import crypto from 'crypto';
import { db } from '../db';
import { freshWrite } from '../store';
import { services, ServiceError } from '../services';
import { matchBlyntAccount } from '../../mapping/auto-mapper';
import { evaluatePaper } from '../../workpapers/engine';
import { templateFor } from '../../workpapers/templates';
import { STANDARDS } from '../../standards';
import { gateFor } from '../gate';
import { run, aiAvailable } from './gateway';
import { AiError, type RunCtx, type ToolBox } from './types';
import {
  suggestMappingTask,
  reviewWorkpaperTask,
  draftConclusionTask,
  summariseEngagementTask,
  riskReviewTask,
  researchTask,
  type PaperInput,
} from './tasks/accounting';
import type { UserRole } from '../../types/models';

/**
 * Shared AI services: one place each Workpaper module, and the MCP tools, call for AI help.
 * The caller has already checked the user can see the engagement or paper. Facts come from
 * Workpaper's own engine; the AI drafts; anything saved is a suggestion, a finding or a draft
 * that a person accepts, dismisses or rewrites.
 */

type Actor = { id: string; name: string; role: UserRole; firmId: string };
const ctxOf = (actor: Actor, engagementId?: string, channel: RunCtx['channel'] = 'app'): RunCtx => ({ firmId: actor.firmId, userId: actor.id, channel, engagementId });

function engagementOf(engagementId: string) {
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng) throw new ServiceError('Engagement not found', 404, 'NOT_FOUND');
  return eng;
}

function writable(engagementId: string) {
  if (engagementOf(engagementId).status === 'locked') throw new ServiceError('This engagement is locked. Unlock it to add AI drafts.', 409, 'LOCKED');
}

// ------------------------------------------------------------ Accounting intelligence: mapping

/** Rules first (the auto-mapper and learned rules); AI only for accounts the rules could not place. */
export async function suggestMappings(actor: Actor, items: { id: string; name: string; type?: string; code?: string; balance_p?: string }[], channel?: RunCtx['channel']) {
  const ruled = items.map((item) => {
    const s = matchBlyntAccount(item.name || '', item.type || '', item.code || '');
    return { id: item.id, source_name: item.name, suggested_blynt_code: s?.blynt_code ?? null, blynt_name: s?.name ?? null, confidence: s?.confidence ?? 0, reason: s?.reason ?? 'No rule matched', source: 'rule' as const };
  });
  const weak = ruled.filter((r) => r.confidence < 70);
  if (!weak.length || !aiAvailable(actor.firmId, suggestMappingTask)) return { results: ruled, ai: false };

  const chart = db.blynt_accounts.filter((a) => a.type !== 'System' && (!a.firm_id || a.firm_id === actor.firmId)).map((a) => ({ code: a.code, name: a.name, type: a.type }));
  const codes = new Set(chart.map((c) => c.code));
  try {
    const r = await run(
      suggestMappingTask,
      { chart, items: weak.map((w) => { const i = items.find((x) => x.id === w.id)!; return { id: i.id, name: i.name, type: i.type ?? '', balance_p: i.balance_p ?? '' }; }) },
      ctxOf(actor, undefined, channel)
    );
    const byId = new Map(r.output.suggestions.filter((s) => codes.has(s.code)).map((s) => [s.id, s]));
    const results = ruled.map((x) => {
      const s = byId.get(x.id);
      if (!s || x.confidence >= 70 || s.confidence <= x.confidence) return x;
      // A disagreement between two models is never Ready
      const confidence = r.agreement === false ? Math.min(s.confidence, 69) : s.confidence;
      return { ...x, suggested_blynt_code: s.code, blynt_name: chart.find((c) => c.code === s.code)?.name ?? null, confidence, reason: s.reason, source: 'ai' as const, model: r.model };
    });
    return { results, ai: true, model: r.model };
  } catch (err) {
    if (err instanceof AiError) return { results: ruled, ai: false, note: err.message };
    throw err;
  }
}

// ------------------------------------------------------------ Review and reporting on one paper

/** The engine's checks and totals for a paper, as plain JSON (amounts as pence strings). */
export function paperChecks(wp: Parameters<typeof evaluatePaper>[0]) {
  const r = evaluatePaper(wp);
  if (!r) return null;
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
  return { checks: plain(r.checks), totals: plain(r.totals), leads: plain(r.leads) };
}

