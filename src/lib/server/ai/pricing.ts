/**
 * USD per million tokens [input, output]. Claude list prices as published November 2026
 * (Haiku 5.5 is the rate for prompts up to 100K tokens). OpenAI prices are not built in: set
 * AI_PRICES='{"<model>":[input,output]}' from OpenAI's price list, which also overrides any row here.
 * A model with no price is logged with cost null and shown as "price not set" in the Control Centre.
 */
const BUILT_IN: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

function prices(): Record<string, [number, number]> {
  try {
    return { ...BUILT_IN, ...(process.env.AI_PRICES ? JSON.parse(process.env.AI_PRICES) : {}) };
  } catch {
    return BUILT_IN;
  }
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = prices()[model];
  if (!p) return null;
  return Math.round(((inputTokens * p[0] + outputTokens * p[1]) / 1_000_000) * 1e6) / 1e6;
}
