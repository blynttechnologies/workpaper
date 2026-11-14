// Engagement periods (ENG-01): year-end, quarterly and monthly files
export type Frequency = 'year_end' | 'quarterly' | 'monthly';
export const FREQUENCY_MONTHS: Record<Frequency, number> = { year_end: 12, quarterly: 3, monthly: 1 };

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** First day of a period of `months` months ending on `end` (YYYY-MM-DD). */
export function periodStart(end: string, months: number): string {
  const [y, m, d] = end.split('-').map(Number);
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Ending on a month end: start on the 1st, `months` months back
  if (d === lastOfMonth) return iso(y, m - months, 1);
  // Mid-month: the day after the same date `months` back, clamped to that month's length
  const daysThen = new Date(Date.UTC(y, m - 1 - months + 1, 0)).getUTCDate();
  return iso(y, m - 1 - months, Math.min(d, daysThen) + 1);
}

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const NAME: Record<Frequency, string> = { year_end: 'Year', quarterly: 'Quarter', monthly: 'Month' };

/** "Year ended 31 Mar 2026", or "Short period ended …" when the start was moved. */
export function periodLabel(e: { period_start: string; period_end: string; frequency?: Frequency }): string {
  const f = e.frequency ?? 'year_end';
  const standard = periodStart(e.period_end, FREQUENCY_MONTHS[f]);
  const name = e.period_start === standard ? NAME[f] : e.period_start < standard ? 'Long period' : 'Short period';
  return `${name} ended ${fmt(e.period_end)}`;
}

/** The same date a year earlier; 29 February falls back to the 28th. */
export const sameDayLastYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4).replace('-02-29', '-02-28')}`;

/** UK records (HMRC, Companies Act) are kept 6 years after the year end, beyond the 5 years the money-laundering rules ask. */
export const RETENTION_YEARS = 6;

/** True while a period's records must still be kept, so it cannot be deleted (archive the client instead). */
export const mustKeep = (periodEnd: string, today = new Date().toISOString().slice(0, 10)) =>
  `${Number(periodEnd.slice(0, 4)) + RETENTION_YEARS}${periodEnd.slice(4)}` > today;

/** Xero and QuickBooks are read for the current financial year and the two before it; what was pulled is kept for RETENTION_YEARS. */
export const PULL_YEARS = 3;

/**
 * True when a period starting on `periodStart` may be pulled from Xero or QuickBooks. A year starting
 * after this day PULL_YEARS ago is the current financial year or one of the two before it.
 * shortcut: exact for year-end files; quarterly and monthly files get a rolling 3 years, until the client's year end is stored in one format.
 */
export const canPull = (periodStart: string, today = new Date().toISOString().slice(0, 10)) =>
  periodStart > `${Number(today.slice(0, 4)) - PULL_YEARS}${today.slice(4).replace('-02-29', '-02-28')}`;
