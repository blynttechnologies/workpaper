/**
 * Blynt Workpapers Data Models
 * Exactly matches the database schema & ground rules.
 */

import type { TemplateDef } from '../workpapers/templates';

export type UserRole = 'readonly' | 'preparer' | 'reviewer' | 'manager' | 'partner' | 'admin';

export type StatusKey =
  | 'not_started'
  | 'in_progress'
  | 'unreconciled'
  | 'reconciled'
  | 'prepared'
  | 'signed_off'
  | 'needs_you'
  | 'stale'
  | 'waiting_on_client'
  | 'ai_suggestion';

export interface StatusMeta {
  key: StatusKey;
  symbol: string;
  label: string;
  colorClass: string;
  bgClass: string;
}

export const STATUS_DEFINITIONS: Record<StatusKey, StatusMeta> = {
  not_started: {
    key: 'not_started',
    symbol: '○',
    label: 'Not started',
    colorClass: 'text-[#4A5878]',
    bgClass: 'bg-[#F5F8FD]',
  },
  in_progress: {
    key: 'in_progress',
    symbol: '◑',
    label: 'In progress',
    colorClass: 'text-[#1D4E89]',
    bgClass: 'bg-[#EAF5FC]',
  },
  unreconciled: {
    key: 'unreconciled',
    symbol: '≠',
    label: 'Unreconciled',
    colorClass: 'text-[#B8432F]',
    bgClass: 'bg-[#FFF1EE]',
  },
  reconciled: {
    key: 'reconciled',
    symbol: '=',
    label: 'Reconciled',
    colorClass: 'text-[#0B6B52]',
    bgClass: 'bg-[#E6F4EF]',
  },
  prepared: {
    key: 'prepared',
    symbol: '●',
    label: 'Prepared',
    colorClass: 'text-[#122654]',
    bgClass: 'bg-[#EAF5FC]',
  },
  signed_off: {
    key: 'signed_off',
    symbol: '✓',
    label: 'Signed off',
    colorClass: 'text-[#0B6B52]',
    bgClass: 'bg-[#E6F4EF]',
  },
  needs_you: {
    key: 'needs_you',
    symbol: '!',
    label: 'Needs you',
    colorClass: 'text-[#B8432F]',
    bgClass: 'bg-[#FFF1EE]',
  },
  stale: {
    key: 'stale',
    symbol: '⚠',
    label: 'Stale',
    colorClass: 'text-[#6B4700]',
    bgClass: 'bg-[#FFF4DB]',
  },
  waiting_on_client: {
    key: 'waiting_on_client',
    symbol: '◷',
    label: 'Waiting on client',
    colorClass: 'text-[#4A5878]',
    bgClass: 'bg-[#F5F8FD]',
  },
  ai_suggestion: {
    key: 'ai_suggestion',
    symbol: '✦',
    label: 'AI suggestion',
    colorClass: 'text-[#A23A27]',
    bgClass: 'bg-[#FFF1EE]',
  },
};

export type CompanyType =
  | 'Sole trader'
  | 'Partnership'
  | 'LLP (FRS 102 + LLP SORP)'
  | 'Micro-entity (FRS 105)'
  | 'Small company (FRS 102 1A)'
  | 'Medium/large (FRS 102)'
  | 'IFRS company/group'
  | 'Charity (SORP)'
  | 'Academy trust';

export type DataSource = 'blynt' | 'xero' | 'quickbooks' | 'csv' | 'freeagent' | 'sage';

export interface Firm {
  id: string;
  name: string;
  created_at: string;
  owner_user_id?: string; // the person who created the firm; may run set-up and invite
  // Practice onboarding wizard; absent on firms created before it existed (treated as done)
  onboarding?: { step: number; completed_at: string | null };
  profile?: PracticeProfile;
  // ADM-02 practice settings; DAT-08 gate thresholds per AI output type
  settings?: {
    gate?: Partial<Record<AiActionLogItem['output_type'], { ready?: number; check?: number; auto_accept?: boolean }>>;
    defaults?: PracticeDefaults;
    // QTR-02: shown on every client-facing output produced from now on
    branding?: { logo_file_key?: string; colour?: string; footer?: string; disclaimer?: string };
    ai?: AiSettings;
    /** The practice's own dated tax entries (a new rate or threshold); they win over the built-in library for their dates */
    tax_entries?: import('../tax').TaxEntry[];
    /** Weekly GOV.UK check of the pages the tax library cites (lib/server/tax-watch) */
    tax_watch?: import('../server/tax-watch').TaxWatch;
  };
}

