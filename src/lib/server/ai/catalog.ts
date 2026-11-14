import type { Mode, ProviderId } from './types';

/** Every AI task, as the Control Centre lists it for routing. Defaults match each task's definition. */
export const TASK_CATALOG: { id: string; label: string; module: string; provider: ProviderId; mode: Mode }[] = [
  { id: 'read_bank_statement', label: 'Read bank statement balances', module: 'Bank reconciliation', provider: 'anthropic', mode: 'single' },
  { id: 'classify_document', label: 'Classify an uploaded document', module: 'Documents', provider: 'anthropic', mode: 'single' },
  { id: 'extract_document', label: 'Read figures from a document', module: 'Documents', provider: 'anthropic', mode: 'single' },
  { id: 'suggest_mapping', label: 'Suggest account mappings', module: 'Mapping', provider: 'anthropic', mode: 'single' },
  { id: 'review_workpaper', label: 'Review a working paper', module: 'Review', provider: 'anthropic', mode: 'single' },
  { id: 'risk_review', label: 'Find unusual balances', module: 'Risk', provider: 'anthropic', mode: 'single' },
  { id: 'draft_conclusion', label: 'Draft a paper conclusion', module: 'Reporting', provider: 'anthropic', mode: 'single' },
  { id: 'summarise_engagement', label: 'Engagement summaries and reports', module: 'Reporting', provider: 'anthropic', mode: 'single' },
  { id: 'research', label: 'Accounting research (Workpaper sources)', module: 'Research', provider: 'anthropic', mode: 'single' },
];
