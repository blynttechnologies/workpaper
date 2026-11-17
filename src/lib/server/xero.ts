import { canPull, PULL_YEARS, RETENTION_YEARS, sameDayLastYear } from '../periods';
import { ukDate } from '../dates';
import crypto from 'crypto';
import { db } from './db';
import { secret } from './auth';
import { ServiceError } from './services';
import { importTrialBalance, ImportResult, TbLineInput } from './tb-import';
import { toPence } from '../money';
import { Adjustment, DebtorOpenItem, DebtorPayment, LedgerTransaction, UserRole } from '../types/models';

/**
 * Xero connection (DAT-01): OAuth 2.0 authorisation code flow, encrypted token storage with
 * silent refresh, and the trial balance pull, which feeds the same import pipeline as a CSV.
 *
 * Configure with XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI (see docs/xero.md).
 */

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';
const API = 'https://api.xero.com/api.xro/2.0';

// Read-only access, except manual journals: approved Blynt journals are sent to Xero (as drafts unless asked).
// offline_access lets us refresh without the accountant present.
// Granular scopes: apps created on or after 2 March 2026 can't request the old broad ones
// (accounting.transactions, accounting.reports.read). accounting.journals.read needs Xero's
// approval, so it is left out until the journals drill-down (DAT-07) uses it.
// accounting.payments.read lets us gather payments; credit notes and transfers come with the invoice and bank scopes.
export const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.settings.read',
  'accounting.reports.trialbalance.read',
  'accounting.contacts.read',
  'accounting.invoices.read',
  'accounting.banktransactions.read',
  'accounting.manualjournals',
  'accounting.payments.read',
];

export interface XeroConnection {
  id: string;
  firm_id: string;
  client_id: string;
  tenant_id: string;
  tenant_name: string;
  short_code: string | null; // for deep links back to Xero (DAT-07)
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  connected_by: string;
  connected_at: string;
  last_synced_at: string | null;
  last_checked_at?: string | null; // the automatic end-of-day check
  auto_sync?: { at: string; engagement_id: string; changes: number }; // the last automatic pull that found changes
}

export class XeroReconnectError extends ServiceError {
  constructor() {
    super('The Xero connection has expired or was revoked. Reconnect Xero for this client.', 409, 'XERO_RECONNECT');
  }
}

export function xeroConfig() {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const redirectUri = process.env.XERO_REDIRECT_URI;
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

function requireConfig() {
  const c = xeroConfig();
  if (!c) throw new ServiceError('Xero is not set up yet. Add XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI.', 503, 'XERO_NOT_CONFIGURED');
  return c;
}

export function authorizeUrl(state: string): string {
  const c = requireConfig();
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: XERO_SCOPES.join(' '),
    state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}

// ── OAuth state: signed and short-lived, so a callback can't be forged or replayed later ──

interface StatePayload {
  firmId: string;
  userId: string;
  clientId: string;
}

const hmac = (body: string) => crypto.createHmac('sha256', `${secret()}:xero-state`).update(body).digest('base64url');

export function createState(p: StatePayload, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...p, n: crypto.randomBytes(8).toString('hex'), exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function readState(state: string | null | undefined): StatePayload | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(hmac(body));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
    return { firmId: p.firmId, userId: p.userId, clientId: p.clientId };
  } catch {
    return null;
  }
}

// ── Tokens are encrypted at rest (AES-256-GCM) ──

const tokenKey = () => crypto.createHash('sha256').update(process.env.XERO_TOKEN_KEY || `${secret()}:xero-tokens`).digest();

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decryptToken(stored: string): string {
  const [iv, tag, enc] = stored.split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ── Xero HTTP calls ──

interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const c = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.error === 'invalid_grant') throw new XeroReconnectError();
    throw new ServiceError(`Xero sign-in failed (${body.error || res.status}).`, 502, 'XERO_ERROR');
  }
  return body as TokenSet;
}

export const exchangeCode = (code: string) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: requireConfig().redirectUri });

const refreshTokens = (refreshToken: string) => tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Xero GET. Xero allows each organisation 60 calls a minute and 5,000 a day; when it says to
 * wait a minute or less we wait and try again, as long as that still ends before `deadline`.
 */
async function xeroGet<T>(url: string, accessToken: string, tenantId?: string, deadline = 0): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(tenantId ? { 'xero-tenant-id': tenantId } : {}),
      },
    });
    if (res.status === 401) throw new XeroReconnectError();
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 60;
      console.warn(`Xero 429 (${res.headers.get('x-rate-limit-problem') ?? 'unknown'} limit), retry after ${wait}s`);
      if (wait <= 60 && attempt < 3 && Date.now() + wait * 1000 < deadline) {
        await sleep(wait * 1000);
        continue;
      }
      throw new ServiceError(
        wait > 3600
          ? `Xero's daily limit for this organisation is used up. Try again in about ${Math.ceil(wait / 3600)} hours.`
          : `Xero is limiting requests right now. Try again in ${wait > 60 ? `${Math.ceil(wait / 60)} minutes` : 'a minute'}.`,
        429,
        'XERO_RATE_LIMIT'
      );
    }
    // Connected before Blynt asked Xero for this kind of record: only connecting again grants it
    if (res.status === 403) throw new ServiceError("Xero hasn't given Blynt permission to read this for this client. Disconnect and reconnect Xero on the client's page, then try again.", 409, 'XERO_NO_ACCESS');
    if (!res.ok) throw new ServiceError(`Xero returned an error (${res.status}).`, 502, 'XERO_ERROR');
    return (await res.json()) as T;
  }
}

/** Creates a record in Xero. The idempotency key stops a retry after a lost reply from making a second one. */
async function xeroWrite<T>(url: string, accessToken: string, tenantId: string, body: unknown, idempotencyKey: string): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json', 'xero-tenant-id': tenantId, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new XeroReconnectError();
  if (res.status === 403) {
    throw new ServiceError("Xero hasn't given Blynt permission to add journals for this client. Disconnect and reconnect Xero on the client's page, then send again.", 403, 'XERO_NO_WRITE');
  }
  if (res.status === 429) throw new ServiceError('Xero is limiting requests right now. Try again in a minute.', 429, 'XERO_RATE_LIMIT');
  const out = (await res.json().catch(() => ({}))) as { Elements?: { ValidationErrors?: { Message?: string }[] }[]; Message?: string };
  if (!res.ok) {
    const why = (out.Elements ?? []).flatMap((e) => (e.ValidationErrors ?? []).map((v) => v.Message)).filter(Boolean);
    throw new ServiceError(why.length ? `Xero refused the journal: ${why.join(' ')}` : `Xero returned an error (${res.status}).`, 502, 'XERO_REJECTED');
  }
  return out as T;
}