/** AI Control Centre settings for one practice. No secrets: API keys live only in the server's environment. */
export interface AiSettings {
  /** A provider is on when its key is set on the server, unless switched off here. */
  providers?: Partial<Record<'anthropic' | 'openai' | 'gemini', { enabled?: boolean; model?: string }>>;
  /** Per task: which provider goes first, single / review (two read independently) / collaborate (one drafts, one checks), and whether to fall back. */
  routes?: Record<string, { provider?: 'anthropic' | 'openai' | 'gemini'; mode?: 'single' | 'review' | 'collaborate'; fallback?: boolean }>;
  monthly_limit_usd?: number | null;
  /** Outside assistants (ChatGPT, Microsoft Copilot): off until an admin turns them on. */
  mcp?: { enabled?: boolean; disabled_tools?: string[] };
}

export type Regulator = 'ICAEW' | 'ACCA' | 'ICAS' | 'CAI' | 'AAT' | 'CIMA' | 'ATT' | 'CIOT';

export interface PracticeProfile {
  legal_name: string;
  trading_name?: string;
  structure: 'llp' | 'ltd' | 'partnership' | 'sole';
  company_number?: string;
  address_line: string;
  postcode: string;
  jurisdiction: 'england_wales' | 'scotland' | 'northern_ireland';
  regulator: Regulator;
  registration_number?: string;
  vat_registered?: boolean;
  vat_number?: string;
  phone?: string;
  logo_attachment_id?: string;
}

// ADM-02 practice settings skeleton (Build Order step 2)
export interface PracticeDefaults {
  tolerance_p: string; // pence; differences below this count as reconciled
  review_threshold_p: string; // pence; movements above this are flagged
  signoff_levels: 1 | 2 | 3; // preparer / + reviewer / + partner
  /** Sole practitioners: a partner or admin may approve a journal they proposed, giving a reason that is audited */
  self_approve_journals?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  initials: string;
  title: string;
  mfa_enabled: boolean;
  avatar?: string;
}

export interface Membership {
  user_id: string;
  firm_id: string;
  role: UserRole;
  client_ids?: string[]; // ADM-01: clients a non-partner may see; absent = all
  status?: 'active' | 'deactivated'; // deactivated members can't sign in; absent = active
}

// ADM-01: invitation to join a practice. Server-only (the token hash never reaches the browser).
export interface Invite {
  id: string;
  firm_id: string;
  email: string;
  name: string;
  role: UserRole;
  client_ids?: string[];
  /** Clients whose team the person joins when they accept */
  team_client_ids?: string[];
  token_hash: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at?: string | null;
}

export interface Client {
  id: string;
  firm_id?: string;
  name: string;
  company_no?: string;
  company_type?: CompanyType;
  year_end?: string;
  yearEnd?: string;
  data_source?: DataSource;
  reconnect_needed?: boolean;
  // Client profile (Build Order step 2): decides which working papers each engagement gets
  trading_name?: string;
  address_line?: string;
  postcode?: string;
  jurisdiction?: 'england_wales' | 'scotland' | 'northern_ireland';
  vat_number?: string;
  vat_registered?: boolean;
  vat_scheme?: 'standard' | 'flat_rate' | 'cash' | 'annual';
  vat_flat_rate_category?: string; // a key from the tax library's flat rate percentages
  vat_registered_on?: string; // the effective date of registration: the flat rate first-year discount runs a year from it
  payroll?: boolean;
  services?: ('year_end' | 'management' | 'vat' | 'payroll' | 'quarterly' | 'corporation_tax')[];
  signoff_levels?: 1 | 2 | 3; // overrides the practice default
  team_user_ids?: string[];
  industry?: string;
  framework?: string;
  currentEngagementId?: string;
  // Archived clients drop out of everyday lists and their files become read-only; nothing is deleted
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  [key: string]: any;
}

