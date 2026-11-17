// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({
  syncIn: async () => {},
  syncOut: async () => {},
  freshWrite: async (apply: () => unknown) => apply(),
  currentVersion: () => 1,
  hasDatabase: () => false,
}));

import { db } from '../lib/server/db';
import { importTrialBalance } from '../lib/server/tb-import';
import { sameDayLastYear } from '../lib/periods';
import { createSessionToken, SESSION_COOKIE } from '../lib/server/auth';
import {
  XERO_SCOPES,
  authorizeUrl,
  createState,
  readState,
  encryptToken,
  decryptToken,
  parseTrialBalance,
  withComparatives,
  xeroTbChanged,
} from '../lib/server/xero';
import { GET as connect } from '../app/api/v1/integrations/xero/connect/route';
import { GET as callback } from '../app/api/v1/integrations/xero/callback/route';
import { POST as sync } from '../app/api/v1/integrations/xero/sync/route';
import { DELETE as disconnect } from '../app/api/v1/integrations/xero/connection/route';
import { GET as getState, PUT as putState } from '../app/api/v1/state/route';
import { GET as getLedger } from '../app/api/v1/engagements/[id]/transactions/route';
import { GET as sendGet, POST as sendPost } from '../app/api/v1/adjustments/[id]/xero/route';
import { JOURNAL_IN_TB } from '../lib/types/models';

const FIRM = 'firm_blynt_uk';
const CLIENT = 'cli_harlow';
const ENG = 'eng_harlow_fy26';
const cookie = (uid = 'usr_admin') => `${SESSION_COOKIE}=${createSessionToken(uid)}`;
const get = (url: string, uid?: string) => new Request(`http://localhost${url}`, { headers: uid === undefined ? {} : { cookie: cookie(uid) } });
const post = (url: string, body: unknown, method = 'POST', uid = 'usr_admin') =>
  new Request(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json', cookie: cookie(uid) }, body: JSON.stringify(body) });

// Recorded shapes of Xero's responses (values invented)
const ACCOUNTS = {
  Accounts: [
    { AccountID: 'acc-090', Code: '090', Name: 'Business Bank Account', Type: 'BANK', Class: 'ASSET' },
    { AccountID: 'acc-091', Code: '091', Name: 'Savings', Type: 'BANK', Class: 'ASSET' },
    { AccountID: 'acc-610', Code: '610', Name: 'Accounts Receivable', Type: 'CURRENT', Class: 'ASSET', SystemAccount: 'DEBTORS' },
    { AccountID: 'acc-800', Code: '800', Name: 'Accounts Payable', Type: 'CURRLIAB', Class: 'LIABILITY', SystemAccount: 'CREDITORS' },
    { AccountID: 'acc-200', Code: '200', Name: 'Sales', Type: 'REVENUE', Class: 'REVENUE' },
    { AccountID: 'acc-429', Code: '429', Name: 'General Expenses', Type: 'EXPENSE', Class: 'EXPENSE' },
    { AccountID: 'acc-970', Code: '970', Name: 'Owner A Funds Introduced', Type: 'EQUITY', Class: 'EQUITY' },
  ],
};
const row = (label: string, id: string, ytdDebit: string, ytdCredit: string) => ({
  RowType: 'Row',
  Cells: [
    { Value: label, Attributes: [{ Value: id, Id: 'account' }] },
    { Value: '' }, { Value: '' },
    { Value: ytdDebit, Attributes: [{ Value: id, Id: 'account' }] },
    { Value: ytdCredit, Attributes: [{ Value: id, Id: 'account' }] },
  ],
});
const trialBalance = (expenses = '2500.00', funds = '10000.00') => ({
  Reports: [
    {
      ReportID: 'TrialBalance',
      ReportName: 'Trial Balance',
      ReportDate: '30 September 2026',
      Rows: [
        { RowType: 'Header', Cells: [{ Value: 'Account' }, { Value: 'Debit' }, { Value: 'Credit' }, { Value: 'YTD Debit' }, { Value: 'YTD Credit' }] },
        { RowType: 'Section', Title: 'Revenue', Rows: [row('Sales (200)', 'acc-200', '', '12500.00')] },
        { RowType: 'Section', Title: 'Expenses', Rows: [row('General Expenses (429)', 'acc-429', expenses, '')] },
        {
          RowType: 'Section',
          Title: 'Assets',
          Rows: [row('Business Bank Account (090)', 'acc-090', String((12500 - Number(expenses) + Number(funds)).toFixed(2)), '')],
        },
        { RowType: 'Section', Title: 'Equity', Rows: [row('Owner A Funds Introduced (970)', 'acc-970', '', funds)] },
        { RowType: 'Section', Title: '', Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'Total' }, { Value: '' }, { Value: '' }, { Value: '22500.00' }, { Value: '22500.00' }] }] },
      ],
    },
  ],
});

