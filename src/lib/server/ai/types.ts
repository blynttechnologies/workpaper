/** Shapes shared by the AI gateway, its tasks and its provider adapters. Modules never see provider types. */

export type ProviderId = 'anthropic' | 'openai';
export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai'];
export type Mode = 'single' | 'review' | 'collaborate';
/** Where the request came from: the Workpaper app, or an outside assistant through the MCP server. */
export type Channel = 'app' | 'chatgpt' | 'copilot' | 'mcp';
export type Effort = 'low' | 'medium' | 'high';
export type JsonSchema = Record<string, unknown>;

/** Content sent to a model. Files are base64; documents are always untrusted input. */
export type Part = { type: 'text'; text: string } | { type: 'file'; mime: string; data: string; filename?: string };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: JsonSchema;
}

export type Msg =
  | { role: 'user'; content: Part[] }
  /** `raw` is the provider's own reply content, handed back unchanged to the same provider in a tool loop. */
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: { id: string; output: string; isError?: boolean }[] };

export interface ProviderCall {
  model: string;
  system: string;
  messages: Msg[];
  schema?: JsonSchema;
  tools?: ToolDef[];
  maxTokens: number;
  effort: Effort;
  timeoutMs: number;
}

export interface ProviderResult {
  text: string;
  toolCalls: ToolCall[];
  stop: 'end' | 'tool' | 'max_tokens' | 'refusal' | 'other';
  inputTokens: number;
  outputTokens: number;
  /** The model that actually answered (a server-side fallback can differ from the one asked for). */
  model: string;
  raw?: unknown;
}

export interface Provider {
  id: ProviderId;
  label: string;
  configured(): boolean;
  defaultModel(): string;
  call(c: ProviderCall): Promise<ProviderResult>;
}

export type AiErrorCode =
  | 'not_configured'
  | 'disabled'
  | 'limit'
  | 'timeout'
  | 'rate_limited'
  | 'provider'
  | 'invalid_output'
  | 'refusal'
  | 'truncated'
  | 'bad_request'
  | 'tool';

export class AiError extends Error {
  constructor(
    message: string,
    public code: AiErrorCode,
    public retryable = false
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Who asked, for tenant checks, limits and the request log. */
export interface RunCtx {
  firmId: string;
  userId: string;
  channel?: Channel;
  engagementId?: string;
}

export interface ToolBox {
  defs: ToolDef[];
  run(name: string, input: unknown): Promise<string>;
}

export interface TaskDef<I, O> {
  id: string;
  /** The Workpaper area the task serves, for cost by module. */
  module: string;
  /** Bumped whenever the prompt or schema changes; logged with every request and every accepted value. */
  version: string;
  system: string;
  build(input: I): Part[];
  /** Structured output. Without it the output is the model's text. */
  schema?: JsonSchema;
  /** Read-only tools the model may call. Tasks that read client documents get none. */
  tools?: (ctx: RunCtx) => ToolBox;
  maxTokens: number;
  effort: Effort;
  provider?: ProviderId;
  mode?: Mode;
  /** Review mode: do two independent outputs agree? Default: identical JSON. */
  agree?(a: O, b: O): boolean;
  timeoutMs?: number;
}

/** Which model read a document, carried onto confidence-gate items and into AI lineage when a person accepts a value. */
export interface AiSource {
  provider: string;
  model: string;
  task_version: string;
  request_id: string;
  /** Review mode: false when a second model read it differently */
  agreement?: boolean;
}

export interface RunResult<O> {
  output: O;
  provider: ProviderId;
  model: string;
  requestId: string;
  taskVersion: string;
  mode: Mode;
  /** Review mode only: whether the second provider reached the same result. */
  agreement?: boolean;
  second?: { provider: ProviderId; model: string; output: O };
}
