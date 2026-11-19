import { db } from './db';
import { Actor } from './state-guard';
import { findRule, learnFromCorrection, norm, recordDecision, runGated, type AiProposal } from './gate';
import { SCHEDULE_DECISIONS, type ScheduleGate, type ScheduleOutputType } from '../types/models';
import { asPence, formatPence } from '../money';

/**
 * Schedule AI learning: the four schedule readings (prepayments, accrued income, the search for unrecorded
 * liabilities, bad debt provisions) put through the same gate, rules library and AI action log as Mapping.
 * Nothing here gates, matches or stores on its own; it only says how a schedule line maps onto gate.ts:
 *
 *   gateSchedule()                 a validated AI answer through runGated: learned rules first, then the gate
 *   learnFromScheduleDecisions()   a person's decision on a read line goes to the action log and becomes a rule
 *
 * A rule holds a classification for a supplier or customer of one client on one schedule. It never holds an
 * amount, and neither a rule nor a Ready reading decides a line: it is the suggestion the person is shown first.
 */

const isDecision = (type: ScheduleOutputType, v: unknown): v is string => typeof v === 'string' && Object.keys(SCHEDULE_DECISIONS[type]).includes(v);

// Rules match on the supplier or customer alone, held apart from the description. A * would turn the pattern into a wildcard
const supplierKeys = (supplier: string) => (norm(supplier) ? [`supplier:${norm(supplier).replace(/\*/g, '')}`] : []);

/**
 * The learned rule for this supplier on this client's schedule, if there is one. Looking does not count as using it.
 * Only the kind of rule a decision makes is honoured: one supplier by name, for a client or an approved practice.
 * Rules reach the server from browsers, so a wildcard or an every-client supplier rule is not taken as a suggestion.
 */
export function scheduleRule(firmId: string, clientId: string | null | undefined, type: ScheduleOutputType, supplier: string) {
  const r = findRule(firmId, type, supplierKeys(supplier), { clientId, supplier });
  return r && r.scope !== 'supplier' && !r.pattern.includes('*') ? r : undefined;
}

/**
 * An AI answer only goes to the gate when its classification is one of the schedule's own decisions and its
 * confidence is a number from 0 to 100. Anything else is no proposal, which the gate leaves for a person.
 */
export function scheduleProposal(type: ScheduleOutputType, answer: { classification?: unknown; confidence?: unknown; summary?: unknown }): AiProposal<string> | null {
  const c = answer.confidence;
  if (!isDecision(type, answer.classification) || typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 100) return null;
  return { value: answer.classification, confidence: c, reason: String(answer.summary ?? ''), evidence: 'AI reading' };
}

/** One schedule reading through the rules and the gate. */
export function gateSchedule(
  firmId: string,
  clientId: string | null | undefined,
  type: ScheduleOutputType,
  supplier: string,
  answer: { classification?: unknown; confidence?: unknown; summary?: unknown }
): ScheduleGate {
  const g = runGated<string | null>({
    firmId,
    outputType: type,
    ruleType: type,
    keys: scheduleRule(firmId, clientId, type, supplier) ? supplierKeys(supplier) : [],
    clientId,
    supplier,
    // A rule can be changed in settings, so its target is checked like the AI's answer
    decode: (target) => (isDecision(type, target) ? target : null),
    ai: () => scheduleProposal(type, answer),
  });
  // The rule answers, and what the AI read is kept beside it
  const own = g.source === 'rule' ? scheduleProposal(type, answer) : null;
  return {
    classification: g.value,
    confidence: g.confidence,
    gate: g.value ? g.gate : 'exception',
    source: g.source,
    ...(g.rule_id ? { rule_id: g.rule_id } : {}),
    ...(own ? { ai_classification: own.value, ai_confidence: own.confidence } : {}),
    supplier,
  };
}

type Line = { id: string; desc?: string; date?: string; contact?: string; amount_p?: string; decision?: string; provision_p?: string; ai?: Partial<ScheduleGate> & { percent?: number; amount_p?: string } };

