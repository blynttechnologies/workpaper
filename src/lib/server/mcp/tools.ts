import { db } from '../db';
import { freshWrite } from '../store';
import { canAccessEngagement, actorForUser } from '../api-helpers';
import { services, ServiceError } from '../services';
import { engagementFacts, summariseEngagement, paperChecks } from '../ai/services';
import { templateFor } from '../../workpapers/templates';
import { gateFor } from '../gate';
import { formatPence, toPence } from '../../money';
import type { Channel, JsonSchema } from '../ai/types';
import type { UserRole } from '../../types/models';

/**
 * The Workpaper tools offered to outside assistants (ChatGPT, Microsoft Copilot) through the MCP server.
 * Every tool runs as the signed-in Workpaper user behind the token: their practice, their assigned clients,
 * their role. Reads go through the same access checks as the app. The one write tool only proposes: it
 * leaves an unconfirmed value that blocks sign-off until a person confirms it inside Workpaper.
 */

export type McpActor = ReturnType<typeof actorForUser>;

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Writes need the workpaper.draft scope and a role that may prepare work */
  write?: boolean;
  run(actor: McpActor, args: Record<string, any>, channel: Channel): Promise<unknown>;
}

const WRITERS: UserRole[] = ['preparer', 'reviewer', 'manager', 'partner', 'admin'];
const str = (description: string) => ({ type: 'string', description });
const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });

function engagementFor(actor: McpActor, engagementId: string) {
  if (!canAccessEngagement(actor, engagementId)) throw new ServiceError('Engagement not found, or you do not have access to it.', 404, 'NOT_FOUND');
  return db.engagements.find((e) => e.id === engagementId)!;
}

function workpaperFor(actor: McpActor, workpaperId: string) {
  const wp = db.workpapers.find((w) => w.id === workpaperId && canAccessEngagement(actor, w.engagement_id));
  if (!wp) throw new ServiceError('Workpaper not found, or you do not have access to it.', 404, 'NOT_FOUND');
  return wp;
}

const titleOf = (w: { ref: string; custom_template?: { title?: string } | null }) => w.custom_template?.title ?? templateFor(w.ref)?.title ?? w.ref;
const pounds = (p: string | null | undefined) => (p == null || p === '' ? null : formatPence(p));
const visibleEngagements = (actor: McpActor) => db.engagements.filter((e) => canAccessEngagement(actor, e.id));