function paperInput(workpaperId: string): { input: PaperInput; engagementId: string; ref: string } {
  const wp = db.workpapers.find((w) => w.id === workpaperId);
  if (!wp) throw new ServiceError('Workpaper not found', 404, 'NOT_FOUND');
  const eng = engagementOf(wp.engagement_id);
  const { confidence_gate_items: _items, ...data } = (wp.data_json ?? {}) as Record<string, unknown>;
  return {
    engagementId: wp.engagement_id,
    ref: wp.ref,
    input: {
      ref: wp.ref,
      title: wp.custom_template?.title ?? templateFor(wp.ref)?.title ?? wp.ref,
      framework: eng.framework,
      period_end: eng.period_end,
      data,
      checks: paperChecks(wp),
      procedures: db.procedures.filter((p) => p.workpaper_id === wp.id).map((p) => ({ text: p.text, done: !!p.done_by, not_applicable_reason: p.not_applicable_reason })),
    },
  };
}

/** Risk and exception review of one paper: findings join the paper's review findings (warnings and errors block sign-off until dismissed or fixed). */
export async function reviewWorkpaper(actor: Actor, workpaperId: string, channel?: RunCtx['channel']) {
  const { input, engagementId, ref } = paperInput(workpaperId);
  writable(engagementId);
  const r = await run(reviewWorkpaperTask, input, ctxOf(actor, engagementId, channel));
  const now = new Date().toISOString();
  const findings = r.output.findings.map((f) => ({
    id: `find_${crypto.randomUUID()}`,
    workpaper_id: workpaperId,
    engagement_id: engagementId,
    schedule_ref: ref,
    severity: f.severity,
    title: f.title,
    explanation: f.explanation,
    detail: f.explanation,
    status: 'open' as const,
    created_at: now,
    source: 'ai' as const,
    model: `${r.provider}:${r.model}`,
    ...(r.agreement === false ? { second_opinion_differs: true } : {}),
  }));
  await freshWrite(() => {
    writable(engagementId);
    // A new review replaces the last AI review's open findings; fixed and dismissed ones stay on record
    db.ai_review_findings = db.ai_review_findings.filter((f) => !(f.workpaper_id === workpaperId && f.status === 'open' && f.source === 'ai'));
    db.ai_review_findings.push(...findings);
    db.logAudit(actor.firmId, actor, 'AI_REVIEW_WORKPAPER', 'workpapers', workpaperId, null, { findings: findings.length, provider: r.provider, model: r.model, request_id: r.requestId });
  });
  return { findings, provider: r.provider, model: r.model, agreement: r.agreement };
}

/** A draft conclusion, kept beside the conclusion a person writes; never written into it. */
export async function draftConclusion(actor: Actor, workpaperId: string, channel?: RunCtx['channel']) {
  const { input, engagementId } = paperInput(workpaperId);
  writable(engagementId);
  const r = await run(draftConclusionTask, input, ctxOf(actor, engagementId, channel));
  await freshWrite(() => {
    writable(engagementId);
    const wp = db.workpapers.find((w) => w.id === workpaperId)!;
    const conclusion = { ...(wp.data_json?.conclusion ?? {}), ai_draft: r.output, ai_status: 'draft', ai_model: `${r.provider}:${r.model}` };
    wp.data_json = { ...wp.data_json, conclusion };
    wp.updated_at = new Date().toISOString();
    db.logAudit(actor.firmId, actor, 'AI_DRAFT_CONCLUSION', 'workpapers', workpaperId, null, { provider: r.provider, model: r.model, request_id: r.requestId });
  });
  return { draft: r.output, provider: r.provider, model: r.model };
}

// ------------------------------------------------------------ Workflow and reporting on an engagement

/** The engagement's state as Workpaper's own rules see it: the facts every summary and outside assistant works from. */
export function engagementFacts(engagementId: string) {
  const eng = engagementOf(engagementId);
  const client = db.clients.find((c) => c.id === eng.client_id);
  const papers = db.workpapers.filter((w) => w.engagement_id === engagementId);
  const paperIds = new Set(papers.map((w) => w.id));
  return {
    engagement: { id: eng.id, client: client?.name ?? eng.client_id, period_start: eng.period_start, period_end: eng.period_end, framework: eng.framework, status: eng.status },
    workpapers: papers.map((w) => ({
      id: w.id,
      ref: w.ref,
      title: w.custom_template?.title ?? templateFor(w.ref)?.title ?? w.ref,
      status: w.status,
      values_to_confirm: Number(w.data_json?.values_to_confirm_count || 0),
      open_review_notes: db.comments.filter((c) => c.workpaper_id === w.id && c.status === 'open').length,
    })),
    blockers: services.getEngagementBlockers(engagementId).blockers.filter((b) => !b.passed),
    missing_documents: services.findMissingEvidence(engagementId),
    open_findings: db.ai_review_findings
      .filter((f) => paperIds.has(f.workpaper_id) && f.status === 'open')
      .map((f) => ({ ref: f.schedule_ref, severity: f.severity, title: f.title, explanation: f.explanation })),
    adjustments_awaiting_approval: db.adjustments.filter((a) => a.engagement_id === engagementId && a.status === 'proposed').map((a) => ({ ref: a.ref, narrative: a.narrative })),
  };
}

