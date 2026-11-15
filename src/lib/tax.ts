import { db } from './server/db';
import { asPence } from './money';

/**
 * Tax library (VAT first): dated UK rates, thresholds and flat rate percentages, each with its source, for
 * people and the AI to read. A rate is looked up for a date, never remembered: what applied at the period
 * end is what the facts show. Practices add dated changes of their own (a new threshold from April, say);
 * those win over the built-in entry for the dates they cover.
 */

export type TaxGroup = 'VAT rates' | 'VAT thresholds' | 'VAT schemes' | 'Flat rate percentages';

export interface TaxEntry {
  id: string;
  key: string;
  label: string;
  group: TaxGroup;
  value: number;
  unit: '%' | '£';
  from?: string;
  to?: string;
  source: string;
  note?: string;
  /** Set on a practice's own entries */
  added_by?: string;
  added_at?: string;
}

const RATES = 'https://www.gov.uk/vat-rates';
const REGISTER = 'https://www.gov.uk/vat-registration/when-to-register';
const DEREGISTER = 'https://www.gov.uk/register-for-vat/cancel-your-registration';
const FRS = 'https://www.gov.uk/vat-flat-rate-scheme/how-much-you-pay';
const FRS_JOIN = 'https://www.gov.uk/vat-flat-rate-scheme/who-can-join';
const CASH = 'https://www.gov.uk/vat-cash-accounting-scheme';
const ANNUAL = 'https://www.gov.uk/vat-annual-accounting-scheme';
const NOTICE = (n: number) => `HMRC VAT Notice ${n}`;

const e = (key: string, label: string, group: TaxGroup, value: number, unit: '%' | '£', source: string, from?: string, to?: string, note?: string): TaxEntry => ({
  id: `${key}@${from ?? 'always'}`,
  key,
  label,
  group,
  value,
  unit,
  source,
  ...(from ? { from } : {}),
  ...(to ? { to } : {}),
  ...(note ? { note } : {}),
});

// Flat rate percentages by business type (VAT Notice 733; GOV.UK table). Three changed for the 2020-22 hospitality relief.
const FLAT: [string, string, number][] = [
  ['accountancy', 'Accountancy or book-keeping', 14.5],
  ['advertising', 'Advertising', 11],
  ['agricultural_services', 'Agricultural services', 11],
  ['other_activity', 'Any other activity not listed elsewhere', 12],
  ['architect_engineer_surveyor', 'Architect, civil and structural engineer or surveyor', 14.5],
  ['animal_care', 'Boarding or care of animals', 12],
  ['business_services', 'Business services not listed elsewhere', 12],
  ['it_consultancy', 'Computer and IT consultancy or data processing', 14.5],
  ['computer_repair', 'Computer repair services', 10.5],
  ['entertainment_journalism', 'Entertainment or journalism', 12.5],
  ['estate_agency', 'Estate agency or property management services', 12],
  ['farming', 'Farming or agriculture not listed elsewhere', 6.5],
  ['film_tv_production', 'Film, radio, television or video production', 13],
  ['financial_services', 'Financial services', 13.5],
  ['forestry_fishing', 'Forestry or fishing', 10.5],
  ['general_building', 'General building or construction services', 9.5],
  ['hairdressing_beauty', 'Hairdressing or other beauty treatment services', 13],
  ['hiring_goods', 'Hiring or renting goods', 9.5],
  ['investigation_security', 'Investigation or security', 12],
  ['labour_only_building', 'Labour-only building or construction services', 14.5],
  ['laundry', 'Laundry or dry-cleaning services', 12],
  ['legal', 'Lawyer or legal services', 14.5],
  ['cultural', 'Library, archive, museum or other cultural activity', 9.5],
  ['management_consultancy', 'Management consultancy', 14],
  ['manufacturing_metal', 'Manufacturing fabricated metal products', 10.5],
  ['manufacturing_food', 'Manufacturing food', 9],
  ['manufacturing_other', 'Manufacturing not listed elsewhere', 9.5],
  ['manufacturing_textiles', 'Manufacturing yarn, textiles or clothing', 9],
  ['membership_organisation', 'Membership organisation', 8],
  ['mining_quarrying', 'Mining or quarrying', 10],
  ['packaging', 'Packaging', 9],
  ['photography', 'Photography', 11],
  ['post_offices', 'Post offices', 5],
  ['printing', 'Printing', 8.5],
  ['publishing', 'Publishing', 11],
  ['real_estate', 'Real estate activity not listed elsewhere', 14],
  ['repairing_personal_goods', 'Repairing personal or household goods', 10],
  ['repairing_vehicles', 'Repairing vehicles', 8.5],
  ['retail_food', "Retailing food, confectionery, tobacco, newspapers or children's clothing", 4],
  ['retail_pharmacy', 'Retailing pharmaceuticals, medical goods, cosmetics or toiletries', 8],
  ['retail_other', 'Retailing not listed elsewhere', 7.5],
  ['retail_vehicles_fuel', 'Retailing vehicles or fuel', 6.5],
  ['secretarial', 'Secretarial services', 13],
  ['social_work', 'Social work', 11],
  ['sport_recreation', 'Sport or recreation', 8.5],
  ['transport_storage', 'Transport or storage, including couriers, freight, removals and taxis', 10],
  ['travel_agency', 'Travel agency', 10.5],
  ['veterinary', 'Veterinary medicine', 11],
  ['wholesale_agricultural', 'Wholesaling agricultural products', 8],
  ['wholesale_food', 'Wholesaling food', 7.5],
  ['wholesale_other', 'Wholesaling not listed elsewhere', 8.5],
];
// Changed during the hospitality relief, 15 July 2020 to 31 March 2022: [before, relief to 30 Sep 2021, to 31 Mar 2022, from 1 Apr 2022]
const DATED_FLAT: [string, string, [number, number, number, number]][] = [
  ['catering', 'Catering services including restaurants and takeaways', [12.5, 4.5, 8.5, 12.5]],
  ['hotel_accommodation', 'Hotel or accommodation', [10.5, 0, 5.5, 10.5]],
  ['pubs', 'Pubs', [6.5, 1, 4, 6.5]],
];