export interface Engagement {
  id: string;
  client_id: string;
  firm_id: string;
  period_start: string;
  period_end: string;
  framework: string;
  template_pack_id: string;
  status: 'planning' | 'fieldwork' | 'review' | 'locked';
  frequency?: 'year_end' | 'quarterly' | 'monthly'; // absent = year-end
  locked_at: string | null;
  locked_by?: string | null;
  prior_engagement_id: string | null;
  // Stages D and E: these belong to the period, so they are kept on it
  commentary?: Record<string, Commentary>; // ANL-03, keyed by accounts line
  std_dismissed?: Record<string, string>; // STD-02: finding id -> why it is not relevant
  budgets?: Budget[]; // MGT-03
  forecast?: ForecastAssumptions; // MGT-05
  quarterly?: QuarterlyPack; // QTR-01
  /** Sales invoices, credit notes and money on account still open at the period end, read from the ledger; C-10 ages from these */
  debtor_open_items?: DebtorOpenItems;
  /** The same for bills, supplier credit notes and money paid on account; K-10 reads these */
  creditor_open_items?: DebtorOpenItems;
}

export interface DebtorOpenItem {
  contact: string;
  kind: 'invoice' | 'credit note' | 'prepayment' | 'overpayment';
  ref: string;
  date: string;
  due: string; // the invoice's due date; a credit's own date
  amount_p: string; // open at the period end: an invoice positive, a credit negative
  received_after_p: string; // paid against it after the period end, up to the pull
  received_after_on?: string; // the last of those payments
  url?: string;
  total_p?: string; // the invoice's full amount
  payments?: DebtorPayment[]; // everything set against it, before and after the period end
}
export interface DebtorPayment { date: string; amount_p: string; how: 'payment' | 'credit note' | 'prepayment' | 'overpayment' }

export interface DebtorOpenItems {
  as_at: string; // the period end the items were open at
  fetched_at: string;
  source: 'Xero';
  items: DebtorOpenItem[];
}

export interface Commentary {
  text: string;
  visibility: 'internal' | 'client';
  ai_text?: string; // the drafted wording, kept when a person edits it
  history: { text: string; by: string; at: string }[];
}

export interface Budget {
  id: string;
  name: string;
  active: boolean;
  /** Twelve monthly amounts in pence per P&L line, signed as the accounts show them */
  lines: Record<string, string[]>;
}

export interface ForecastAssumptions {
  debtor_days: number;
  creditor_days: number;
  minimum_cash_p: string;
  capex_p: string; // per month
  dividends_p: string; // per month
}

export interface QuarterlyPack {
  comment: string;
  removed: string[]; // insights the accountant deleted
  status: 'draft' | 'ready' | 'approved';
  approved_by?: string;
  approved_at?: string;
}

export interface BlyntAccount {
  code: string;
  name: string;
  type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Cost of Sales' | 'Overhead' | 'System';
  normal_balance: 'Debit' | 'Credit' | 'Mixed';
  lead_letter: string; // e.g. "A", "B", "C", "D", "E", "F", "K", "Q", "Z"
  is_control: boolean;
  is_system: boolean;
  statutory_line?: string;
  schedule_ref?: string;
  cash_flow_category?: 'Operating activities' | 'Investing activities' | 'Financing activities' | 'Cash and cash equivalents';
  /** Profit and loss accounts only: the default corporation tax treatment the AI starts from */
  tax_treatment?: 'Taxable' | 'Allowable' | 'Add back' | 'Review' | 'Timing' | 'Separate' | 'Exempt' | 'Tax';
  used_by_count?: number;
  /** Set on accounts a practice added; the standard chart has none */
  firm_id?: string;
  /** The standard account a practice account is classified like */
  parent_code?: string;
  /** Set when a practice account was added for one client; only that client sees it */
  client_id?: string;
  /** Set on owner accounts that only one type of business uses */
  structure?: 'sole' | 'partnership' | 'llp';
}

export interface MappingList {
  id: string;
  firm_id: string;
  company_type: CompanyType;
  version: number;
  status: 'draft' | 'published';
  rule_count?: number;
  clients_using?: number;
}

export interface MappingRule {
  id: string;
  mapping_list_id: string;
  source_system: DataSource;
  source_code: string;
  source_name_pattern: string;
  blynt_code: string;
  scope: 'client' | 'firm';
}

