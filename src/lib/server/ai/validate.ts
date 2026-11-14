import type { JsonSchema } from './types';

/**
 * Checks a value against the subset of JSON Schema the tasks use (type, enum, properties, required,
 * additionalProperties: false, items). Returns the problems found; empty means valid.
 * AI output is untrusted: nothing reaches a workpaper without passing this.
 */
export function validate(schema: JsonSchema, value: unknown, path = '$'): string[] {
  const s = schema as {
    type?: string | string[];
    enum?: unknown[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
  };
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  if (types.length && !types.some((t) => isType(t, value))) return [`${path}: expected ${types.join(' or ')}`];
  if (s.enum && !s.enum.includes(value)) return [`${path}: not one of ${s.enum.join(', ')}`];
  const errors: string[] = [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in obj)) errors.push(`${path}.${k}: missing`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = s.properties?.[k];
      if (sub) errors.push(...validate(sub, v, `${path}.${k}`));
      else if (s.additionalProperties === false) errors.push(`${path}.${k}: not allowed`);
    }
  }
  if (Array.isArray(value) && s.items) value.forEach((v, i) => errors.push(...validate(s.items!, v, `${path}[${i}]`)));
  return errors;
}

function isType(t: string, v: unknown): boolean {
  switch (t) {
    case 'object':
      return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'array':
      return Array.isArray(v);
    case 'integer':
      return Number.isInteger(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'null':
      return v === null;
    default:
      return typeof v === t;
  }
}
