// Contrato que debe cumplir cualquier modelo (Gemini, Claude, ...).
// El resto del agente nunca importa un SDK de proveedor directamente.

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
  thoughtSignature?: string; // exigido por Gemini 3 para reconstruir el functionCall en el siguiente turno
}

export interface LLMMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string; // nombre de la tool, requerido por Gemini para armar el functionResponse
  toolCalls?: ToolCall[]; // function calls que el modelo pidió en este turno (role "assistant")
}

export interface LLMToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}

export interface LLMResponse {
  text: string | null;
  toolCalls: ToolCall[];
}

export interface LLMProvider {
  complete(messages: LLMMessage[], tools: LLMToolSpec[]): Promise<LLMResponse>;
}
