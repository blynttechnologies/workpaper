import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { CENTRAL_TAX_RATES } from '../tax-rates';
import { addDays, chartCodeOf, journalCheck, ledgerFor, pair, type JLine, type PaperContext } from './common';

/**
 * Investments and investment property (G-10). The engagement's framework decides measurement:
 * FRS 102 holds investment property at fair value with gains through the P&L (and deferred tax);
 * FRS 105 (micro-entities) can't use fair value, so property is cost less depreciation on the
 * building. Rules flag what is usually missed: fees expensed on a purchase, no independent
 * valuation, and rent received short of the tenancy.
 */

export interface Property {
  id: string;
  address: string;
  type?: string;
  acquired: string;
  cost_p: string;
  land_p?: string; // not depreciated under FRS 105
  dep_bf_p?: string; // FRS 105: depreciation at the start of the year
  prior_value_p?: string; // FRS 102: fair value last year end
  valuation_p?: string; // FRS 102: fair value at this year end
  valuation_date?: string;
  valuer?: 'independent' | 'directors' | '';
  rent_pa_p?: string;
  rent_received_p?: string;
  title?: string;
  mortgage?: string;
  code?: string; // the chart account it sits in
}

export interface Investment {
  id: string;
  name: string;
  kind: 'listed' | 'unlisted';
  holding_pct?: string;
  cost_p: string;
  market_p?: string;
  impairment_p?: string;
}

const BUILDING_RATE_BP = 200n; // 2% a year on the building

export const isFrs105 = (engagementId: string) => /105|micro/i.test(db.engagements.find((e) => e.id === engagementId)?.framework ?? '');

export function investmentsReview(ctx: PaperContext) {
  const { data } = ctx;
  const frs105 = isFrs105(ctx.engagementId);
  const decisions: Record<string, Record<string, string>> = data.decisions ?? {};
  const fees = ledgerFor(ctx.engagementId, ['4800', '4820', '4990']);
  const props = ((data.properties ?? []) as Property[]).map((p) => {
    const d = decisions[p.id] ?? {};
    const cost = asPence(p.cost_p);
    // Fees on the purchase that were charged to the P&L
    const feeTx = fees.filter((t) => t.date >= addDays(p.acquired, -30) && t.date <= addDays(p.acquired, 90) && asPence(t.amount_p) > 0n && /completion|conveyanc|purchase|stamp duty|sdlt|solicitor|legal|survey/i.test(`${t.description} ${t.contact}`));
    const feeTotal = feeTx.reduce((a, t) => a + asPence(t.amount_p), 0n);
    const capitalised = d.fees === 'capitalise' ? feeTotal : 0n;
    const fullCost = cost + capitalised;
    const addedThisYear = p.acquired >= ctx.periodStart && p.acquired <= ctx.periodEnd;
    // FRS 105: cost less depreciation on the building
    const depBf = addedThisYear ? 0n : asPence(p.dep_bf_p);
    const charge = frs105 ? ((fullCost - asPence(p.land_p)) * BUILDING_RATE_BP + 5000n) / 10000n : 0n;
    // FRS 102: fair value, gain against last year's value (or cost when bought this year)
    const value = p.valuation_p ? asPence(p.valuation_p) : null;
    const base = addedThisYear ? fullCost : asPence(p.prior_value_p ?? p.cost_p);
    const gain = !frs105 && value !== null ? value - base : 0n;
    const carrying = frs105 ? fullCost - depBf - charge : (value ?? base);
    // Rent for the part of the year it was let, against what was received
    const from = p.acquired > ctx.periodStart ? p.acquired : ctx.periodStart;
    const months = Math.max(0, Math.round((Date.parse(ctx.periodEnd) - Date.parse(from)) / (86_400_000 * 30.44)));
    const expected = (asPence(p.rent_pa_p) * BigInt(Math.min(12, months))) / 12n;
    const received = asPence(p.rent_received_p);
    const shortfall = p.rent_pa_p && p.rent_received_p != null && p.rent_received_p !== '' && expected > received ? expected - received : 0n;
    const noValuation = !frs105 && (p.valuer !== 'independent' || !p.valuation_date || p.valuation_date < addDays(ctx.periodEnd, -365));
    const flags = [
      ...(feeTotal && !d.fees ? [{ kind: 'fees' as const, why: `${formatPence(feeTotal)} of fees on the purchase (${feeTx.map((t) => t.description).join(', ')}) were charged to the P&L. They are part of the property's cost.` }] : []),
      ...(noValuation && !d.valuation ? [{ kind: 'valuation' as const, why: p.valuer === 'directors' ? 'Valued by the directors, not independently. Confirm the basis they used and keep it on file.' : 'No independent valuation at the year end. Fair value needs a valuation, or the directors confirming their basis.' }] : []),
      ...(shortfall && !d.rent ? [{ kind: 'rent' as const, why: `${formatPence(received)} received against ${formatPence(expected)} due under the tenancy for ${Math.min(12, months)} months: ${formatPence(shortfall)} short.` }] : []),
    ];
    return { p, d, cost, feeTx, feeTotal, capitalised, fullCost, addedThisYear, depBf, charge, value, base, gain, carrying, expected, received, shortfall, noValuation, flags, code: p.code || '6500' };
  });
  const invs = ((data.investments ?? []) as Investment[]).map((i) => {
    const cost = asPence(i.cost_p);
    const market = i.market_p ? asPence(i.market_p) : null;
    const impairment = asPence(i.impairment_p);
    const carrying = i.kind === 'listed' && !frs105 && market !== null ? market : cost - impairment;
    return { i, cost, market, impairment, carrying, gain: carrying - cost };
  });

  const dtRate = BigInt(CENTRAL_TAX_RATES.corporation_tax.main_rate_pct);
  const lines: JLine[] = [];
  for (const x of props) {
    const dep = String(Number(x.code) + 10); // v3: each cost account's depreciation sits ten above it (6500 → 6510)
    if (x.capitalised) for (const t of x.feeTx) lines.push(...pair(x.code, chartCodeOf(ctx.engagementId, t.account_code) ?? '4820', asPence(t.amount_p), `${x.p.address}: purchase fees added to cost`));
    if (x.d.rent === 'debtor' && x.shortfall) lines.push(...pair('7200', '1400', x.shortfall, `${x.p.address}: rent due under the tenancy`));
    if (frs105 && x.charge) lines.push(...pair('4920', dep, x.charge, `${x.p.address}: depreciation on the building`));
    if (!frs105 && x.gain) {
      lines.push(...pair(x.code, '1400', x.gain, `${x.p.address}: fair value ${x.gain > 0n ? 'gain' : 'loss'}`));
      lines.push(...pair('5600', '8400', (x.gain * dtRate) / 100n, `${x.p.address}: deferred tax on the fair value movement`));
    }
  }
  const gains = props.reduce((a, x) => a + x.gain, 0n);
  return { frs105, props, invs, lines, gains, deferredTax: (gains * dtRate) / 100n };
}

