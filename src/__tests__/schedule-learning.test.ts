// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, freshWrite: async (f: () => unknown) => f(), currentVersion: () => 1, hasDatabase: () => false }));
const run = vi.fn();
vi.mock('../lib/server/ai/gateway', () => ({ run: (...a: unknown[]) => run(...a), aiAvailable: () => true }));

import { db } from '../lib/server/db';
import { services } from '../lib/server/services';
import { accuracy, findRule, gateFor } from '../lib/server/gate';
import { gateSchedule, scheduleProposal } from '../lib/server/schedule-learning';
import { reviewAfterDateCosts, suggestProvision } from '../lib/server/ai/services';
import { SCHEDULE_DECISIONS, SCHEDULE_OUTPUT_LABELS, type ScheduleOutputType } from '../lib/types/models';

const FIRM = 'firm_blynt_uk';
const user = { id: 'usr_admin', name: 'Admin', role: 'admin' as const };
const actor = { ...user, firmId: FIRM };
const TYPES = Object.keys(SCHEDULE_DECISIONS) as ScheduleOutputType[];
let engId = '';
let clientId = '';
let pe = '';
const day = (n: number) => new Date(Date.parse(pe) + n * 86_400_000).toISOString().slice(0, 10);

/** This engagement's paper with the given data, replacing any the seed has. */
const paper = (ref: string, data: Record<string, any>) => {
  db.workpapers = db.workpapers.filter((w) => !(w.engagement_id === engId && w.ref === ref));
  db.workpapers.push({ id: `wp_${ref}`, engagement_id: engId, ref, data_json: data } as any);
  return `wp_${ref}`;
};
const save = (wpId: string, patch: Record<string, any>) => services.updateWorkpaperData(FIRM, user, wpId, patch);
/** A reading as the AI route returns it and the screen keeps it on the line. */
const read = (supplier: string, classification: string, confidence: number, type: ScheduleOutputType = 'prepayment') => ({ from: '', to: '', summary: 'Reading.', model: 'm', ...gateSchedule(FIRM, clientId, type, supplier, { classification, confidence }) });
const prep = (id: string, supplier: string, ai?: object, more: object = {}) => ({ id, desc: `${supplier} · Annual licence`, code: '4600', net_p: '90000', method: 'days', found: true, ...(ai ? { ai } : {}), ...more });
const decide = (wpId: string, key: string, id: string, decision: string | undefined) => save(wpId, { [key]: (db.workpapers.find((w) => w.id === wpId)!.data_json[key] as any[]).map((l) => (l.id === id ? { ...l, decision } : l)) });
const rules = (type?: ScheduleOutputType) => db.learned_rules.filter((r) => !type || r.type === type);
const logs = () => db.ai_action_logs;

beforeEach(() => {
  db.seed(true);
  run.mockReset();
  const eng = db.engagements[0];
  engId = eng.id;
  clientId = eng.client_id;
  pe = eng.period_end;
  db.learned_rules = [];
  db.ai_action_logs = [];
});

describe('the schedule types', () => {
  it('are named once, in the words the schedules use, with their own decisions', () => {
    expect(SCHEDULE_OUTPUT_LABELS).toEqual({ prepayment: 'Prepayment', accrued_sales: 'Accrued income', after_date_cost: 'Search for unrecorded liabilities', provision: 'Provision' });
    expect(TYPES).toEqual(['prepayment', 'accrued_sales', 'after_date_cost', 'provision']);
    expect(Object.keys(SCHEDULE_DECISIONS.prepayment)).toEqual(['add', 'not']);
    expect(Object.keys(SCHEDULE_DECISIONS.accrued_sales)).toEqual(['add', 'not']);
    expect(Object.keys(SCHEDULE_DECISIONS.after_date_cost)).toEqual(['accrue', 'creditor', 'not_liability']);
    // A provision is provide or not: no amount is part of it, and moving a credit balance to creditors is not a provision decision
    expect(Object.keys(SCHEDULE_DECISIONS.provision)).toEqual(['provide', 'no_provision']);
  });
});

