import type { LLMMessage, LLMProvider } from "../llm/provider.js";
import { getTool, listToolSpecs } from "../tools/registry.js";

const MAX_ITERATIONS = 8;

export interface PendingApproval {
  status: "pending_approval";
  toolName: string;
  args: unknown;
  requestId: string;
  callId: string;
  messages: LLMMessage[]; // historial en el punto de corte, para reanudar tras la decisión humana
}

export interface AgentDone {
  status: "done";
  text: string;
}

export type AgentResult = PendingApproval | AgentDone;

export interface ToolExecutedEvent {
  requestId: string;
  toolName: string;
  args: unknown;
  result: unknown;
  risk: "low" | "medium" | "high";
  decidedBy?: string;
}

export interface LoopOptions {
  onToolExecuted?: (event: ToolExecutedEvent) => Promise<void>;
}

export async function runAgentLoop(
  llm: LLMProvider,
  requestId: string,
  input: string | LLMMessage[],
  opts: LoopOptions = {},
): Promise<AgentResult> {
  // El texto del usuario se trata siempre como dato, nunca como instrucción del sistema.
  const messages: LLMMessage[] =
    typeof input === "string" ? [{ role: "user", content: input }] : [...input];
  const tools = listToolSpecs();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await llm.complete(messages, tools);

    if (response.toolCalls.length === 0) {
      return { status: "done", text: response.text ?? "" };
    }

    // El turno del modelo (su pedido de function call) debe quedar en el historial:
    // sin esto, el modelo no "recuerda" haber pedido la tool y vuelve a pedirla en el siguiente turno.
    messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });

    for (const call of response.toolCalls) {
      const tool = getTool(call.name);
      if (!tool) {
        messages.push({ role: "tool", content: `Error: tool ${call.name} no existe`, toolCallId: call.id, toolName: call.name });
        continue;
      }

      const parsed = tool.schema.safeParse(call.arguments);
      if (!parsed.success) {
        messages.push({
          role: "tool",
          content: `Error de validación: ${parsed.error.message}`,
          toolCallId: call.id,
          toolName: call.name,
        });
        continue;
      }

      if (tool.risk === "high") {
        return {
          status: "pending_approval",
          toolName: tool.name,
          args: parsed.data,
          requestId,
          callId: call.id,
          messages,
        };
      }

      const result = await tool.run(parsed.data);
      await opts.onToolExecuted?.({ requestId, toolName: tool.name, args: parsed.data, result, risk: tool.risk });
      messages.push({ role: "tool", content: JSON.stringify(result), toolCallId: call.id, toolName: call.name });
    }
  }

  return { status: "done", text: "Límite de iteraciones alcanzado sin resolución." };
}

export async function resumeAfterApproval(
  llm: LLMProvider,
  requestId: string,
  messages: LLMMessage[],
  toolName: string,
  args: unknown,
  callId: string,
  decidedBy: string,
  opts: LoopOptions = {},
): Promise<AgentResult> {
  const tool = getTool(toolName);
  if (!tool) {
    return { status: "done", text: `Error: tool ${toolName} no existe` };
  }

  const result = await tool.run(args);
  await opts.onToolExecuted?.({ requestId, toolName, args, result, risk: tool.risk, decidedBy });

  const resumedMessages: LLMMessage[] = [
    ...messages,
    { role: "tool", content: JSON.stringify(result), toolCallId: callId, toolName },
  ];

  return runAgentLoop(llm, requestId, resumedMessages, opts);
}
