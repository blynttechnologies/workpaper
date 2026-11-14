// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { services } from '../lib/server/services';
import { mergeFirmState, GuardError } from '../lib/server/state-guard';

const FIRM = 'firm_blynt_uk';
const writer = { id: 'usr_test_preparer', name: 'Writer', role: 'preparer' as const, firmId: FIRM };
const other = { id: 'usr_test_reviewer', name: 'Other', role: 'reviewer' as const, firmId: FIRM };
const admin = { id: 'usr_test_admin', name: 'Admin', role: 'admin' as const, firmId: FIRM };

beforeEach(() => db.seed(true));

function withComment() {
  const wp = db.workpapers.find((w) => w.engagement_id === 'eng_harlow_fy26')!;
  const c = services.addComment(FIRM, writer, wp.id, { type: 'comment', anchor_json: { kind: 'paper' }, body: 'Check the lease' });
  c.replies = [{ id: 'rep1', comment_id: c.id, body: 'Done', mentions: [], created_by: writer.id, created_by_name: writer.name, created_at: '2026-11-01T00:00:00Z' }];
  const before = JSON.parse(JSON.stringify(db.exportState()));
  const after = JSON.parse(JSON.stringify(before));
  const find = (s: any) => s.comments.find((x: any) => x.id === c.id);
  return { c, before, after, find };
}

describe('editing and deleting comments', () => {
  it('the writer can edit and delete their own; someone else cannot', () => {
    let t = withComment();
    t.find(t.after).body = 'Check the lease and the break clause';
    expect(() => mergeFirmState(t.before, t.after, other)).toThrow(GuardError);
    expect(() => mergeFirmState(t.before, t.after, writer)).not.toThrow();

    t = withComment();
    t.after.comments = t.after.comments.filter((x: any) => x.id !== t.c.id);
    expect(() => mergeFirmState(t.before, t.after, other)).toThrow(/Only the person who wrote/);
    expect(() => mergeFirmState(t.before, t.after, writer)).not.toThrow();
    expect(() => mergeFirmState(t.before, t.after, admin)).not.toThrow();
  });

  it('a reply is its writer’s to change; anyone may reply or set how long it is kept', () => {
    let t = withComment();
    t.find(t.after).replies = [];
    expect(() => mergeFirmState(t.before, t.after, other)).toThrow(/reply/);

    t = withComment();
    const c = t.find(t.after);
    c.keep = 'every_year';
    c.replies.push({ id: 'rep2', comment_id: c.id, body: 'Agreed', mentions: [], created_by: other.id, created_by_name: other.name, created_at: '2026-11-02T00:00:00Z' });
    expect(() => mergeFirmState(t.before, t.after, other)).not.toThrow();
  });
});

describe('comments kept for later years', () => {
  it('“also next year” comes across once, “every year” keeps coming, the rest stay behind', () => {
    const prior = db.engagements.find((e) => e.id === 'eng_harlow_fy25')!;
    const wp = db.workpapers.find((w) => w.engagement_id === prior.id)!;
    const add = (body: string, keep?: any) => Object.assign(services.addComment(FIRM, writer, wp.id, { type: 'review_note', anchor_json: { kind: 'paper' }, body }), { keep });
    add('Once more next year', 'next_year');
    const every = add('Check the director’s guarantee', 'every_year');
    every.status = 'resolved';
    add('Only this year');

    const result = services.executeRollForward(FIRM, writer, prior.id, { new_period_start: '2026-10-01', new_period_end: '2027-09-30', manager_override: true, override_reason: 'test' });
    const carried = db.comments.filter((c) => result.newWorkpapers!.some((w) => w.id === c.workpaper_id));
    expect(carried.map((c) => [c.body, c.keep, c.status])).toEqual(
      expect.arrayContaining([
        ['Once more next year', 'this_year', 'open'],
        ['Check the director’s guarantee', 'every_year', 'open'],
      ]),
    );
    expect(carried.some((c) => c.body === 'Only this year')).toBe(false);
    expect(carried.every((c) => c.carried_from === prior.period_end)).toBe(true);
  });
});