/** Facts always; a written summary when AI is available. */
export async function summariseEngagement(actor: Actor, engagementId: string, kind: 'status' | 'exceptions' | 'management' = 'status', channel?: RunCtx['channel']) {
  const facts = engagementFacts(engagementId);
  const withFigures = kind === 'management' ? { ...facts, trial_balance: riskInput(engagementId) } : facts;
  try {
    const r = await run(summariseEngagementTask, { facts: withFigures, kind }, ctxOf(actor, engagementId, channel));
    return { facts, summary: r.output, provider: r.provider, model: r.model };
  } catch (err) {
    if (err instanceof AiError) return { facts, summary: null, note: err.message };
    throw err;
  }
}

// ------------------------------------------------------------ Risk intelligence

function riskInput(engagementId: string) {
  const eng = engagementOf(engagementId);
  const prior = new Map(db.account_mappings.filter((m) => m.engagement_id === eng.prior_engagement_id).map((m) => [m.source_code, m.balance_p]));
  return {
    period_end: eng.period_end,
    lines: db.account_mappings
      .filter((m) => m.engagement_id === engagementId)
      .map((m) => ({ source_code: m.source_code, name: m.source_name, blynt_code: m.blynt_code, balance_p: m.balance_p, prior_p: prior.get(m.source_code) ?? null })),
  };
}

export async function riskReview(actor: Actor, engagementId: string, channel?: RunCtx['channel']) {
  const input = riskInput(engagementId);
  if (!input.lines.length) return { anomalies: [], note: 'No trial balance has been imported for this engagement yet.' };
  const r = await run(riskReviewTask, input, ctxOf(actor, engagementId, channel));
  return { anomalies: r.output.anomalies, provider: r.provider, model: r.model, gate: gateFor(actor.firmId, 'finding', 80) };
}

// ------------------------------------------------------------ Research intelligence (internal sources)

export async function research(actor: Actor, question: string, engagementId?: string, channel?: RunCtx['channel']) {
  if (!question.trim()) throw new ServiceError('Ask a question.', 400);
  const tools = (): ToolBox => ({
    defs: [
      {
        name: 'search_standards',
        description: 'Search the accounting standards library held in Workpaper (FRS 102, FRS 102 Section 1A, FRS 105): disclosures, checklist questions and note templates.',
        schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
      },
      ...(engagementId
        ? [
            {
              name: 'get_engagement_facts',
              description: "The current engagement's papers, blockers, missing documents, open findings and journals awaiting approval.",
              schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
            },
          ]
        : []),
    ],
    async run(name, input) {
      if (name === 'get_engagement_facts' && engagementId) return JSON.stringify(engagementFacts(engagementId));
      const words = String((input as { query: string }).query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const hits = STANDARDS.flatMap((s) => [
        ...s.disclosures.map((d) => ({ source: `${s.code} ${s.version} ${d.code}`, text: `${d.title}: ${d.requirement}` })),
        ...s.checklist.map((c) => ({ source: `${s.code} ${s.version} checklist ${c.id}`, text: c.question })),
        ...s.note_templates.map((n) => ({ source: `${s.code} ${s.version} note ${n.id}`, text: `${n.title}: ${n.body}` })),
      ])
        .map((h) => ({ ...h, score: words.filter((w) => h.text.toLowerCase().includes(w)).length }))
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
      return hits.length ? JSON.stringify(hits.map(({ score: _s, ...h }) => h)) : 'No matching entries in the standards library.';
    },
  });
  const r = await run(researchTask(tools), { question }, ctxOf(actor, engagementId, channel));
  return { ...r.output, provider: r.provider, model: r.model };
}
