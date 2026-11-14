// Words too common in nominal names to say two accounts are the same kind
const COMMON = new Set(['account', 'accounts', 'sales', 'other', 'general', 'total', 'fees', 'cost', 'costs', 'income', 'expense', 'expenses', 'revenue', 'control', 'route', 'misc', 'sundry']);

/** The name with codes and numbers as *: "Route 2V Wages" and "Route 52 Wages" are both "route * wages". */
export const nameShape = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (/\d/.test(w) ? '*' : w))
    .join(' ');

const keyWords = (name: string) => new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/\d/.test(w) && !COMMON.has(w)));

type Line = { id: string; source_name: string; source_type: string };

/**
 * Other lines that look like `item`. `alike` lines have the same name but for codes and numbers
 * (ticked by default); the rest share a distinctive word and the same ledger type (offered, not ticked).
 */
export function similarLines<T extends Line>(item: T, all: T[]): { line: T; alike: boolean }[] {
  const shape = nameShape(item.source_name);
  const hasWords = shape.replace(/[*\s]/g, '') !== '';
  const mine = keyWords(item.source_name);
  return all
    .filter((m) => m.id !== item.id)
    .map((m) => ({ line: m, alike: hasWords && nameShape(m.source_name) === shape }))
    .filter(({ line, alike }) => alike || (line.source_type === item.source_type && [...keyWords(line.source_name)].some((w) => mine.has(w))))
    .sort((a, b) => Number(b.alike) - Number(a.alike));
}
