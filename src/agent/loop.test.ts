import { describe, expect, it } from "vitest";
import "../tools/examples.js";
import type { LLMProvider, LLMResponse } from "../llm/provider.js";
import { runAgentLoop } from "./loop.js";

function fakeLLM(responses: LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    async complete() {
      return responses[i++] ?? { text: "fin", toolCalls: [] };
    },
  };
}

describe("runAgentLoop", () => {
  it("ejecuta tools de bajo riesgo y termina con respuesta", async () => {
    const llm = fakeLLM([
      { text: null, toolCalls: [{ id: "1", name: "getUserStatus", arguments: { userId: "8492" } }] },
      { text: "Listo", toolCalls: [] },
    ]);

    const result = await runAgentLoop(llm, "req-1", "estado del usuario 8492");
    expect(result.status).toBe("done");
  });

  it("corta el loop y pide aprobación en tools de riesgo alto", async () => {
    const llm = fakeLLM([
      { text: null, toolCalls: [{ id: "1", name: "reactivarCuenta", arguments: { userId: "8492" } }] },
    ]);

    const result = await runAgentLoop(llm, "req-2", "reactiva la cuenta 8492");
    expect(result.status).toBe("pending_approval");
  });

  it("devuelve error de validación cuando los argumentos no cumplen el schema", async () => {
    const llm = fakeLLM([
      { text: null, toolCalls: [{ id: "1", name: "getUserStatus", arguments: { userId: 123 } }] },
      { text: "fin", toolCalls: [] },
    ]);

    const result = await runAgentLoop(llm, "req-3", "estado inválido");
    expect(result.status).toBe("done");
  });
});