const INVOICES = [
  { InvoiceID: 'inv-1', Type: 'ACCREC', Status: 'PAID', DateString: '2026-05-10T00:00:00', Contact: { Name: 'Acme Ltd' }, Reference: 'INV-001',
    LineItems: [{ AccountCode: '200', Description: 'Consulting', LineAmount: 1000, TaxAmount: 200 }] },
  { InvoiceID: 'inv-2', Type: 'ACCPAY', Status: 'DRAFT', DateString: '2026-05-11T00:00:00', Contact: { Name: 'Draft Co' },
    LineItems: [{ AccountCode: '429', Description: 'Not posted', LineAmount: 50, TaxAmount: 0 }] },
];
const BANK_TXS = [
  { BankTransactionID: 'bt-1', Type: 'SPEND', Status: 'AUTHORISED', Date: '/Date(1780000000000+0000)/', Contact: { Name: 'Stationers' }, BankAccount: { Code: '090' },
    LineItems: [{ AccountCode: '429', Description: 'Paper', LineAmount: 30, TaxAmount: 6 }] },
];
const CREDIT_NOTES = [
  { CreditNoteID: 'cn-1', Type: 'ACCRECCREDIT', Status: 'AUTHORISED', DateString: '2026-06-01T00:00:00', Contact: { Name: 'Acme Ltd' },
    LineItems: [{ AccountCode: '200', Description: 'Refund', LineAmount: 100, TaxAmount: 20 }] },
  { CreditNoteID: 'cn-2', Type: 'ACCRECCREDIT', Status: 'VOIDED', DateString: '2026-06-02T00:00:00', Contact: { Name: 'Void Ltd' },
    LineItems: [{ AccountCode: '200', LineAmount: 5, TaxAmount: 0 }] },
];
const PAYMENTS = [
  { PaymentID: 'pay-1', PaymentType: 'ACCRECPAYMENT', Status: 'AUTHORISED', DateString: '2026-06-10T00:00:00', Amount: 1200, Account: { Code: '090' }, Reference: 'Receipt', Invoice: { InvoiceID: 'inv-1', Contact: { Name: 'Acme Ltd' } } },
  { PaymentID: 'pay-2', PaymentType: 'ARCREDITPAYMENT', Status: 'AUTHORISED', DateString: '2026-06-11T00:00:00', Amount: 50, Account: { Code: '090' } },
  { PaymentID: 'pay-3', PaymentType: 'ACCPAYPAYMENT', Status: 'DELETED', DateString: '2026-06-12T00:00:00', Amount: 70, Account: { Code: '090' } },
];
const TRANSFERS = [{ BankTransferID: 'bx-1', DateString: '2026-06-15T00:00:00', Amount: 500, FromBankAccount: { Code: '090' }, ToBankAccount: { Code: '091' } }];
const INCLUSIVE = [{ InvoiceID: 'inv-3', Type: 'ACCREC', Status: 'AUTHORISED', LineAmountTypes: 'Inclusive', DateString: '2026-06-20T00:00:00', Contact: { Name: 'Gross Ltd' },
  LineItems: [{ AccountCode: '200', LineAmount: 120, TaxAmount: 20 }] }];

const JOURNALS = [
  { ManualJournalID: 'mj-1', Status: 'POSTED', DateString: '2026-09-30T00:00:00', Narration: 'Year-end accrual',
    JournalLines: [{ AccountCode: '429', LineAmount: 75, Description: 'Accrual' }, { AccountCode: '970', LineAmount: -75 }] },
];

/** A fake Xero: answers the token, connections and accounting endpoints and records each call. */
function fakeXero(
  opts: { tb?: () => unknown; tokenError?: string; noExtras?: boolean; transfers?: unknown[]; invoices?: unknown[]; journals?: unknown[]; journalWrite?: { status: number; body: unknown } } = {}
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let tokenCount = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://identity.xero.com/connect/token') {
      if (opts.tokenError) return json({ error: opts.tokenError }, 400);
      tokenCount++;
      return json({ access_token: `access-${tokenCount}`, refresh_token: `refresh-${tokenCount}`, expires_in: 1800, token_type: 'Bearer' });
    }
    if (url === 'https://api.xero.com/connections') return json([{ id: 'conn-1', tenantId: 'tenant-1', tenantType: 'ORGANISATION', tenantName: 'Harlow Demo Ltd' }]);
    if (url.startsWith('https://api.xero.com/api.xro/2.0/Organisation')) return json({ Organisations: [{ Name: 'Harlow Demo Ltd', ShortCode: '!aB3cD' }] });
    if (url.startsWith('https://api.xero.com/api.xro/2.0/Accounts')) return json(ACCOUNTS);
    if (url.startsWith('https://api.xero.com/api.xro/2.0/Reports/TrialBalance')) return json((opts.tb ?? trialBalance)());
    // One page of each document type; page 2 is empty
    const page2 = url.includes('page=2');
    if (url.startsWith('https://api.xero.com/api.xro/2.0/Invoices')) return json({ Invoices: page2 ? [] : opts.invoices ?? INVOICES });
    if (!opts.noExtras && url.startsWith('https://api.xero.com/api.xro/2.0/CreditNotes')) return json({ CreditNotes: page2 ? [] : CREDIT_NOTES });
    if (!opts.noExtras && url.startsWith('https://api.xero.com/api.xro/2.0/Payments')) return json({ Payments: page2 ? [] : PAYMENTS });
    if (!opts.noExtras && url.startsWith('https://api.xero.com/api.xro/2.0/Prepayments')) return json({ Prepayments: [] });
    if (!opts.noExtras && url.startsWith('https://api.xero.com/api.xro/2.0/Overpayments')) return json({ Overpayments: [] });
    // Transfers ignore the page number, as Xero may
    if (!opts.noExtras && url.startsWith('https://api.xero.com/api.xro/2.0/BankTransfers')) return json({ BankTransfers: opts.transfers ?? TRANSFERS });
    if (url.startsWith('https://api.xero.com/api.xro/2.0/BankTransactions')) return json({ BankTransactions: page2 ? [] : BANK_TXS });
    if (url.startsWith('https://api.xero.com/api.xro/2.0/ManualJournals') && init?.method === 'PUT') {
      if (opts.journalWrite) return json(opts.journalWrite.body, opts.journalWrite.status);
      const mj = JSON.parse(String(init.body)).ManualJournals[0];
      return json({ ManualJournals: [{ ...mj, ManualJournalID: 'mj-new' }] });
    }
    if (url.startsWith('https://api.xero.com/api.xro/2.0/ManualJournals')) return json({ ManualJournals: page2 ? [] : opts.journals ?? JOURNALS });
    return json({ error: 'unexpected' }, 404);
  });
  vi.stubGlobal('fetch', impl);
  return { calls, impl };
}

