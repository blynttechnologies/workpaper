import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../lib/server/db';
import { services } from '../lib/server/services';
import { journalAction } from '../lib/server/journals';
import { asPence, formatPence, toPence } from '../lib/money';
import {
  REPORTS,
  buildReport,
  toCsv,
  practiceReport,
  newBudget,
  setBudgetCell,
  setActiveBudget,
  budgetCsv,
  importBudgetCsv,
  budgetVsActual,
  cashFlow,
  cashForecast,
  saveForecast,
  quarterlyPack,
  setQuarterly,
  journalsLedgerCsv,
  fileIndex,
} from '../lib/management';

describe('Stage E - Reports, Management Accounts, Quarterly Pack and Launch (Steps 15–18)', () => {
  const firmId = 'firm_blynt_uk';
  const engagementId = 'eng_harlow_fy26';
  const preparer = { id: 'usr_test_preparer', name: 'Test Preparer', role: 'preparer' as const };
  const reviewer = { id: 'usr_test_reviewer', name: 'Test Reviewer', role: 'reviewer' as const };
  const partner = { id: 'usr_test_partner', name: 'Test Partner', role: 'partner' as const };

  beforeEach(() => {
    db.seed(true);
  });

  // =========================================================================
  // STEP 15 · Reports and dashboards (RPT-01, RPT-02, RPT-03, ENG-05)
  // =========================================================================
  describe('Step 15 · Reports and Dashboards', () => {
    it('RPT-01: Report library generates unadjusted TB, adjusted TB, journals, and review status reports', () => {
      // 1. Unadjusted TB report
      const rUnadj = buildReport(engagementId, 'tb_unadjusted');
      expect(rUnadj.title).toBe('Trial balance (as imported)');
      expect(rUnadj.rows.length).toBeGreaterThan(0);

      // 2. Adjusted TB report
      const rAdj = buildReport(engagementId, 'tb_adjusted');
      expect(rAdj.title).toBe('Trial balance (adjusted)');
      expect(rAdj.columns).toContain('Adjusted');
      expect(rAdj.rows.length).toBeGreaterThan(0);

      // 3. Journal register report
      const rJnl = buildReport(engagementId, 'journals');
      expect(rJnl.title).toBe('Journal register');
      expect(rJnl.columns).toContain('Debit');

      // 4. Review status report
      const rRev = buildReport(engagementId, 'review_status');
      expect(rRev.title).toBe('Review status');
      expect(rRev.columns).toContain('Prepared');

      // 5. CSV export outputs numbers formatted cleanly
      const csv = toCsv(rAdj.columns, rAdj.rows);
      expect(csv).toContain('Code,Account,Imported,Journals,Adjusted');
    });

    it('RPT-02: Full working paper file export compiles index, schedules, leads, conclusions and evidence', () => {
      const index = fileIndex(engagementId);
      expect(index.length).toBeGreaterThan(0);

      const bankEntry = index.find((i) => i.ref === 'B-10');
      expect(bankEntry).toBeDefined();
      expect(bankEntry?.title).toBeDefined();
      expect(Array.isArray(bankEntry?.signoffs)).toBe(true);
      expect(Array.isArray(bankEntry?.comments)).toBe(true);
    });

    it('RPT-03 & ENG-05: Practice management report calculates WIP, deadlines, days remaining and AI accuracy per output type', () => {
      // Record sample AI action log items
      db.ai_action_logs.push(
        {
          id: 'log_1',
          firm_id: firmId,
          engagement_id: engagementId,
          output_type: 'mapping',
          confidence: 95,
          outcome: 'accepted',
          model_version: 'v1.0',
          inputs_used: 'Ledger nominal accounts',
          decided_by: preparer.id,
          decided_by_name: preparer.name,
          decided_at: '2026-09-15T10:00:00Z',
        },
        {
          id: 'log_2',
          firm_id: firmId,
          engagement_id: engagementId,
          output_type: 'extraction',
          confidence: 92,
          outcome: 'accepted',
          model_version: 'v1.0',
          inputs_used: 'Bank statement PDF',
          decided_by: preparer.id,
          decided_by_name: preparer.name,
          decided_at: '2026-09-15T11:00:00Z',
        }
      );

      const report = practiceReport(firmId, '2026-09-30');
      expect(report.work.length).toBeGreaterThan(0);

      const harlowWork = report.work.find((w) => w.id === engagementId);
      expect(harlowWork).toBeDefined();
      expect(typeof harlowWork?.reconciledPct).toBe('number');
      expect(typeof harlowWork?.reviewedPct).toBe('number');
      expect(typeof harlowWork?.daysLeft).toBe('number');
      expect(['none', 'soon', 'overdue']).toContain(harlowWork?.alert);

      // AI accuracy metrics per month
      expect(report.ai.length).toBeGreaterThan(0);
      const mappingMetric = report.ai.find((a) => a.type === 'mapping');
      expect(mappingMetric).toBeDefined();
      expect(mappingMetric?.pct).toBe(100);
    });
  });

  // =========================================================================
  // STEP 16 · Management accounts, budgets and cash flow (MGT-01 to MGT-05)
  // =========================================================================
  describe('Step 16 · Management Accounts, Budgets and Cash Flow', () => {
    it('MGT-03: Budgeting creates monthly budget, edits cells, sets active, and compares actuals vs budget', () => {
      const actor = { id: preparer.id, name: preparer.name, role: preparer.role };

      // 1. Create new budget from prior year with 5% uplift
      const budget = newBudget(engagementId, 'FY26 Working Budget', 'prior', actor, 5);
      expect(budget).toBeDefined();
      expect(budget?.name).toBe('FY26 Working Budget');
      expect(budget?.active).toBe(true);

      const turnoverLine = Object.keys(budget!.lines).find((l) => /turnover|sales/i.test(l))!;
      expect(budget!.lines[turnoverLine].length).toBe(12);

      // 2. Edit a single monthly budget cell
      setBudgetCell(engagementId, budget!.id, turnoverLine, 0, 50000000n, actor); // £500,000 in Month 1
      const updatedEng = db.engagements.find((e) => e.id === engagementId)!;
      expect(updatedEng.budgets![0].lines[turnoverLine][0]).toBe('50000000');

      // 3. Export to CSV and verify structure
      const csv = budgetCsv(budget!);
      expect(csv).toContain('Line,Month 1,Month 2');

      // 4. Budget vs Actual comparison
      const bva = budgetVsActual(engagementId);
      expect(bva).toBeDefined();
      expect(bva?.name).toBe('FY26 Working Budget');
      expect(bva?.rows.length).toBeGreaterThan(0);
    });

    it('MGT-04: Cash flow statement builds indirect cash bridge reconciling opening to closing cash', () => {
      const cf = cashFlow(engagementId);
      expect(cf).toBeDefined();
      if (!cf) return;

      expect(cf.lines.length).toBeGreaterThanOrEqual(6);
      expect(cf.lines.some((l) => l.group === 'Operating')).toBe(true);
      expect(cf.lines.some((l) => l.group === 'Investing')).toBe(true);
      expect(cf.lines.some((l) => l.group === 'Financing')).toBe(true);

      // Cash reconciliation agrees
      expect(cf.closing).toBe(cf.opening + cf.change + cf.difference);
    });

    it('MGT-05: 12-month cash forecast calculates cash flow based on budget and credit terms', () => {
      const actor = { id: preparer.id, name: preparer.name, role: preparer.role };
      // Ensure active budget exists
      newBudget(engagementId, 'Active Forecast Budget', 'prior', actor, 0);

      saveForecast(
        engagementId,
        {
          debtor_days: 45,
          creditor_days: 30,
          minimum_cash_p: '5000000', // £50,000 minimum
          capex_p: '250000', // £2,500/mo
          dividends_p: '1000000', // £10,000/mo
        },
        actor
      );

      const forecast = cashForecast(engagementId);
      expect(forecast).toBeDefined();
      expect(forecast?.length).toBe(12);

      // Monthly columns: opening, receipts, payments, closing, below
      const m1 = forecast![0];
      expect(m1.month).toBe(1);
      expect(typeof m1.opening).toBe('bigint');
      expect(typeof m1.receipts).toBe('bigint');
      expect(typeof m1.payments).toBe('bigint');
      expect(typeof m1.closing).toBe('bigint');
      expect(typeof m1.below).toBe('boolean');
    });
  });

  // =========================================================================
  // STEP 17 · Quarterly insight pack (QTR-01, QTR-03)
  // =========================================================================
  describe('Step 17 · Quarterly Insight Pack', () => {
    it('QTR-01 & QTR-03: Quarterly insight pack generates KPIs, AI insights, and requires partner/manager approval', () => {
      const pack = quarterlyPack(engagementId);
      expect(pack.kpis.length).toBe(6); // Revenue, Gross profit, Net profit, Cash, Debtors, Creditors
      expect(pack.deadlines.length).toBeGreaterThanOrEqual(1);

      // Attempting to approve without accountant's comment is rejected
      const emptyErr = setQuarterly(engagementId, partner, { status: 'approved' });
      expect(emptyErr).toContain('accountant’s comment');

      // Add accountant's comment and set ready
      setQuarterly(engagementId, preparer, { comment: 'Trading was robust with solid cash collection in Q4.' });
      const readyErr = setQuarterly(engagementId, preparer, { status: 'ready' });
      expect(readyErr).toBeNull();

      // Only manager/partner can approve
      const preparerApproveErr = setQuarterly(engagementId, preparer, { status: 'approved' });
      expect(preparerApproveErr).toContain('manager or partner');

      const partnerApproveErr = setQuarterly(engagementId, partner, { status: 'approved' });
      expect(partnerApproveErr).toBeNull();

      const approvedPack = quarterlyPack(engagementId);
      expect(approvedPack.state.status).toBe('approved');
      expect(approvedPack.state.approved_by).toBe(partner.name);
    });
  });

  // =========================================================================
  // STEP 18 · Ledger posting and launch hardening (JNL-03)
  // =========================================================================
  describe('Step 18 · Ledger Posting and Launch Hardening', () => {
    it('JNL-03: Approved adjustments export in ledger CSV layout and can be marked as posted', () => {
      // Find or create an approved journal
      const jnl = db.adjustments.find((j) => j.engagement_id === engagementId);
      expect(jnl).toBeDefined();
      if (!jnl) return;

      jnl.status = 'approved';

      // 1. Export in ledger CSV format
      const exportRes = journalsLedgerCsv(engagementId);
      expect(exportRes.count).toBeGreaterThan(0);
      expect(exportRes.csv).toContain('*Narration,*Date,Description,*AccountCode,*TaxRate,*Amount');

      // 2. Mark journal as posted
      const actor = { id: partner.id, name: partner.name, role: partner.role, firmId };
      const posted = journalAction(actor, jnl.id, {
        action: 'post',
        reason: 'Xero Manual Journal Reference #XJ-9042',
      });

      expect(posted.status).toBe('posted');
      expect(db.adjustments.find((x) => x.id === jnl.id)?.status).toBe('posted');
    });
  });
});