export interface TbSnapshot {
  id: string;
  engagement_id: string;
  source: DataSource;
  as_at: string;
  raw_json: string;
  sha256: string;
  created_by: string;
  created_at: string;
  prior_snapshot_id?: string | null;
  changes?: TbSnapshotDiff[]; // DAT-06: movements since the previous snapshot (late postings)
}

export interface TbLine {
  id: string;
  snapshot_id: string;
  source_code: string;
  source_name: string;
  source_type: string;
  debit_p: string; // stored as string for exact bigint serialization
  credit_p: string;
  comparative_p?: string; // net balance a year earlier, debit positive, when the ledger gave one
}

export interface AccountMapping {
  id: string;
  engagement_id: string;
  source_code: string;
  source_name: string;
  source_type: string;
  balance_p: string; // Net balance in pence (string for bigint)
  blynt_code: string | null;
  status: 'suggested' | 'confirmed' | 'needs_you';
  confidence: number; // 0 - 100
  method: 'rule' | 'ai' | 'manual';
  statutory_line?: string;
  schedule_ref?: string;
  cash_flow_category?: string;
  ai_reason?: string;
  evidence_used?: string;
  sign_mismatch?: boolean;
  gate?: 'ready' | 'check' | 'exception';
  ai_alternatives?: { blynt_code: string; name: string; reason: string; confidence: number }[];
  /** The AI found no chart account that fits and proposes creating this one */
  ai_new_account?: { name: string; parent_code: string } | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  comment_count?: number;
}

export interface AdjustmentLine {
  id: string;
  adjustment_id: string;
  blynt_code: string;
  debit_p: string; // string for bigint
  credit_p: string;
  narrative?: string;
}

// Journals in the adjusted TB (a reversed journal still counts; its reversal cancels it). A journal
// 'in_ledger' is posted in the client's ledger and already inside the imported trial balance, so it no longer adds to it.
export const JOURNAL_IN_TB: Adjustment['status'][] = ['accepted', 'approved', 'posted', 'reversed'];

export interface Adjustment {
  id: string;
  engagement_id: string;
  ref: string; // e.g. AJE-001
  narrative: string;
  // proposed = Draft (JNL-02); accepted = in the adjusted TB; reversed = cancelled by a reversing journal
  status: 'proposed' | 'accepted' | 'approved' | 'posted' | 'reversed' | 'rejected' | 'in_ledger';
  /** The journal as sent to the client's ledger: its id there and the status the ledger last reported */
  ledger?: { provider: 'xero'; id: string; status: string; url?: string; sent_at: string; sent_by: string; in_tb_at?: string };
  type?: 'adjusting' | 'reclassification' | 'client_posted' | 'proposed_by_ai';
  date?: string;
  source_schedule?: string;
  calculation?: string;
  evidence?: { file_key: string; filename: string }[];
  auto_reverse?: boolean;
  reverses_id?: string;
  reversed_by_id?: string;
  reject_reason?: string;
  /** Why the person who proposed it also approved it (only where the practice allows it) */
  self_approval_reason?: string;
  proposed_by: string;
  proposed_by_name: string;
  approved_by: string | null;
  approved_by_name?: string | null;
  created_at: string;
  lines: AdjustmentLine[];
}

export interface Template {
  id: string;
  key: string;
  name: string;
  area_letter: string;
  company_types: CompanyType[];
  version: number;
  schema_json: Record<string, any>;
  status: 'published' | 'draft';
  used_by_count?: number;
  is_builtin?: boolean;
}