beforeEach(() => {
  db.seed(true);
  process.env.XERO_CLIENT_ID = 'test-client-id';
  process.env.XERO_CLIENT_SECRET = 'test-client-secret';
  process.env.XERO_REDIRECT_URI = 'http://localhost:3000/api/v1/integrations/xero/callback';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.XERO_CLIENT_ID;
  delete process.env.XERO_CLIENT_SECRET;
  delete process.env.XERO_REDIRECT_URI;
});

describe('Xero client', () => {
  it('builds the consent URL with read-only scopes and offline access', () => {
    const url = new URL(authorizeUrl('state-123'));
    expect(url.origin + url.pathname).toBe('https://login.xero.com/identity/connect/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/v1/integrations/xero/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-123');
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toEqual(XERO_SCOPES);
    expect(scopes).toContain('offline_access');
    expect(scopes.every((s) => !s.endsWith('accounting.transactions') && !s.endsWith('accounting.settings'))).toBe(true);
    // Read-only, except manual journals, which approved Blynt journals are sent to
    expect(scopes.filter((s) => s.startsWith('accounting.') && !s.endsWith('.read'))).toEqual(['accounting.manualjournals']);
    // Retired for apps created on or after 2 March 2026 (Xero returns invalid_scope)
    for (const retired of ['accounting.transactions', 'accounting.transactions.read', 'accounting.reports.read']) expect(scopes).not.toContain(retired);
    expect(scopes).toContain('accounting.payments.read');
    // Needs Xero's approval, so not requested until we use it
    expect(scopes).not.toContain('accounting.journals.read');
    expect(scopes).toContain('accounting.reports.trialbalance.read');
  });

  it('signs the OAuth state and rejects tampering and expiry', () => {
    const s = createState({ firmId: FIRM, userId: 'usr_admin', clientId: CLIENT });
    expect(readState(s)).toMatchObject({ firmId: FIRM, userId: 'usr_admin', clientId: CLIENT });
    expect(readState(s.slice(0, -2) + 'xx')).toBeNull();
    expect(readState(createState({ firmId: FIRM, userId: 'usr_admin', clientId: CLIENT }, -1))).toBeNull();
  });

  it('encrypts tokens at rest', () => {
    const enc = encryptToken('secret-refresh-token');
    expect(enc).not.toContain('secret-refresh-token');
    expect(decryptToken(enc)).toBe('secret-refresh-token');
    expect(encryptToken('x')).not.toBe(encryptToken('x')); // fresh IV each time
  });

  it('turns Xero’s trial balance report into balanced import lines with codes and types', () => {
    const lines = parseTrialBalance(trialBalance(), ACCOUNTS.Accounts);
    expect(lines).toEqual([
      { code: '200', name: 'Sales', type: 'Revenue', debit: '0.00', credit: '12500.00', external_id: 'acc-200' },
      { code: '429', name: 'General Expenses', type: 'Expense', debit: '2500.00', credit: '0.00', external_id: 'acc-429' },
      { code: '090', name: 'Business Bank Account', type: 'Bank', debit: '20000.00', credit: '0.00', external_id: 'acc-090' },
      { code: '970', name: 'Owner A Funds Introduced', type: 'Equity', debit: '0.00', credit: '10000.00', external_id: 'acc-970' },
    ]);
  });
});

