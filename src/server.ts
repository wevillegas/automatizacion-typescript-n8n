import Fastify from "fastify";
import { z } from "zod";
import "./tools/examples.js";
import { Prisma } from "@prisma/client";
import { prisma } from "./db/client.js";
import { resumeAfterApproval, runAgentLoop, type ToolExecutedEvent } from "./agent/loop.js";
import { GeminiProvider } from "./llm/gemini.js";

const app = Fastify({ logger: true });

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

app.get("/health", async () => ({ ok: true }));

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
    return reply.send({ status: "pending_approval", toolName: result.toolName, args: result.args });
  }

  return reply.send(result);
});

const approvalSchema = z.object({
  requestId: z.string(),
  approved: z.boolean(),
  decidedBy: z.string().optional(),
});

app.post("/approval-callback", async (req, reply) => {
  if (!requireApiKey(req, reply)) return;
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.message });
  }
  const { requestId, approved, decidedBy } = parsed.data;

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
    return reply.send({ status: "rejected" });
  }

  const result = await resumeAfterApproval(
    llm,
    requestId,
    pending.messages as any,
    pending.toolName,
    pending.args,
    pending.callId,
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
    return reply.send({ status: "pending_approval", requestId, toolName: result.toolName, args: result.args });
  }

  return reply.send(result);
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