// Where each schedule keeps its lines on its paper, and what a line is known by in the action log when its id does not last
const SCHEDULES: { ref: string; type: ScheduleOutputType; lines: (data: Record<string, any>) => Line[]; refOf?: (l: Line) => string }[] = [
  { ref: 'C-20', type: 'prepayment', lines: (d) => d.prepayments ?? [] },
  { ref: 'C-20', type: 'accrued_sales', lines: (d) => d.accrued_income ?? [] },
  // A Xero pull renumbers the ledger rows and so these line ids: the log goes by what searchAfterDate matches a moved cost on
  // shortcut: two costs alike in date, supplier, description and amount share one log row, give the line a lasting id if that matters
  { ref: 'K-10', type: 'after_date_cost', lines: (d) => d.search?.items ?? [], refOf: (l) => `${l.date}|${l.contact}|${l.desc}|${l.amount_p}` },
  { ref: 'C-10', type: 'provision', lines: (d) => d.lines ?? [] },
];

/**
 * Called on every save of a working paper, with its data as it was before. A decision made in this save, on a
 * line that was there undecided and carries a gated reading, is logged once (AUD-03) and learned as a client
 * rule for its supplier (DAT-09). Undoing and deciding again logs nothing more, but the rule follows the last
 * decision. A decision that came back with a line under a new id (a new search after a pull) is not a new one.
 * A rule someone switched off in settings stays off.
 */
export function learnFromScheduleDecisions(actor: Actor, wp: { ref: string; engagement_id: string; data_json: Record<string, any> }, before: Record<string, any>) {
  const clientId = db.engagements.find((e) => e.id === wp.engagement_id)?.client_id;
  for (const s of SCHEDULES.filter((x) => x.ref === wp.ref)) {
    const was = new Map(s.lines(before).map((l) => [l.id, l]));
    for (const l of s.lines(wp.data_json)) {
      const ai = l.ai;
      const old = was.get(l.id);
      if (!ai?.gate || !old || old.decision || !isDecision(s.type, l.decision)) continue;
      const label = SCHEDULE_DECISIONS[s.type];
      const itemRef = s.refOf?.(l) ?? l.id;
      // Only a line the AI or a rule classified has an output to judge
      if (ai.classification && !db.ai_action_logs.some((r) => r.engagement_id === wp.engagement_id && r.output_type === s.type && r.item_ref === itemRef)) {
        const said = (c: string) => label[c] ?? c;
        // A provision's suggested amount is the AI's: a rule never holds one
        const figure = ai.amount_p ? ` at ${ai.percent}% (${formatPence(asPence(ai.amount_p))})` : '';
        const suggested =
          ai.source === 'rule'
            ? `Rule ${ai.rule_id} suggested: ${said(ai.classification)}.${ai.ai_classification ? ` AI read: ${said(ai.ai_classification)}${figure}, ${ai.ai_confidence}% sure.` : ''}`
            : `AI suggested: ${said(ai.classification)}${figure}.`;
        recordDecision(actor, {
          engagementId: wp.engagement_id,
          outputType: s.type,
          itemRef,
          confidence: ai.confidence ?? 0,
          outcome: ai.classification === l.decision ? 'accepted' : 'edited',
          inputs: `${[ai.supplier && !(l.desc ?? '').includes(ai.supplier) ? ai.supplier : '', l.desc].filter(Boolean).join(' · ')}. ${suggested} Decided: ${label[l.decision]}${l.provision_p ? ` (${formatPence(asPence(l.provision_p))})` : ''}.`,
          // Left out for a rule, which the log then names as the rules engine
          modelVersion: ai.source === 'ai' ? ai.model : undefined,
        });
      }
      // Nothing to learn when the rules already say so, there is no supplier to know the next one by, or the rule was switched off in settings
      const key = supplierKeys(ai.supplier ?? '')[0];
      const off = db.learned_rules.some((r) => r.firm_id === actor.firmId && r.type === s.type && r.scope === 'client' && r.client_id === clientId && !r.active && norm(r.pattern ?? '') === key);
      if (key && ai.supplier && clientId && !off && scheduleRule(actor.firmId, clientId, s.type, ai.supplier)?.target_value !== l.decision) {
        learnFromCorrection(actor, {
          type: s.type,
          scope: 'client',
          client_id: clientId,
          supplier_name: ai.supplier,
          pattern: key,
          target_value: l.decision,
          explanation: `${ai.supplier}: ${label[l.decision]}`,
        });
      }
    }
  }
}