export const TOOLS: McpTool[] = [
  {
    name: 'search_workpapers',
    title: 'Search working papers',
    description: 'Find working papers by client name, paper reference (e.g. "B-10") or title, optionally within one engagement or by status.',
    inputSchema: obj({ query: str('Words to match against client, reference and title; empty lists all'), engagement_id: str('Limit to one engagement'), status: str('e.g. not_started, in_progress, prepared, signed_off') }),
    async run(actor, a) {
      const engs = new Map(visibleEngagements(actor).map((e) => [e.id, e]));
      const words = String(a.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const rows = db.workpapers
        .filter((w) => engs.has(w.engagement_id) && (!a.engagement_id || w.engagement_id === a.engagement_id) && (!a.status || w.status === a.status))
        .map((w) => {
          const e = engs.get(w.engagement_id)!;
          const client = db.clients.find((c) => c.id === e.client_id)?.name ?? '';
          return { workpaper_id: w.id, engagement_id: e.id, client, period_end: e.period_end, ref: w.ref, title: titleOf(w), status: w.status };
        })
        .filter((r) => words.every((x) => `${r.client} ${r.ref} ${r.title}`.toLowerCase().includes(x)));
      return { count: rows.length, workpapers: rows.slice(0, 50), ...(rows.length > 50 ? { note: 'Showing the first 50; narrow the search.' } : {}) };
    },
  },
  {
    name: 'get_client_summary',
    title: 'Client summary',
    description: "A client's details and engagements, with the latest engagement's progress, blockers and missing documents.",
    inputSchema: obj({ client_id: str('Client id'), client_name: str('Or part of the client name') }),
    async run(actor, a) {
      const clients = db.clients.filter((c) => c.firm_id === actor.firmId && (!actor.clientIds || actor.clientIds.includes(c.id)));
      const client = a.client_id ? clients.find((c) => c.id === a.client_id) : clients.find((c) => c.name.toLowerCase().includes(String(a.client_name ?? '').toLowerCase()) && a.client_name);
      if (!client) return { error: 'No client you can see matches that.', clients: clients.slice(0, 30).map((c) => ({ id: c.id, name: c.name })) };
      const engs = visibleEngagements(actor).filter((e) => e.client_id === client.id).sort((x, y) => y.period_end.localeCompare(x.period_end));
      const latest = engs[0];
      const facts = latest ? engagementFacts(latest.id) : null;
      return {
        client: { id: client.id, name: client.name, company_number: client.company_no, company_type: client.company_type, year_end: client.year_end },
        engagements: engs.map((e) => ({ id: e.id, period_end: e.period_end, framework: e.framework, status: e.status })),
        latest: facts && {
          engagement_id: facts.engagement.id,
          papers: facts.workpapers.length,
          signed_off: facts.workpapers.filter((w) => w.status === 'signed_off').length,
          blockers: facts.blockers.map((b) => b.title),
          missing_documents: facts.missing_documents.length,
          open_findings: facts.open_findings.length,
        },
      };
    },
  },
  {
    name: 'get_account_details',
    title: 'Account details',
    description: "Trial balance accounts for an engagement: the client's code and name, balance, the Blynt account it maps to and the mapping status. Filter by code or name.",
    inputSchema: obj({ engagement_id: str('Engagement id'), account: str('Code or part of the name; empty lists all') }, ['engagement_id']),
    async run(actor, a) {
      engagementFor(actor, a.engagement_id);
      const q = String(a.account ?? '').toLowerCase();
      const rows = db.account_mappings
        .filter((m) => m.engagement_id === a.engagement_id && (!q || m.source_code.toLowerCase() === q || m.source_name.toLowerCase().includes(q)))
        .map((m) => ({
          code: m.source_code,
          name: m.source_name,
          balance: pounds(m.balance_p),
          balance_p: m.balance_p,
          blynt_code: m.blynt_code,
          blynt_name: db.blynt_accounts.find((b) => b.code === m.blynt_code)?.name ?? null,
          mapping_status: m.status,
        }));
      return { count: rows.length, accounts: rows.slice(0, 200) };
    },
  },
  {
    name: 'find_missing_documents',
    title: 'Missing supporting documents',
    description: 'Items on working papers that still need supporting evidence (additions, disposals, checklist items).',
    inputSchema: obj({ engagement_id: str('Engagement id') }, ['engagement_id']),
    async run(actor, a) {
      engagementFor(actor, a.engagement_id);
      const missing = services.findMissingEvidence(a.engagement_id);
      return { count: missing.length, missing };
    },
  },
  {
    name: 'generate_report',
    title: 'Generate a report',
    description: 'A status summary, exceptions report or management commentary for an engagement, written from Workpaper’s own figures. Read-only.',
    inputSchema: obj({ engagement_id: str('Engagement id'), kind: { type: 'string', enum: ['status', 'exceptions', 'management'] } }, ['engagement_id']),
    async run(actor, a, channel) {
      engagementFor(actor, a.engagement_id);
      return summariseEngagement(actor, a.engagement_id, a.kind ?? 'status', channel);
    },
  },
  {
    name: 'create_reconciliation_draft',
    title: 'Draft a bank reconciliation figure',
    description:
      'Put a bank statement balance on a bank reconciliation paper as an unconfirmed draft. It fills only an empty balance, never changes one a person entered, and blocks sign-off until someone confirms it in Workpaper against the statement.',
    inputSchema: obj(
      {
        workpaper_id: str('The bank reconciliation paper (B-) id'),
        account_id: str('The bank account row on the paper, when it has several (see get_workpaper_status)'),
        statement_balance: str('Balance as printed on the statement, in pounds, e.g. "118402.17"; negative if overdrawn'),
        statement_date: str('YYYY-MM-DD the balance is at'),
        source: str('Where the figure came from, e.g. the statement file name'),
      },
      ['workpaper_id', 'statement_balance', 'statement_date', 'source']
    ),
    write: true,
    async run(actor, a, channel) {
      if (!WRITERS.includes(actor.role)) throw new ServiceError('Your Workpaper role is read-only.', 403, 'READONLY');
      if (!/^-?\d+(\.\d{1,2})?$/.test(String(a.statement_balance).replace(/[£,\s]/g, ''))) throw new ServiceError('statement_balance must be a plain amount such as 118402.17.', 400);
      // Shape, then a round trip: 2026-13-45 fails to parse, and 2026-02-30 parses but comes back as 2 March
      const day = Date.parse(a.statement_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.statement_date) || Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== a.statement_date) throw new ServiceError('statement_date must be a real date, as YYYY-MM-DD.', 400);
      const balance = toPence(String(a.statement_balance).replace(/[£,\s]/g, '')).toString();
      return freshWrite(() => {
        const wp = workpaperFor(actor, a.workpaper_id);
        if (!wp.ref.startsWith('B-')) throw new ServiceError('That is not a bank reconciliation paper.', 400);
        const eng = db.engagements.find((e) => e.id === wp.engagement_id)!;
        if (eng.status === 'locked') throw new ServiceError('The engagement is locked.', 409, 'LOCKED');
        if (wp.status === 'signed_off') throw new ServiceError('The paper is signed off; it cannot take a draft figure.', 409);
        const data = { ...wp.data_json } as Record<string, any>;
        const accounts: any[] = Array.isArray(data.accounts) ? data.accounts : [];
        const row = a.account_id ? accounts.find((x) => x.id === a.account_id) : accounts.length === 1 ? accounts[0] : undefined;
        if (accounts.length > 1 && !row) return { error: 'This paper has several bank accounts: give account_id.', accounts: accounts.map((x) => ({ id: x.id, code: x.code, name: x.name })) };
        const current = row ? row.statement_p : data.statement_p;
        if (current) return { filled: false, reason: 'A statement balance is already entered; drafts never overwrite a person’s figure.', current: pounds(current) };
        const field = row ? `accounts.${row.id}.statement_p` : 'statement_p';
        if (row) data.accounts = accounts.map((x) => (x.id === row.id ? { ...x, statement_p: balance, statement_date: a.statement_date, source: channel } : x));
        else Object.assign(data, { statement_p: balance, statement_date: a.statement_date, statement_source: channel });
        const items: any[] = data.confidence_gate_items ?? [];
        items.push({
          id: `gate_${channel}_${Date.now()}`,
          field,
          label: `${row ? `${row.code} ${row.name}` : 'Statement'} closing balance (from ${channel})`,
          value: balance,
          source_attachment_id: null,
          filename: String(a.source ?? '').slice(0, 200),
          page: 1,
          clause: '',
          confidence: 0,
          gate: gateFor(actor.firmId, 'extraction', 0),
          reason: `Entered through ${channel} for ${actor.name}: confirm it against the statement`,
          confirmed: false,
        });
        data.confidence_gate_items = items;
        data.values_to_confirm_count = items.filter((i) => !i.confirmed).length;
        wp.data_json = data;
        wp.updated_at = new Date().toISOString();
        // As with an edit in the app (updateWorkpaperData): a sign-off does not cover a figure added after it
        for (const s of db.signoffs.filter((x) => x.workpaper_id === wp.id && !x.stale_at)) {
          s.stale_at = wp.updated_at;
          s.stale_reason = `Draft figure from ${channel} for ${actor.name} on ${new Date().toLocaleDateString('en-GB')}`;
        }
        db.logAudit(actor.firmId, actor, 'MCP_RECONCILIATION_DRAFT', 'workpapers', wp.id, null, { field, balance_p: balance, statement_date: a.statement_date, channel, source: a.source }, `Draft from ${channel}`);
        return { filled: true, workpaper_id: wp.id, field, balance: pounds(balance), status: 'Unconfirmed: a person must confirm it in Workpaper before sign-off.' };
      });
    },
  },
  {
    name: 'retrieve_review_exceptions',
    title: 'Review exceptions',
    description: 'Open review notes, open review findings and failing completion checks for an engagement.',
    inputSchema: obj({ engagement_id: str('Engagement id') }, ['engagement_id']),
    async run(actor, a) {
      engagementFor(actor, a.engagement_id);
      const facts = engagementFacts(a.engagement_id);
      const papers = new Map(facts.workpapers.map((w) => [w.id, w.ref]));
      const notes = db.comments
        .filter((c) => papers.has(c.workpaper_id) && c.status === 'open')
        .map((c) => ({ ref: papers.get(c.workpaper_id), type: c.type, about: c.anchor_summary, note: c.body, by: c.created_by_name, at: c.created_at }));
      return { review_notes: notes, findings: facts.open_findings, blockers: facts.blockers, values_to_confirm: facts.workpapers.filter((w) => w.values_to_confirm).map((w) => ({ ref: w.ref, count: w.values_to_confirm })) };
    },
  },
  {
    name: 'get_workpaper_status',
    title: 'Working paper status',
    description: "One working paper's status: sign-offs, procedures done, values awaiting confirmation, open notes and findings, and the engine's checks.",
    inputSchema: obj({ workpaper_id: str('Workpaper id') }, ['workpaper_id']),
    async run(actor, a) {
      const wp = workpaperFor(actor, a.workpaper_id);
      const procs = db.procedures.filter((p) => p.workpaper_id === wp.id);
      return {
        workpaper_id: wp.id,
        ref: wp.ref,
        title: titleOf(wp),
        status: wp.status,
        signoffs: db.signoffs.filter((s) => s.workpaper_id === wp.id).map((s) => ({ role: s.role, by: s.user_name, at: s.signed_at, stale: !!s.stale_at })),
        procedures: { done: procs.filter((p) => p.done_by || p.not_applicable_reason).length, total: procs.length },
        values_to_confirm: Number(wp.data_json?.values_to_confirm_count || 0),
        open_review_notes: db.comments.filter((c) => c.workpaper_id === wp.id && c.status === 'open').length,
        open_findings: db.ai_review_findings.filter((f) => f.workpaper_id === wp.id && f.status === 'open').map((f) => ({ severity: f.severity, title: f.title })),
        bank_accounts: Array.isArray(wp.data_json?.accounts) ? wp.data_json.accounts.map((x: any) => ({ id: x.id, code: x.code, name: x.name, statement_balance: pounds(x.statement_p) })) : undefined,
        checks: paperChecks(wp)?.checks ?? null,
      };
    },
  },
];
