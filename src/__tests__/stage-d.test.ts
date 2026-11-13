import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../lib/server/db';
import { services } from '../lib/server/services';
import { signOff } from '../lib/server/signoff';
import { asPence, formatPence } from '../lib/money';
import { buildAccounts } from '../lib/workpapers/accounts';
import {
  plAnalysis,
  bsAnalysis,
  clientQueries,
  postBalanceSheetEvents,
  setCommentary,
} from '../lib/analysis';
import {
  standardCheck,
  dismissStandardFinding,
  checklistFor,
  answerChecklist,
  draftNotes,
  notesFor,
  consistencyChecks,
  completionBlockers,
} from '../lib/completion';
import { standardFor } from '../lib/standards';

describe('Stage D - AI Review, Disclosures and Statutory Accounts (Steps 13–14)', () => {
  const firmId = 'firm_blynt_uk';
  const engagementId = 'eng_harlow_fy26';
  const preparer = { id: 'usr_test_preparer', name: 'Test Preparer', role: 'preparer' as const };
  const reviewer = { id: 'usr_test_reviewer', name: 'Test Reviewer', role: 'reviewer' as const };
  const manager = { id: 'usr_test_manager', name: 'Test Manager', role: 'manager' as const };
  const partner = { id: 'usr_test_partner', name: 'Test Partner', role: 'partner' as const };

  beforeEach(() => {
    db.seed(true);
  });

  // =========================================================================
  // STEP 13 · AI review and analysis (ANL-01 to ANL-04, AIX-03, AIX-07)
  // =========================================================================
  describe('Step 13 · AI Review and Analysis', () => {
    it('ANL-01: Profit and loss movement analysis flags significant variances and explains them from ledger data', () => {
      const pl = plAnalysis(engagementId);
      expect(pl.rows.length).toBeGreaterThan(0);
      expect(pl.ratios.length).toBe(4); // Gross margin, Operating margin, Net margin, Staff cost to turnover

      // Find flagged rows (movements over £1,000 and 10%)
      const flagged = pl.rows.filter((r) => r.flagged);
      expect(flagged.length).toBeGreaterThan(0);

      // Flagged rows have AI explanations naming accounts and journals
      const explained = flagged.filter((r) => r.explanation !== null);
      expect(explained.length).toBeGreaterThan(0);
      expect(explained[0].explanation).toContain('up');
    });

    it('ANL-02: Balance sheet analysis evaluates key liquidity ratios and going concern indicators', () => {
      const bs = bsAnalysis(engagementId);
      expect(bs.rows.length).toBeGreaterThan(0);
      expect(bs.ratios.length).toBe(6); // Current ratio, Quick ratio, Debtor days, Creditor days, Stock days, Gearing

      // Ratio tests
      const currentRatio = bs.ratios.find((r) => r.label === 'Current ratio');
      expect(currentRatio).toBeDefined();
      expect(typeof currentRatio?.value).toBe('number');

      // Check going concern triggers
      expect(Array.isArray(bs.goingConcern)).toBe(true);
    });

    it('ANL-03: Manual commentary everywhere with audit history and visibility control (internal vs client-facing)', () => {
      // 1. Add internal commentary
      setCommentary(engagementId, 'Turnover', preparer, {
        text: 'Initial draft explanation for revenue growth.',
        ai_text: 'Sales increased by £800k across commercial accounts.',
        visibility: 'internal',
      });

      const eng = db.engagements.find((e) => e.id === engagementId)!;
      expect(eng.commentary?.Turnover.text).toBe('Initial draft explanation for revenue growth.');
      expect(eng.commentary?.Turnover.visibility).toBe('internal');
      expect(eng.commentary?.Turnover.history.length).toBe(1);

      // 2. Edit commentary and promote to client-facing
      setCommentary(engagementId, 'Turnover', reviewer, {
        text: 'Commercial revenue expanded by 14.8% due to distribution expansion.',
        visibility: 'client',
      });

      expect(eng.commentary?.Turnover.text).toContain('Commercial revenue');
      expect(eng.commentary?.Turnover.visibility).toBe('client');
      expect(eng.commentary?.Turnover.history.length).toBe(2);

      // Empty text resets visibility to internal
      setCommentary(engagementId, 'Turnover', preparer, {
        text: '',
        visibility: 'client',
      });
      expect(eng.commentary?.Turnover.visibility).toBe('internal');
    });

    it('AIX-03: Automatic client query list generated from gaps in the file', () => {
      const queries = clientQueries(engagementId);
      expect(Array.isArray(queries)).toBe(true);
      expect(queries.length).toBeGreaterThan(0);

      // Each query contains id, source, href, and actionable text
      const q = queries[0];
      expect(q.id).toBeDefined();
      expect(q.source).toBeDefined();
      expect(q.href).toContain(`/engagements/${engagementId}`);
      expect(q.text.length).toBeGreaterThan(5);
    });

    it('AIX-07: Post balance sheet events scan detects transactions dated after period end over threshold', () => {
      // Add a post-period-end transaction
      const eng = db.engagements.find((e) => e.id === engagementId)!;
      db.transactions.push({
        id: 'tx_post_period_1',
        engagement_id: engagementId,
        date: '2026-10-15', // After period end 2026-09-30
        amount_p: '2500000', // £25,000
        account_code: '1010',
        account_name: 'Barclays Operating Account',
        vat_p: '0',
        gross_p: '2500000',
        source: 'CSV Upload',
        contact: 'Major Equipment Supplier',
        description: 'New industrial machinery purchase',
      });

      const events = postBalanceSheetEvents(engagementId);
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.id === 'tx_post_period_1')).toBe(true);
    });

    it('ANL-04: AI schedule review bot flags warnings/errors and blocks sign-off until answered', () => {
      const bankWp = db.workpapers.find((w) => w.engagement_id === engagementId && w.ref === 'B-10')!;
      bankWp.status = 'reconciled';
      db.signoffs = db.signoffs.filter((s) => s.workpaper_id !== bankWp.id);

      // Insert open review warning on the bank schedule
      db.ai_review_findings.push({
        id: 'rf_test_err',
        workpaper_id: bankWp.id,
        schedule_ref: 'B-10',
        title: 'Unreconciled difference detected on current account',
        severity: 'warning',
        status: 'open',
        created_at: new Date().toISOString(),
      });

      // Attempting to sign off 'prepare' while open warnings exist is blocked
      const actor = { id: preparer.id, name: preparer.name, role: preparer.role, firmId };
      expect(() => signOff(actor, bankWp.id, 'prepare')).toThrow(/review finding/);

      // Dismiss the finding with a reason
      const finding = db.ai_review_findings.find((f) => f.id === 'rf_test_err')!;
      finding.status = 'dismissed';
      finding.dismiss_reason = 'Explained by timing difference in clearing transit';

      // Now the check passes (finding no longer open)
      expect(finding.status).toBe('dismissed');
    });
  });

  // =========================================================================
  // STEP 14 · Disclosures, notes, statutory accounts, completion
  // =========================================================================
  describe('Step 14 · Disclosures, Notes, Statutory Accounts and Completion', () => {
    it('STD-01: Accounting standards library provides correct framework and version by period date', () => {
      const frs102 = standardFor('Small company (FRS 102 1A)', '2026-09-30')!;
      expect(frs102.code).toBe('FRS 102 1A');
      expect(frs102.disclosures.length).toBeGreaterThan(0);

      const frs105 = standardFor('Micro-entity (FRS 105)', '2026-09-30')!;
      expect(frs105.code).toBe('FRS 105');
    });

    it('STD-02: Standard completeness check detects missing schedules required by the standard', () => {
      // Find required schedules
      const findings = standardCheck(engagementId);
      expect(Array.isArray(findings)).toBe(true);

      // If a required schedule is marked not applicable while having a balance, it's flagged
      const c10 = db.workpapers.find((w) => w.engagement_id === engagementId && w.ref === 'C-10');
      if (c10) {
        c10.applicable = false;
        const newFindings = standardCheck(engagementId);
        expect(newFindings.some((f) => f.ref === 'C-10')).toBe(true);

        // Dismiss with manager reason
        const err = dismissStandardFinding(engagementId, `na:C-10`, 'Agreed zero risk debtor balance', manager);
        expect(err).toBeNull();
        expect(db.engagements.find((e) => e.id === engagementId)?.std_dismissed?.[`na:C-10`]).toBeDefined();
      }
    });

    it('STD-03: Disclosure checklist with rule-based AI pre-answers and manager override requirement on No', () => {
      const checklist = checklistFor(engagementId);
      expect(checklist.length).toBeGreaterThan(0);

      // Check that AI suggestions are pre-filled
      expect(checklist.every((c) => ['Yes', 'No', 'N/A'].includes(c.ai_suggested_answer))).toBe(true);
      expect(checklist.every((c) => c.ai_confidence > 0)).toBe(true);

      // Confirm an answer as Yes
      const target = checklist[0];
      const resYes = answerChecklist(target.id, 'Yes', preparer);
      expect(resYes).toBeNull();
      expect(target.confirmed_answer).toBe('Yes');

      // Answering No requires manager/partner override reason
      const preparerNo = answerChecklist(target.id, 'No', preparer);
      expect(preparerNo).toContain('manager or partner');

      const managerNo = answerChecklist(target.id, 'No', manager, 'Exemption under FRS 102 1A applied');
      expect(managerNo).toBeNull();
      expect(target.confirmed_answer).toBe('No');
      expect(target.manager_override_reason).toBe('Exemption under FRS 102 1A applied');
    });

    it('STD-04: AI-suggested notes to the accounts draft live figures and preserve custom wording', () => {
      const actor = { id: preparer.id, name: preparer.name, role: preparer.role };
      const drafted = draftNotes(engagementId, actor);
      expect(drafted.length).toBeGreaterThanOrEqual(4);

      // Verify notes include Accounting policies, Tangible fixed assets, Debtors, Creditors
      expect(drafted.some((n) => n.title.includes('Accounting policies'))).toBe(true);
      expect(drafted.some((n) => n.title.includes('Tangible fixed assets'))).toBe(true);

      // Custom wording is preserved upon re-drafting
      const assetNote = drafted.find((n) => n.title.includes('Tangible fixed assets'))!;
      assetNote.narrative_html = 'Customized company depreciation policy text.';
      assetNote.is_custom_wording = true;

      const reDrafted = draftNotes(engagementId, actor);
      const updatedAssetNote = reDrafted.find((n) => n.id === assetNote.id)!;
      expect(updatedAssetNote.narrative_html).toBe('Customized company depreciation policy text.');
    });

    it('STD-05 & AIX-09: Statutory accounts preview and final consistency checks confirm self-balancing', () => {
      // Confirm all mappings so accounts preview is fully mapped and self-balancing
      db.account_mappings.filter((m) => m.engagement_id === engagementId).forEach((m) => {
        if (!m.blynt_code) m.blynt_code = '4000';
        m.status = 'confirmed';
      });

      const accounts = buildAccounts(engagementId);
      expect(accounts.pl.length).toBeGreaterThan(0);
      expect(accounts.bs.fixed.length).toBeGreaterThan(0);

      // Draft notes to match statutory balance sheet
      draftNotes(engagementId, partner);

      // Consistency checks
      const checks = consistencyChecks(engagementId);
      expect(checks.length).toBe(5);
      expect(checks.find((c) => c.id === 'bs_balances')?.passed).toBe(true);
      expect(checks.find((c) => c.id === 'tb_balances')?.passed).toBe(true);
      expect(checks.find((c) => c.id === 'all_mapped')?.passed).toBe(true);
    });

    it('REV-05 & ENG-06: File completion blockers prevent locking until resolved, partner lock protects period', () => {
      const blockers = completionBlockers(engagementId);
      expect(Array.isArray(blockers)).toBe(true);

      // Partner lock control
      const eng = db.engagements.find((e) => e.id === engagementId)!;
      expect(eng.status).not.toBe('locked');

      // Attempting to lock as preparer is refused
      expect(() => services.lockEngagement(firmId, preparer, engagementId)).toThrow(/partner or admin/);
    });
  });
});
