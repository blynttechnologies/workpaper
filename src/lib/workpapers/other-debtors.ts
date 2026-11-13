import { asPence, formatPence } from '../money';
import { byContact, daysBetween, journalCheck, ledgerFor, openItems, pair, type JLine, type PaperContext } from './common';

/**
 * Other debtors and sundry balances (C-30): every open item on 7200 Other receivables and 7490
 * Other current assets, when it falls due, what was recovered after the period end, and a
 * decision on anything that looks misclassified or stale.
 */

export const OTHER_ACCOUNTS = ['7200', '7490'] as const;
export const ITEM_TYPES = ['Deposit', 'Insurance claim', 'Refund due', 'Staff loan', 'Prepayment', 'Other'] as const;

export interface OtherItem {
  id: string;
  account: string;
  desc: string;
  contact?: string;
  type?: string;
  date: string;
  amount_p: string;
  due?: 'within' | 'after';
  recovered_p?: string;
  recoveries?: { date: string; desc: string; amount_p: string }[];
  ledger?: { date: string; desc: string; amount_p: string; url?: string }[];
  no_detail?: boolean; // a balance with no ledger transactions behind it
  decision?: 'prepayment' | 'write_off' | 'keep';
  move_p?: string;
  expense_code?: string; // where the expired part of a prepayment is charged
  reason?: string;
}

const PREPAID = /licen[cs]e|subscription|insurance premium|annual|in advance|prepaid|renewal/i;
const LONG_TERM = /deposit|loan|bond/i;

export function otherItemView(i: OtherItem, periodEnd: string, files: number) {
  const amount = asPence(i.amount_p);
  const recovered = asPence(i.recovered_p);
  const age = i.date ? daysBetween(i.date, periodEnd) : 0;
  const supported = files > 0 || (amount > 0n && recovered >= amount);
  const suggestion =
    PREPAID.test(`${i.desc} ${i.type ?? ''}`) && amount > 0n
      ? { kind: 'prepayment' as const, why: `"${i.desc}" reads like a cost paid in advance, not money owed to the company. Move the unexpired part to prepayments and charge the rest.` }
      : (age > 365 || i.no_detail) && recovered === 0n && files === 0
        ? {
            kind: 'write_off' as const,
            why: `${i.no_detail ? 'There are no ledger transactions behind this balance' : `No movement for ${Math.floor(age / 365)} year${age >= 730 ? 's' : ''}`} and nothing on file supports it. Write it off to other administrative expenses, or explain why it is still recoverable.`,
          }
        : null;
  const needsDue = !i.due;
  const decided = !suggestion || (!!i.decision && (i.decision !== 'keep' || !!i.reason?.trim()));
  const moved = i.decision === 'prepayment' ? asPence(i.move_p ?? i.amount_p) : 0n;
  const written = i.decision === 'write_off' ? amount : 0n;
  return { i, amount, recovered, age, supported, suggestion, needsDue, decided, moved, written, remaining: amount - moved - written };
}

/** The listing from the ledger. Open items clear oldest first per contact; a balance with no ledger detail becomes one item. */
export function otherItemsFromLedger(ctx: Pick<PaperContext, 'engagementId' | 'periodStart' | 'periodEnd' | 'tb'>, existing: OtherItem[] = []): OtherItem[] {
  const out: OtherItem[] = [];
  for (const account of OTHER_ACCOUNTS) {
    const txs = ledgerFor(ctx.engagementId, [account]);
    let listed = 0n;
    for (const [contact, list] of byContact(txs)) {
      const { open, unused } = openItems(list, ctx.periodEnd, 1n);
      let after = list.filter((t) => t.date > ctx.periodEnd && asPence(t.amount_p) < 0n).reduce((a, t) => a - asPence(t.amount_p), 0n);
      const recoveries = list.filter((t) => t.date > ctx.periodEnd && asPence(t.amount_p) < 0n).map((t) => ({ date: t.date, desc: t.description, amount_p: (-asPence(t.amount_p)).toString() }));
      for (const o of open) {
        const got = after < o.amount ? after : o.amount;
        after -= got;
        listed += o.amount;
        const id = `oth_${o.tx.id}`;
        const prev = existing.find((x) => x.id === id);
        out.push({
          ...prev,
          id,
          account,
          desc: o.tx.description || contact,
          contact: contact === 'No name' ? undefined : contact,
          type: prev?.type,
          date: o.tx.date,
          amount_p: o.amount.toString(),
          due: prev?.due ?? (LONG_TERM.test(o.tx.description) ? undefined : 'within'),
          recovered_p: got.toString(),
          recoveries,
          ledger: [{ date: o.tx.date, desc: o.tx.description, amount_p: o.amount.toString(), ...(o.tx.external_url ? { url: o.tx.external_url } : {}) }],
        });
      }
      if (unused > 0n) {
        listed -= unused;
        const id = `oth_${account}_credit_${contact}`;
        const prev = existing.find((x) => x.id === id);
        out.push({ ...prev, id, account, desc: `Credit balance – ${contact}`, contact, date: ctx.periodEnd, amount_p: (-unused).toString(), due: 'within' });
      }
    }
    // What the trial balance holds that the ledger transactions don't explain, such as a balance brought forward
    const gap = ctx.tb(account).draft - listed;
    if (gap !== 0n) {
      const id = `oth_${account}_bf`;
      const prev = existing.find((x) => x.id === id);
      out.push({ ...prev, id, account, desc: 'Balance with no ledger detail', type: prev?.type, date: prev?.date ?? ctx.periodStart, amount_p: gap.toString(), due: prev?.due ?? 'within', no_detail: true });
    }
  }
  return out;
}

