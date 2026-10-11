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
  const result = await runAgentLoop(llm, c.id, c.message);

  if (c.expectEscalation) {
    if (result.status === "pending_approval") escalatedCorrectly++;
  } else if (result.status === "done") {
    correct++;
  }

  console.log(`[${c.id}] -> ${result.status}`);
}

console.log(`\nResolución correcta: ${correct}/${cases.length - escalationCases.length}`);
console.log(`Escalamiento correcto: ${escalatedCorrectly}/${escalationCases.length}`);
