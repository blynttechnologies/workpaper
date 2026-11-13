import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { addDays, chartCodeOf, chartName, journalCheck, ledgerFor, type JLine, type PaperContext } from './common';

/**
 * Fixed assets (F-10) as a register: one line per asset, its class's method and rate, the
 * charge worked out for the year, additions and disposals, and a summary by class that agrees
 * to the trial balance. Costs over the capitalisation threshold that were expensed are found in
 * the ledger; an asset sale found on the Revenue paper becomes a disposal.
 * Policy: a full year's charge in the year of purchase and none in the year of sale.
 */

export const ASSET_CLASSES = [
  { code: '6500', dep: '6510', name: 'Property' },
  { code: '6600', dep: '6610', name: 'Plant and equipment' },
  { code: '6700', dep: '6710', name: 'Motor vehicles' },
  { code: '6800', dep: '6810', name: 'Computer equipment' },
  { code: '6900', dep: '6910', name: 'Fixtures and fittings' },
] as const;
export type ClassCode = (typeof ASSET_CLASSES)[number]['code'];

export interface Policy {
  method: 'sl' | 'rb'; // straight line on cost, or reducing balance
  rate: string; // % a year
}
export const DEFAULT_POLICIES: Record<ClassCode, Policy> = {
  '6500': { method: 'sl', rate: '2' },
  '6600': { method: 'rb', rate: '18' },
  '6700': { method: 'rb', rate: '25' },
  '6800': { method: 'sl', rate: '33.33' },
  '6900': { method: 'rb', rate: '15' },
};

export interface Asset {
  id: string;
  ref: string;
  desc: string;
  class_code: ClassCode;
  acquired: string;
  cost_p: string;
  dep_bf_p: string; // depreciation at the start of the year
  disposed?: string; // date sold or scrapped
  proceeds_p?: string;
  source?: 'opening' | 'capitalised' | 'manual' | 'ledger';
  from_tx?: string;
}

export interface Candidate {
  id: string; // ledger transaction id
  date: string;
  desc: string;
  amount_p: string;
  code: string; // where it was expensed
  class_code: ClassCode;
  decision?: 'capitalise' | 'expense';
  reason?: string;
}

const LOOKS_CAPITAL = /laptop|computer|pc|macbook|server|printer|monitor|machine|machinery|equipment|tool|van|vehicle|car|truck|furniture|desk|chair|fixture|fitting|shelving|install|plant|camera|phone|ipad|tablet/i;
const classFor = (text: string): ClassCode =>
  /laptop|computer|pc|macbook|server|printer|monitor|ipad|tablet|phone/i.test(text) ? '6800' : /van|vehicle|car|truck/i.test(text) ? '6700' : /furniture|desk|chair|fixture|fitting|shelving/i.test(text) ? '6900' : '6600';

export const policyOf = (data: Record<string, any>, code: ClassCode): Policy => ({ ...DEFAULT_POLICIES[code], ...(data.policies?.[code] ?? {}) });
const rateBp = (p: Policy) => BigInt(Math.round(Number(p.rate || 0) * 100));

/** One asset's figures for the year. */
export function assetYear(a: Asset, policy: Policy, periodStart: string, periodEnd: string) {
  const cost = asPence(a.cost_p);
  const bf = a.acquired < periodStart ? asPence(a.dep_bf_p) : 0n;
  const added = a.acquired >= periodStart && a.acquired <= periodEnd;
  const held = a.acquired <= periodEnd;
  const disposed = !!a.disposed && a.disposed >= periodStart && a.disposed <= periodEnd;
  const gone = !!a.disposed && a.disposed < periodStart;
  const nbvStart = cost - bf;
  let charge = 0n;
  if (held && !gone && !disposed) {
    const raw = policy.method === 'sl' ? (cost * rateBp(policy) + 5000n) / 10000n : (nbvStart * rateBp(policy) + 5000n) / 10000n;
    charge = raw > nbvStart ? nbvStart : raw < 0n ? 0n : raw;
  }
  const cf = disposed || gone ? 0n : bf + charge;
  const proceeds = asPence(a.proceeds_p);
  return {
    a,
    cost,
    bf,
    charge,
    cf,
    nbv: disposed || gone ? 0n : cost - cf,
    added,
    disposed,
    gone,
    profit: disposed ? proceeds - nbvStart : 0n,
    status: gone ? 'Gone' : disposed ? 'Disposed' : added ? 'Added this year' : held ? 'Held' : 'Not yet bought',
  };
}