describe("validating the AI's answer before the gate", () => {
  it.each(TYPES)('%s: takes its own decisions with a confidence from 0 to 100, and nothing else', (type) => {
    const own = Object.keys(SCHEDULE_DECISIONS[type])[0];
    expect(scheduleProposal(type, { classification: own, confidence: 0, summary: 's' })).toMatchObject({ value: own, confidence: 0, reason: 's' });
    expect(scheduleProposal(type, { classification: own, confidence: 100 })).toMatchObject({ value: own, confidence: 100 });
    for (const confidence of [101, -1, NaN, Infinity, '90', null, undefined]) expect(scheduleProposal(type, { classification: own, confidence })).toBeNull();
    // Another schedule's decision, a mapping-style answer, or an object key that is not a decision
    const foreign = type === 'after_date_cost' ? 'add' : 'accrue';
    for (const classification of [foreign, 'creditors', 'Expense', 'toString', '', 5, undefined]) expect(scheduleProposal(type, { classification, confidence: 90 })).toBeNull();
  });
});

describe('the confidence gate, on every schedule type', () => {
  it.each(TYPES)('%s: bands the confidence with the practice thresholds and leaves an invalid answer for a person', (type) => {
    const own = Object.keys(SCHEDULE_DECISIONS[type])[0];
    const g = (confidence: unknown, classification: unknown = own) => gateSchedule(FIRM, clientId, type, 'Acme Ltd', { classification, confidence });
    expect(g(95)).toEqual({ classification: own, confidence: 95, gate: 'ready', source: 'ai', supplier: 'Acme Ltd' });
    expect(g(80)).toMatchObject({ classification: own, gate: 'check', source: 'ai' });
    expect(g(40)).toMatchObject({ classification: own, gate: 'exception', source: 'ai' });
    expect(g(140)).toEqual({ classification: null, confidence: 0, gate: 'exception', source: 'none', supplier: 'Acme Ltd' });
    expect(g(95, 'Expense')).toMatchObject({ classification: null, gate: 'exception', source: 'none' });
    // The practice's own thresholds are the ones Mapping uses (firm.settings.gate), kept per output type
    const firm = db.firms.find((f) => f.id === FIRM)!;
    firm.settings = { ...firm.settings, gate: { [type]: { ready: 75 } } };
    expect(g(80).gate).toBe('ready');
    expect(gateFor(FIRM, 'mapping', 80)).toBe('check');
  });
});

