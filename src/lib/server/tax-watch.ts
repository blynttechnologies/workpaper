import { db } from './db';
import { ServiceError } from './services';
import type { Actor } from './state-guard';
import { BUILT_IN_TAX } from '../tax';

/**
 * Weekly check of the GOV.UK pages the tax library cites. GOV.UK's Content API gives each page's
 * public_updated_at, the date of its last meaningful change; when that moves, the practice is told the
 * page changed so a person can add a dated entry. Figures are never changed automatically.
 */

export interface TaxPageResult {
  slug: string;
  /** The cited paths that lead to this page (a cited path can redirect) */
  cited: string[];
  title: string;
  url: string;
  gov_updated_at?: string;
  error?: string;
}

export interface TaxWatch {
  checked_at: string;
  pages: Record<string, { title: string; url: string; gov_updated_at: string; cited: string[]; changed?: boolean }>;
  failed?: string[];
}

const MANAGER_UP = ['manager', 'partner', 'admin'];
const GOV = 'https://www.gov.uk/';

/** The GOV.UK pages the built-in library cites, by the first part of their path (vat-rates, register-for-vat…) */
export const taxSourcePages = () =>
  [...new Set(BUILT_IN_TAX.map((t) => t.source).filter((s) => s.startsWith(GOV)).map((s) => new URL(s).pathname.split('/')[1]))].filter(Boolean);

/** Reads each page's last-change date from the Content API, following one redirect; a failure is reported, not thrown. */
export async function fetchTaxSources(fetchFn: typeof fetch = fetch): Promise<TaxPageResult[]> {
  const results = await Promise.all(
    taxSourcePages().map(async (start): Promise<TaxPageResult> => {
      let path = start;
      try {
        for (let hop = 0; hop < 3; hop++) {
          const res = await fetchFn(`${GOV}api/content/${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`GOV.UK answered ${res.status}`);
          const d = await res.json();
          const to = d?.document_type === 'redirect' ? d.redirects?.[0]?.destination : undefined;
          if (to) {
            path = String(to).replace(/^\//, '').split('/')[0];
            continue;
          }
          if (!d?.public_updated_at || Number.isNaN(Date.parse(d.public_updated_at))) throw new Error('GOV.UK gave no update date');
          return { slug: path, cited: [start], title: String(d.title ?? path), url: `${GOV}${path}`, gov_updated_at: d.public_updated_at };
        }
        throw new Error('Too many redirects');
      } catch (e) {
        return { slug: path, cited: [start], title: path, url: `${GOV}${path}`, error: (e as Error).message };
      }
    }),
  );
  // Two cited paths can lead to the same page (vat-registration redirects to register-for-vat)
  const bySlug = new Map<string, TaxPageResult>();
  for (const r of results) {
    const seen = bySlug.get(r.slug);
    bySlug.set(r.slug, seen ? { ...seen, cited: [...seen.cited, ...r.cited] } : r);
  }
  return [...bySlug.values()];
}

/** Saves a run on every practice: a page whose date moved since the last run is flagged until someone marks it checked. */
export function recordTaxCheck(results: TaxPageResult[], now = new Date()) {
  const changed = new Set<string>();
  for (const firm of db.firms) {
    const before = firm.settings?.tax_watch;
    const pages = { ...(before?.pages ?? {}) };
    for (const r of results) {
      if (r.error || !r.gov_updated_at) continue;
      const prev = pages[r.slug];
      const moved = Boolean(prev) && Date.parse(prev.gov_updated_at) !== Date.parse(r.gov_updated_at);
      if (moved) changed.add(r.slug);
      // The first run only records where each page stands
      pages[r.slug] = { title: r.title, url: r.url, gov_updated_at: r.gov_updated_at, cited: r.cited, changed: Boolean(prev?.changed || moved) };
    }
    const failed = results.filter((r) => r.error).map((r) => r.slug);
    firm.settings = { ...(firm.settings ?? {}), tax_watch: { checked_at: now.toISOString(), pages, ...(failed.length ? { failed } : {}) } };
  }
  return { checked: results.filter((r) => !r.error).length, changed: [...changed], failed: results.filter((r) => r.error).map((r) => `${r.slug}: ${r.error}`) };
}

/** Due once a weekend (Saturday or Sunday, London time) unless a practice was checked in the last five days. */
export function taxCheckDue(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/London' }).format(now);
  if (day !== 'Sat' && day !== 'Sun') return false;
  const last = Math.max(0, ...db.firms.map((f) => Date.parse(f.settings?.tax_watch?.checked_at ?? '') || 0));
  return now.getTime() - last > 5 * 86_400_000;
}

/** A manager marks a changed page as looked at; the flag clears until GOV.UK changes it again. */
export function acknowledgeTaxPage(actor: Actor, slug: string) {
  if (!MANAGER_UP.includes(actor.role)) throw new ServiceError('Only a manager or above can mark a tax source as checked.', 403, 'FORBIDDEN');
  const firm = db.firms.find((f) => f.id === actor.firmId);
  const page = firm?.settings?.tax_watch?.pages[slug];
  if (!firm || !page) throw new ServiceError('That source page has not been checked yet.', 404, 'NOT_FOUND');
  const before = { ...page };
  page.changed = false;
  db.logAudit(actor.firmId, actor, 'CHECK_TAX_SOURCE', 'firms', firm.id, before, page);
  return firm.settings!.tax_watch!;
}
