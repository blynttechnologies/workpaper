import { db } from './db';
import { gateFor, findRule } from './gate';
import { Attachment, AttachmentCategory, DocumentBullet, AiDocumentSummary } from '../types/models';
import { toPence } from '../money';
import type { AiSource } from './ai/types';
import { DOCUMENT_FIELDS, type ExtractOutput, type FieldKind } from './ai/tasks/documents';

const DECIMAL = /^-?\d+(\.\d+)?$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// Summary bullets show Ready or Check; an Exception reads as Check
const asBulletGate = (g: 'ready' | 'check' | 'exception'): 'ready' | 'check' => (g === 'ready' ? 'ready' : 'check');

/** A value as the model printed it, in the form the schedules hold: pence strings, ISO dates, numbers. '' or null when absent or unreadable. */
function convert(kind: FieldKind, raw: string): string | number | boolean | null {
  if (!raw) return null;
  switch (kind) {
    case 'money': {
      const clean = raw.replace(/[£,\s]/g, '');
      return DECIMAL.test(clean) ? toPence(clean).toString() : null;
    }
    case 'date':
      return ISO.test(raw) ? raw : null;
    case 'int':
      return /^-?\d+$/.test(raw.replace(/,/g, '')) ? parseInt(raw.replace(/,/g, ''), 10) : null;
    case 'number':
      return DECIMAL.test(raw.replace(/[%,\s]/g, '')) ? Number(raw.replace(/[%,\s]/g, '')) : null;
    case 'bool':
      return raw.toLowerCase() === 'true' ? true : raw.toLowerCase() === 'false' ? false : null;
    default:
      return raw;
  }
}

export interface ExtractedField<T = any> {
  value: T;
  confidence: number; // 0-100
  page?: number;
  clause?: string;
  sourceText?: string;
  gate: 'ready' | 'check' | 'exception';
  reason: string;
}

export interface BankStatementExtraction {
  bank_name: ExtractedField<string>;
  sort_code: ExtractedField<string>;
  account_number: ExtractedField<string>;
  statement_date: ExtractedField<string>;
  statement_balance_p: ExtractedField<string>;
  opening_balance_p: ExtractedField<string>;
  total_debits_p: ExtractedField<string>;
  total_credits_p: ExtractedField<string>;
  reconciling_uncleared_items: Array<{
    date: string;
    description: string;
    amount_p: string;
    type: 'cheque' | 'deposit';
    older_than_30_days: boolean;
  }>;
}

export interface LeaseAgreementExtraction {
  lessor: ExtractedField<string>;
  lessee: ExtractedField<string>;
  property_address: ExtractedField<string>;
  start_date: ExtractedField<string>;
  end_date: ExtractedField<string>;
  term_years: ExtractedField<number>;
  rent_per_annum_p: ExtractedField<string>;
  payment_frequency: ExtractedField<'monthly' | 'quarterly' | 'annual'>;
  rent_free_months: ExtractedField<number>;
  break_date?: ExtractedField<string>;
  deposit_p: ExtractedField<string>;
  service_charge_p: ExtractedField<string>;
  commitments: {
    within_1y_p: ExtractedField<string>;
    within_1_to_5y_p: ExtractedField<string>;
    over_5y_p: ExtractedField<string>;
  };
}

export interface LoanAgreementExtraction {
  lender: ExtractedField<string>;
  borrower: ExtractedField<string>;
  principal_amount_p: ExtractedField<string>;
  start_date: ExtractedField<string>;
  term_months: ExtractedField<number>;
  interest_rate_pct: ExtractedField<number>;
  monthly_repayment_p: ExtractedField<string>;
  secured: ExtractedField<boolean>;
  security_details?: ExtractedField<string>;
  maturity: {
    within_1y_p: ExtractedField<string>;
    within_1_to_5y_p: ExtractedField<string>;
    over_5y_p: ExtractedField<string>;
  };
}

export interface PayrollExtraction {
  software_layout: 'BrightPay' | 'Sage' | 'Xero Payroll' | 'Moneysoft' | 'Staffology';
  month_number: number;
  period_label: string;
  gross_pay_p: ExtractedField<string>;
  employer_nic_p: ExtractedField<string>;
  employee_nic_p: ExtractedField<string>;
  paye_tax_p: ExtractedField<string>;
  employer_pension_p: ExtractedField<string>;
  employee_pension_p: ExtractedField<string>;
  net_pay_p: ExtractedField<string>;
  hmrc_due_p: ExtractedField<string>;
  directors_remuneration_p: ExtractedField<string>;
  average_employees: ExtractedField<number>;
}