describe('learning from a decision on a schedule line', () => {
  it('logs the decision once and learns a client rule for the supplier, which is the suggestion on the next line from that supplier', () => {
    const wp = paper('C-20', { prepayments: [prep('prep_1', 'Acme Ltd', read('Acme Ltd', 'add', 93))] });
    decide(wp, 'prepayments', 'prep_1', 'add');

    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ firm_id: FIRM, engagement_id: engId, output_type: 'prepayment', item_ref: 'prep_1', confidence: 93, outcome: 'accepted', model_version: 'm', decided_by: 'usr_admin', decided_by_name: 'Admin' });
    expect(logs()[0].inputs_used).toBe('Acme Ltd · Annual licence. AI suggested: Add as prepayment. Decided: Add as prepayment.');
    expect(rules()).toHaveLength(1);
    expect(rules()[0]).toMatchObject({ firm_id: FIRM, client_id: clientId, type: 'prepayment', scope: 'client', supplier_name: 'Acme Ltd', pattern: 'supplier:acme ltd', target_value: 'add', active: true, created_by: 'usr_admin', explanation: 'Acme Ltd: Add as prepayment' });
    expect(db.audit_logs.some((a) => a.action === 'CREATE_RULE' && a.entity_id === rules()[0].id && a.actor_id === 'usr_admin')).toBe(true);

    // Next time the rule comes first, whatever the AI reads, and its use is counted. Matching ignores case and spacing
    const next = gateSchedule(FIRM, clientId, 'prepayment', '  ACME   ltd ', { classification: 'not', confidence: 60 });
    expect(next).toMatchObject({ classification: 'add', confidence: 100, gate: 'ready', source: 'rule', rule_id: rules()[0].id });
    expect(rules()[0].times_used).toBe(1);
    // What the AI itself read is kept beside the rule's answer, to compare
    expect(next).toMatchObject({ ai_classification: 'not', ai_confidence: 60 });
  });

  it('keeps a rule to its own schedule and its own client, and away from Mapping', () => {
    const wp = paper('C-20', { prepayments: [prep('prep_1', 'Acme Ltd', read('Acme Ltd', 'add', 93))] });
    decide(wp, 'prepayments', 'prep_1', 'not');
    const ai = { classification: 'add', confidence: 95 };
    expect(gateSchedule(FIRM, clientId, 'prepayment', 'Acme Ltd', ai)).toMatchObject({ classification: 'not', source: 'rule' });
    // The same supplier on accrued income shares the decision ids 'add' and 'not', and still does not get the rule
    expect(gateSchedule(FIRM, clientId, 'accrued_sales', 'Acme Ltd', ai)).toMatchObject({ classification: 'add', source: 'ai' });
    expect(gateSchedule(FIRM, clientId, 'after_date_cost', 'Acme Ltd', { classification: 'accrue', confidence: 95 })).toMatchObject({ classification: 'accrue', source: 'ai' });
    expect(gateSchedule(FIRM, clientId, 'provision', 'Acme Ltd', { classification: 'provide', confidence: 95 })).toMatchObject({ classification: 'provide', source: 'ai' });
    expect(gateSchedule(FIRM, 'another_client', 'prepayment', 'Acme Ltd', ai)).toMatchObject({ classification: 'add', source: 'ai' });
    expect(gateSchedule(FIRM, clientId, 'prepayment', 'Acme Holdings', ai)).toMatchObject({ classification: 'add', source: 'ai' });
    expect(findRule(FIRM, 'mapping', ['supplier:acme ltd'], { clientId })).toBeUndefined();
  });

  it("records an override as edited, and the rule follows the person's last decision without a second rule", () => {
    const wp = paper('C-20', { prepayments: [prep('prep_1', 'Acme Ltd', read('Acme Ltd', 'add', 93))] });
    decide(wp, 'prepayments', 'prep_1', 'not');
    expect(logs()[0]).toMatchObject({ outcome: 'edited', confidence: 93 });
    expect(logs()[0].inputs_used).toContain('AI suggested: Add as prepayment. Decided: Not a prepayment.');
    expect(rules()[0]).toMatchObject({ target_value: 'not' });

    // A later line from the supplier arrives with the rule's suggestion; the person overrides the rule
    const ruled = read('Acme Ltd', 'add', 99);
    expect(ruled).toMatchObject({ classification: 'not', source: 'rule' });
    save(wp, { prepayments: [...db.workpapers.find((w) => w.id === wp)!.data_json.prepayments, prep('prep_2', 'Acme Ltd', ruled)] });
    decide(wp, 'prepayments', 'prep_2', 'add');
    expect(rules()).toHaveLength(1);
    expect(rules()[0]).toMatchObject({ target_value: 'add', active: true });
    expect(db.audit_logs.filter((a) => a.action === 'UPDATE_RULE')).toHaveLength(1);
    expect(logs()).toHaveLength(2);
    // A rule's suggestion is logged against the rules engine, with the rule named
    expect(logs()[1]).toMatchObject({ item_ref: 'prep_2', outcome: 'edited', confidence: 100, model_version: 'rules-patterns-v1' });
    expect(logs()[1].inputs_used).toContain(`Rule ${rules()[0].id} suggested: Not a prepayment. AI read: Add as prepayment, 99% sure. Decided: Add as prepayment.`);
  });

  it('is idempotent: undoing and deciding again, or saving anything else, records nothing twice', () => {
    const wp = paper('C-20', { prepayments: [prep('prep_1', 'Acme Ltd', read('Acme Ltd', 'add', 93)), prep('prep_2', 'Acme Ltd', read('Acme Ltd', 'add', 91))] });
    decide(wp, 'prepayments', 'prep_1', 'add');
    const audits = () => db.audit_logs.filter((a) => a.entity === 'learned_rules').length;
    const [ruleAudits, rule] = [audits(), { ...rules()[0] }];

    decide(wp, 'prepayments', 'prep_1', undefined);
    decide(wp, 'prepayments', 'prep_1', 'add');
    save(wp, { min_p: '5000' });
    save(wp, { prepayments: db.workpapers.find((w) => w.id === wp)!.data_json.prepayments.map((l: any) => ({ ...l, end: day(200) })) });
    expect(logs()).toHaveLength(1);
    // The second line agrees with the rule the first one made: it is logged as its own decision, and the rule is left as it is
    decide(wp, 'prepayments', 'prep_2', 'add');
    expect(logs().map((r) => r.item_ref)).toEqual(['prep_1', 'prep_2']);
    expect(rules()).toEqual([rule]);
    expect(audits()).toBe(ruleAudits);
  });

  it('learns nothing from a line the gate has not seen, or a decision that came back under a new id', () => {
    const legacy = { from: '', to: '', summary: 'An earlier reading, before suggestions.' };
    const wp = paper('C-20', { prepayments: [prep('prep_unread', 'Acme Ltd'), prep('prep_legacy', 'Acme Ltd', legacy)], accrued_income: [] });
    decide(wp, 'prepayments', 'prep_unread', 'add');
    decide(wp, 'prepayments', 'prep_legacy', 'not');
    // A new search after a pull brings a decided line back under a new id, in one save
    save(wp, { accrued_income: [prep('acc_new_id', 'Brightside', read('Brightside', 'add', 95, 'accrued_sales'), { decision: 'add' })] });
    expect(logs()).toEqual([]);
    expect(rules()).toEqual([]);
  });

  it('logs a decision with no supplier but makes no rule from it, and learns from a decision the AI had no answer for', () => {
    const none = read('Globex', 'not a decision', 95);
    expect(none).toMatchObject({ classification: null, gate: 'exception', source: 'none' });
    // A name of only spaces is no supplier either
    const wp = paper('C-20', { prepayments: [prep('prep_1', '', read('', 'add', 95)), prep('prep_2', 'Globex', none), prep('prep_3', ' ', read(' ', 'add', 95))] });
    decide(wp, 'prepayments', 'prep_1', 'add');
    decide(wp, 'prepayments', 'prep_2', 'add');
    decide(wp, 'prepayments', 'prep_3', 'add');
    // Only the second had no AI output to judge; only the second has a supplier to know the next one by
    expect(logs().map((r) => r.item_ref)).toEqual(['prep_1', 'prep_3']);
    expect(rules().map((r) => r.pattern)).toEqual(['supplier:globex']);
  });

  it('a rule whose target is no longer one of the schedule decisions suggests nothing', () => {
    const wp = paper('C-20', { prepayments: [prep('prep_1', 'Acme Ltd', read('Acme Ltd', 'add', 93))] });
    decide(wp, 'prepayments', 'prep_1', 'add');
    rules()[0].target_value = 'C-20 Prepayments';
    expect(gateSchedule(FIRM, clientId, 'prepayment', 'Acme Ltd', { classification: 'add', confidence: 95 })).toMatchObject({ classification: null, gate: 'exception', source: 'rule' });
  });

  it('leaves a rule switched off in settings switched off, whatever is decided next', () => {
    const wp = paper('C-20', { prepayments: [prep('prep_1', 'Acme Ltd', read('Acme Ltd', 'add', 93)), prep('prep_2', 'Acme Ltd', read('Acme Ltd', 'add', 91))] });
    decide(wp, 'prepayments', 'prep_1', 'add');
    rules()[0].active = false;
    expect(gateSchedule(FIRM, clientId, 'prepayment', 'Acme Ltd', { classification: 'not', confidence: 95 })).toMatchObject({ classification: 'not', source: 'ai' });
    decide(wp, 'prepayments', 'prep_2', 'not');
    expect(rules()).toHaveLength(1);
    expect(rules()[0]).toMatchObject({ active: false, target_value: 'add' });
    expect(db.audit_logs.filter((a) => a.action === 'UPDATE_RULE')).toHaveLength(0);
    // The decision itself is still on record
    expect(logs()).toHaveLength(2);
  });

  it('takes only a rule for one named supplier as a suggestion: not a wildcard, and not a supplier rule that runs on every client', () => {
    const rule = (more: object) => db.learned_rules.push({ id: `rule_${db.learned_rules.length}`, firm_id: FIRM, client_id: clientId, type: 'prepayment', scope: 'client', pattern: 'supplier:acme ltd', target_value: 'not', created_by: 'usr_x', created_by_name: 'X', created_at: '', times_used: 0, active: true, ...more } as any);
    const ai = { classification: 'add', confidence: 95 };
    rule({ pattern: 'supplier:*' });
    expect(gateSchedule(FIRM, clientId, 'prepayment', 'Acme Ltd', ai)).toMatchObject({ classification: 'add', source: 'ai' });
    db.learned_rules = [];
    rule({ scope: 'supplier', client_id: null, supplier_name: 'Acme Ltd' });
    expect(gateSchedule(FIRM, clientId, 'prepayment', 'Acme Ltd', ai)).toMatchObject({ classification: 'add', source: 'ai' });
    expect(db.learned_rules[0].times_used).toBe(0);
    db.learned_rules = [];
    rule({});
    expect(gateSchedule(FIRM, clientId, 'prepayment', 'Acme Ltd', ai)).toMatchObject({ classification: 'not', source: 'rule' });
  });

  it('measures each schedule on its own in the accuracy report', () => {
    const wp = paper('C-20', {
      prepayments: [prep('prep_1', 'Acme Ltd', read('Acme Ltd', 'add', 93)), prep('prep_2', 'Globex', read('Globex', 'add', 72))],
      accrued_income: [prep('acc_1', 'Brightside', read('Brightside', 'add', 95, 'accrued_sales'))],
    });
    decide(wp, 'prepayments', 'prep_1', 'add');
    decide(wp, 'prepayments', 'prep_2', 'not');
    decide(wp, 'accrued_income', 'acc_1', 'add');
    expect(accuracy(FIRM, 'prepayment', engId)).toMatchObject({ decided: 2, accepted_unchanged: 1, edited: 1, rate: 50 });
    expect(accuracy(FIRM, 'accrued_sales', engId)).toMatchObject({ decided: 1, accepted_unchanged: 1, rate: 100 });
    expect(accuracy(FIRM, 'mapping', engId).decided).toBe(0);
    expect(rules('accrued_sales')).toHaveLength(1);
    expect(rules('prepayment')).toHaveLength(2);
  });
});

