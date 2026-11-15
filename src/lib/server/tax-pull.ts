import { inForce, TAX_KEYS } from '../tax';

/**
 * Pull from GOV.UK: reads the figures GOV.UK states in plain words (VAT rates, thresholds, scheme limits) from
 * the Content API and sets each beside the library's figure in force today. Nothing is changed here: a person
 * adds a figure that differs as a dated entry. Flat rate percentages are not on GOV.UK in a readable table
 * (the guide sends people to an HMRC checker), so they and the notice-only limits are checked by hand.
 */

const GOV = 'https://www.gov.uk/';

export interface PulledFigure {
  key: string;
  label: string;
  unit: '%' | '£';
  library: number | null;
  gov: number | null;
  status: 'match' | 'differs' | 'unread';
  source: string;
}

export const HAND_CHECK = ['Flat rate percentages by business type (VAT Notice 733)', 'Flat rate scheme leave limit (VAT Notice 733)', 'Cash accounting leave limit (VAT Notice 731)'];

// Where each figure is said on GOV.UK, and the words around it
const RULES: { key: string; page: string; part?: string; re: RegExp }[] = [
  { key: 'vat.rate.standard', page: 'vat-rates', re: /Standard rate\s+(\d+(?:\.\d+)?)%/ },
  { key: 'vat.rate.reduced', page: 'vat-rates', re: /Reduced rate\s+(\d+(?:\.\d+)?)%/ },
  { key: 'vat.rate.zero', page: 'vat-rates', re: /Zero rate\s+(\d+(?:\.\d+)?)%/ },
  { key: 'vat.threshold.registration', page: 'register-for-vat', part: 'when-register-for-vat', re: /goes over £([\d,]+) \(the VAT threshold\)/ },
  { key: 'vat.threshold.deregistration', page: 'register-for-vat', part: 'cancel-your-registration', re: /taxable turnover falls below £([\d,]+)/ },
  { key: 'vat.flat_rate.join', page: 'vat-flat-rate-scheme', part: 'who-can-join', re: /turnover to be £([\d,]+) or less \(excluding/ },
  { key: 'vat.flat_rate.limited_cost', page: 'vat-flat-rate-scheme', part: 'how-much-you-pay', re: /higher rate of (\d+(?:\.\d+)?)%/ },
  { key: 'vat.flat_rate.first_year_discount', page: 'vat-flat-rate-scheme', part: 'how-much-you-pay', re: /(\d+(?:\.\d+)?)% discount if you’re in your first year/ },
  { key: 'vat.cash.join', page: 'vat-cash-accounting-scheme', part: 'eligibility', re: /turnover is £([\d.,]+ million|[\d,]+) or less/ },
  { key: 'vat.annual.join', page: 'vat-annual-accounting-scheme', part: 'eligibility', re: /turnover is £([\d.,]+ million|[\d,]+) or less/ },
  { key: 'vat.annual.leave', page: 'vat-annual-accounting-scheme', part: 'eligibility', re: /more than £([\d.,]+ million|[\d,]+) at the end/ },
];

const plain = (htmlText: string) =>
  htmlText
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&rsquo;|&#8217;|&#39;/g, '’')
    .replace(/\s+/g, ' ');

/** "1.35 million" → 1350000, "90,000" → 90000 */
export const amount = (s: string) => (/million/.test(s) ? Math.round(parseFloat(s.replace(/,/g, '')) * 1_000_000) : Number(s.replace(/,/g, '')));

export async function pullTaxFigures(fetchFn: typeof fetch = fetch, firmId?: string, today = new Date().toISOString().slice(0, 10)): Promise<PulledFigure[]> {
  const pages = new Map<string, Promise<{ body: string; parts: Record<string, string> } | null>>();
  const page = (slug: string) => {
    if (!pages.has(slug))
      pages.set(
        slug,
        fetchFn(`${GOV}api/content/${slug}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
          .then(async (res) => {
            if (!res.ok) return null;
            const d = await res.json();
            const parts: Record<string, string> = {};
            for (const p of d?.details?.parts ?? []) parts[p.slug] = plain(String(p.body ?? ''));
            return { body: plain(String(d?.details?.body ?? '')), parts };
          })
          .catch(() => null),
      );
    return pages.get(slug)!;
  };

  return Promise.all(
    RULES.map(async (r): Promise<PulledFigure> => {
      const base = TAX_KEYS.find((t) => t.key === r.key)!;
      const library = inForce(r.key, today, firmId)?.value ?? null;
      const p = await page(r.page);
      const text = p ? (r.part ? p.parts[r.part] : p.body) ?? '' : '';
      const m = text.match(r.re);
      const gov = m ? amount(m[1]) : null;
      const source = `${GOV}${r.page}${r.part ? `/${r.part}` : ''}`;
      const status = gov === null || Number.isNaN(gov) ? 'unread' : gov === library ? 'match' : 'differs';
      return { key: r.key, label: base.label, unit: base.unit, library, gov: status === 'unread' ? null : gov, status, source };
    }),
  );
}