export interface VatReturnExtraction {
  vat_registration_number: ExtractedField<string>;
  period_start: ExtractedField<string>;
  period_end: ExtractedField<string>;
  box1_vat_due_sales: ExtractedField<string>;
  box2_vat_due_acquisitions: ExtractedField<string>;
  box3_total_vat_due: ExtractedField<string>;
  box4_vat_reclaimed: ExtractedField<string>;
  box5_net_vat_payable: ExtractedField<string>;
  box6_total_sales_ex_vat: ExtractedField<string>;
  box7_total_purchases_ex_vat: ExtractedField<string>;
  box8_total_supplies_ec: ExtractedField<string>;
  box9_total_acquisitions_ec: ExtractedField<string>;
}

export interface StockCountExtraction {
  count_date: ExtractedField<string>;
  total_valuation_p: ExtractedField<string>;
  categories: Array<{
    category: string;
    quantity: number;
    amount_p: string;
    unit_cost_p: string;
    confidence: number;
  }>;
}

export interface PriorYearAccountsExtraction {
  company_name: ExtractedField<string>;
  company_number: ExtractedField<string>;
  balance_sheet_date: ExtractedField<string>;
  accounting_standard: ExtractedField<string>;
  fixed_assets_nbv_p: ExtractedField<string>;
  current_assets_p: ExtractedField<string>;
  debtors_p: ExtractedField<string>;
  cash_p: ExtractedField<string>;
  creditors_due_within_1y_p: ExtractedField<string>;
  creditors_due_over_1y_p: ExtractedField<string>;
  net_assets_p: ExtractedField<string>;
  share_capital_p: ExtractedField<string>;
  retained_reserves_p: ExtractedField<string>;
  turnover_p: ExtractedField<string>;
  cost_of_sales_p: ExtractedField<string>;
  gross_profit_p: ExtractedField<string>;
  operating_profit_p: ExtractedField<string>;
  depreciation_rates: Record<string, string>;
  accounting_policies: {
    turnover: string;
    tangible_fixed_assets: string;
    depreciation: string;
    leasing: string;
  };
}

export interface InvoiceExtraction {
  supplier: ExtractedField<string>;
  invoice_number: ExtractedField<string>;
  invoice_date: ExtractedField<string>;
  net_amount_p: ExtractedField<string>;
  vat_amount_p: ExtractedField<string>;
  gross_amount_p: ExtractedField<string>;
  description: ExtractedField<string>;
  is_capital: ExtractedField<boolean>;
  suggested_class?: ExtractedField<string>;
  useful_life_years?: ExtractedField<number>;
  service_period_start?: string;
  service_period_end?: string;
}

/**
 * Shared AI Document Extraction Service (Step 8)
 * Plugs into confidence gate (DAT-08) and rules library (DAT-09).
 */
