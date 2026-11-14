/**
 * USD per million tokens [input, output], standard tier, as published November 2026.
 * Claude: Anthropic list prices (Haiku 5.5 is the rate for prompts up to 100K tokens).
 * OpenAI: developers.openai.com/api/docs/pricing; GPT-5.x and 6.x rows are the under-272K-context rates.
 * AI_PRICES='{"<model>":[input,output]}' adds or overrides rows without a deploy of new code.
 * A model with no price is logged with cost null and shown as "price not set" in the Control Centre.
 */
const BUILT_IN: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'gpt-5.5': [5, 30],
  'gpt-5.4': [2.5, 15],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-6-astra': [10, 50],
  'gpt-6-sol': [2, 10],
  'gpt-6-luna': [0.1, 0.5],
  'gpt-6.1-sol': [2, 10],
};

function prices(): Record<string, [number, number]> {
  try {
    return { ...BUILT_IN, ...(process.env.AI_PRICES ? JSON.parse(process.env.AI_PRICES) : {}) };
  } catch {
    return BUILT_IN;
  }
}

/** Dated snapshots (gpt-5.5-2026-04-23) are priced as their base model. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const table = prices();
  const p = table[model] ?? table[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (!p) return null;
  return Math.round(((inputTokens * p[0] + outputTokens * p[1]) / 1_000_000) * 1e6) / 1e6;
}
