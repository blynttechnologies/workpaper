import Anthropic from '@anthropic-ai/sdk';
import { AiError, type Msg, type Part, type Provider, type ProviderCall, type ProviderResult } from '../types';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
// Models that take the server-side refusal fallback (Haiku 5.5 has none)
const WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5']);

function part(p: Part): Anthropic.Beta.BetaContentBlockParam {
  if (p.type === 'text') return { type: 'text', text: p.text };
  if (p.mime === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } };
  if ((IMAGE_TYPES as readonly string[]).includes(p.mime)) {
    return { type: 'image', source: { type: 'base64', media_type: p.mime as (typeof IMAGE_TYPES)[number], data: p.data } };
  }
  if (p.mime.startsWith('text/') || p.mime === 'application/json') {
    return { type: 'text', text: `<document name="${p.filename ?? 'file'}">\n${Buffer.from(p.data, 'base64').toString('utf8')}\n</document>` };
  }
  throw new AiError(`Claude cannot read ${p.mime} files.`, 'bad_request');
}

function messages(msgs: Msg[]): Anthropic.Beta.BetaMessageParam[] {
  return msgs.map((m): Anthropic.Beta.BetaMessageParam => {
    if (m.role === 'user') return { role: 'user', content: m.content.map(part) };
    if (m.role === 'assistant') {
      // The reply exactly as Claude sent it (thinking blocks included), as the API requires in a tool loop
      if (m.raw) return { role: 'assistant', content: m.raw as Anthropic.Beta.BetaContentBlockParam[] };
      return {
        role: 'assistant',
        content: [
          ...(m.text ? [{ type: 'text' as const, text: m.text }] : []),
          ...m.toolCalls.map((t) => ({ type: 'tool_use' as const, id: t.id, name: t.name, input: t.input as Record<string, unknown> })),
        ],
      };
    }
    return {
      role: 'user',
      content: m.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.output, is_error: !!r.isError })),
    };
  });
}

function mapError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  // Not retried: a second wait on the same provider would outlast the Lambda; the gateway falls back instead
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError('Claude took too long to answer.', 'timeout');
  if (err instanceof Anthropic.APIConnectionError) return new AiError('Could not reach Claude.', 'provider', true);
  if (err instanceof Anthropic.RateLimitError) return new AiError('Claude is rate limiting requests.', 'rate_limited', true);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiError('The Anthropic API key was refused.', 'not_configured');
  if (err instanceof Anthropic.BadRequestError) return new AiError(`Claude refused the request: ${err.message.slice(0, 200)}`, 'bad_request');
  if (err instanceof Anthropic.APIError) return new AiError(`Claude returned an error (${err.status}).`, 'provider', (err.status ?? 500) >= 500);
  return new AiError(err instanceof Error ? err.message : String(err), 'provider');
}

export const anthropicProvider: Provider = {
  id: 'anthropic',
  label: 'Claude (Anthropic)',
  configured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  defaultModel: () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',

  async call(c: ProviderCall): Promise<ProviderResult> {
    // Retries are the gateway's job, so it can log and fall back between attempts
    const client = new Anthropic({ timeout: c.timeoutMs, maxRetries: 0 });
    try {
      // Streamed: long documents can give long outputs; finalMessage() collects them
      const res = await client.beta.messages
        .stream({
          model: c.model,
          max_tokens: c.maxTokens,
          ...(WITH_FALLBACK.has(c.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          system: c.system,
          output_config: { effort: c.effort, ...(c.schema ? { format: { type: 'json_schema' as const, schema: c.schema } } : {}) },
          ...(c.tools?.length
            ? { tools: c.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema, strict: true })) }
            : {}),
          messages: messages(c.messages),
        })
        .finalMessage();
      const stop =
        res.stop_reason === 'end_turn' ? 'end' : res.stop_reason === 'tool_use' ? 'tool' : res.stop_reason === 'max_tokens' ? 'max_tokens' : res.stop_reason === 'refusal' ? 'refusal' : 'other';
      return {
        text: res.content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
        toolCalls: res.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [])),
        stop,
        inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
        outputTokens: res.usage.output_tokens,
        model: res.model,
        raw: res.content,
      };
    } catch (err) {
      throw mapError(err);
    }
  },
};