export class AiExtractionService {
  /**
   * AI Type suggestion on upload (DOC-03)
   */
  suggestDocumentType(
    firmId: string,
    filename: string,
    mimeType: string,
    contentSample?: string
  ): { category: AttachmentCategory; confidence: number; gate: 'ready' | 'check' | 'exception'; reason: string } {
    const fn = filename.toLowerCase();
    const content = (contentSample || '').toLowerCase();

    // Check learned rule first (DAT-09)
    const rule = findRule(firmId, 'tagging', [`file:${filename}`, `name:${fn}`]);
    if (rule) {
      return {
        category: rule.target_value as AttachmentCategory,
        confidence: 100,
        gate: 'ready',
        reason: `Matched learned rule: ${rule.pattern} -> ${rule.target_value}`,
      };
    }

    if (fn.includes('lease') || fn.includes('tenancy') || content.includes('tenancy agreement') || content.includes('demised premises')) {
      return { category: 'Lease agreement', confidence: 96, gate: 'ready', reason: 'Filename and keywords match commercial lease agreement' };
    }
    if (fn.includes('bank') || fn.includes('statement') || content.includes('closing balance') || content.includes('sort code')) {
      return { category: 'Statement', confidence: 95, gate: 'ready', reason: 'Detected bank statement format with period balances' };
    }
    if (fn.includes('p32') || fn.includes('payroll') || fn.includes('wages') || content.includes('gross pay') || content.includes('nic')) {
      return { category: 'Payroll report', confidence: 94, gate: 'ready', reason: 'Recognised HMRC P32 employer payment record' };
    }
    if (fn.includes('vat') || fn.includes('vat100') || content.includes('box 1') || content.includes('box 5')) {
      return { category: 'VAT return', confidence: 97, gate: 'ready', reason: 'Identified 9-box VAT return form' };
    }
    if (fn.includes('stock') || fn.includes('inventory') || fn.includes('count_sheet') || content.includes('unit cost')) {
      return { category: 'Stock count', confidence: 92, gate: 'ready', reason: 'Stock count sheet listing items and valuations' };
    }
    if (fn.includes('accounts') || fn.includes('statutory') || fn.includes('annual_report') || content.includes('balance sheet')) {
      return { category: 'Prior-year accounts', confidence: 95, gate: 'ready', reason: 'Prior year financial statements and notes' };
    }
    if (fn.includes('loan') || fn.includes('borrowing') || fn.includes('facility') || fn.includes('hire_purchase') || fn.includes('hp_')) {
      return { category: 'Loan agreement', confidence: 93, gate: 'ready', reason: 'Loan facility or hire purchase agreement' };
    }
    if (fn.includes('invoice') || fn.includes('bill') || fn.includes('receipt') || content.includes('invoice no')) {
      return { category: 'Invoice', confidence: 91, gate: 'ready', reason: 'Supplier purchase invoice' };
    }
    if (fn.includes('minute') || fn.includes('board') || content.includes('board meeting')) {
      return { category: 'Board minute', confidence: 88, gate: 'check', reason: 'Board minutes document' };
    }

    // Default / low confidence fallback
    return {
      category: 'Other',
      confidence: 55,
      gate: 'exception',
      reason: 'Low confidence: document type unclear from filename and content sample. Tagged Unsorted.',
    };
  }

  /**
   * The extraction shape for a document type, from what a model read (or from nothing). A value that was
   * not read stays blank with gate Check: this service never supplies a figure of its own.
   */
  buildExtraction(
    firmId: string,
    category: string,
    read: ExtractOutput | null,
    source?: AiSource,
    note?: string
  ): { category: AttachmentCategory; summary: AiDocumentSummary; data: Record<string, any> } {
    const specs = DOCUMENT_FIELDS[category] ?? [];
    const data: Record<string, any> = {};
    for (const spec of specs) {
      const cell = read?.fields?.[spec.key];
      const raw = (cell?.value ?? '').trim();
      const value = convert(spec.kind, raw);
      const found = value !== '' && value !== null;
      const confidence = found && read ? read.confidence : 0;
      const field: ExtractedField = {
        value: found ? value : spec.kind === 'money' || spec.kind === 'text' || spec.kind === 'date' ? '' : null,
        confidence,
        page: cell?.page || undefined,
        clause: cell?.clause || undefined,
        gate: found ? gateFor(firmId, 'extraction', confidence) : 'check',
        reason: found ? `${spec.label}: read from the document${cell?.clause ? ` (${cell.clause})` : ''}` : `${spec.label}: not read, enter it from the document`,
      };
      // Nested shapes such as commitments.within_1y_p
      const path = spec.key.split('.');
      let at = data;
      for (const p of path.slice(0, -1)) at = at[p] ??= {};
      at[path[path.length - 1]] = field;
    }
    // Plain values the schedules read directly
    if (category === 'Payroll report') {
      data.month_number = typeof data.month_number?.value === 'number' ? data.month_number.value : undefined;
      data.period_label = data.period_label?.value || undefined;
    }
    if (category === 'Stock count') {
      data.categories = (read?.rows ?? [])
        .filter((r) => r.description && DECIMAL.test(r.amount.replace(/[£,\s]/g, '')))
        .map((r) => ({
          category: r.description,
          quantity: Number(r.quantity.replace(/,/g, '')) || 0,
          amount_p: toPence(r.amount).toString(),
          unit_cost_p: DECIMAL.test(r.unit_cost.replace(/[£,\s]/g, '')) ? toPence(r.unit_cost).toString() : '',
          confidence: read?.confidence ?? 0,
        }));
    }
    if (source) data._source = source;

    const bullets: DocumentBullet[] = read
      ? read.summary.map((b) => ({ text: b.text, page: b.page, clause: b.clause, confidence: read.confidence, gate: asBulletGate(gateFor(firmId, 'extraction', read.confidence)) }))
      : [{ text: note ?? 'Not read yet. Enter the figures from the document, or read it with AI once AI is set up.', page: 1, clause: '', confidence: 0, gate: 'check' }];
    return { category: category as AttachmentCategory, summary: { bullets }, data };
  }