export function registerReview(ctx: PaperContext) {
  const { data } = ctx;
  const assets: Asset[] = data.assets ?? [];
  const rows = assets.map((a) => assetYear(a, policyOf(data, a.class_code), ctx.periodStart, ctx.periodEnd));
  const classes = ASSET_CLASSES.map((c) => {
    const rs = rows.filter((r) => r.a.class_code === c.code && !r.gone);
    const sum = (f: (r: (typeof rows)[number]) => bigint) => rs.reduce((acc, r) => acc + f(r), 0n);
    const costOpen = sum((r) => (r.added ? 0n : r.cost));
    const additions = sum((r) => (r.added ? r.cost : 0n));
    const disposals = sum((r) => (r.disposed ? r.cost : 0n));
    const depOpen = sum((r) => r.bf);
    const charge = sum((r) => r.charge);
    const depDisposals = sum((r) => (r.disposed ? r.bf : 0n));
    const tbCost = ctx.tb(c.code);
    const tbDep = ctx.tb(c.dep);
    const priorCost = ctx.priorId ? ctx.tb(c.code, ctx.priorId).final : null;
    const priorDep = ctx.priorId ? -ctx.tb(c.dep, ctx.priorId).final : null;
    return {
      ...c,
      policy: policyOf(data, c.code),
      count: rs.length,
      costOpen,
      additions,
      disposals,
      costClose: costOpen + additions - disposals,
      depOpen,
      charge,
      depDisposals,
      depClose: depOpen + charge - depDisposals,
      tbCost: tbCost.draft,
      tbDep: -tbDep.draft,
      mapped: tbCost.mapped || tbDep.mapped,
      priorCost,
      priorDep,
    };
  }).filter((c) => c.count > 0 || c.mapped || c.tbCost !== 0n);

  // The journal: capitalised costs, disposals out of cost and depreciation, and the year's charge
  const lines: JLine[] = [];
  const candidates: Candidate[] = data.candidates ?? [];
  for (const k of candidates.filter((x) => x.decision === 'capitalise')) {
    lines.push({ code: k.class_code, debit: asPence(k.amount_p), credit: 0n, narrative: `${k.desc}: capitalised` });
    lines.push({ code: k.code, debit: 0n, credit: asPence(k.amount_p), narrative: `${k.desc}: out of ${chartName(k.code)}` });
  }
  for (const r of rows.filter((x) => x.disposed)) {
    const dep = ASSET_CLASSES.find((c) => c.code === r.a.class_code)!.dep;
    if (r.bf) lines.push({ code: dep, debit: r.bf, credit: 0n, narrative: `${r.a.ref} ${r.a.desc}: depreciation on disposal` });
    if (r.cost - r.bf) lines.push({ code: '4930', debit: r.cost - r.bf, credit: 0n, narrative: `${r.a.ref} ${r.a.desc}: book value written off on disposal` });
    lines.push({ code: r.a.class_code, debit: 0n, credit: r.cost, narrative: `${r.a.ref} ${r.a.desc}: cost of the asset disposed of` });
  }
  const chargeInTb = ctx.tb('4920').draft;
  const charge = classes.reduce((acc, c) => acc + c.charge, 0n);
  if (charge - chargeInTb !== 0n) {
    lines.push({ code: '4920', debit: charge - chargeInTb > 0n ? charge - chargeInTb : 0n, credit: charge - chargeInTb < 0n ? chargeInTb - charge : 0n, narrative: 'Depreciation charge for the year' });
    for (const c of classes) {
      const share = chargeInTb === 0n ? c.charge : (c.charge * (charge - chargeInTb)) / (charge || 1n);
      if (share) lines.push({ code: c.dep, debit: share < 0n ? -share : 0n, credit: share > 0n ? share : 0n, narrative: `${c.name}: depreciation for the year` });
    }
    // Rounding from splitting an existing charge lands on the first class
    const off = lines.reduce((acc, l) => acc + l.debit - l.credit, 0n);
    if (off !== 0n) {
      const first = lines.find((l) => ASSET_CLASSES.some((c) => c.dep === l.code));
      if (first && first.credit > 0n) first.credit += off;
      else if (first) first.debit -= off;
    }
  }
  return { rows, classes, candidates, lines, charge, chargeInTb };
}