export function reviewInvestments(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const r = investmentsReview(ctx);
  const propertyTotal = r.props.reduce((a, x) => a + x.carrying, 0n);
  const invTotal = r.invs.reduce((a, x) => a + x.carrying, 0n);
  Object.assign(totals, { property: propertyTotal, investments: invTotal, gains: r.gains, deferred_tax: r.deferredTax, rent_shortfall: r.props.reduce((a, x) => a + x.shortfall, 0n) });
  r.props.forEach((x) => anchors.push({ id: x.p.id, label: x.p.address || 'Property' }));
  r.invs.forEach((x) => anchors.push({ id: x.i.id, label: x.i.name || 'Investment' }));

  if (!r.props.length && !r.invs.length) {
    checks.push({
      id: 'nil',
      label: 'Nothing held confirmed',
      detail: data.none_held ? `Confirmed nothing held: ${data.none_held}` : 'Add the properties and investments, or confirm none are held and say how you know.',
      passed: !!data.none_held?.trim(),
    });
    return data.none_held ? `The company held no investments or investment property at the year end (${data.none_held}).` : '';
  }
  const openFlags = r.props.flatMap((x) => x.flags.map((f) => `${x.p.address || 'a property'}: ${f.kind}`));
  checks.push({ id: 'found', label: 'Issues found dealt with', detail: openFlags.length ? `Decide on ${openFlags.join(', ')}.` : 'Nothing left to decide.', passed: !openFlags.length });
  const noTitle = r.props.filter((x) => !x.p.title || !ctx.files(x.p.id));
  checks.push({
    id: 'ownership',
    label: 'Ownership evidenced',
    detail: noTitle.length ? `Enter the Land Registry title and attach it for ${noTitle.map((x) => x.p.address || 'a property').join(', ')}.` : 'Every property has its title on file.',
    passed: !noTitle.length,
  });
  const codes = Array.from(new Set(r.props.map((x) => x.code)));
  const off = codes.filter((c) => {
    const expected = r.props.filter((x) => x.code === c).reduce((a, x) => a + (r.frs105 ? x.cost : x.addedThisYear ? x.cost : asPence(x.p.prior_value_p ?? x.p.cost_p)), 0n);
    return expected !== ctx.tb(c).draft;
  });
  checks.push({
    id: 'tb',
    label: 'Register agrees to TB',
    detail: off.length ? `The register's ${r.frs105 ? 'cost' : 'opening value plus additions'} differs from the TB for ${off.join(', ')}.` : 'Agrees to the trial balance before this year’s adjustments.',
    passed: !off.length,
  });
  checks.push(journalCheck(data.journal, r.lines));
  return `Investment property of ${formatPence(propertyTotal)} is held at ${r.frs105 ? 'cost less depreciation, as FRS 105 requires' : `fair value under FRS 102, with ${r.gains >= 0n ? 'gains' : 'losses'} of ${formatPence(r.gains < 0n ? -r.gains : r.gains)} through the P&L and deferred tax of ${formatPence(r.deferredTax < 0n ? -r.deferredTax : r.deferredTax)}`}.${invTotal ? ` Investments total ${formatPence(invTotal)}.` : ''}${!r.frs105 && r.gains > 0n ? ` Unrealised gains of ${formatPence(r.gains - r.deferredTax)} after tax cannot be paid out as dividends.` : ''}`;
}
