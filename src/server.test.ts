import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Base en memoria: solo lo que tocan /triage y /approval-callback.
const pending = new Map<string, any>();
vi.mock("./db/client.js", () => ({
  prisma: {
    pendingApproval: {
      findUnique: async ({ where }: any) => pending.get(where.requestId) ?? null,
      updateMany: async ({ where, data }: any) => {
        const row = pending.get(where.requestId);
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    auditLog: { create: async () => ({}) },
    request: { upsert: async () => ({}), updateMany: async () => ({ count: 1 }) },
  },
}));

// El LLM responde texto directo: ninguna llamada real a Gemini.
vi.mock("./llm/gemini.js", () => ({
  GeminiProvider: class {
    async complete() {
      return { text: "ok", toolCalls: [] };
    }
  },
}));

const KEY = "test-key";
let app: Awaited<typeof import("./server.js")>["app"];

beforeAll(async () => {
  process.env.API_KEY = KEY;
  process.env.TRIAGE_RATE_LIMIT = "2";
  ({ app } = await import("./server.js"));
});
afterAll(() => app.close());

beforeEach(() => {
  pending.clear();
  pending.set("req-1", { requestId: "req-1", toolName: "reactivarCuenta", args: { userId: "8492" }, status: "pending" });
});

const callback = (body: object, key: string | null = KEY) =>
  app.inject({
    method: "POST",
    url: "/approval-callback",
    headers: key ? { "x-api-key": key } : {},
    payload: body,
  });

describe("/approval-callback", () => {
  it("401 sin x-api-key o con una incorrecta", async () => {
    expect((await callback({ requestId: "req-1", approved: false }, null)).statusCode).toBe(401);
    expect((await callback({ requestId: "req-1", approved: false }, "mala")).statusCode).toBe(401);
    expect(pending.get("req-1").status).toBe("pending");
  });

  it("404 si no hay aprobación pendiente para ese requestId", async () => {
    expect((await callback({ requestId: "no-existe", approved: true })).statusCode).toBe(404);
  });

  it("400 si el body no cumple el schema", async () => {
    expect((await callback({ requestId: "req-1", approved: "si" })).statusCode).toBe(400);
  });

  it("la segunda decisión sobre el mismo requestId devuelve 409", async () => {
    const first = await callback({ requestId: "req-1", approved: false, decidedBy: "ana" });
    expect(first.json()).toEqual({ status: "rejected" });
    expect((await callback({ requestId: "req-1", approved: true })).statusCode).toBe(409);
    expect(pending.get("req-1").status).toBe("rejected");
  });

  it("dos callbacks simultáneos: solo uno gana", async () => {
    const codes = (await Promise.all([
      callback({ requestId: "req-1", approved: false }),
      callback({ requestId: "req-1", approved: false }),
    ])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
  });
});

describe("/triage rate limit", () => {
  it("devuelve 429 al superar TRIAGE_RATE_LIMIT por minuto", async () => {
    const triage = (id: string) =>
      app.inject({ method: "POST", url: "/triage", headers: { "x-api-key": KEY }, payload: { requestId: id, message: "hola" } });
    expect((await triage("t-1")).statusCode).toBe(200);
    expect((await triage("t-2")).statusCode).toBe(200);
    expect((await triage("t-3")).statusCode).toBe(429);
  });
});
