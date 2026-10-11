import { z } from "zod";
import type { LLMToolSpec } from "../llm/provider.js";

export type RiskLevel = "low" | "medium" | "high";

export interface Tool<TArgs = any> {
  name: string;
  description: string;
  risk: RiskLevel;
  schema: z.ZodType<TArgs>;
  jsonSchema: Record<string, unknown>;
  run: (args: TArgs) => Promise<unknown>;
}

const tools = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function listToolSpecs(): LLMToolSpec[] {
  return [...tools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    jsonSchema: t.jsonSchema,
  }));
}

export function riskOf(name: string): RiskLevel | undefined {
  return tools.get(name)?.risk;
}