export interface Workpaper {
  id: string;
  engagement_id: string;
  ref: string; // e.g. "F-10", "B-10"
  template_id: string;
  template_version: number;
  data_json: Record<string, any>;
  status: StatusKey;
  rolled_from_workpaper_id: string | null;
  custom_template?: TemplateDef | null; // set on a paper the practice defined for this engagement
  // WPS-03: unticked papers move to the N/A list with the reason; absent = applicable
  applicable?: boolean;
  na_reason?: string | null;
  // REV-04: who the schedule is assigned to, and when it is due
  assignee_id?: string | null;
  due_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Procedure {
  id: string;
  workpaper_id: string;
  text: string;
  done_by: string | null;
  done_at: string | null;
  not_applicable_reason: string | null;
}

export type AnchorJson =
  | { kind: 'cell'; section: string; row: string; col: string }
  | { kind: 'text'; section: string; start: number; end: number }
  | { kind: 'row'; table: string; row: string }
  | { kind: 'file'; attachment_id: string }
  /** Pinned anywhere on the paper: a table row (by its first cells' text) and the spot within it, or a place on the paper */
  | { kind: 'pin'; row?: string; x: number; y: number; top?: number; view?: string[]; label: string }
  | { kind: 'paper' };

export interface Comment {
  id: string;
  workpaper_id: string;
  type: 'comment' | 'review_note' | 'client_query';
  anchor_json: AnchorJson;
  anchor_summary?: string;
  status: 'open' | 'resolved';
  created_by: string;
  created_by_name: string;
  created_at: string;
  resolved_by: string | null;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  body: string;
  mentions?: string[]; // users tagged with @name (REV-03)
  replies?: CommentReply[];
  /** How long it stays: this year only (the default), carried into next year once, or every year */
  keep?: CommentKeep;
  /** Period end of the year it was carried from, when it came from last year's paper */
  carried_from?: string;
  edited_at?: string;
}

export type CommentKeep = 'this_year' | 'next_year' | 'every_year';

export interface CommentReply {
  id: string;
  comment_id: string;
  body: string;
  edited_at?: string;
  mentions: string[];
  created_by: string;
  created_by_name: string;
  created_at: string;
}

export type AttachmentCategory =
  | 'Invoice'
  | 'Register'
  | 'Statement'
  | 'Photo'
  | 'Board minute'
  | 'Valuation'
  | 'Confirmation'
  | 'From client'
  | 'Lease agreement'
  | 'Payroll report'
  | 'VAT return'
  | 'Stock count'
  | 'Prior-year accounts'
  | 'Loan agreement'
  | 'Supplier statement'
  | 'Other';

export interface DocumentBullet {
  text: string;
  clause?: string;
  page?: number;
  confidence?: number;
  gate?: 'ready' | 'check';
}

export interface AiDocumentSummary {
  bullets: DocumentBullet[];
  is_edited?: boolean;
  original_summary?: DocumentBullet[];
  edited_by?: string;
  edited_at?: string;
}

export interface AttachmentVersion {
  version: number;
  file_key: string;
  filename: string;
  uploaded_at: string;
  uploaded_by: string;
  size: number;
}

export interface Attachment {
  id: string;
  engagement_id: string;
  workpaper_id: string | null;
  file_key: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  category: AttachmentCategory;
  is_permanent: boolean;
  folder?: 'current' | 'permanent';
  ai_tag?: string;
  ai_tag_confidence?: number;
  ai_tag_gate?: 'ready' | 'check' | 'exception';
  expiry_date?: string;
  expires_in_days?: number;
  version?: number;
  versions?: AttachmentVersion[];
  ai_summary?: AiDocumentSummary;
  extracted_data?: Record<string, any>;
  /** First 1,000 characters of a text upload, for reading figures without AI. */
  text_sample?: string;
  linked_schedule_ref?: string;
  /** Kept on file but off the paper: not shown as evidence until restored */
  archived_at?: string | null;
  deleted_at?: string | null;
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_at: string;
  links?: AttachmentLink[];
}

export interface AttachmentLink {
  attachment_id: string;
  anchor_json: AnchorJson;
}

/** A named set of working papers a practice can add to a client year. Built-in ones live in code; these are the practice's own. */
export interface WorkflowTemplate {
  id: string;
  firm_id: string;
  name: string;
  refs: string[];
  created_by: string;
  created_at: string;
}

/** A workflow added to one engagement. Its papers are the engagement's papers whose reference is in `refs`. */
export interface EngagementWorkflow {
  id: string;
  engagement_id: string;
  name: string;
  refs: string[];
  created_at: string;
  /** Set when a manager archived it: hidden from the cards and menu, and restorable */
  archived_at?: string | null;
}

export interface Signoff {
  id: string;
  workpaper_id: string;
  role: 'preparer' | 'reviewer' | 'partner';
  user_id: string;
  user_name: string;
  signed_at: string;
  content_hash: string;
  stale_at: string | null;
  stale_reason?: string | null;
}

export interface ViewPrefs {
  user_id: string;
  scope: 'user' | 'firm';
  key: string;
  value_json: {
    showPriorYear?: boolean;
    showChangePercent?: boolean;
    showSource?: boolean;
    showTickmarks?: boolean;
    rowSpacing?: 'comfortable' | 'compact';
    textSize?: 'S' | 'M' | 'L';
    highContrast?: boolean;
    inactivityTimeoutMinutes?: number;
    selectedClientId?: string;
    onboardingCompleted?: boolean;
    primaryCompanyType?: string;
    jurisdiction?: string;
    [key: string]: any;
  };
}

export interface AuditLog {
  id: string;
  firm_id: string;
  actor_id: string;
  actor_name: string;
  actor_role: UserRole;
  action: string;
  entity: string;
  entity_id: string;
  before_json: string | null;
  after_json: string | null;
  at: string;
  reason?: string | null; // AUD-01: why, where the action asks for one (unreview, unlock, corrections)
}

export interface AiLineage {
  id: string;
  entity: string;
  entity_id: string;
  field: string;
  source_attachment_id: string | null;
  page: number | null;
  model: string;
  prompt_version: string;
  accepted_by: string;
  accepted_at: string;
}

// ==========================================
// v1.1 SPECIFICATION MODELS (Build Order v1.1)
// ==========================================

export type ConfidenceGate = 'Ready' | 'Check' | 'Exception';

export interface EvidenceLink {
  title: string;
  url?: string;
  attachment_id?: string;
  page?: number;
  clause?: string;
}

export interface AiOutputMeta {
  confidence: number; // 0 - 100
  gate: ConfidenceGate;
  reason: string;
  evidence_links?: EvidenceLink[];
  auto_accepted?: boolean;
  source_type?: string;
}

export type RuleScope = 'supplier' | 'client' | 'practice';
// A schedule's rules carry its own type, so a rule learned on one schedule is never matched on another
export type RuleType = 'mapping' | 'extraction' | 'tagging' | 'proposal' | 'review' | 'na_choice' | ScheduleOutputType;

export interface LearnedRule {
  id: string;
  firm_id: string;
  client_id?: string | null;
  supplier_name?: string | null;
  type: RuleType;
  scope: RuleScope;
  pattern: string;
  target_value: string;
  explanation?: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  times_used: number;
  active: boolean;
  approved_by_manager?: boolean;
}

export interface AiActionLogItem {
  id: string;
  firm_id: string;
  engagement_id: string;
  output_type: 'mapping' | 'extraction' | 'journal' | 'finding' | 'note' | 'commentary' | ScheduleOutputType;
  item_ref?: string;
  inputs_used: string;
  confidence: number;
  model_version: string;
  outcome: 'accepted' | 'edited' | 'rejected' | 'auto_accepted';
  decided_by: string;
  decided_by_name: string;
  decided_at: string;
  rejection_reason?: string;
}

/**
 * The AI readings on schedule lines that a person then decides on, one per AI task that reads a schedule:
 *   prepayment       review_prepaid_costs      C-20 data.prepayments        PrepLine.ai
 *   accrued_sales    review_accrued_sales      C-20 data.accrued_income     PrepLine.ai
 *   after_date_cost  review_after_date_costs   K-10 data.search.items       SearchItem.ai
 *   provision        suggest_provision         C-10 data.lines              DebtorLine.ai
 * Each is an output type of the confidence gate and a rule type of the rules library (gate.ts).
 * These ids are stored on rules and in the AI action log: the labels can change, the ids cannot.
 */
export type ScheduleOutputType = 'prepayment' | 'accrued_sales' | 'after_date_cost' | 'provision';

/** The name each schedule goes by on screen. */
export const SCHEDULE_OUTPUT_LABELS: Record<ScheduleOutputType, string> = {
  prepayment: 'Prepayment',
  accrued_sales: 'Accrued income',
  after_date_cost: 'Search for unrecorded liabilities',
  provision: 'Provision',
};

/**
 * The decisions a person can make on each schedule, as stored on its lines, with the wording the schedule shows.
 * The AI classifies into these and a learned rule's target is one of them, so nothing outside a schedule's own
 * list is ever suggested on it.
 */
export const SCHEDULE_DECISIONS: Record<ScheduleOutputType, Record<string, string>> = {
  prepayment: { add: 'Add as prepayment', not: 'Not a prepayment' },
  accrued_sales: { add: 'Add as accrued income', not: 'Not accrued income' },
  after_date_cost: { accrue: 'Accrue', creditor: 'Creditor', not_liability: 'Not this year' },
  // A provision's amount is never part of the classification: the person sets it
  provision: { provide: 'Provide', no_provision: 'No provision' },
};

/** What the gate made of one schedule reading; kept on the line beside the reading so the decision can be compared with it. */
export interface ScheduleGate {
  classification: string | null; // the suggested decision, one of SCHEDULE_DECISIONS for its schedule
  confidence: number; // 0-100
  gate: 'ready' | 'check' | 'exception';
  source: 'rule' | 'ai' | 'none';
  rule_id?: string;
  // What the AI itself read when a learned rule answered instead, so the two can be compared
  ai_classification?: string;
  ai_confidence?: number;
  supplier: string; // the supplier or customer on its own, as rules are matched on it
  model?: string;
}

export interface AiReviewFinding {
  id: string;
  workpaper_id: string;
  engagement_id?: string;
  schedule_ref?: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  explanation?: string;
  detail?: string;
  evidence_links?: EvidenceLink[];
  status: 'open' | 'fixed' | 'dismissed';
  dismiss_reason?: string;
  rated_useful?: boolean | null;
  feedback?: 'useful' | 'not_useful' | null;
  created_at: string;
  /** Raised by an AI review (provider:model); absent for findings from rules */
  source?: 'ai';
  model?: string;
  second_opinion_differs?: boolean;
}

export interface ScheduleVersion {
  id: string;
  workpaper_id: string;
  version_label?: string;
  version_number?: number;
  signed_by?: string;
  signed_by_name?: string;
  created_by_user_id?: string;
  created_by_name?: string;
  role?: 'preparer' | 'reviewer' | 'partner';
  data_snapshot?: Record<string, any>;
  snapshot_data_json?: Record<string, any>;
  status_at_save?: StatusKey;
  status?: string;
  created_at: string;
  reason?: string;
}

export interface DisclosureChecklistItem {
  id: string;
  engagement_id: string;
  section:
    | 'accounting_policies'
    | 'balance_sheet_notes'
    | 'pl_notes'
    | 'directors'
    | 'related_parties'
    | 'commitments'
    | 'post_balance_sheet'
    | 'going_concern';
  question: string;
  standard_ref: string;
  ai_suggested_answer: 'Yes' | 'No' | 'N/A';
  ai_confidence: number;
  ai_reason: string;
  confirmed_answer: 'Yes' | 'No' | 'N/A' | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  manager_override_reason?: string | null;
  linked_note_id?: string | null;
}

export interface StatutoryNoteItem {
  id: string;
  engagement_id: string;
  note_number: number;
  title: string;
  standard_ref: string;
  why_included: string;
  narrative_html: string;
  figures: { label: string; amount_p: string; workpaper_ref?: string }[];
  status: 'draft' | 'reviewed' | 'updated_needs_review';
  is_custom_wording: boolean;
}

// Stage A DAT-07: Drill down to transactions
export interface LedgerTransaction {
  id: string;
  engagement_id: string;
  account_code: string;
  account_name: string;
  date: string;
  contact: string;
  description: string;
  amount_p: string; // Net pence: debit positive, credit negative
  vat_p: string;
  gross_p: string;
  source: 'Xero' | 'QuickBooks' | 'Bank Feed' | 'CSV Upload';
  external_id?: string;
  external_url?: string;
  ref?: string; // the invoice or credit note number
  attachment_url?: string;
  attachment_name?: string;
  invoice_id?: string;
}

// Stage A DAT-01 / DAT-06: Snapshot change detection between imports
export interface TbSnapshotDiff {
  account_code: string;
  account_name: string;
  prior_amount_p: string;
  new_amount_p: string;
  diff_p: string;
  direction: 'increased' | 'decreased' | 'new';
  affected_schedule_ref?: string;
}


