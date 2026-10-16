import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { z } from "zod";
import "./tools/examples.js";
import { Prisma } from "@prisma/client";
import { prisma } from "./db/client.js";
import { resumeAfterApproval, runAgentLoop, type ToolExecutedEvent } from "./agent/loop.js";
import { GeminiProvider } from "./llm/gemini.js";

export const app = Fastify({ logger: !process.env.VITEST });

const apiKey = process.env.GEMINI_API_KEY ?? "";
const llm = new GeminiProvider(apiKey);

const sharedApiKey = process.env.API_KEY;
if (!sharedApiKey) {
  throw new Error("API_KEY no configurada: requerida para autenticar /triage y /approval-callback");
}

function requireApiKey(req: { headers: Record<string, unknown> }, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) {
  if (req.headers["x-api-key"] !== sharedApiKey) {
    reply.status(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

// Dashboard: usuario logueado en Supabase Auth. Se valida el token contra Supabase y decidedBy sale de ahí,
// nunca del body. Si el registro está abierto cualquiera con la anon key (pública) podría crearse una cuenta
// y aprobar, así que en ese caso se rechaza.
type ApprovalAuth = { email: string | null } | { status: number; error: string };
async function authorizeApproval(headers: Record<string, unknown>): Promise<ApprovalAuth> {
  if (headers["x-api-key"] === sharedApiKey) return { email: null }; // n8n: decidedBy viene en el body
  const auth = headers.authorization;
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ") || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { status: 401, error: "unauthorized" };
  }
  const get = (path: string, extra: Record<string, string> = {}) =>
    fetch(`${SUPABASE_URL}/auth/v1/${path}`, { headers: { apikey: SUPABASE_ANON_KEY, ...extra } }).then((r) =>
      r.ok ? r.json() : null,
    );
  const [settings, user] = await Promise.all([get("settings"), get("user", { authorization: auth })]);
  if (!user?.email) return { status: 401, error: "sesión inválida o vencida" };
  if (settings?.disable_signup !== true) {
    return { status: 403, error: "deshabilitá el registro público en Supabase Auth para aprobar desde el dashboard" };
  }
  return { email: user.email };
}

async function logToolExecution(event: ToolExecutedEvent): Promise<void> {
  await prisma.auditLog.create({
    data: {
      requestId: event.requestId,
      toolName: event.toolName,
      args: event.args as object,
      result: event.result === null ? Prisma.JsonNull : (event.result as object),
      risk: event.risk,
      decidedBy: event.decidedBy ?? null,
    },
  });
}

// Una fila por solicitud, que es lo que lee el dashboard. updateMany: no falla si la fila no existe
// (aprobaciones creadas antes de que existiera la tabla).
type RequestState = { status: string; response?: string; toolName?: string; args?: object };
const trackRequest = (requestId: string, message: string, data: RequestState) =>
  prisma.request.upsert({ where: { requestId }, create: { requestId, message, ...data }, update: data });
const updateRequest = (requestId: string, data: RequestState) =>
  prisma.request.updateMany({ where: { requestId }, data });

// Protege la cuota de Gemini: como mucho TRIAGE_RATE_LIMIT corridas del agente por minuto.
// ponytail: ventana global en memoria (una sola instancia); usar @fastify/rate-limit con store compartido si se escala.
const triageLimit = Number(process.env.TRIAGE_RATE_LIMIT ?? 20);
let triageHits: number[] = [];
function triageAllowed(now = Date.now()): boolean {
  triageHits = triageHits.filter((t) => now - t < 60_000);
  if (triageHits.length >= triageLimit) return false;
  triageHits.push(now);
  return true;
}

app.get("/health", async () => ({ ok: true }));

// Dashboard estático: lee AuditLog desde Supabase con la anon key (pública por diseño, limitada por RLS).
app.get("/dashboard", async (_req, reply) => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return reply.status(503).send({ error: "SUPABASE_URL y SUPABASE_ANON_KEY no configuradas" });
  }
  const html = readFileSync("dashboard/index.html", "utf8")
    .replace("__SUPABASE_URL__", SUPABASE_URL)
    .replace("__SUPABASE_ANON_KEY__", SUPABASE_ANON_KEY);
  return reply.type("text/html").send(html);
});