  /**
   * Without AI: bank statements give the closing balance printed in the text that came with the upload;
   * every other document type comes back blank for a person to fill in.
   */
  extract(
    firmId: string,
    attachment: Attachment,
    overrideCategory?: AttachmentCategory
  ): {
    category: AttachmentCategory;
    summary: AiDocumentSummary;
    data: Record<string, any>;
  } {
    const category = overrideCategory || attachment.category;
    if (category === 'Statement' || (category as string) === 'Bank statement') {
      // The closing balance comes only from the statement's own text (PDFs and scans are read by the AI);
      // with no text it stays blank, never a made-up figure.
      const text = attachment.text_sample ?? '';
      const closing = /closing balance\D{0,5}([\d,]+\.\d{2})/i.exec(text) ?? /balance\D{0,5}([\d,]+\.\d{2})/i.exec(text);
      const balanceP = closing ? toPence(closing[1]).toString() : '';
      const blank = (reason: string): ExtractedField<string> => ({ value: '', confidence: 0, gate: 'check', reason });
      const data: BankStatementExtraction = {
        bank_name: blank('Not read'),
        sort_code: blank('Not read'),
        account_number: blank('Not read'),
        statement_date: blank('Not read'),
        statement_balance_p: balanceP
          ? { value: balanceP, confidence: 96, page: 1, gate: gateFor(firmId, 'extraction', 96), reason: 'Closing balance printed in the statement text' }
          : blank('Closing balance not read: enter it from the statement'),
        opening_balance_p: blank('Not read'),
        total_debits_p: blank('Not read'),
        total_credits_p: blank('Not read'),
        reconciling_uncleared_items: [],
      };
      const bullets: DocumentBullet[] = [
        balanceP
          ? { text: `Closing Balance: £${(Number(balanceP) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, page: 1, clause: 'Summary', confidence: 96, gate: 'ready' }
          : { text: 'Closing Balance: not read, enter it from the statement', page: 1, clause: 'Summary', confidence: 0, gate: 'check' },
      ];
      return { category, summary: { bullets }, data };
    }
    return this.buildExtraction(firmId, category, null);
  }

  /**
   * Auto-fill schedule from extracted document (DOC-05 / Step 8)
   * Values carry AI badges until confirmed by a user.
   */
  fillScheduleFromDocument(
    firmId: string,
    actor: { id: string; name: string; role: any },
    attachmentId: string,
    targetWorkpaperId: string,
    /** Bank and cash: the account row the statement belongs to. */
    accountId?: string
  ): { workpaper: any; filledFields: string[] } {
    const attachment = db.attachments.find((a) => a.id === attachmentId);
    if (!attachment) throw new Error('Attachment not found');

    const wp = db.workpapers.find((w) => w.id === targetWorkpaperId);
    if (!wp) throw new Error('Target workpaper not found');

    // Run extraction if not already extracted
    let extracted = attachment.extracted_data;
    if (!extracted) {
      const res = this.extract(firmId, attachment);
      extracted = res.data;
      attachment.extracted_data = extracted;
      attachment.ai_summary = res.summary;
    }

    const filledFields: string[] = [];
    const wpData = { ...wp.data_json };
    const gateItems: any[] = wpData.confidence_gate_items || [];

    // Helper to add AI badge item
    const addGateItem = (field: string, label: string, value: any, confidence: number, page?: number, clause?: string, reason?: string) => {
      gateItems.push({
        id: `gate_${attachment.id}_${field}`,
        field,
        label,
        value,
        source_attachment_id: attachment.id,
        filename: attachment.filename,
        page: page || 1,
        clause: clause || '',
        confidence,
        gate: gateFor(firmId, 'extraction', confidence),
        reason: reason || 'Extracted by AI from document',
        confirmed: false,
        // Which model read it, written to AI lineage when a person confirms the value
        ...(extracted._source ? { ai: extracted._source } : {}),
      });
      filledFields.push(label);
    };

    // Fill according to schedule ref / kind
    if (wp.ref === 'B-10' || wp.ref.startsWith('B-')) {
      // Bank Reconciliation
      const stmtBal = extracted.statement_balance_p?.value;
      const account = Array.isArray(wpData.accounts) ? wpData.accounts.find((a: any) => a.id === accountId) : undefined;
      if (account) {
        // Every balance read is kept on the row so a wrong one can be swapped for the date before or after
        const read = stmtBal ? [{ date: extracted.statement_date?.value ?? '', balance_p: String(stmtBal), label: 'Balance at the year end', page: extracted.statement_balance_p.page }] : [];
        const balances = [...read, ...((extracted.candidates ?? []) as { date: string; balance_p: string; label: string; page?: number }[])];
        if (balances.length) wpData.accounts = wpData.accounts.map((a: any) => (a.id === account.id ? { ...a, ai_balances: balances } : a));
        // Only fill a blank balance: a figure someone entered is never overwritten by the AI,
        // and a balance the AI could not read stays blank rather than guessing
        if (stmtBal && !account.statement_p) {
          wpData.accounts = wpData.accounts.map((a: any) =>
            a.id === account.id ? { ...a, statement_p: String(stmtBal), statement_date: extracted.statement_date?.value || undefined, source: 'upload' } : a
          );
          addGateItem(
            `accounts.${account.id}.statement_p`,
            `${account.code === '*' ? account.name : `${account.code} ${account.name}`} closing balance`,
            stmtBal,
            extracted.statement_balance_p.confidence || 95,
            extracted.statement_balance_p.page,
            extracted.statement_balance_p.clause,
            extracted.statement_balance_p.reason
          );
        }
      } else if (stmtBal) {
        wpData.statement_p = String(stmtBal);
        wpData.statement_source = 'Upload';
        wpData.statement_date = extracted.statement_date?.value || undefined;
        wpData.source_attachment_id = attachment.id;
        wpData.source_page = extracted.statement_balance_p.page || 1;
        addGateItem(
          'statement_p',
          'Statement closing balance',
          stmtBal,
          extracted.statement_balance_p.confidence || 95,
          extracted.statement_balance_p.page,
          extracted.statement_balance_p.clause,
          extracted.statement_balance_p.reason
        );
      }
    } else if (wp.ref === 'L-10' || wp.ref.startsWith('L-10')) {
      // Lease Schedule (REC-04): only what was read; right-of-use and liability figures are worked on the paper
      if (extracted.lessor?.value || extracted.rent_per_annum_p?.value) {
        const leaseRow = {
          id: `lease_${attachment.id}`,
          lessor: extracted.lessor?.value || '',
          property: extracted.property_address?.value || '',
          start_date: extracted.start_date?.value || '',
          end_date: extracted.end_date?.value || '',
          term_years: extracted.term_years?.value ?? null,
          rent_pa_p: extracted.rent_per_annum_p?.value || '',
          break_date: extracted.break_date?.value || null,
          comm_1y_p: extracted.commitments?.within_1y_p?.value || '',
          comm_1to5y_p: extracted.commitments?.within_1_to_5y_p?.value || '',
          comm_over5y_p: extracted.commitments?.over_5y_p?.value || '',
          source_attachment_id: attachment.id,
        };
        wpData.leases = [...(wpData.leases || []), leaseRow];
        const conf = extracted.rent_per_annum_p?.confidence || extracted.lessor?.confidence || 0;
        addGateItem('lease_terms', `Lease terms for ${leaseRow.lessor || attachment.filename}`, leaseRow, conf, extracted.rent_per_annum_p?.page, extracted.rent_per_annum_p?.clause);
      }
    } else if (wp.ref === 'F-10' || wp.ref.startsWith('F-')) {
      // Fixed Assets Register (REC-03)
      if (extracted.is_capital?.value && extracted.net_amount_p?.value) {
        const addition = {
          id: `add_${attachment.id}`,
          class_id: extracted.suggested_class?.value === 'Fixtures & fittings' ? 'c2' : 'c1',
          item: extracted.description?.value || attachment.filename,
          cost_p: extracted.net_amount_p.value,
          type: 'addition',
          date: extracted.invoice_date?.value || '',
          supplier: extracted.supplier?.value || '',
          invoice_attachment_id: attachment.id,
          source: 'document_extraction',
        };
        wpData.movements = [...(wpData.movements || []), addition];
        addGateItem('addition', `Addition: ${addition.item}`, addition.cost_p, extracted.net_amount_p.confidence ?? 0, extracted.net_amount_p.page, extracted.net_amount_p.clause);
      }
    } else if (wp.ref === 'L-20' || wp.ref.startsWith('L-20')) {
      // Loans (REC-10)
      if (extracted.principal_amount_p?.value) {
        wpData.lender = extracted.lender?.value || '';
        wpData.principal_p = extracted.principal_amount_p.value;
        wpData.interest_rate_pct = extracted.interest_rate_pct?.value ?? null;
        wpData.secured = extracted.secured?.value ?? null;
        wpData.maturity = {
          within_1y_p: extracted.maturity?.within_1y_p?.value || '',
          within_1_to_5y_p: extracted.maturity?.within_1_to_5y_p?.value || '',
          over_5y_p: extracted.maturity?.over_5y_p?.value || '',
        };
        addGateItem('loan_terms', `Loan facility with ${wpData.lender || attachment.filename}`, wpData.principal_p, extracted.principal_amount_p.confidence ?? 0, extracted.principal_amount_p.page, extracted.principal_amount_p.clause);
      }
    } else if (wp.ref === 'P-20' || wp.ref.startsWith('P-20')) {
      // Payroll (REC-05)
      // Only when the report says which month it is: figures are never put on a guessed month
      if (extracted.gross_pay_p?.value && extracted.month_number) {
        const monthNum = extracted.month_number;
        const months = wpData.months || [];
        const targetMonth = months.find((m: any) => m.month === monthNum) || months[monthNum - 1];
        if (targetMonth) {
          targetMonth.gross_pay_p = extracted.gross_pay_p.value;
          targetMonth.employer_nic_p = extracted.employer_nic_p?.value || '';
          targetMonth.employee_nic_p = extracted.employee_nic_p?.value || '';
          targetMonth.paye_tax_p = extracted.paye_tax_p?.value || '';
          targetMonth.employer_pension_p = extracted.employer_pension_p?.value || '';
          targetMonth.employee_pension_p = extracted.employee_pension_p?.value || '';
          targetMonth.source_attachment_id = attachment.id;
          addGateItem(`payroll_m${monthNum}`, `Month ${monthNum} payroll figures`, targetMonth.gross_pay_p, extracted.gross_pay_p.confidence ?? 0, extracted.gross_pay_p.page, extracted.gross_pay_p.clause);
        }
      }
    } else if (wp.ref === 'T-20' || wp.ref.startsWith('T-20')) {
      // VAT (REC-06)
      if (extracted.box5_net_vat_payable?.value) {
        const returns = wpData.returns || [];
        if (returns.length > 0) {
          returns[returns.length - 1].box1_vat_due = extracted.box1_vat_due_sales?.value || '';
          returns[returns.length - 1].box4_vat_reclaimed = extracted.box4_vat_reclaimed?.value || '';
          returns[returns.length - 1].box5_net_vat = extracted.box5_net_vat_payable.value;
          returns[returns.length - 1].source_attachment_id = attachment.id;
          addGateItem('vat_return', 'VAT Return Box 1-5', extracted.box5_net_vat_payable.value, extracted.box5_net_vat_payable.confidence ?? 0, extracted.box5_net_vat_payable.page, 'Box 5');
        }
      }
    } else if (wp.ref === 'D-10' || wp.ref.startsWith('D-10')) {
      // Stock (REC-14)
      if (extracted.total_valuation_p?.value) {
        wpData.lines = (extracted.categories || []).map((c: any, i: number) => ({
          id: `stock_${i + 1}`,
          desc: c.category,
          qty: String(c.quantity),
          amount_p: c.amount_p,
          source_attachment_id: attachment.id,
        }));
        addGateItem('stock_total', 'Stock count valuation', extracted.total_valuation_p.value, extracted.total_valuation_p.confidence ?? 0, extracted.total_valuation_p.page, extracted.total_valuation_p.clause);
      }
    }

    wpData.confidence_gate_items = gateItems;
    wpData.values_to_confirm_count = gateItems.filter((i) => !i.confirmed).length;
    wp.data_json = wpData;
    wp.updated_at = new Date().toISOString();

    // Link document to workpaper
    if (!attachment.workpaper_id) {
      attachment.workpaper_id = wp.id;
    }
    attachment.linked_schedule_ref = wp.ref;

    // Log in audit trail
    db.logAudit(
      firmId,
      actor,
      'FILL_SCHEDULE_FROM_DOC',
      'workpapers',
      wp.id,
      null,
      { filledFields, attachmentId: attachment.id }
    );

    return { workpaper: wp, filledFields };
  }
}

export const aiExtractionService = new AiExtractionService();