// ── Trial balance report → import lines ──

interface XeroAccount {
  AccountID: string;
  Code?: string;
  Name: string;
  Type: string;
  SystemAccount?: string; // 'DEBTORS' and 'CREDITORS' mark the trade control accounts
  Status?: string; // ACTIVE or ARCHIVED
}

interface XeroCell {
  Value?: string;
  Attributes?: { Id: string; Value: string }[];
}

interface XeroRow {
  RowType: string;
  Cells?: XeroCell[];
  Rows?: XeroRow[];
}

const XERO_TYPES: Record<string, string> = {
  BANK: 'Bank',
  CURRENT: 'Current Asset',
  INVENTORY: 'Current Asset',
  PREPAYMENT: 'Current Asset',
  FIXED: 'Fixed Asset',
  NONCURRENT: 'Non-current Asset',
  CURRLIAB: 'Current Liability',
  LIABILITY: 'Liability',
  TERMLIAB: 'Non-current Liability',
  PAYGLIABILITY: 'Current Liability',
  SUPERANNUATIONLIABILITY: 'Current Liability',
  WAGESPAYABLELIABILITY: 'Current Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  SALES: 'Revenue',
  OTHERINCOME: 'Other Income',
  DIRECTCOSTS: 'Direct Costs',
  EXPENSE: 'Expense',
  OVERHEADS: 'Overhead',
  DEPRECIATN: 'Expense',
  SUPERANNUATIONEXPENSE: 'Expense',
  WAGESEXPENSE: 'Expense',
};

