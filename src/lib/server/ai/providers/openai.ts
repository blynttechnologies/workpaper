import { AiError, type Msg, type Part, type Provider, type ProviderCall, type ProviderResult } from '../types';

/**
 * OpenAI through the Responses API, called over HTTPS without the SDK (one endpoint, a few fields).
 * `store: false`: OpenAI keeps no copy of the conversation for later retrieval.
 * The model comes from OPENAI_MODEL; there is no built-in default, so nothing runs on a model nobody chose.
 */

type Item = Record<string, unknown>;

function part(p: Part): Item {
  if (p.type === 'text') return { type: 'input_text', text: p.text };
  if (p.mime.startsWith('image/')) return { type: 'input_image', image_url: `data:${p.mime};base64,${p.data}` };
  if (p.mime === 'application/pdf') return { type: 'input_file', filename: p.filename ?? 'document.pdf', file_data: `data:application/pdf;base64,${p.data}` };
  if (p.mime.startsWith('text/') || p.mime === 'application/json') {
    return { type: 'input_text', text: `<document name="${p.filename ?? 'file'}">\n${Buffer.from(p.data, 'base64').toString('utf8')}\n</document>` };
  }
  throw new AiError(`OpenAI cannot read ${p.mime} files.`, 'bad_request');
}

function input(msgs: Msg[]): Item[] {
  return msgs.flatMap((m): Item[] => {
    if (m.role === 'user') return [{ role: 'user', content: m.content.map(part) }];
    if (m.role === 'assistant') {
      if (Array.isArray(m.raw)) return m.raw as Item[];
      return m.toolCalls.map((t) => ({ type: 'function_call', call_id: t.id, name: t.name, arguments: JSON.stringify(t.input) }));
    }
    return m.results.map((r) => ({ type: 'function_call_output', call_id: r.id, output: r.output }));
  });
}

// Models that take a reasoning effort (GPT-5 onwards and the o-series)
const isReasoning = (model: string) => /^(gpt-([5-9]|\d{2})|o\d)/.test(model);

export const openaiProvider: Provider = {
  id: 'openai',
  label: 'OpenAI API',
  configured: () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
  defaultModel: () => process.env.OPENAI_MODEL || '',

  async call(c: ProviderCall): Promise<ProviderResult> {
    const body = {
      model: c.model,
      instructions: c.system,
      input: input(c.messages),
      max_output_tokens: c.maxTokens,
      store: false,
      ...(isReasoning(c.model) ? { reasoning: { effort: c.effort } } : {}),
      ...(c.schema ? { text: { format: { type: 'json_schema', name: 'output', schema: c.schema, strict: true } } } : {}),
      ...(c.tools?.length ? { tools: c.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema, strict: true })) } : {}),
    };
    let res: Response;
    try {
      res = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(c.timeoutMs),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') throw new AiError('OpenAI took too long to answer.', 'timeout', true);
      throw new AiError('Could not reach OpenAI.', 'provider', true);
    }
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; type?: string; code?: string };
      status?: string;
      incomplete_details?: { reason?: string };
      model?: string;
      output?: Item[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (!res.ok) {
      const msg = json.error?.message?.slice(0, 200) ?? `status ${res.status}`;
      // OpenAI also answers 429 when the account is out of credit: retrying cannot help, so say so and fall back
      if (res.status === 429 && json.error?.type === 'insufficient_quota') throw new AiError('The OpenAI account has no credit left. Add credit in the OpenAI billing settings.', 'provider');
      if (res.status === 429) throw new AiError('OpenAI is rate limiting requests.', 'rate_limited', true);
      if (res.status === 401 || res.status === 403) throw new AiError('The OpenAI API key was refused.', 'not_configured');
      if (res.status >= 500) throw new AiError(`OpenAI returned an error (${res.status}).`, 'provider', true);
      throw new AiError(`OpenAI refused the request: ${msg}`, 'bad_request');
    }
    const output = json.output ?? [];
    let text = '';
    let refused = false;
    const toolCalls: ProviderResult['toolCalls'] = [];
    for (const item of output) {
      if (item.type === 'message') {
        for (const c of (item.content as Item[]) ?? []) {
          if (c.type === 'output_text') text += String(c.text ?? '');
          if (c.type === 'refusal') refused = true;
        }
      } else if (item.type === 'function_call') {
        let args: unknown = {};
        try {
          args = JSON.parse(String(item.arguments ?? '{}'));
        } catch {
          throw new AiError('OpenAI sent tool arguments that are not valid JSON.', 'invalid_output', true);
        }
        toolCalls.push({ id: String(item.call_id), name: String(item.name), input: args });
      }
    }
    const stop = refused
      ? 'refusal'
      : json.status === 'incomplete' && json.incomplete_details?.reason === 'max_output_tokens'
        ? 'max_tokens'
        : toolCalls.length
          ? 'tool'
          : json.status === 'completed'
            ? 'end'
            : 'other';
    return {
      text,
      toolCalls,
      stop,
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      model: json.model ?? c.model,
      // Handed back on the next tool round: the calls and any message, never reasoning items (not stored)
      raw: output.filter((i) => i.type === 'function_call' || i.type === 'message'),
    };
  },
};
