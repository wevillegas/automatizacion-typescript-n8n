import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Base en memoria: solo lo que tocan /triage y /approval-callback.
const pending = new Map<string, any>();
const audit: any[] = [];
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
    auditLog: { create: async ({ data }: any) => void audit.push(data) },
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
  audit.length = 0;
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

describe("/approval-callback con login de Supabase", () => {
  // Fake de Supabase Auth: el token "valido" es de ana@empresa.com.
  function fakeSupabase(disableSignup: boolean) {
    process.env.SUPABASE_URL = "https://sb.test";
    process.env.SUPABASE_ANON_KEY = "anon";
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      if (url.endsWith("/auth/v1/settings")) return Response.json({ disable_signup: disableSignup });
      const ok = init.headers.authorization === "Bearer valido";
      return ok ? Response.json({ email: "ana@empresa.com" }) : new Response("{}", { status: 401 });
    });
  }
  const withToken = (t: string, body: object) =>
    app.inject({ method: "POST", url: "/approval-callback", headers: { authorization: `Bearer ${t}` }, payload: body });
  afterAll(() => vi.unstubAllGlobals());

  it("registra el email del token como decidedBy, ignorando el del body", async () => {
    fakeSupabase(true);
    const res = await withToken("valido", { requestId: "req-1", approved: false, decidedBy: "impostor" });
    expect(res.statusCode).toBe(200);
    expect(audit.at(-1).decidedBy).toBe("ana@empresa.com");
  });

  it("avisa la decisión a n8n con quién decidió", async () => {
    fakeSupabase(true);
    const avisos: any[] = [];
    const supabaseFetch = globalThis.fetch;
    process.env.N8N_NOTIFY_URL = "http://n8n.test/webhook/decision-notify";
    vi.stubGlobal("fetch", async (url: string, init: any) =>
      url.startsWith("http://n8n.test") ? (avisos.push(JSON.parse(init.body)), new Response("{}")) : supabaseFetch(url, init),
    );
    await withToken("valido", { requestId: "req-1", approved: false });
    delete process.env.N8N_NOTIFY_URL;
    expect(avisos).toEqual([
      { requestId: "req-1", approved: false, decidedBy: "ana@empresa.com", toolName: "reactivarCuenta", status: "rejected" },
    ]);
  });

  it("401 con un token inválido", async () => {
    fakeSupabase(true);
    expect((await withToken("falso", { requestId: "req-1", approved: false })).statusCode).toBe(401);
    expect(pending.get("req-1").status).toBe("pending");
  });

  it("403 si el registro público de Supabase está abierto", async () => {
    fakeSupabase(false);
    expect((await withToken("valido", { requestId: "req-1", approved: false })).statusCode).toBe(403);
    expect(pending.get("req-1").status).toBe("pending");
  });
});