describe('the search for unrecorded liabilities, end to end', () => {
  beforeEach(() => {
    db.transactions = db.transactions.filter((t) => t.engagement_id !== engId);
    db.account_mappings.push({ id: 'm_pur', engagement_id: engId, source_code: 'PUR', source_name: 'Purchases', source_type: 'Direct Costs', balance_p: '0', blynt_code: '2000', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null } as any);
    const tx = (id: string, contact: string, date: string) => db.transactions.push({ id, engagement_id: engId, account_code: 'PUR', account_name: 'Purchases', date, contact, description: 'Goods', amount_p: '500000', vat_p: '0', gross_p: '500000', source: 'Xero' } as any);
    tx('tx_a', 'Booker', day(3));
    tx('tx_b', 'Zen Internet', day(5));
  });

  it('reads, gates, takes the decision, learns, and suggests from the rule on the next read', async () => {
    run.mockResolvedValue({
      output: {
        items: [
          { id: 'srch_tx_a', covers_from: '', covers_to: '', summary: 'Delivered before the period end.', classification: 'accrue', confidence: 95 },
          { id: 'srch_tx_b', covers_from: '', covers_to: '', summary: 'Cannot be told.', classification: 'not_liability', confidence: 55 },
        ],
      },
      provider: 'anthropic',
      model: 'claude-test',
    });
    const first = await reviewAfterDateCosts(actor, engId, { days: 60, min_p: '10000' });
    // Supplier held apart from the description, so a rule can be matched on it
    expect(first.items).toMatchObject([
      { id: 'srch_tx_a', classification: 'accrue', confidence: 95, gate: 'ready', source: 'ai', supplier: 'Booker', model: 'claude-test' },
      { id: 'srch_tx_b', classification: 'not_liability', confidence: 55, gate: 'exception', source: 'ai', supplier: 'Zen Internet' },
    ]);
    // The task classifies into this schedule's own decisions
    expect(run.mock.calls[0][0].schema.properties.items.items.properties.classification.enum).toEqual(['accrue', 'creditor', 'not_liability']);

    // The screen keeps each reading on its line; the person accepts one and overrides the other
    const items = first.items.map(({ id, ...ai }) => ({ id, date: day(3), contact: ai.supplier, desc: 'Goods', amount_p: '500000', code: '2000', ai }));
    const wp = paper('K-10', { search: { items } });
    const setItem = (id: string, decision: string) => save(wp, { search: { items: db.workpapers.find((w) => w.id === wp)!.data_json.search.items.map((i: any) => (i.id === id ? { ...i, decision } : i)) } });
    setItem('srch_tx_a', 'accrue');
    setItem('srch_tx_b', 'creditor');
    expect(logs()).toMatchObject([
      { output_type: 'after_date_cost', item_ref: `${day(3)}|Booker|Goods|500000`, outcome: 'accepted', confidence: 95, model_version: 'claude-test' },
      { output_type: 'after_date_cost', item_ref: `${day(3)}|Zen Internet|Goods|500000`, outcome: 'edited', confidence: 55 },
    ]);
    // The supplier is named in the log, as this schedule keeps it apart from the description
    expect(logs()[0].inputs_used).toBe('Booker · Goods. AI suggested: Accrue. Decided: Accrue.');
    expect(rules('after_date_cost').map((r) => [r.pattern, r.target_value])).toEqual([['supplier:booker', 'accrue'], ['supplier:zen internet', 'creditor']]);

    // The same suppliers on a later read: the rules answer, the AI's own classification is not used, and each use is counted
    const again = await reviewAfterDateCosts(actor, engId, { days: 60, min_p: '10000' });
    expect(again.items).toMatchObject([
      { id: 'srch_tx_a', classification: 'accrue', confidence: 100, gate: 'ready', source: 'rule' },
      { id: 'srch_tx_b', classification: 'creditor', confidence: 100, gate: 'ready', source: 'rule' },
    ]);
    expect(rules('after_date_cost').map((r) => r.times_used)).toEqual([1, 1]);
    // A rule suggests; it does not decide. Nothing on the paper changed by reading again
    expect(db.workpapers.find((w) => w.id === wp)!.data_json.search.items.map((i: any) => i.decision)).toEqual(['accrue', 'creditor']);
    expect(logs()).toHaveLength(2);

    // A pull from Xero renumbers the rows, so a new search brings the lines back under new ids. Changing a decision then is not a second log row
    const moved = () => db.workpapers.find((w) => w.id === wp)!.data_json.search.items.map((i: any) => ({ ...i, id: i.id.replace('srch_tx_', 'srch_tx_new_') }));
    save(wp, { search: { items: moved() } });
    setItem('srch_tx_new_a', undefined as any);
    setItem('srch_tx_new_a', 'creditor');
    expect(logs()).toHaveLength(2);
    expect(rules('after_date_cost').map((r) => r.target_value)).toEqual(['creditor', 'creditor']);
  });

  it('is never Ready on a line two models classified differently', async () => {
    const answer = (a: string, b: string) => ({ items: [{ id: 'srch_tx_a', covers_from: '', covers_to: '', summary: 's', classification: a, confidence: 95 }, { id: 'srch_tx_b', covers_from: '', covers_to: '', summary: 's', classification: b, confidence: 95 }] });
    run.mockResolvedValue({ output: answer('accrue', 'accrue'), second: { provider: 'openai', model: 'o', output: answer('accrue', 'not_liability') }, agreement: false, provider: 'anthropic', model: 'm' });
    const out = await reviewAfterDateCosts(actor, engId, { days: 60, min_p: '10000' });
    expect(out.items).toMatchObject([{ id: 'srch_tx_a', classification: 'accrue', confidence: 95, gate: 'ready' }, { id: 'srch_tx_b', classification: 'accrue', confidence: 89, gate: 'check' }]);
  });
});