export const BUILT_IN_TAX: TaxEntry[] = [
  e('vat.rate.standard', 'Standard rate', 'VAT rates', 17.5, '%', RATES, '2010-01-01', '2011-01-03'),
  e('vat.rate.standard', 'Standard rate', 'VAT rates', 20, '%', RATES, '2011-01-04'),
  e('vat.rate.reduced', 'Reduced rate', 'VAT rates', 5, '%', RATES),
  e('vat.rate.zero', 'Zero rate', 'VAT rates', 0, '%', RATES),
  e('vat.threshold.registration', 'Registration threshold (taxable turnover, last 12 months)', 'VAT thresholds', 85000, '£', REGISTER, '2017-04-01', '2024-03-31'),
  e('vat.threshold.registration', 'Registration threshold (taxable turnover, last 12 months)', 'VAT thresholds', 90000, '£', REGISTER, '2024-04-01'),
  e('vat.threshold.deregistration', 'Deregistration threshold', 'VAT thresholds', 83000, '£', DEREGISTER, '2017-04-01', '2024-03-31'),
  e('vat.threshold.deregistration', 'Deregistration threshold', 'VAT thresholds', 88000, '£', DEREGISTER, '2024-04-01'),
  e('vat.flat_rate.join', 'Flat rate scheme: join limit (taxable turnover excluding VAT)', 'VAT schemes', 150000, '£', FRS_JOIN),
  e('vat.flat_rate.leave', 'Flat rate scheme: leave limit (turnover including VAT)', 'VAT schemes', 230000, '£', NOTICE(733), undefined, undefined, 'Not on the GOV.UK guide pages; from VAT Notice 733. Check against the notice.'),
  e('vat.flat_rate.limited_cost', 'Flat rate scheme: limited cost business rate', 'VAT schemes', 16.5, '%', FRS, '2017-04-01', undefined, 'Goods cost less than 2% of turnover, or less than £1,000 a year if more than 2%.'),
  e('vat.flat_rate.first_year_discount', 'Flat rate scheme: discount in the first year of VAT registration', 'VAT schemes', 1, '%', FRS),
  e('vat.cash.join', 'Cash accounting: join limit (taxable turnover)', 'VAT schemes', 1350000, '£', CASH),
  e('vat.cash.leave', 'Cash accounting: leave limit (taxable turnover)', 'VAT schemes', 1600000, '£', NOTICE(731), undefined, undefined, 'Not on the GOV.UK guide pages; from VAT Notice 731. Check against the notice.'),
  e('vat.annual.join', 'Annual accounting: join limit (taxable turnover)', 'VAT schemes', 1350000, '£', ANNUAL),
  e('vat.annual.leave', 'Annual accounting: leave limit (taxable turnover)', 'VAT schemes', 1600000, '£', NOTICE(732), undefined, undefined, 'Not on the GOV.UK guide pages; from VAT Notice 732. Check against the notice.'),
  ...FLAT.map(([k, label, v]) => e(`vat.frs.${k}`, label, 'Flat rate percentages', v, '%', FRS)),
  ...DATED_FLAT.flatMap(([k, label, [before, relief, step, after]]) => [
    e(`vat.frs.${k}`, label, 'Flat rate percentages', before, '%', FRS, undefined, '2020-07-14'),
    e(`vat.frs.${k}`, label, 'Flat rate percentages', relief, '%', FRS, '2020-07-15', '2021-09-30'),
    e(`vat.frs.${k}`, label, 'Flat rate percentages', step, '%', FRS, '2021-10-01', '2022-03-31'),
    e(`vat.frs.${k}`, label, 'Flat rate percentages', after, '%', FRS, '2022-04-01'),
  ]),
];

