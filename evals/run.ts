import { readFileSync } from "node:fs";
import { GeminiProvider } from "../src/llm/gemini.js";
import { runAgentLoop } from "../src/agent/loop.js";
import "../src/tools/examples.js";

interface EvalCase {
  id: string;
  message: string;
  expectedTools: string[];
  risk: string;
  expectEscalation?: boolean;
}

const cases: EvalCase[] = JSON.parse(readFileSync(new URL("./dataset.json", import.meta.url), "utf-8"));
const llm = new GeminiProvider(process.env.GEMINI_API_KEY ?? "");

let correct = 0;
let escalatedCorrectly = 0;
const escalationCases = cases.filter((c) => c.expectEscalation);

for (const c of cases) {
  // Correcto = terminó como se esperaba Y usó la tool esperada (no alcanza con que responda algo).
  const used: string[] = [];
  const result = await runAgentLoop(llm, c.id, c.message, {
    onToolExecuted: async (e) => void used.push(e.toolName),
  });
  if (result.status === "pending_approval") used.push(result.toolName);
  const toolsOk = c.expectedTools.every((t) => used.includes(t));

  if (c.expectEscalation) {
    if (result.status === "pending_approval" && toolsOk) escalatedCorrectly++;
  } else if (result.status === "done" && toolsOk) {
    correct++;
  }

  console.log(`[${c.id}] -> ${result.status} (tools: ${used.join(", ") || "ninguna"}) ${toolsOk ? "OK" : "FALLA"}`);
}

console.log(`\nResolución correcta: ${correct}/${cases.length - escalationCases.length}`);
console.log(`Escalamiento correcto: ${escalatedCorrectly}/${escalationCases.length}`);