/** Costs in the ledger over the threshold that read like assets but were charged to the P&L. */
export function findCapitalCosts(ctx: Pick<PaperContext, 'engagementId' | 'periodStart' | 'periodEnd'>, threshold: bigint, existing: Candidate[]) {
  return ledgerFor(ctx.engagementId, ['2', '4'])
    .filter((t) => t.date >= ctx.periodStart && t.date <= ctx.periodEnd && asPence(t.amount_p) >= threshold && LOOKS_CAPITAL.test(`${t.description} ${t.contact}`))
    .map((t) => {
      const prev = existing.find((x) => x.id === t.id);
      const desc = [t.description, t.contact].filter(Boolean).join(' · ');
      return { id: t.id, date: t.date, desc, amount_p: t.amount_p, code: chartCodeOf(ctx.engagementId, t.account_code) ?? '4990', class_code: prev?.class_code ?? classFor(desc), ...(prev?.decision ? { decision: prev.decision, reason: prev.reason } : {}) };
    });
}

/**
 * The register from the ledger (Xero or QuickBooks): one line per purchase posted to an asset cost
 * account in the year, and one opening line per class for what was there at the start of the year.
 * Credits to a cost account are returned apart: they read as disposals, which need the asset picked.
 */
export function fromLedger(ctx: Pick<PaperContext, 'engagementId' | 'periodStart' | 'periodEnd' | 'tb'>, existing: Asset[]) {
  const have = new Set(existing.map((a) => a.from_tx).filter(Boolean));
  const inYear = (code: string) => ledgerFor(ctx.engagementId, [code]).filter((t) => t.date >= ctx.periodStart && t.date <= ctx.periodEnd);
  const sum = (ts: { amount_p: string }[]) => ts.reduce((a, t) => a + asPence(t.amount_p), 0n);
  const assets: Omit<Asset, 'id' | 'ref'>[] = [];
  const credits: { date: string; desc: string; amount: bigint }[] = [];
  for (const c of ASSET_CLASSES) {
    const tx = inYear(c.code);
    const opening = ctx.tb(c.code).draft - sum(tx);
    if (opening > 0n && !existing.some((a) => a.class_code === c.code && a.source === 'opening')) {
      const depOpening = -(ctx.tb(c.dep).draft - sum(inYear(c.dep)));
      assets.push({ desc: `${c.name} brought forward`, class_code: c.code, acquired: addDays(ctx.periodStart, -1), cost_p: opening.toString(), dep_bf_p: (depOpening > 0n ? depOpening : 0n).toString(), source: 'opening' });
    }
    for (const t of tx) {
      const desc = [t.description, t.contact].filter(Boolean).join(' · ') || c.name;
      if (asPence(t.amount_p) < 0n) credits.push({ date: t.date, desc, amount: -asPence(t.amount_p) });
      else if (!have.has(t.id)) assets.push({ desc, class_code: c.code, acquired: t.date, cost_p: t.amount_p, dep_bf_p: '0', source: 'ledger', from_tx: t.id });
    }
  }
  return { assets, credits };
}

/** Asset sales moved out of turnover on the Revenue paper, still to record as disposals. */
export function salesFromRevenue(engagementId: string) {
  const wp = db.workpapers.find((w) => w.engagement_id === engagementId && w.ref === 'I-10');
  const decisions: Record<string, { decision: string; to?: string }> = wp?.data_json?.nontrading ?? {};
  return Object.entries(decisions)
    .filter(([, d]) => d.decision === 'remove' && (d.to ?? '4930') === '4930')
    .map(([id]) => db.transactions.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({ id: t.id, date: t.date, desc: [t.contact, t.description].filter(Boolean).join(' · '), amount: -asPence(t.amount_p) }));
}

/** Last year's register carried forward: what was still held, with its depreciation to date. */
export function bringForward(ctx: Pick<PaperContext, 'priorId'>): Asset[] {
  const wp = ctx.priorId ? db.workpapers.find((w) => w.engagement_id === ctx.priorId && w.ref === 'F-10') : undefined;
  const prior = db.engagements.find((e) => e.id === ctx.priorId);
  if (!wp || !prior) return [];
  return ((wp.data_json?.assets ?? []) as Asset[])
    .map((a) => ({ a, y: assetYear(a, policyOf(wp.data_json, a.class_code), prior.period_start, prior.period_end) }))
    .filter(({ y }) => !y.disposed && !y.gone)
    .map(({ a, y }) => ({ ...a, dep_bf_p: y.cf.toString(), source: 'opening' as const }));
}

