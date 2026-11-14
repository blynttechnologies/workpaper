import { AiError, type Msg, type Part, type Provider, type ProviderCall, type ProviderResult } from '../types';

/**
 * Google Gemini through the Gemini API generateContent endpoint, over HTTPS without the SDK.
 * The key goes in the x-goog-api-key header, never in the URL, so it cannot end up in access logs.
 * GEMINI_MODEL picks the model; without it, gemini-4-hydrogen.
 */

type Item = Record<string, unknown>;

function part(p: Part): Item {
  if (p.type === 'text') return { text: p.text };
  if (p.mime.startsWith('image/') || p.mime === 'application/pdf') return { inlineData: { mimeType: p.mime, data: p.data } };
  if (p.mime.startsWith('text/') || p.mime === 'application/json') {
    return { text: `<document name="${p.filename ?? 'file'}">\n${Buffer.from(p.data, 'base64').toString('utf8')}\n</document>` };
  }
  throw new AiError(`Gemini cannot read ${p.mime} files.`, 'bad_request');
}

function contents(msgs: Msg[]): Item[] {
  const names = new Map<string, string>(); // tool results carry only the call id; Gemini also wants the name
  return msgs.map((m): Item => {
    if (m.role === 'user') return { role: 'user', parts: m.content.map(part) };
    if (m.role === 'assistant') {
      for (const t of m.toolCalls) names.set(t.id, t.name);
      // The model's own content goes back unchanged: it carries the thought signatures Gemini checks on the next round
      if (m.raw && typeof m.raw === 'object') return m.raw as Item;
      return { role: 'model', parts: m.toolCalls.map((t) => ({ functionCall: { id: t.id, name: t.name, args: t.input } })) };
    }
    return {
      role: 'user',
      parts: m.results.map((r) => ({ functionResponse: { id: r.id, name: names.get(r.id) ?? '', response: r.isError ? { error: r.output } : { output: r.output } } })),
    };
  });
}

const REFUSED = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

export const geminiProvider: Provider = {
  id: 'gemini',
  label: 'Google Gemini API',
  configured: () => Boolean(process.env.GEMINI_API_KEY),
  defaultModel: () => process.env.GEMINI_MODEL || 'gemini-4-hydrogen',

  async call(c: ProviderCall): Promise<ProviderResult> {
    const body = {
      systemInstruction: { parts: [{ text: c.system }] },
      contents: contents(c.messages),
      generationConfig: {
        maxOutputTokens: c.maxTokens,
        thinkingConfig: { thinkingLevel: c.effort },
        ...(c.schema ? { responseMimeType: 'application/json', responseJsonSchema: c.schema } : {}),
      },
      ...(c.tools?.length ? { tools: [{ functionDeclarations: c.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.schema })) }] } : {}),
    };
    const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    let res: Response;
    try {
      res = await fetch(`${base}/models/${encodeURIComponent(c.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(c.timeoutMs),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') throw new AiError('Gemini took too long to answer.', 'timeout', true);
      throw new AiError('Could not reach Gemini.', 'provider', true);
    }
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string; details?: { reason?: string }[] };
      candidates?: { content?: { role?: string; parts?: Item[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      modelVersion?: string;
    };
    if (!res.ok) {
      const msg = json.error?.message?.slice(0, 200) ?? `status ${res.status}`;
      // Google answers 400 (not 401) for a wrong key
      if (res.status === 401 || res.status === 403 || json.error?.details?.some((d) => d.reason === 'API_KEY_INVALID')) throw new AiError('The Gemini API key was refused.', 'not_configured');
      if (res.status === 429) throw new AiError('Gemini is rate limiting requests or the quota is used up.', 'rate_limited', true);
      if (res.status >= 500) throw new AiError(`Gemini returned an error (${res.status}).`, 'provider', true);
      throw new AiError(`Gemini refused the request: ${msg}`, 'bad_request');
    }
    const cand = json.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    let text = '';
    const toolCalls: ProviderResult['toolCalls'] = [];
    parts.forEach((p, i) => {
      if (typeof p.text === 'string' && !p.thought) text += p.text;
      const fc = p.functionCall as { id?: string; name?: string; args?: unknown } | undefined;
      if (fc?.name) toolCalls.push({ id: fc.id || `call_${i}_${fc.name}`, name: fc.name, input: fc.args ?? {} });
    });
    const reason = cand?.finishReason;
    const stop = json.promptFeedback?.blockReason || (reason && REFUSED.has(reason))
      ? 'refusal'
      : reason === 'MAX_TOKENS'
        ? 'max_tokens'
        : toolCalls.length
          ? 'tool'
          : reason === 'STOP'
            ? 'end'
            : 'other';
    const u = json.usageMetadata ?? {};
    return {
      text,
      toolCalls,
      stop,
      inputTokens: u.promptTokenCount ?? 0,
      // Thinking tokens are billed as output
      outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      model: json.modelVersion ?? c.model,
      raw: cand?.content ? { role: 'model', parts } : undefined,
    };
  },
};