/** Flat rate business types a client can be put in, by key (without the vat.frs. prefix). */
export const FLAT_RATE_CATEGORIES: { key: string; label: string }[] = Array.from(
  new Map(BUILT_IN_TAX.filter((t) => t.key.startsWith('vat.frs.')).map((t) => [t.key.slice(8), t.label])).entries()
)
  .map(([key, label]) => ({ key, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** The keys a practice may add dated changes for. */
export const TAX_KEYS = Array.from(new Map(BUILT_IN_TAX.map((t) => [t.key, t])).values());

export const practiceTax = (firmId: string | undefined): TaxEntry[] => (firmId ? db.firms.find((f) => f.id === firmId)?.settings?.tax_entries ?? [] : []);

const covers = (t: TaxEntry, date: string) => (!t.from || t.from <= date) && (!t.to || t.to >= date);

/** The entry for a key on a date: a practice's own entry first, then the latest-starting built-in one. */
export function inForce(key: string, date: string, firmId?: string): TaxEntry | undefined {
  const pick = (list: TaxEntry[]) => list.filter((t) => t.key === key && covers(t, date)).sort((a, b) => (b.from ?? '').localeCompare(a.from ?? ''))[0];
  return pick(practiceTax(firmId)) ?? pick(BUILT_IN_TAX);
}

/** Every entry for a key whose dates overlap a period, oldest first: a rate that changed part-way shows both. */
export function inPeriod(key: string, start: string, end: string, firmId?: string): TaxEntry[] {
  const all = [...practiceTax(firmId), ...BUILT_IN_TAX].filter((t) => t.key === key && (!t.from || t.from <= end) && (!t.to || t.to >= start));
  return all.sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
}

const pounds = (n: number) => `£${n.toLocaleString('en-GB')}`;

/**
 * The VAT position for a client year as the library sees it at the period end: scheme, rates, thresholds,
 * the flat rate percentage, and warnings for a person to check. Turnover is the year's confirmed revenue.
 */
export function vatFactsFor(engagementId: string) {
  const eng = db.engagements.find((x) => x.id === engagementId);
  if (!eng) return null;
  const client = db.clients.find((c) => c.id === eng.client_id);
  const firmId = eng.firm_id;
  const at = eng.period_end;
  const value = (key: string) => inForce(key, at, firmId)?.value;
  const revenue = db.account_mappings
    .filter((m) => m.engagement_id === engagementId && m.status === 'confirmed' && /^1\d{3}$/.test(m.blynt_code ?? ''))
    .reduce((s, m) => s - asPence(m.balance_p), 0n);
  const turnover = Number(revenue) / 100;
  const registered = client?.vat_registered !== false;
  const scheme = registered ? client?.vat_scheme ?? 'standard' : null;
  const category = client?.vat_flat_rate_category as string | undefined;
  const warnings: string[] = [];

  const registration = value('vat.threshold.registration');
  if (!registered && registration && turnover > registration) {
    warnings.push(`Turnover for the period (${pounds(Math.round(turnover))}) is over the VAT registration threshold (${pounds(registration)}). Check whether the client should have registered.`);
  }
  let flat: { category: string; label: string; percent: number; first_year_discount: boolean; limited_cost_percent?: number; changes_in_period: { percent: number; from?: string; to?: string }[] } | null = null;
  if (scheme === 'flat_rate') {
    const entry = category ? inForce(`vat.frs.${category}`, at, firmId) : undefined;
    if (!entry) warnings.push('The client is on the flat rate scheme but no business category is set. Choose it on the client profile.');
    else {
      const regOn = client?.vat_registered_on as string | undefined;
      const firstYear = !!regOn && at < `${Number(regOn.slice(0, 4)) + 1}${regOn.slice(4)}`;
      flat = {
        category: category!,
        label: entry.label,
        percent: firstYear ? Math.max(0, entry.value - (value('vat.flat_rate.first_year_discount') ?? 0)) : entry.value,
        first_year_discount: firstYear,
        limited_cost_percent: value('vat.flat_rate.limited_cost'),
        changes_in_period: inPeriod(`vat.frs.${category}`, eng.period_start, at, firmId).map((t) => ({ percent: t.value, from: t.from, to: t.to })),
      };
    }
    const leave = value('vat.flat_rate.leave');
    const standard = value('vat.rate.standard') ?? 20;
    if (leave && turnover * (1 + standard / 100) > leave) {
      warnings.push(`Turnover including VAT (about ${pounds(Math.round(turnover * (1 + standard / 100)))}) is over the flat rate scheme leaving limit (${pounds(leave)}). Check whether the client should have left the scheme.`);
    }
  }
  for (const [s, key, name] of [['cash', 'vat.cash.leave', 'cash accounting'], ['annual', 'vat.annual.leave', 'annual accounting']] as const) {
    const leave = value(key);
    if (scheme === s && leave && turnover > leave) warnings.push(`Turnover (${pounds(Math.round(turnover))}) is over the ${name} leaving limit (${pounds(leave)}). Check whether the client should have left the scheme.`);
  }
  return {
    registered,
    scheme,
    vat_number: client?.vat_number ?? null,
    turnover_p: revenue.toString(),
    rates: { standard: value('vat.rate.standard'), reduced: value('vat.rate.reduced'), zero: value('vat.rate.zero') },
    thresholds: { registration, deregistration: value('vat.threshold.deregistration') },
    flat_rate: flat,
    warnings,
    as_at: at,
  };
}