export function otherDebtorsJournal(data: Record<string, any>, periodEnd: string): JLine[] {
  const lines: JLine[] = [];
  for (const i of (data.items ?? []) as OtherItem[]) {
    const v = otherItemView(i, periodEnd, 0);
    if (v.moved) lines.push(...pair('7300', i.account, v.moved, `${i.desc}: unexpired part to prepayments`));
    if (i.decision === 'prepayment' && v.amount - v.moved > 0n) lines.push(...pair(i.expense_code ?? '4990', i.account, v.amount - v.moved, `${i.desc}: expired part charged`));
    if (v.written) lines.push(...pair('4990', i.account, v.written, `${i.desc}: written off`));
  }
  return lines;
}

export function reviewOtherDebtors(ctx: PaperContext): string {
  const { data, totals, checks, anchors, periodEnd } = ctx;
  const views = ((data.items ?? []) as OtherItem[]).map((i) => otherItemView(i, periodEnd, ctx.files(i.id)));
  const per = OTHER_ACCOUNTS.map((a) => {
    const listing = views.filter((v) => v.i.account === a).reduce((acc, v) => acc + v.amount, 0n);
    const tb = ctx.tb(a);
    return { a, listing, ledger: tb.draft, mapped: tb.mapped };
  });
  const listing = per.reduce((acc, p) => acc + p.listing, 0n);
  const ledger = per.reduce((acc, p) => acc + p.ledger, 0n);
  const lines = otherDebtorsJournal(data, periodEnd);
  const adjusted = views.reduce((acc, v) => acc + v.remaining, 0n);
  Object.assign(totals, {
    listing,
    ledger,
    difference: listing - ledger,
    supported: BigInt(views.filter((v) => v.supported).length),
    recovered: views.reduce((acc, v) => acc + v.recovered, 0n),
    after_one_year: views.filter((v) => v.i.due === 'after').reduce((acc, v) => acc + v.remaining, 0n),
    within_one_year: views.filter((v) => v.i.due !== 'after').reduce((acc, v) => acc + v.remaining, 0n),
    moved: views.reduce((acc, v) => acc + v.moved, 0n),
    written: views.reduce((acc, v) => acc + v.written, 0n),
    suggested: views.filter((v) => v.suggestion).reduce((acc, v) => acc + v.amount, 0n),
    adjusted,
  });
  per.forEach((p) => {
    totals[`${p.a}_listing`] = p.listing;
    totals[`${p.a}_ledger`] = p.ledger;
  });
  views.forEach((v) => anchors.push({ id: v.i.id, label: `${v.i.account} · ${v.i.desc}` }));

  const off = per.filter((p) => p.listing !== p.ledger);
  checks.push({
    id: 'listing_tb',
    label: 'Listing agrees to ledger for every account',
    detail: off.length ? off.map((p) => `${p.a}: listing ${formatPence(p.listing)}, ledger ${formatPence(p.ledger)}`).join('; ') + '.' : `Listing ${formatPence(listing)} agrees to 7200 and 7490.`,
    passed: !off.length && per.some((p) => p.mapped),
  });
  const unsupported = views.filter((v) => !v.supported && !v.written && v.amount !== 0n);
  checks.push({
    id: 'supported',
    label: `Every item supported (${views.length - unsupported.length}/${views.length})`,
    detail: unsupported.length ? `Attach evidence or show the receipt after the period end for ${unsupported.map((v) => v.i.desc).join(', ')}.` : 'Every item has evidence or was recovered after the period end.',
    passed: !unsupported.length,
  });
  const flagged = views.filter((v) => v.suggestion);
  checks.push({
    id: 'misclassified',
    label: `Misclassified and old items dealt with (${flagged.filter((v) => v.decided).length}/${flagged.length})`,
    detail: flagged.some((v) => !v.decided) ? `Decide on ${flagged.filter((v) => !v.decided).map((v) => v.i.desc).join(', ')}. Keeping one needs a reason.` : 'Nothing misclassified or stale left open.',
    passed: flagged.every((v) => v.decided),
  });
  const noDue = views.filter((v) => v.needsDue);
  checks.push({
    id: 'due_split',
    label: 'Split between within and after one year set',
    detail: noDue.length ? `Set when ${noDue.map((v) => v.i.desc).join(', ')} falls due.` : 'Set for every item.',
    passed: !noDue.length,
  });
  checks.push(journalCheck(data.journal, lines));

  return !per.some((p) => p.mapped)
    ? ''
    : `Other debtors of ${formatPence(ledger)} ${listing === ledger ? 'agree to the listing of open items' : `differ from the listing by ${formatPence(listing - ledger)}`}. ${views.filter((v) => v.supported).length} of ${views.length} items are supported by evidence or receipts after the period end.${
        totals.after_one_year ? ` ${formatPence(totals.after_one_year)} falls due after more than one year and is shown separately.` : ''
      }${totals.moved ? ` ${formatPence(totals.moved)} is moved to prepayments.` : ''}${totals.written ? ` ${formatPence(totals.written)} is written off.` : ''}`;
}