const triageSchema = z.object({
  requestId: z.string(),
  message: z.string(),
});

app.post("/triage", async (req, reply) => {
  if (!requireApiKey(req, reply)) return;
  const parsed = triageSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.message });
  }
  const { requestId, message } = parsed.data;

  // Idempotencia: un webhook reenviado con el mismo requestId no vuelve a disparar el loop.
  const existing = await prisma.pendingApproval.findUnique({ where: { requestId } });
  if (existing) {
    return reply.send({ status: "duplicate_ignored" });
  }

  if (!triageAllowed()) {
    return reply.status(429).send({ error: "demasiadas solicitudes, reintentar en un minuto" });
  }

  const result = await runAgentLoop(llm, requestId, message, { onToolExecuted: logToolExecution });

  if (result.status === "pending_approval") {
    await prisma.pendingApproval.create({
      data: {
        requestId: result.requestId,
        toolName: result.toolName,
        args: result.args as object,
        callId: result.callId,
        messages: result.messages as object,
      },
    });
    await logToolExecution({
      requestId: result.requestId,
      toolName: result.toolName,
      args: result.args,
      result: null,
      risk: "high",
    });
    await trackRequest(requestId, message, { status: "pending", toolName: result.toolName, args: result.args as object });
    return reply.send({ status: "pending_approval", toolName: result.toolName, args: result.args });
  }

  await trackRequest(requestId, message, { status: "resolved", response: result.text });
  return reply.send(result);
});

const approvalSchema = z.object({
  requestId: z.string(),
  approved: z.boolean(),
  decidedBy: z.string().optional(),
});

app.post("/approval-callback", async (req, reply) => {
  const auth = await authorizeApproval(req.headers);
  if ("error" in auth) return reply.status(auth.status).send({ error: auth.error });
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.message });
  }
  const { requestId, approved } = parsed.data;
  const decidedBy = auth.email ?? parsed.data.decidedBy;

  const pending = await prisma.pendingApproval.findUnique({ where: { requestId } });
  if (!pending) {
    return reply.status(404).send({ error: "no hay aprobación pendiente para ese requestId" });
  }

  // Transición atómica: si dos callbacks llegan a la vez para el mismo requestId,
  // solo uno encuentra status "pending" en la cláusula WHERE y gana la carrera.
  const claimed = await prisma.pendingApproval.updateMany({
    where: { requestId, status: "pending" },
    data: { status: approved ? "approved" : "rejected" },
  });
  if (claimed.count === 0) {
    return reply.status(409).send({ error: "esta aprobación ya fue procesada" });
  }

  if (!approved) {
    await prisma.auditLog.create({
      data: {
        requestId,
        toolName: pending.toolName,
        args: pending.args as object,
        result: Prisma.JsonNull,
        risk: "high",
        decidedBy: decidedBy ?? "unknown",
      },
    });
    await updateRequest(requestId, { status: "rejected" });
    return reply.send({ status: "rejected" });
  }

  const result = await resumeAfterApproval(
    llm,
    requestId,
    pending.messages as any,
    pending.toolName,
    pending.args,
    pending.callId,
    decidedBy ?? "unknown",
    { onToolExecuted: logToolExecution },
  );

  if (result.status === "pending_approval") {
    // Mismo requestId: runAgentLoop/resumeAfterApproval nunca lo cambian, así que
    // el cliente (n8n/Slack) puede seguir aprobando con el ID que ya conoce.
    await prisma.pendingApproval.update({
      where: { requestId },
      data: {
        toolName: result.toolName,
        args: result.args as object,
        callId: result.callId,
        messages: result.messages as object,
        status: "pending",
      },
    });
    await updateRequest(requestId, { status: "pending", toolName: result.toolName, args: result.args as object });
    return reply.send({ status: "pending_approval", requestId, toolName: result.toolName, args: result.args });
  }

  await updateRequest(requestId, { status: "approved", response: result.text });
  return reply.send(result);
});

const port = Number(process.env.PORT ?? 3000);
if (!process.env.VITEST) app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