const amount = (v: string | undefined) => {
  const n = Number(String(v || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Xero's Trial Balance report has columns Account, Debit, Credit, YTD Debit, YTD Credit, grouped
 * into sections. The year-to-date columns give the closing balance at the report date; each row
 * carries the AccountID, which we use to look up the account's code and type.
 */
export function parseTrialBalance(report: unknown, accounts: XeroAccount[]): TbLineInput[] {
  const byId = new Map(accounts.map((a) => [a.AccountID, a]));
  const rows: XeroRow[] = (report as { Reports?: { Rows?: XeroRow[] }[] })?.Reports?.[0]?.Rows ?? [];
  const header = rows.find((r) => r.RowType === 'Header')?.Cells?.map((c) => (c.Value || '').toLowerCase()) ?? [];
  const ytdDebitCol = header.indexOf('ytd debit') >= 0 ? header.indexOf('ytd debit') : 3;
  const ytdCreditCol = header.indexOf('ytd credit') >= 0 ? header.indexOf('ytd credit') : 4;

  const lines: TbLineInput[] = [];
  const walk = (list: XeroRow[]) => {
    for (const r of list) {
      if (r.Rows) walk(r.Rows);
      if (r.RowType !== 'Row' || !r.Cells) continue;
      const label = r.Cells[0]?.Value || '';
      const id = r.Cells[0]?.Attributes?.find((a) => a.Id === 'account')?.Value;
      const acc = id ? byId.get(id) : undefined;
      const net = amount(r.Cells[ytdDebitCol]?.Value) - amount(r.Cells[ytdCreditCol]?.Value);
      // "Sales (200)" → name and code when the account list doesn't have it
      const m = label.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      lines.push({
        code: acc?.Code || m?.[2] || '',
        name: acc?.Name || m?.[1] || label,
        type: (acc && XERO_TYPES[acc.Type]) || 'General',
        debit: (net > 0 ? net : 0).toFixed(2),
        credit: (net < 0 ? -net : 0).toFixed(2),
        external_id: id,
      } as TbLineInput);
    }
  };
  walk(rows);
  return lines.filter((l) => Number(l.debit) !== 0 || Number(l.credit) !== 0);
}

/**
 * Adds each account's balance a year earlier. An account with only a prior balance stays on the
 * report, in the place Xero lists it.
 */
export function withComparatives(current: TbLineInput[], prior: TbLineInput[]): TbLineInput[] {
  const key = (l: TbLineInput) => l.external_id ?? l.code;
  const net = (l: TbLineInput) => (Number(l.debit) - Number(l.credit)).toFixed(2);
  const inCurrent = (l: TbLineInput) => current.some((c) => key(c) === key(l));
  const out: TbLineInput[] = current.map((l) => {
    const was = prior.find((p) => key(p) === key(l));
    return { ...l, comparative: was ? net(was) : '0.00' };
  });
  prior.forEach((p, i) => {
    if (inCurrent(p)) return;
    const next = prior.slice(i + 1).find(inCurrent);
    out.splice(next ? out.findIndex((l) => key(l) === key(next)) : out.length, 0, { ...p, debit: '0.00', credit: '0.00', comparative: net(p) });
  });
  return out;
}

// ── Transactions for the drill-down (DAT-07) ──

interface XeroLine {
  AccountCode?: string;
  Description?: string;
  LineAmount?: number;
  TaxAmount?: number;
}

interface XeroDoc {
  InvoiceID?: string;
  BankTransactionID?: string;
  ManualJournalID?: string;
  Type?: string;
  Status?: string;
  Date?: string;
  DateString?: string;
  Contact?: { Name?: string };
  Reference?: string;
  Narration?: string;
  BankAccount?: { Code?: string; AccountID?: string; Name?: string };
  LineItems?: XeroLine[];
  JournalLines?: XeroLine[];
  LineAmountTypes?: string; // 'Inclusive' means LineAmount already contains the tax
  CreditNoteID?: string;
  PaymentID?: string;
  PaymentType?: string;
  Amount?: number;
  Account?: { Code?: string; AccountID?: string };
  Invoice?: { InvoiceID?: string; Contact?: { Name?: string } };
  BankTransferID?: string;
  FromBankAccount?: { Code?: string };
  ToBankAccount?: { Code?: string };
  Total?: number;
  IsReconciled?: boolean;
  // Open items: what is still owed, and what was set against it and when
  InvoiceNumber?: string;
  CreditNoteNumber?: string;
  PrepaymentID?: string;
  OverpaymentID?: string;
  DueDate?: string;
  DueDateString?: string;
  AmountDue?: number;
  RemainingCredit?: number;
  Payments?: XeroAllocation[];
  CreditNotes?: XeroAllocation[];
  Prepayments?: XeroAllocation[];
  Overpayments?: XeroAllocation[];
  Allocations?: XeroAllocation[];
}
interface XeroAllocation {
  Date?: string;
  DateString?: string;
  Amount?: number;
  AppliedAmount?: number;
}

const pence = (n: number | undefined) => BigInt(Math.round((n ?? 0) * 100));
// Xero sends "DateString" (2026-05-10T00:00:00) or the older "/Date(1780000000000+0000)/"
const docDate = (d: XeroDoc) =>
  d.DateString?.slice(0, 10) ?? new Date(Number(/\/Date\((\d+)/.exec(d.Date ?? '')?.[1] ?? 0)).toISOString().slice(0, 10);

/**
 * Sales invoices, credit notes, prepayments and overpayments open at the period end, as Xero's Aged
 * Receivables shows them: what is owed now, plus whatever was set against it after the period end.
 * Each invoice keeps its own payments, so nothing is matched oldest-first. Credits come out negative.
 * The purchases side reads bills, supplier credit notes and money paid on account the same way, for Aged Payables.
 */
export function openDebtorItems(
  pe: string,
  shortCode: string | null,
  docs: { invoices: XeroDoc[]; creditNotes: XeroDoc[]; prepayments: XeroDoc[]; overpayments: XeroDoc[] },
  side: 'sales' | 'purchases' = 'sales'
): DebtorOpenItem[] {
  const sales = side === 'sales';
  const area = sales ? '/AccountsReceivable' : '/AccountsPayable';
  const out: DebtorOpenItem[] = [];
  const live = (d: XeroDoc) => ['AUTHORISED', 'PAID'].includes(d.Status ?? '') && docDate(d) <= pe;
  const later = (list: XeroAllocation[] | undefined, field: 'Amount' | 'AppliedAmount') =>
    (list ?? []).filter((a) => docDate(a as XeroDoc) > pe).reduce((s, a) => s + pence(a[field]), 0n);
  const dueOf = (d: XeroDoc) => (d.DueDateString || d.DueDate ? docDate({ DateString: d.DueDateString, Date: d.DueDate }) : docDate(d));
  for (const inv of docs.invoices) {
    if (inv.Type !== (sales ? 'ACCREC' : 'ACCPAY') || !live(inv) || !inv.InvoiceID) continue;
    const paidAfter = later(inv.Payments, 'Amount');
    const open = pence(inv.AmountDue) + paidAfter + later(inv.CreditNotes, 'AppliedAmount') + later(inv.Prepayments, 'AppliedAmount') + later(inv.Overpayments, 'AppliedAmount');
    if (open <= 0n) continue;
    const lastPaid = (inv.Payments ?? []).map((p) => docDate(p as XeroDoc)).filter((d) => d > pe).sort().pop();
    const settled = (list: XeroAllocation[] | undefined, field: 'Amount' | 'AppliedAmount', how: DebtorPayment['how']) =>
      (list ?? []).map((a) => ({ date: docDate(a as XeroDoc), amount_p: pence(a[field]).toString(), how }));
    const payments = [
      ...settled(inv.Payments, 'Amount', 'payment'),
      ...settled(inv.CreditNotes, 'AppliedAmount', 'credit note'),
      ...settled(inv.Prepayments, 'AppliedAmount', 'prepayment'),
      ...settled(inv.Overpayments, 'AppliedAmount', 'overpayment'),
    ].sort((a, b) => a.date.localeCompare(b.date));
    out.push({
      contact: inv.Contact?.Name ?? '',
      kind: 'invoice',
      ref: inv.InvoiceNumber || inv.Reference || (sales ? 'Invoice' : 'Bill'),
      date: docDate(inv),
      due: dueOf(inv),
      amount_p: open.toString(),
      received_after_p: paidAfter.toString(),
      ...(lastPaid ? { received_after_on: lastPaid } : {}),
      url: xeroDeepLink(shortCode, `${area}/View.aspx?InvoiceID=${inv.InvoiceID}`),
      ...(inv.Total != null ? { total_p: pence(inv.Total).toString() } : {}),
      ...(payments.length ? { payments } : {}),
    });
  }
  const credits: [DebtorOpenItem['kind'], XeroDoc[], (d: XeroDoc) => boolean, (d: XeroDoc) => string | undefined][] = [
    ['credit note', docs.creditNotes, (d) => d.Type === (sales ? 'ACCRECCREDIT' : 'ACCPAYCREDIT'), (d) => d.CreditNoteID && `${area}/ViewCreditNote.aspx?creditNoteID=${d.CreditNoteID}`],
    ['prepayment', docs.prepayments, (d) => d.Type === (sales ? 'RECEIVE-PREPAYMENT' : 'SPEND-PREPAYMENT'), () => undefined],
    ['overpayment', docs.overpayments, (d) => d.Type === (sales ? 'RECEIVE-OVERPAYMENT' : 'SPEND-OVERPAYMENT'), () => undefined],
  ];
  for (const [kind, list, mine, path] of credits) {
    for (const c of list) {
      if (!mine(c) || !live(c)) continue;
      const open = pence(c.RemainingCredit) + later(c.Allocations, 'Amount');
      if (open <= 0n) continue;
      const p = path(c);
      out.push({
        contact: c.Contact?.Name ?? '',
        kind,
        ref: c.CreditNoteNumber || c.Reference || kind[0].toUpperCase() + kind.slice(1),
        date: docDate(c),
        due: docDate(c),
        amount_p: (-open).toString(),
        received_after_p: '0',
        ...(p ? { url: xeroDeepLink(shortCode, p) } : {}),
      });
    }
  }
  return out;
}

/** Opens the record in the client's own Xero organisation (falls back to plain go.xero.com). */
export function xeroDeepLink(shortCode: string | null, path: string): string {
  return shortCode ? `https://go.xero.com/organisationlogin/default.aspx?shortcode=${shortCode}&redirecturl=${path}` : `https://go.xero.com${path}`;
}

/**
 * What the ledger posted in the period, one row per account line, signed debit-positive, as in
 * Xero's Account Transactions report: invoices and bills (with the debtors or creditors side),
 * credit notes, bank transactions, payments, bank transfers and manual journals. Drafts, voids
 * and deletions are not in the ledger.
 * shortcut: overpayments, prepayments and Xero's own journals (depreciation, year-end) aren't
 * pulled; the last need accounting.journals.read, which Xero must approve for the app.
 */
export interface XeroDocs {
  invoices: XeroDoc[];
  bank: XeroDoc[];
  journals: XeroDoc[];
  creditNotes?: XeroDoc[];
  payments?: XeroDoc[];
  transfers?: XeroDoc[];
}

export function parseTransactions(engagementId: string, shortCode: string | null, docs: XeroDocs, names: Map<string, string>, control: { debtors?: string; creditors?: string } = {}): LedgerTransaction[] {
  const rows: LedgerTransaction[] = [];
  const add = (doc: XeroDoc, id: string, path: string | undefined, code: string | undefined, net: bigint, vat: bigint, description: string) => {
    if (!code) return;
    rows.push({
      id: `tx_${engagementId}_${id}_${rows.length}`,
      engagement_id: engagementId,
      account_code: code,
      account_name: names.get(code) ?? code,
      date: docDate(doc),
      contact: doc.Contact?.Name ?? doc.Invoice?.Contact?.Name ?? '',
      description,
      amount_p: net.toString(),
      vat_p: vat.toString(),
      gross_p: (net + vat).toString(),
      source: 'Xero',
      external_id: id,
      ...(path ? { external_url: xeroDeepLink(shortCode, path) } : {}),
    });
  };
  // Tax-inclusive documents carry the tax inside LineAmount
  const lineNet = (doc: XeroDoc, l: XeroLine) => (doc.LineAmountTypes === 'Inclusive' ? pence(l.LineAmount) - pence(l.TaxAmount) : pence(l.LineAmount));
  // The lines, then the other side of the entry (debtors, creditors or the bank) for what they total
  const post = (doc: XeroDoc, id: string, path: string, sign: bigint, otherSide: string | undefined, label: string) => {
    let gross = 0n;
    for (const l of doc.LineItems ?? []) {
      const net = sign * lineNet(doc, l);
      const vat = sign * pence(l.TaxAmount);
      gross += net + vat;
      add(doc, id, path, l.AccountCode, net, vat, l.Description || doc.Reference || '');
    }
    add(doc, id, path, otherSide, -gross, 0n, doc.Reference || doc.Contact?.Name || label);
  };
  const live = (doc: XeroDoc) => ['AUTHORISED', 'PAID'].includes(doc.Status ?? '');

  for (const inv of docs.invoices) {
    if (!live(inv) || !inv.InvoiceID) continue;
    const sales = inv.Type === 'ACCREC';
    // sales credit income and debit debtors; bills debit costs and credit creditors
    post(inv, inv.InvoiceID, `/${sales ? 'AccountsReceivable' : 'AccountsPayable'}/View.aspx?InvoiceID=${inv.InvoiceID}`, sales ? -1n : 1n, sales ? control.debtors : control.creditors, 'Invoice');
  }
  for (const cn of docs.creditNotes ?? []) {
    if (!live(cn) || !cn.CreditNoteID) continue;
    const sales = cn.Type === 'ACCRECCREDIT';
    post(cn, cn.CreditNoteID, `/${sales ? 'AccountsReceivable' : 'AccountsPayable'}/ViewCreditNote.aspx?creditNoteID=${cn.CreditNoteID}`, sales ? 1n : -1n, sales ? control.debtors : control.creditors, 'Credit note');
  }
  for (const bt of docs.bank) {
    if (!live(bt) || !bt.BankTransactionID) continue;
    // spend money debits the line and credits the bank; receive money the other way round
    post(bt, bt.BankTransactionID, `/Bank/ViewTransaction.aspx?bankTransactionID=${bt.BankTransactionID}`, bt.Type?.startsWith('SPEND') ? 1n : -1n, bt.BankAccount?.Code, 'Bank transaction');
  }
  for (const p of docs.payments ?? []) {
    const sales = p.PaymentType === 'ACCRECPAYMENT';
    // Only payments of invoices and bills; applying an overpayment or credit moves no money
    if (p.Status !== 'AUTHORISED' || !p.PaymentID || (!sales && p.PaymentType !== 'ACCPAYPAYMENT')) continue;
    const amount = pence(p.Amount);
    const path = p.Invoice?.InvoiceID ? `/${sales ? 'AccountsReceivable' : 'AccountsPayable'}/View.aspx?InvoiceID=${p.Invoice.InvoiceID}` : undefined;
    const description = p.Reference || 'Payment';
    add(p, p.PaymentID, path, p.Account?.Code, sales ? amount : -amount, 0n, description);
    add(p, p.PaymentID, path, sales ? control.debtors : control.creditors, sales ? -amount : amount, 0n, description);
  }
  for (const t of docs.transfers ?? []) {
    if (!t.BankTransferID) continue;
    const amount = pence(t.Amount);
    add(t, t.BankTransferID, undefined, t.ToBankAccount?.Code, amount, 0n, 'Bank transfer');
    add(t, t.BankTransferID, undefined, t.FromBankAccount?.Code, -amount, 0n, 'Bank transfer');
  }
  for (const mj of docs.journals) {
    if (mj.Status !== 'POSTED' || !mj.ManualJournalID) continue;
    const path = `/Journal/View.aspx?invoiceID=${mj.ManualJournalID}`;
    for (const l of mj.JournalLines ?? []) add(mj, mj.ManualJournalID, path, l.AccountCode, pence(l.LineAmount), pence(l.TaxAmount), mj.Narration || l.Description || '');
  }
  return rows;
}

/**
 * Every page of one Xero list endpoint for the period. Pages hold 100, or up to 1,000 where the
 * endpoint takes pageSize, which keeps a pull well inside Xero's 60 calls a minute.
 */
async function allPages(endpoint: string, key: string, token: string, tenantId: string, from: string, to: string, deadline = 0): Promise<XeroDoc[]> {
  return allPagesWhere(endpoint, key, token, tenantId, `Date >= ${xeroDt(from)} && Date <= ${xeroDt(to)}`, deadline);
}

const xeroDt = (d: string) => `DateTime(${d.replace(/-02-29$/, '-02-28').replaceAll('-', ', ')})`;

/**
 * Sales documents open at the period end, however old: unpaid now, or settled only after the period end.
 * Xero's filter on when an invoice was fully paid is used where it works; otherwise invoices settled in
 * the last three years are read and the rest dropped by date. shortcut: credits settled more than three
 * years before the pull are not read, which only matters if one was still open at a period end that old.
 */
// Both sides in one read: the type is left out of the filters and each side is picked out after
async function openItemsAt(token: string, tenantId: string, shortCode: string | null, pe: string, deadline: number) {
  const asOf = xeroDt(pe);
  const since = xeroDt(`${Number(pe.slice(0, 4)) - 3}${pe.slice(4)}`);
  const settled = `(Status=="AUTHORISED" || (Status=="PAID" && Date >= ${since}))`;
  const get = (endpoint: string, where: string) => allPagesWhere(endpoint, endpoint, token, tenantId, where, deadline);
  const invoices = await get('Invoices', `Date <= ${asOf} && (Status=="AUTHORISED" || (Status=="PAID" && FullyPaidOnDate > ${asOf}))`).catch((err) => {
    if (!(err instanceof ServiceError) || err.code !== 'XERO_ERROR') throw err;
    return get('Invoices', `Date <= ${asOf} && ${settled}`);
  });
  const [creditNotes, prepayments, overpayments] = await Promise.all([
    get('CreditNotes', `Date <= ${asOf} && ${settled}`),
    get('Prepayments', `Date <= ${asOf} && ${settled}`),
    get('Overpayments', `Date <= ${asOf} && ${settled}`),
  ]);
  const docs = { invoices, creditNotes, prepayments, overpayments };
  return { debtors: openDebtorItems(pe, shortCode, docs, 'sales'), creditors: openDebtorItems(pe, shortCode, docs, 'purchases') };
}

async function allPagesWhere(endpoint: string, key: string, token: string, tenantId: string, filter: string, deadline = 0): Promise<XeroDoc[]> {
  const where = encodeURIComponent(filter);
  const idOf = (d: XeroDoc) => d.InvoiceID ?? d.CreditNoteID ?? d.PrepaymentID ?? d.OverpaymentID ?? d.BankTransactionID ?? d.PaymentID ?? d.BankTransferID ?? d.ManualJournalID ?? JSON.stringify(d);
  const out: XeroDoc[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 50; page++) {
    const body = await xeroGet<Record<string, XeroDoc[]>>(`${API}/${endpoint}?where=${where}&page=${page}&pageSize=1000`, token, tenantId, deadline);
    const items = body[key] ?? [];
    // Some endpoints ignore the page number and send everything again: stop when nothing is new
    const fresh = items.filter((d) => !seen.has(idOf(d)));
    fresh.forEach((d) => seen.add(idOf(d)));
    out.push(...fresh);
    // Fewer than 100 is the last page whichever page size the endpoint used
    if (items.length < 100 || !fresh.length) break;
  }
  return out;
}

// ── Money out of the bank after the period end (creditors "paid after" check) ──

export interface BankPayment {
  date: string;
  contact: string;
  ref: string;
  amount_p: string;
  reconciled: boolean; // true when Xero has matched it to a bank statement line
  bank?: string; // the Xero account it was paid from
  url?: string;
}

/**
 * Bill payments and money spent, from every account in Xero, i.e. what left the banks. Payments on account to
 * suppliers count; transfers between the client's own accounts, drafts, voids and deletions are skipped.
 */
export function parseBankPayments(shortCode: string | null, docs: { payments: XeroDoc[]; bank: XeroDoc[] }, accounts: XeroAccount[] = []): BankPayment[] {
  // Bank accounts need no code in Xero, so the account is found by its id first
  const paidFrom = (a?: { AccountID?: string; Code?: string; Name?: string }) => {
    const name = accounts.find((x) => (a?.AccountID && x.AccountID === a.AccountID) || (a?.Code && x.Code === a.Code))?.Name ?? a?.Name;
    return name ? { bank: name } : {};
  };
  const out: BankPayment[] = [];
  for (const p of docs.payments) {
    if (p.Status !== 'AUTHORISED' || p.PaymentType !== 'ACCPAYPAYMENT') continue;
    const id = p.Invoice?.InvoiceID;
    out.push({ date: docDate(p), contact: p.Invoice?.Contact?.Name ?? '', ref: p.Reference || 'Payment', amount_p: pence(p.Amount).toString(), reconciled: !!p.IsReconciled, ...paidFrom(p.Account), ...(id ? { url: xeroDeepLink(shortCode, `/AccountsPayable/View.aspx?InvoiceID=${id}`) } : {}) });
  }
  for (const b of docs.bank) {
    if (!['AUTHORISED', 'PAID'].includes(b.Status ?? '') || !b.Type?.startsWith('SPEND') || b.Type === 'SPEND-TRANSFER' || !b.BankTransactionID) continue;
    out.push({ date: docDate(b), contact: b.Contact?.Name ?? '', ref: b.Reference || 'Spend money', amount_p: pence(b.Total).toString(), reconciled: !!b.IsReconciled, ...paidFrom(b.BankAccount), url: xeroDeepLink(shortCode, `/Bank/ViewTransaction.aspx?bankTransactionID=${b.BankTransactionID}`) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Each bank account in Xero and how many payments left it; an archived one is listed only when something was paid from it. */
export function banksChecked(accounts: XeroAccount[], payments: BankPayment[]): { name: string; payments: number }[] {
  const count = (name: string) => payments.filter((p) => p.bank === name).length;
  const banks = accounts.filter((a) => a.Type === 'BANK' && (a.Status !== 'ARCHIVED' || count(a.Name))).map((a) => a.Name);
  // A bill can be paid from an account that is not a bank, e.g. a director's loan
  const others = payments.map((p) => p.bank).filter((n): n is string => !!n && !banks.includes(n));
  return Array.from(new Set([...banks, ...others])).map((name) => ({ name, payments: count(name) }));
}

/** What was paid out of every bank account in the `days` after the engagement's period end. */
export async function bankPaymentsAfter(actor: Actor, engagementId: string, days: number): Promise<{ from: string; to: string; payments: BankPayment[]; banks: { name: string; payments: number }[] }> {
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng) throw new ServiceError('Engagement not found', 404, 'NOT_FOUND');
  const conn = db.xero_connections.find((c) => c.firm_id === actor.firmId && c.client_id === eng.client_id);
  if (!conn) throw new ServiceError('This client is not connected to Xero yet.', 409, 'XERO_NOT_CONNECTED');
  const day = (n: number) => new Date(Date.parse(eng.period_end) + n * 86_400_000).toISOString().slice(0, 10);
  const from = day(1);
  // Never past today: "not in the bank to" a date still to come would read as if those days had been checked
  const today = new Date().toISOString().slice(0, 10);
  const end = day(Math.min(Math.max(Math.round(days) || 60, 1), 366));
  const to = end > today && today >= from ? today : end;
  requirePullable(from, 'Xero');
  const token = await accessTokenFor(conn);
  const deadline = Date.now() + 200_000;
  const [payments, bank, accounts] = await Promise.all([
    allPages('Payments', 'Payments', token, conn.tenant_id, from, to, deadline),
    allPages('BankTransactions', 'BankTransactions', token, conn.tenant_id, from, to, deadline),
    xeroGet<{ Accounts?: XeroAccount[] }>(`${API}/Accounts`, token, conn.tenant_id, deadline),
  ]);
  const paid = parseBankPayments(conn.short_code, { payments, bank }, accounts.Accounts ?? []);
  return { from, to, payments: paid, banks: banksChecked(accounts.Accounts ?? [], paid) };
}

// ── Connections ──

type Actor = { id: string; name: string; role: UserRole; firmId: string };

/** Refuses a pull for data older than the current financial year and the two before it. */
export function requirePullable(from: string, provider: string) {
  if (!canPull(from))
    throw new ServiceError(
      `${provider} is only read for the current financial year and the ${PULL_YEARS - 1} before it, and this period starts on ${ukDate(from)}. Import its trial balance from a file instead. What is already here is kept for ${RETENTION_YEARS} years after the year end.`,
      409,
      'OUTSIDE_PULL_WINDOW'
    );
}

/** Finishes the OAuth flow: swaps the code for tokens and links the shared organisation to the client. */
export async function completeConnection(actor: Actor, clientId: string, code: string): Promise<XeroConnection> {
  const tokens = await exchangeCode(code);
  const tenants = await xeroGet<{ tenantId: string; tenantName: string; tenantType: string }[]>(CONNECTIONS_URL, tokens.access_token);
  const org = tenants.find((t) => t.tenantType === 'ORGANISATION') ?? tenants[0];
  if (!org) throw new ServiceError('No Xero organisation was shared. Try again and choose an organisation.', 400, 'XERO_NO_ORG');
  const details = await xeroGet<{ Organisations?: { ShortCode?: string }[] }>(`${API}/Organisation`, tokens.access_token, org.tenantId).catch(() => null);

  const now = new Date();
  db.xero_connections = db.xero_connections.filter((c) => !(c.firm_id === actor.firmId && c.client_id === clientId));
  const conn: XeroConnection = {
    id: `xc_${crypto.randomUUID()}`,
    firm_id: actor.firmId,
    client_id: clientId,
    tenant_id: org.tenantId,
    tenant_name: org.tenantName,
    short_code: details?.Organisations?.[0]?.ShortCode ?? null,
    access_token_enc: encryptToken(tokens.access_token),
    refresh_token_enc: encryptToken(tokens.refresh_token),
    expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    connected_by: actor.id,
    connected_at: now.toISOString(),
    last_synced_at: null,
  };
  db.xero_connections.push(conn);

  const client = db.clients.find((c) => c.id === clientId);
  if (client) {
    client.data_source = 'xero';
    client.reconnect_needed = false;
  }
  db.logAudit(actor.firmId, actor, 'XERO_CONNECTED', 'clients', clientId, null, { tenant_id: org.tenantId, tenant_name: org.tenantName });
  return conn;
}

/** A usable access token, refreshing (and saving the rotated refresh token) when it has expired. */
async function accessTokenFor(conn: XeroConnection): Promise<string> {
  if (new Date(conn.expires_at).getTime() - 60_000 > Date.now()) return decryptToken(conn.access_token_enc);
  try {
    const t = await refreshTokens(decryptToken(conn.refresh_token_enc));
    conn.access_token_enc = encryptToken(t.access_token);
    conn.refresh_token_enc = encryptToken(t.refresh_token);
    conn.expires_at = new Date(Date.now() + t.expires_in * 1000).toISOString();
    return t.access_token;
  } catch (err) {
    if (err instanceof XeroReconnectError) {
      const client = db.clients.find((c) => c.id === conn.client_id);
      if (client) client.reconnect_needed = true;
    }
    throw err;
  }
}

/**
 * Whether Xero's trial balance at the period end differs from the last one imported: two calls and
 * nothing imported. Compared by account name and balance, so codes Blynt made up for code-less lines don't count.
 */
export async function xeroTbChanged(conn: XeroConnection, engagementId: string, periodEnd: string): Promise<boolean> {
  const prior = db.tb_snapshots.filter((s) => s.engagement_id === engagementId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const token = await accessTokenFor(conn);
  const deadline = Date.now() + 30_000;
  const [accounts, report] = await Promise.all([
    xeroGet<{ Accounts: XeroAccount[] }>(`${API}/Accounts`, token, conn.tenant_id, deadline),
    xeroGet<unknown>(`${API}/Reports/TrialBalance?date=${periodEnd}`, token, conn.tenant_id, deadline),
  ]);
  if (!prior) return true;
  const key = (name: string, net: bigint) => `${name.trim()}\u0000${net}`;
  const now = parseTrialBalance(report, accounts.Accounts ?? []).map((l) => key(String(l.name ?? ''), toPence(l.debit) - toPence(l.credit)));
  const before = db.tb_lines
    .filter((l) => l.snapshot_id === prior.id)
    .map((l) => [l.source_name, BigInt(l.debit_p) - BigInt(l.credit_p)] as const)
    .filter(([, net]) => net !== 0n)
    .map(([name, net]) => key(name, net));
  return now.sort().join('\n') !== before.sort().join('\n');
}

/** Pulls the trial balance at the engagement's period end and imports it (DAT-01, DAT-06). */
/** How far past the period end the pull reads transactions. */
export const AFTER_DAYS = 90;

export async function pullTrialBalance(actor: Actor, engagementId: string): Promise<ImportResult> {
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng) throw new ServiceError('Engagement not found', 404, 'NOT_FOUND');
  const conn = db.xero_connections.find((c) => c.firm_id === actor.firmId && c.client_id === eng.client_id);
  if (!conn) throw new ServiceError('This client is not connected to Xero yet.', 409, 'XERO_NOT_CONNECTED');
  requirePullable(eng.period_start, 'Xero');
  // Waits for Xero's limits must end well inside the server's 300-second request limit
  const deadline = Date.now() + 200_000;

  const token = await accessTokenFor(conn);
  const [accounts, report, priorReport] = await Promise.all([
    xeroGet<{ Accounts: XeroAccount[] }>(`${API}/Accounts`, token, conn.tenant_id, deadline),
    xeroGet<unknown>(`${API}/Reports/TrialBalance?date=${eng.period_end}`, token, conn.tenant_id, deadline),
    // Comparatives are a nicety: the import still goes ahead without them, and a prior year outside the window isn't read
    canPull(sameDayLastYear(eng.period_start))
      ? xeroGet<unknown>(`${API}/Reports/TrialBalance?date=${sameDayLastYear(eng.period_end)}`, token, conn.tenant_id, deadline).catch(() => null)
      : null,
  ]);
  const current = parseTrialBalance(report, accounts.Accounts ?? []);
  const lines = priorReport ? withComparatives(current, parseTrialBalance(priorReport, accounts.Accounts ?? [])) : current;
  const out = importTrialBalance(actor, engagementId, lines, 'xero');
  if (out.status >= 400) return out;

  conn.last_synced_at = new Date().toISOString();

  // Read past the period end too: the search for unrecorded liabilities and receipts after date need what was posted after it.
  // shortcut: 90 days after the period end, raise AFTER_DAYS if a search window longer than that is needed
  const after = new Date(Date.parse(eng.period_end) + AFTER_DAYS * 86_400_000).toISOString().slice(0, 10);
  const page = (endpoint: string) => allPages(endpoint, endpoint, token, conn.tenant_id, eng.period_start, after, deadline);
  // The trial balance is in; Xero's limit stopping the transactions keeps it, and the last transactions pulled stay
  const rateLimited = (err: unknown) => {
    if (!(err instanceof ServiceError) || err.code !== 'XERO_RATE_LIMIT') throw err;
    out.body.rateLimited = err.message;
    return out;
  };
  let invoices: XeroDoc[], bank: XeroDoc[], journals: XeroDoc[];
  try {
    [invoices, bank, journals] = await Promise.all([page('Invoices'), page('BankTransactions'), page('ManualJournals')]);
  } catch (err) {
    return rateLimited(err);
  }
  // The rest are gathered in a second round (Xero allows five calls at once), and one that fails,
  // e.g. a connection made before payments were requested, doesn't stop the pull
  const notGathered: string[] = [];
  const extra = (label: string, endpoint: string) =>
    page(endpoint).catch((err) => {
      if (err instanceof ServiceError && err.code === 'XERO_RATE_LIMIT') throw err;
      notGathered.push(label);
      return [] as XeroDoc[];
    });
  let creditNotes: XeroDoc[], payments: XeroDoc[], transfers: XeroDoc[];
  try {
    [creditNotes, payments, transfers] = await Promise.all([extra('credit notes', 'CreditNotes'), extra('payments', 'Payments'), extra('bank transfers', 'BankTransfers')]);
  } catch (err) {
    return rateLimited(err);
  }
  const names = new Map((accounts.Accounts ?? []).filter((a) => a.Code).map((a) => [a.Code!, a.Name]));
  const systemAccount = (name: string) => (accounts.Accounts ?? []).find((a) => a.SystemAccount === name)?.Code;
  const tx = parseTransactions(engagementId, conn.short_code, { invoices, bank, journals, creditNotes, payments, transfers }, names, { debtors: systemAccount('DEBTORS'), creditors: systemAccount('CREDITORS') });
  // Replace this engagement's Xero transactions so a re-pull never doubles them up
  db.transactions = [...db.transactions.filter((t) => !(t.engagement_id === engagementId && t.source === 'Xero')), ...tx];
  out.body.transactionCount = tx.length;
  // Trade debtors and creditors come from what was open at the period end, however old, not from one year's movements
  try {
    const { debtors, creditors } = await openItemsAt(token, conn.tenant_id, conn.short_code, eng.period_end, deadline);
    const at = new Date().toISOString();
    eng.debtor_open_items = { as_at: eng.period_end, fetched_at: at, source: 'Xero', items: debtors };
    eng.creditor_open_items = { as_at: eng.period_end, fetched_at: at, source: 'Xero', items: creditors };
    out.body.openDebtorItems = debtors.length;
    out.body.openCreditorItems = creditors.length;
  } catch (err) {
    if (err instanceof XeroReconnectError) throw err;
    notGathered.push('open debtors and creditors at the period end');
  }
  // Journals Blynt sent: once Xero has posted one, the trial balance just pulled holds it, so it stops adding to it
  for (const a of db.adjustments.filter((x) => x.engagement_id === engagementId && x.ledger?.provider === 'xero')) {
    const mj = journals.find((m) => m.ManualJournalID === a.ledger!.id);
    if (!mj?.Status) continue;
    a.ledger!.status = mj.Status;
    if (mj.Status === 'POSTED' && (a.status === 'approved' || a.status === 'posted')) {
      const before = { ...a };
      a.status = 'in_ledger';
      a.ledger!.in_tb_at = new Date().toISOString();
      db.logAudit(actor.firmId, actor, 'JOURNAL_IN_LEDGER', 'adjustments', a.id, before, a);
    }
  }
  if (notGathered.length) out.body.notGathered = notGathered;
  return out;
}

export function disconnect(actor: Actor, clientId: string) {
  const before = db.xero_connections.length;
  db.xero_connections = db.xero_connections.filter((c) => !(c.firm_id === actor.firmId && c.client_id === clientId));
  if (db.xero_connections.length === before) throw new ServiceError('This client is not connected to Xero.', 404, 'NOT_FOUND');
  db.logAudit(actor.firmId, actor, 'XERO_DISCONNECTED', 'clients', clientId, null, null);
}

// ── Sending approved journals to Xero ──

const writableAccounts = (accounts: XeroAccount[]) => accounts.filter((a) => a.Code && a.Status !== 'ARCHIVED');
const connTokens = (c: XeroConnection) => ({ access_token_enc: c.access_token_enc, refresh_token_enc: c.refresh_token_enc, expires_at: c.expires_at });

function journalConnection(actor: Actor, journalId: string) {
  const j = db.adjustments.find((a) => a.id === journalId);
  const eng = j && db.engagements.find((e) => e.id === j.engagement_id && e.firm_id === actor.firmId);
  if (!j || !eng) throw new ServiceError('Journal not found', 404, 'NOT_FOUND');
  const conn = db.xero_connections.find((c) => c.firm_id === actor.firmId && c.client_id === eng.client_id);
  if (!conn) throw new ServiceError('This client is not connected to Xero. Connect it on the client page first.', 409, 'XERO_NOT_CONNECTED');
  return { j, eng, conn };
}

/**
 * The client's Xero accounts a journal can use, and a suggestion for each line: the client account its
 * Blynt account is mapped from (the one with the largest balance when several are). Nothing is saved but tokens.
 */
export async function xeroAccountsForJournal(actor: Actor, journalId: string) {
  const { j, conn } = journalConnection(actor, journalId);
  const token = await accessTokenFor(conn);
  const { Accounts = [] } = await xeroGet<{ Accounts?: XeroAccount[] }>(`${API}/Accounts`, token, conn.tenant_id, Date.now() + 30_000);
  const accounts = writableAccounts(Accounts).map((a) => ({ code: a.Code!, name: a.Name, type: a.Type }));
  const codes = new Set(accounts.map((a) => a.code));
  const size = (p: string) => (BigInt(p || '0') < 0n ? -BigInt(p || '0') : BigInt(p || '0'));
  const suggested: Record<string, string | null> = {};
  for (const l of j.lines) {
    const m = db.account_mappings
      .filter((x) => x.engagement_id === j.engagement_id && x.blynt_code === l.blynt_code && codes.has(x.source_code))
      .sort((a, b) => (size(b.balance_p) > size(a.balance_p) ? 1 : -1))[0];
    suggested[l.id] = m?.source_code ?? null;
  }
  return { organisation: conn.tenant_name, accounts, suggested, connId: conn.id, tokens: connTokens(conn) };
}

export type SentJournal = { ledger: NonNullable<Adjustment['ledger']>; connId: string; tokens: ReturnType<typeof connTokens> };

/**
 * Sends an approved journal to Xero as a manual journal, each line on the client account chosen for it:
 * a draft unless `post` is set, so someone approves it in Xero. Talks to Xero only; recordXeroJournal saves the result.
 */
export async function sendJournalToXero(actor: Actor, journalId: string, input: { accounts?: Record<string, string>; post?: boolean }): Promise<SentJournal> {
  if (!['reviewer', 'manager', 'partner', 'admin'].includes(actor.role)) throw new ServiceError('Only a reviewer or above can send journals to Xero.', 403, 'FORBIDDEN');
  const { j, eng, conn } = journalConnection(actor, journalId);
  if (eng.status === 'locked') throw new ServiceError('This engagement is locked. Unlock it before sending journals.', 409, 'LOCKED');
  if (j.status !== 'approved' && j.status !== 'posted') throw new ServiceError('Approve the journal before sending it to Xero.', 409, 'NOT_APPROVED');
  const previous = j.ledger;
  if (previous && !['DELETED', 'VOIDED'].includes(previous.status)) throw new ServiceError(`${j.ref} is already in Xero.`, 409, 'ALREADY_SENT');

  const token = await accessTokenFor(conn);
  const { Accounts = [] } = await xeroGet<{ Accounts?: XeroAccount[] }>(`${API}/Accounts`, token, conn.tenant_id, Date.now() + 30_000);
  const usable = new Set(writableAccounts(Accounts).map((a) => a.Code!));
  const lines = j.lines.filter((l) => BigInt(l.debit_p) !== BigInt(l.credit_p));
  const missing = lines.filter((l) => !usable.has(input.accounts?.[l.id] ?? ''));
  if (missing.length) throw new ServiceError(`Choose a Xero account for ${Array.from(new Set(missing.map((l) => l.blynt_code))).join(', ')}.`, 400, 'XERO_ACCOUNT_NEEDED');

  const out = await xeroWrite<{ ManualJournals?: XeroDoc[] }>(
    `${API}/ManualJournals`,
    token,
    conn.tenant_id,
    {
      ManualJournals: [
        {
          Narration: `${j.ref}: ${j.narrative}`,
          Date: j.date ?? eng.period_end,
          Status: input.post ? 'POSTED' : 'DRAFT',
          LineAmountTypes: 'NoTax',
          // Xero takes a debit as a positive amount and a credit as a negative one
          JournalLines: lines.map((l) => ({ AccountCode: input.accounts![l.id], LineAmount: Number(BigInt(l.debit_p) - BigInt(l.credit_p)) / 100, Description: l.narrative || j.narrative })),
        },
      ],
    },
    previous ? `${j.id}-${previous.id}` : j.id
  );
  const mj = out.ManualJournals?.[0];
  if (!mj?.ManualJournalID) throw new ServiceError('Xero did not confirm the journal. Check Xero before sending it again.', 502, 'XERO_ERROR');
  return {
    ledger: {
      provider: 'xero',
      id: mj.ManualJournalID,
      status: mj.Status ?? (input.post ? 'POSTED' : 'DRAFT'),
      url: xeroDeepLink(conn.short_code, `/Journal/View.aspx?invoiceID=${mj.ManualJournalID}`),
      sent_at: new Date().toISOString(),
      sent_by: actor.name,
    },
    connId: conn.id,
    tokens: connTokens(conn),
  };
}

/** Saves a journal sent to Xero, and any tokens Xero rotated, on the latest workspace. */
export function recordXeroJournal(actor: Actor, journalId: string, sent: SentJournal) {
  const conn = db.xero_connections.find((c) => c.id === sent.connId);
  if (conn) Object.assign(conn, sent.tokens);
  const j = db.adjustments.find((a) => a.id === journalId);
  if (!j) return null;
  const before = { ...j };
  j.ledger = sent.ledger;
  // Posted straight away: in the ledger now, though the trial balance holds it only from the next pull
  if (sent.ledger.status === 'POSTED' && j.status === 'approved') j.status = 'posted';
  db.logAudit(actor.firmId, actor, 'SEND_JOURNAL_TO_XERO', 'adjustments', j.id, before, j);
  return j;
}