describe('Last year on the trial balance', () => {
  const line = (code: string, debit: string, credit: string) => ({ code, name: code, type: 'Overhead', debit, credit, external_id: code });

  it('adds comparatives and keeps prior-only accounts in the ledger’s order', () => {
    const out = withComparatives(
      [line('200', '0.00', '100.00'), line('401', '100.00', '0.00')],
      [line('200', '0.00', '90.00'), line('325', '60.00', '0.00'), line('401', '30.00', '0.00')]
    );
    expect(out.map((l) => [l.code, l.debit, l.credit, l.comparative])).toEqual([
      ['200', '0.00', '100.00', '-90.00'],
      ['325', '0.00', '0.00', '60.00'],
      ['401', '100.00', '0.00', '30.00'],
    ]);
  });

  it('a prior-only account is reported but needs no mapping', () => {
    const lines = [
      { code: '200', name: 'Sales', type: 'Revenue', debit: '0.00', credit: '100.00', comparative: '-90.00' },
      { code: '325', name: 'Direct Expenses', type: 'Direct Costs', debit: '0.00', credit: '0.00', comparative: '60.00' },
      { code: '090', name: 'Bank', type: 'Bank', debit: '100.00', credit: '0.00', comparative: '30.00' },
    ];
    const eng = db.engagements[0];
    const out = importTrialBalance({ id: 'usr_admin', name: 'A', role: 'admin', firmId: eng.firm_id }, eng.id, lines, 'xero');
    expect(out.status).toBe(201);
    const rows = db.tb_lines.filter((l) => l.snapshot_id === out.body.snapshot.id);
    expect(rows.map((l) => l.comparative_p)).toEqual(['-9000', '6000', '3000']);
    expect(db.account_mappings.filter((m) => m.engagement_id === eng.id).map((m) => m.source_code)).toEqual(['200', '090']);
  });

  it('works out last year’s date', () => {
    expect(sameDayLastYear('2026-04-05')).toBe('2025-04-05');
    expect(sameDayLastYear('2024-02-29')).toBe('2023-02-28');
  });
});