describe('provision: learning never sets an amount', () => {
  const line = () => db.workpapers.find((w) => w.id === 'wp_C-10')!.data_json.lines[0];
  beforeEach(() => {
    paper('C-10', { basis: 'due', lines: [{ id: 'deb_1', desc: 'Highway Stops Retail Ltd', current_p: '0', d30_p: '0', d60_p: '0', d90_p: '307014', after_date_p: '7014' }] });
  });

  it('gates whether to provide, keeps the amount as the AI suggestion, and leaves the paper alone', async () => {
    run.mockResolvedValue({ output: { percent: 40, reason: 'Long overdue, little paid since.', confidence: 88 }, provider: 'anthropic', model: 'm' });
    const out = await suggestProvision(actor, engId, 'C-10', 'deb_1');
    expect(out).toMatchObject({ percent: 40, amount_p: '120000', classification: 'provide', confidence: 88, gate: 'check', source: 'ai', supplier: 'Highway Stops Retail Ltd' });
    expect(line().decision).toBeUndefined();
    expect(line().provision_p).toBeUndefined();
    // A confidence outside 0 to 100 is no proposal: the percentage is still shown, with nothing Ready about it
    run.mockResolvedValue({ output: { percent: 40, reason: 'x', confidence: 400 }, provider: 'anthropic', model: 'm' });
    expect(await suggestProvision(actor, engId, 'C-10', 'deb_1')).toMatchObject({ percent: 40, amount_p: '120000', classification: null, gate: 'exception', source: 'none' });
  });

  it('learns provide or not for the customer, never the amount, and a rule does not provide by itself', async () => {
    run.mockResolvedValue({ output: { percent: 40, reason: 'Long overdue, little paid since.', confidence: 88 }, provider: 'anthropic', model: 'm' });
    const ai = await suggestProvision(actor, engId, 'C-10', 'deb_1');
    // Asking saves nothing. The answer goes on the line with the decision, when the person provides an amount of their own
    expect(line().ai).toBeUndefined();
    save('wp_C-10', { lines: [{ ...line(), ai, decision: 'provide', provision_p: '50000', provision_reason: 'Custom amount of £3,000.00 still due' }] });

    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ output_type: 'provision', item_ref: 'deb_1', outcome: 'accepted', confidence: 88 });
    // The AI's figure and the person's are both on record, to compare
    expect(logs()[0].inputs_used).toBe('Highway Stops Retail Ltd. AI suggested: Provide at 40% (£1,200.00). Decided: Provide (£500.00).');
    expect(rules()).toHaveLength(1);
    expect(rules()[0]).toMatchObject({ type: 'provision', scope: 'client', client_id: clientId, supplier_name: 'Highway Stops Retail Ltd', target_value: 'provide' });
    expect(JSON.stringify(rules()[0])).not.toMatch(/50000|120000|£/);

    // Next year the customer is back, undecided. The rule says provide; the AI now reads 0%
    save('wp_C-10', { lines: [{ ...line(), decision: undefined, provision_p: undefined, ai: undefined }] });
    run.mockResolvedValue({ output: { percent: 0, reason: 'Paid in full since.', confidence: 97 }, provider: 'anthropic', model: 'm' });
    const next = await suggestProvision(actor, engId, 'C-10', 'deb_1');
    expect(next).toMatchObject({ classification: 'provide', gate: 'ready', source: 'rule', percent: 0, amount_p: '0', ai_classification: 'no_provision', ai_confidence: 97 });
    // Ready, from a rule, and still nothing is decided or provided until a person does it
    expect(line().decision).toBeUndefined();
    expect(line().provision_p).toBeUndefined();
    expect(logs()).toHaveLength(1);
  });

  it('is never Ready when two models disagree on whether to provide', async () => {
    run.mockResolvedValue({ output: { percent: 40, reason: 'r', confidence: 96 }, second: { provider: 'openai', model: 'o', output: { percent: 0, reason: 'r', confidence: 90 } }, agreement: false, provider: 'anthropic', model: 'm' });
    expect(await suggestProvision(actor, engId, 'C-10', 'deb_1')).toMatchObject({ classification: 'provide', confidence: 89, gate: 'check' });
    run.mockResolvedValue({ output: { percent: 40, reason: 'r', confidence: 96 }, second: { provider: 'openai', model: 'o', output: { percent: 60, reason: 'r', confidence: 90 } }, agreement: false, provider: 'anthropic', model: 'm' });
    expect(await suggestProvision(actor, engId, 'C-10', 'deb_1')).toMatchObject({ classification: 'provide', confidence: 96, gate: 'ready' });
  });

  it('does not treat moving a credit balance to creditors as a provision decision', () => {
    const ai = { percent: 0, amount_p: '0', reason: 'x', ...gateSchedule(FIRM, clientId, 'provision', 'Highway Stops Retail Ltd', { classification: 'no_provision', confidence: 95 }) };
    save('wp_C-10', { lines: [{ ...line(), ai }] });
    save('wp_C-10', { lines: [{ ...line(), decision: 'creditors' }] });
    expect(logs()).toEqual([]);
    expect(rules()).toEqual([]);
  });
});