export function reviewFixedAssets(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const r = registerReview(ctx);
  const capitalised = r.candidates.filter((k) => k.decision === 'capitalise');
  const capFor = (code: string) => capitalised.filter((k) => k.class_code === code).reduce((a, k) => a + asPence(k.amount_p), 0n);
  const sum = (f: (c: (typeof r.classes)[number]) => bigint) => r.classes.reduce((a, c) => a + f(c), 0n);
  Object.assign(totals, {
    cost: sum((c) => c.costClose),
    dep: sum((c) => c.depClose),
    nbv: sum((c) => c.costClose - c.depClose),
    charge: r.charge,
    charge_tb: r.chargeInTb,
    additions: sum((c) => c.additions),
    disposals: sum((c) => c.disposals),
    profit: r.rows.reduce((a, x) => a + x.profit, 0n),
  });
  r.rows.forEach((x) => anchors.push({ id: x.a.id, label: `${x.a.ref} ${x.a.desc}` }));

  if (!r.rows.length) {
    checks.push({ id: 'register', label: 'Register built', detail: 'Bring last year’s register forward, pull it from the ledger, or add the assets.', passed: false });
    return '';
  }
  // The register should agree to the TB once this paper's capitalisations and disposals are in
  const costOff = r.classes.filter((c) => c.costClose !== c.tbCost + capFor(c.code) - c.disposals);
  checks.push({
    id: 'cost_tb',
    label: 'Cost agrees to TB',
    detail: costOff.length ? costOff.map((c) => `${c.name}: register ${formatPence(c.costClose)}, TB ${formatPence(c.tbCost)}${capFor(c.code) ? ` + ${formatPence(capFor(c.code))} capitalised` : ''}${c.disposals ? ` − ${formatPence(c.disposals)} disposed` : ''}`).join('; ') + '.' : 'Every class agrees to the trial balance.',
    passed: !costOff.length,
  });
  const openOff = r.classes.filter((c) => c.priorCost !== null && c.costOpen !== c.priorCost);
  checks.push({
    id: 'opening',
    label: 'Opening balances agree to last year',
    detail: !ctx.priorId ? 'No prior year on file; the opening figures come from the register.' : openOff.length ? openOff.map((c) => `${c.name}: opening ${formatPence(c.costOpen)}, last year closed at ${formatPence(c.priorCost!)}`).join('; ') + '.' : 'Opening cost agrees to last year’s closing cost.',
    passed: !openOff.length,
  });
  const noEvidence = r.rows.filter((x) => (x.added || x.disposed) && !ctx.files(x.a.id));
  checks.push({
    id: 'evidence',
    label: 'Evidence for additions and disposals',
    detail: noEvidence.length ? `Attach the invoice or sale document for ${noEvidence.map((x) => x.a.ref).join(', ')}.` : 'Every addition and disposal has its evidence.',
    passed: !noEvidence.length,
  });
  const open = r.candidates.filter((k) => !k.decision || (k.decision === 'expense' && !k.reason?.trim()));
  const sales = salesFromRevenue(ctx.engagementId).filter((s) => !r.rows.some((x) => x.disposed && x.a.from_tx === s.id));
  checks.push({
    id: 'found',
    label: 'Items found in the ledger dealt with',
    detail: [open.length && `Capitalise or explain: ${open.map((k) => k.desc).join(', ')}.`, sales.length && `Record the disposal for ${sales.map((s) => s.desc).join(', ')} (moved out of turnover on Revenue).`].filter(Boolean).join(' ') || 'Nothing left to decide.',
    passed: !open.length && !sales.length,
  });
  checks.push(journalCheck(data.journal, r.lines, 'Journals sent to the ledger'));

  return `Fixed assets with a net book value of ${formatPence(totals.nbv)} are recorded in the register, with a depreciation charge of ${formatPence(r.charge)} for the year worked out from the policies.${totals.additions ? ` Additions were ${formatPence(totals.additions)}.` : ''}${
    totals.disposals ? ` Disposals of ${formatPence(totals.disposals)} cost gave a ${totals.profit >= 0n ? 'profit' : 'loss'} of ${formatPence(totals.profit < 0n ? -totals.profit : totals.profit)}.` : ''
  }`;
}

/** The depreciation policy note, from the rates set. */
export function policyText(data: Record<string, any>, codes: string[]) {
  return ASSET_CLASSES.filter((c) => codes.includes(c.code))
    .map((c) => {
      const p = policyOf(data, c.code);
      return `${c.name}: ${p.rate}% ${p.method === 'sl' ? 'straight line on cost' : 'reducing balance'}`;
    })
    .join('; ');
}