describe('Connecting a client to Xero', () => {
  it('says so plainly when Xero is not configured', async () => {
    delete process.env.XERO_CLIENT_ID;
    const res = await connect(get(`/api/v1/integrations/xero/connect?clientId=${CLIENT}`, 'usr_admin'));
    // Back to the client page with a reason the page explains, not a raw JSON error
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain(`/clients/${CLIENT}?xero=not_configured`);
  });

  it('only for a client the user can see', async () => {
    db.users.push({ id: 'usr_lim', email: 'l@x.test', name: 'L', initials: 'L', title: 'P', mfa_enabled: false });
    db.memberships.push({ user_id: 'usr_lim', firm_id: FIRM, role: 'preparer', client_ids: ['cli_acme'] });
    expect((await connect(get(`/api/v1/integrations/xero/connect?clientId=${CLIENT}`, 'usr_lim'))).status).toBe(404);
  });

  it('redirects to Xero, then the callback stores encrypted tokens and links the organisation', async () => {
    const res = await connect(get(`/api/v1/integrations/xero/connect?clientId=${CLIENT}`, 'usr_admin'));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.hostname).toBe('login.xero.com');
    const state = to.searchParams.get('state')!;

    const xero = fakeXero();
    const back = await callback(get(`/api/v1/integrations/xero/callback?code=auth-code&state=${encodeURIComponent(state)}`, 'usr_admin'));
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toContain(`/clients/${CLIENT}?xero=connected`);

    // Code exchanged with client credentials, never sent to the browser
    const tokenCall = xero.calls.find((c) => c.url === 'https://identity.xero.com/connect/token')!;
    expect(String(tokenCall.init?.body)).toContain('grant_type=authorization_code');
    expect((tokenCall.init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`);

    const conn = db.xero_connections.find((c) => c.client_id === CLIENT)!;
    expect(conn).toMatchObject({ firm_id: FIRM, tenant_id: 'tenant-1', tenant_name: 'Harlow Demo Ltd', short_code: '!aB3cD' });
    expect(conn.access_token_enc).not.toContain('access-1');
    expect(decryptToken(conn.refresh_token_enc)).toBe('refresh-1');
    expect(db.clients.find((c) => c.id === CLIENT)).toMatchObject({ data_source: 'xero', reconnect_needed: false });
    expect(db.audit_logs.some((a) => a.action === 'XERO_CONNECTED' && a.entity_id === CLIENT)).toBe(true);
  });

  it('a forged or expired state is refused and nothing is stored', async () => {
    fakeXero();
    const res = await callback(get(`/api/v1/integrations/xero/callback?code=x&state=forged`, 'usr_admin'));
    expect(res.headers.get('location')).toContain('xero=error');
    expect(db.xero_connections).toHaveLength(0);
  });

  it('the person finishing the callback must be the one who started it', async () => {
    const state = createState({ firmId: FIRM, userId: 'usr_admin', clientId: CLIENT });
    fakeXero();
    const res = await callback(get(`/api/v1/integrations/xero/callback?code=x&state=${encodeURIComponent(state)}`, 'usr_test_preparer'));
    expect(res.headers.get('location')).toContain('xero=error');
    expect(db.xero_connections).toHaveLength(0);
  });

  it('a declined consent comes back as a clear message', async () => {
    const state = createState({ firmId: FIRM, userId: 'usr_admin', clientId: CLIENT });
    const res = await callback(get(`/api/v1/integrations/xero/callback?error=access_denied&state=${encodeURIComponent(state)}`, 'usr_admin'));
    expect(res.headers.get('location')).toContain(`/clients/${CLIENT}?xero=declined`);
  });
});

describe('Pulling the trial balance from Xero', () => {
  async function connected() {
    const state = createState({ firmId: FIRM, userId: 'usr_admin', clientId: CLIENT });
    fakeXero();
    await callback(get(`/api/v1/integrations/xero/callback?code=c&state=${encodeURIComponent(state)}`, 'usr_admin'));
  }

  it('pulls the TB at the period end, imports it and maps every account', async () => {
    await connected();
    const xero = fakeXero();
    const res = await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lineCount).toBe(4);
    const tbCall = xero.calls.find((c) => c.url.includes('/Reports/TrialBalance'))!;
    expect(tbCall.url).toContain('date=2026-09-30');
    expect((tbCall.init!.headers as Record<string, string>)['xero-tenant-id']).toBe('tenant-1');
    expect(db.tb_snapshots.find((s) => s.id === body.snapshot.id)!.source).toBe('xero');
    expect(db.account_mappings.filter((m) => m.engagement_id === ENG)).toHaveLength(4);
  });

  it('brings in posted transactions per account, each linking back to the record in Xero', async () => {
    await connected();
    fakeXero();
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    const tx = db.transactions.filter((x) => x.engagement_id === ENG && x.source === 'Xero');
    // Sales invoice: income is a credit
    expect(tx.find((x) => x.external_id === 'inv-1' && x.account_code === '200')).toMatchObject({ amount_p: '-100000', vat_p: '-20000', contact: 'Acme Ltd', date: '2026-05-10' });
    // Drafts are not in the ledger
    expect(tx.some((x) => x.external_id === 'inv-2')).toBe(false);
    // Spend money: expense debit, and the bank account credited with the gross
    expect(tx.find((x) => x.external_id === 'bt-1' && x.account_code === '429')).toMatchObject({ amount_p: '3000' });
    expect(tx.find((x) => x.external_id === 'bt-1' && x.account_code === '090')).toMatchObject({ amount_p: '-3600' });
    expect(tx.find((x) => x.external_id === 'mj-1' && x.account_code === '970')).toMatchObject({ amount_p: '-7500', description: 'Year-end accrual' });
    // Deep links open the record in this client's Xero organisation
    expect(tx.find((x) => x.external_id === 'inv-1')!.external_url).toBe(
      'https://go.xero.com/organisationlogin/default.aspx?shortcode=!aB3cD&redirecturl=/AccountsReceivable/View.aspx?InvoiceID=inv-1'
    );
    // A second pull replaces them rather than doubling up
    fakeXero();
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    expect(db.transactions.filter((x) => x.engagement_id === ENG && x.source === 'Xero')).toHaveLength(tx.length);
  });

  it('gathers credit notes, payments and transfers with the debtors, creditors and bank sides', async () => {
    await connected();
    fakeXero({ invoices: [...INVOICES, ...INCLUSIVE] });
    const res = await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    const body = await res.json();
    expect(body.notGathered).toBeUndefined();
    const tx = db.transactions.filter((x) => x.engagement_id === ENG && x.source === 'Xero');
    const of = (id: string) => tx.filter((x) => x.external_id === id).map((x) => [x.account_code, x.amount_p, x.vat_p]);
    // The invoice debits debtors with the gross
    expect(of('inv-1')).toEqual([['200', '-100000', '-20000'], ['610', '120000', '0']]);
    // A tax-inclusive line is split into net and tax, and still totals the gross
    expect(of('inv-3')).toEqual([['200', '-10000', '-2000'], ['610', '12000', '0']]);
    // A sales credit note reverses it; voided ones are not in the ledger
    expect(of('cn-1')).toEqual([['200', '10000', '2000'], ['610', '-12000', '0']]);
    expect(of('cn-2')).toEqual([]);
    // Payments of invoices only: bank in, debtors out. Credit-note refunds and deleted payments are skipped
    expect(of('pay-1')).toEqual([['090', '120000', '0'], ['610', '-120000', '0']]);
    expect(of('pay-2')).toEqual([]);
    expect(of('pay-3')).toEqual([]);
    expect(tx.find((x) => x.external_id === 'pay-1')!.contact).toBe('Acme Ltd');
    expect(of('bx-1')).toEqual([['091', '50000', '0'], ['090', '-50000', '0']]);
    // Every document nets to nil, so each account's drill-down ties
    for (const id of new Set(tx.map((x) => x.external_id))) {
      expect(tx.filter((x) => x.external_id === id).reduce((sum, x) => sum + BigInt(x.amount_p) + BigInt(x.vat_p), 0n)).toBe(0n);
    }
  });

  it('waits when Xero asks for a minute or less, and keeps the trial balance when its daily limit stops the transactions', async () => {
    await connected();
    const xero = fakeXero();
    // Xero refuses the invoice list `times` times, asking to wait `retryAfter` seconds
    const limit = (retryAfter: string, times: number) => {
      let refused = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/Invoices') && refused++ < times) return new Response('{}', { status: 429, headers: { 'Retry-After': retryAfter, 'X-Rate-Limit-Problem': 'minute' } });
        return xero.impl(input, init);
      }));
    };
    limit('1', 1);
    const waited = await (await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }))).json();
    expect(waited.rateLimited).toBeUndefined();
    expect(waited.transactionCount).toBeGreaterThan(0);
    expect(xero.calls.find((c) => c.url.includes('/Invoices'))!.url).toContain('pageSize=1000');

    limit('86400', 99);
    const res = await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.rateLimited).toMatch(/daily limit .* about 24 hours/);
    expect(db.tb_snapshots.find((s) => s.id === body.snapshot.id)).toBeDefined();
    expect(db.xero_connections.find((c) => c.client_id === CLIENT)!.last_synced_at).not.toBeNull();
    // The transactions from the earlier pull stay
    expect(db.transactions.some((x) => x.engagement_id === ENG && x.external_id === 'inv-1')).toBe(true);
  });

  it('carries on and says what it could not gather, e.g. a connection made before payments were requested', async () => {
    await connected();
    fakeXero({ noExtras: true });
    const res = await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    expect(res.status).toBe(201);
    // Open debtors need credit notes too, so they are not gathered either; the rest of the pull stands
    expect((await res.json()).notGathered).toEqual(['credit notes', 'payments', 'bank transfers', 'open debtors and creditors at the period end']);
    expect(db.transactions.some((x) => x.external_id === 'inv-1')).toBe(true);
  });

  it('reads transactions for 90 days after the period end, for the search for unrecorded liabilities', async () => {
    await connected();
    const { calls } = fakeXero();
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    const eng = db.engagements.find((e) => e.id === ENG)!;
    const until = new Date(Date.parse(eng.period_end) + 90 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', ', ');
    for (const endpoint of ['Invoices', 'BankTransactions', 'ManualJournals', 'Payments']) {
      expect(calls.some((c) => c.url.includes(`/${endpoint}?`) && decodeURIComponent(c.url).includes(`Date <= DateTime(${until})`))).toBe(true);
    }
  });

  it('keeps the sales and purchase documents open at the period end, for the debtors and creditors', async () => {
    await connected();
    const { calls } = fakeXero();
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    const eng = db.engagements.find((e) => e.id === ENG)!;
    expect(eng.debtor_open_items?.as_at).toBe(eng.period_end);
    expect(eng.creditor_open_items?.as_at).toBe(eng.period_end);
    // Open items are read however old, filtered to what was open at the period end, not by the year's dates
    const invoiceCall = calls.find((c) => c.url.includes('/Invoices') && decodeURIComponent(c.url).includes('FullyPaidOnDate'));
    expect(invoiceCall).toBeTruthy();
    expect(['Prepayments', 'Overpayments'].every((e) => calls.some((c) => c.url.includes(`/${e}?`)))).toBe(true);
  });

  it('an endpoint that ignores the page number does not repeat its rows', async () => {
    await connected();
    const many = Array.from({ length: 100 }, (_, i) => ({ BankTransferID: `bx-${i}`, DateString: '2026-06-15T00:00:00', Amount: 1, FromBankAccount: { Code: '090' }, ToBankAccount: { Code: '091' } }));
    fakeXero({ transfers: many });
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    expect(db.transactions.filter((x) => x.external_id?.startsWith('bx-') && x.account_code === '091')).toHaveLength(100);
  });

  it('a late posting in Xero shows up on the next pull', async () => {
    await connected();
    fakeXero();
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    fakeXero({ tb: () => trialBalance('2750.00') });
    const body = await (await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }))).json();
    expect(body.changes.find((c: any) => c.account_code === '429')).toMatchObject({ diff_p: '25000', direction: 'increased' });
  });

  it('the end-of-day check tells a moved balance from an unchanged one without importing', async () => {
    await connected();
    fakeXero();
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    const eng = db.engagements.find((e) => e.id === ENG)!;
    const snapshots = db.tb_snapshots.length;
    expect(await xeroTbChanged(db.xero_connections[0], ENG, eng.period_end)).toBe(false);
    fakeXero({ tb: () => trialBalance('2750.00') });
    expect(await xeroTbChanged(db.xero_connections[0], ENG, eng.period_end)).toBe(true);
    expect(db.tb_snapshots).toHaveLength(snapshots);
  });

  it('refreshes an expired access token and keeps the rotated refresh token', async () => {
    await connected();
    const conn = db.xero_connections[0];
    conn.expires_at = new Date(Date.now() - 1000).toISOString();
    const xero = fakeXero();
    expect((await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }))).status).toBe(201);
    const refresh = xero.calls.find((c) => c.url === 'https://identity.xero.com/connect/token')!;
    expect(String(refresh.init?.body)).toContain('grant_type=refresh_token');
    expect(decryptToken(db.xero_connections[0].refresh_token_enc)).toBe('refresh-1');
    expect(new Date(db.xero_connections[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('a revoked or expired connection marks the client as needing reconnection', async () => {
    await connected();
    db.xero_connections[0].expires_at = new Date(Date.now() - 1000).toISOString();
    fakeXero({ tokenError: 'invalid_grant' });
    const res = await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('XERO_RECONNECT');
    expect(db.clients.find((c) => c.id === CLIENT)!.reconnect_needed).toBe(true);
  });

  it('a client with no Xero connection gets a clear error', async () => {
    const res = await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('XERO_NOT_CONNECTED');
  });

  it('another practice cannot pull or disconnect this client', async () => {
    await connected();
    db.firms.push({ id: 'firm_other', name: 'O', created_at: '2026-01-01T00:00:00Z' });
    db.users.push({ id: 'usr_other', email: 'o@o.test', name: 'O', initials: 'O', title: 'A', mfa_enabled: false });
    db.memberships.push({ user_id: 'usr_other', firm_id: 'firm_other', role: 'admin' });
    expect((await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }, 'POST', 'usr_other'))).status).toBe(404);
    expect((await disconnect(post(`/api/v1/integrations/xero/connection?clientId=${CLIENT}`, {}, 'DELETE', 'usr_other'))).status).toBe(404);
    expect(db.xero_connections).toHaveLength(1);
  });

  it('disconnecting removes the stored tokens', async () => {
    await connected();
    fakeXero();
    const res = await disconnect(post(`/api/v1/integrations/xero/connection?clientId=${CLIENT}`, {}, 'DELETE'));
    expect(res.status).toBe(200);
    expect(db.xero_connections).toHaveLength(0);
    expect(db.audit_logs.some((a) => a.action === 'XERO_DISCONNECTED')).toBe(true);
  });

  it('tokens never reach the browser', async () => {
    await connected();
    const { firmSlice } = await import('../lib/server/state-guard');
    expect(firmSlice(db.exportState() as any, FIRM)).not.toHaveProperty('xero_connections');
  });
});

describe('Xero bank payments after the period end (creditors check)', () => {
  it('keeps bill payments and spend money, and matches them to suppliers by name or invoice amount', async () => {
    const { parseBankPayments } = await import('../lib/server/xero');
    const { bankMatches } = await import('../lib/workpapers/creditors');
    const payments = parseBankPayments('!abc', {
      payments: [
        { PaymentID: 'p1', PaymentType: 'ACCPAYPAYMENT', Status: 'AUTHORISED', DateString: '2026-10-05T00:00:00', Amount: 1200.5, IsReconciled: true, Invoice: { InvoiceID: 'i1', Contact: { Name: 'Booker Ltd' } } },
        { PaymentID: 'p2', PaymentType: 'ACCRECPAYMENT', Status: 'AUTHORISED', DateString: '2026-10-06T00:00:00', Amount: 50 },
        { PaymentID: 'p3', PaymentType: 'ACCPAYPAYMENT', Status: 'DELETED', DateString: '2026-10-07T00:00:00', Amount: 99 },
      ],
      bank: [
        { BankTransactionID: 'b1', Type: 'SPEND', Status: 'AUTHORISED', DateString: '2026-10-02T00:00:00', Total: 345, Contact: { Name: '' }, Reference: 'CARD 1234' },
        { BankTransactionID: 'b2', Type: 'RECEIVE', Status: 'AUTHORISED', DateString: '2026-10-03T00:00:00', Total: 10 },
      ],
    });
    expect(payments.map((p) => [p.date, p.amount_p, p.reconciled])).toEqual([
      ['2026-10-02', '34500', false],
      ['2026-10-05', '120050', true],
    ]);
    const supplier = (name: string, invoice: string) => ({ id: 's', name, ledger_p: '999999', statement_p: '', paid_after_p: '0', invoices: [{ ref: 'x', date: '2026-09-01', days: 29, amount_p: invoice }] });
    expect(bankMatches(supplier('BOOKER LIMITED', '1'), payments).map((p) => p.amount_p)).toEqual(['120050']); // by name
    expect(bankMatches(supplier('Jefferson Gas', '34500'), payments).map((p) => p.amount_p)).toEqual(['34500']); // by amount
    expect(bankMatches(supplier('Nobody', '1'), payments)).toEqual([]);
  });
});

describe('Ledger transactions stay on the server, out of the workspace download', () => {
  it('the workspace leaves them out, a save cannot change them, and an engagement fetches its own a page at a time', async () => {
    const state = createState({ firmId: FIRM, userId: 'usr_admin', clientId: CLIENT });
    fakeXero();
    await callback(get(`/api/v1/integrations/xero/callback?code=c&state=${encodeURIComponent(state)}`, 'usr_admin'));
    fakeXero();
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    const pulled = db.transactions.filter((t) => t.engagement_id === ENG);
    expect(pulled.length).toBeGreaterThan(2);

    const ws = await (await getState(get('/api/v1/state', 'usr_admin'))).json();
    expect(ws.data.transactions).toBeUndefined();
    expect(ws.data.engagements.length).toBeGreaterThan(0);

    // A save without them (or with an edited copy) leaves the server's untouched
    const res = await putState(post('/api/v1/state', { version: 1, data: { ...ws.data, transactions: [] } }, 'PUT'));
    expect(res.status).toBe(200);
    expect(db.transactions.filter((t) => t.engagement_id === ENG)).toHaveLength(pulled.length);

    const page = async (q: string) => (await getLedger(get(`/api/v1/engagements/${ENG}/transactions${q}`, 'usr_admin'), { params: Promise.resolve({ id: ENG }) })).json();
    const first = await page('?offset=0&limit=2');
    expect(first.total).toBe(pulled.length);
    expect(first.rows.map((t: any) => t.id)).toEqual(pulled.slice(0, 2).map((t) => t.id));
    expect((await page('?offset=2')).rows).toHaveLength(pulled.length - 2);
    // Another firm's user cannot read them
    const outsider = db.users.find((u) => !db.memberships.some((m) => m.user_id === u.id && m.firm_id === FIRM));
    if (outsider) expect((await getLedger(get(`/api/v1/engagements/${ENG}/transactions`, outsider.id), { params: Promise.resolve({ id: ENG }) })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('Sending an approved journal to Xero', () => {
  async function connected() {
    const state = createState({ firmId: FIRM, userId: 'usr_admin', clientId: CLIENT });
    fakeXero();
    await callback(get(`/api/v1/integrations/xero/callback?code=c&state=${encodeURIComponent(state)}`, 'usr_admin'));
  }
  const journal = (status: 'approved' | 'accepted' = 'approved') => {
    const j = {
      id: 'aje_x1', engagement_id: ENG, ref: 'AJE-009', narrative: 'Specific bad debt provision', status, type: 'adjusting', date: '2026-09-30',
      proposed_by: 'usr_test_preparer', proposed_by_name: 'Test Preparer', approved_by: 'usr_admin', created_at: '2026-11-15T10:00:00Z',
      lines: [
        { id: 'l1', adjustment_id: 'aje_x1', blynt_code: '4910', debit_p: '200000', credit_p: '0' },
        { id: 'l2', adjustment_id: 'aje_x1', blynt_code: '7110', debit_p: '0', credit_p: '200000' },
      ],
    };
    db.adjustments.push(j as any);
    // The client's expense account is mapped to 4910; nothing is mapped to 7110 yet
    db.account_mappings.push({ id: 'map_x', engagement_id: ENG, source_code: '429', source_name: 'General Expenses', blynt_code: '4910', balance_p: '7500' } as any);
    return j;
  };
  const xeroRoute = (method: 'GET' | 'POST', body?: unknown, uid = 'usr_admin') =>
    method === 'GET' ? sendGet(get('/api/v1/adjustments/aje_x1/xero', uid), { params: Promise.resolve({ id: 'aje_x1' }) }) : sendPost(post('/api/v1/adjustments/aje_x1/xero', body, 'POST', uid), { params: Promise.resolve({ id: 'aje_x1' }) });

  it('suggests each line the client account it is mapped from', async () => {
    await connected();
    journal();
    fakeXero();
    const out = await (await xeroRoute('GET')).json();
    expect(out.suggested).toEqual({ l1: '429', l2: null });
    expect(out.accounts.map((a: any) => a.code)).toContain('970');
    expect(out).not.toHaveProperty('tokens');
  });

  it('sends it as a draft manual journal on the chosen accounts, debits positive and credits negative', async () => {
    await connected();
    const j = journal();
    const xero = fakeXero();
    const res = await xeroRoute('POST', { accounts: { l1: '429', l2: '970' } });
    expect(res.status).toBe(200);
    const put = xero.calls.find((c) => c.init?.method === 'PUT')!;
    const sent = JSON.parse(String(put.init!.body)).ManualJournals[0];
    expect(sent).toMatchObject({ Status: 'DRAFT', Date: '2026-09-30', Narration: 'AJE-009: Specific bad debt provision' });
    expect(sent.JournalLines).toEqual([
      expect.objectContaining({ AccountCode: '429', LineAmount: 2000 }),
      expect.objectContaining({ AccountCode: '970', LineAmount: -2000 }),
    ]);
    expect((put.init!.headers as Record<string, string>)['Idempotency-Key']).toBe('aje_x1');
    const saved = db.adjustments.find((a) => a.id === j.id)!;
    expect(saved).toMatchObject({ status: 'approved', ledger: { provider: 'xero', id: 'mj-new', status: 'DRAFT' } });
    // Sent once only
    expect((await xeroRoute('POST', { accounts: { l1: '429', l2: '970' } })).status).toBe(409);
  });

  it('needs an account for every line, an approved journal and a reviewer or above', async () => {
    await connected();
    journal('accepted');
    fakeXero();
    expect((await xeroRoute('POST', { accounts: { l1: '429', l2: '970' } })).status).toBe(409);
    db.adjustments.find((a) => a.id === 'aje_x1')!.status = 'approved';
    const missing = await xeroRoute('POST', { accounts: { l1: '429' } });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain('7110');
    expect((await xeroRoute('POST', { accounts: { l1: '429', l2: '970' } }, 'usr_test_preparer')).status).toBe(403);
  });

  it("passes on Xero's reasons when it refuses the journal", async () => {
    await connected();
    journal();
    fakeXero({ journalWrite: { status: 400, body: { Elements: [{ ValidationErrors: [{ Message: 'Account code 970 is archived.' }] }] } } });
    const res = await xeroRoute('POST', { accounts: { l1: '429', l2: '970' } });
    expect((await res.json()).error).toBe('Xero refused the journal: Account code 970 is archived.');
    expect(db.adjustments.find((a) => a.id === 'aje_x1')!.ledger).toBeUndefined();
  });

  it('once Xero has posted it, the next pull takes it out of the adjustments, as the trial balance now holds it', async () => {
    await connected();
    const j = journal();
    Object.assign(db.adjustments.find((a) => a.id === j.id)!, { ledger: { provider: 'xero', id: 'mj-1', status: 'DRAFT', sent_at: '2026-11-15T10:00:00Z', sent_by: 'Dev' } });
    fakeXero(); // mj-1 comes back POSTED
    await sync(post('/api/v1/integrations/xero/sync', { engagementId: ENG }));
    const after = db.adjustments.find((a) => a.id === j.id)!;
    expect(after.status).toBe('in_ledger');
    expect(after.ledger?.status).toBe('POSTED');
    expect(JOURNAL_IN_TB).not.toContain('in_ledger');
  });
});
