import { db } from '../db';
import { readFile } from '../store';
import { thresholdsFor } from '../gate';
import { aiExtractionService, type ExtractedField, type BankStatementExtraction } from '../extraction';
import { readStatement } from '../statement-reader';
import { run, aiAvailable } from './gateway';
import { AiError, type AiSource, type Part, type RunCtx } from './types';
import { classifyDocumentTask, extractDocumentTask } from './tasks/documents';
import type { Attachment, AttachmentCategory, AiDocumentSummary, DocumentBullet } from '../../types/models';

// Summary bullets show Ready or Check; an Exception reads as Check
const asBulletGate = (g: 'ready' | 'check' | 'exception'): 'ready' | 'check' => (g === 'ready' ? 'ready' : 'check');

/**
 * Read a stored document with AI through the gateway: classify it if its type is unknown, then read the
 * fields its working paper needs. Falls back to extract() (blank values) when the file is not stored,
 * no AI provider is set up, or the read fails.
 */
export async function extractWithAi(
  firmId: string,
  ctx: RunCtx,
  attachment: Attachment,
  overrideCategory?: AttachmentCategory
): Promise<{ category: AttachmentCategory; summary: AiDocumentSummary; data: Record<string, any>; ai: boolean; note?: string }> {
  let category = (overrideCategory || attachment.category) as string;
  const fallback = (note: string) => {
    const r = aiExtractionService.extract(firmId, attachment, category as AttachmentCategory);
    if (r.summary.bullets[0]?.confidence === 0) r.summary.bullets[0].text = note;
    return { ...r, ai: false, note };
  };
  const file = attachment.file_key ? await readFile(attachment.file_key) : null;
  if (!file) return fallback('The file itself is not stored, so it cannot be read with AI. Upload it again, or enter the figures by hand.');
  const part: Part = { type: 'file', mime: file.mime, data: file.bytes.toString('base64'), filename: attachment.filename };
  try {
    if ((!category || category === 'Other') && aiAvailable(firmId, classifyDocumentTask)) {
      const c = await run(classifyDocumentTask, { file: part, filename: attachment.filename }, ctx);
      if (c.output.confidence >= 70) category = c.output.category;
    }
    if (category === 'Statement' || category === 'Bank statement') {
      const periodEnd = db.engagements.find((e) => e.id === attachment.engagement_id)?.period_end;
      const read = await readStatement({ ...file, filename: attachment.filename }, periodEnd, ctx);
      if (!read) return fallback('The AI could not read a balance from this statement. Enter it from the statement.');
      const blank = (): ExtractedField<string> => ({ value: '', confidence: 0, gate: 'check', reason: 'Not read' });
      const data: BankStatementExtraction & { _source?: AiSource } = {
        bank_name: read.bank_name,
        sort_code: blank(),
        account_number: blank(),
        statement_date: read.statement_date,
        statement_balance_p: read.statement_balance_p,
        opening_balance_p: blank(),
        total_debits_p: blank(),
        total_credits_p: blank(),
        reconciling_uncleared_items: [],
        _source: read.source,
      };
      const bullets: DocumentBullet[] = [
        { text: `Bank: ${read.bank_name.value || 'not named'}`, page: read.statement_balance_p.page ?? 1, clause: 'Header', confidence: read.bank_name.confidence, gate: asBulletGate(read.bank_name.gate) },
        {
          text: `${read.statement_balance_p.reason}: £${(Number(read.statement_balance_p.value) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })} at ${read.statement_date.value}`,
          page: read.statement_balance_p.page ?? 1,
          clause: 'Balance',
          confidence: read.statement_balance_p.confidence,
          gate: asBulletGate(read.statement_balance_p.gate),
        },
      ];
      return { category: 'Statement', summary: { bullets }, data, ai: true };
    }
    const r = await run(extractDocumentTask(category), { file: part }, ctx);
    const source: AiSource = { provider: r.provider, model: r.model, task_version: r.taskVersion, request_id: r.requestId, ...(r.agreement === undefined ? {} : { agreement: r.agreement }) };
    if (!r.output.found) return { ...aiExtractionService.buildExtraction(firmId, category, null, source, `The AI did not find a ${category.toLowerCase()} in this file. Check the document type.`), ai: true };
    // A second model disagreeing makes every value Check
    const output = r.agreement === false ? { ...r.output, confidence: Math.min(r.output.confidence, thresholdsFor(firmId, 'extraction').ready - 1) } : r.output;
    return { ...aiExtractionService.buildExtraction(firmId, category, output, source), ai: true };
  } catch (err) {
    if (err instanceof AiError) return fallback(`Not read with AI: ${err.message} Enter the figures from the document.`);
    throw err;
  }
}
