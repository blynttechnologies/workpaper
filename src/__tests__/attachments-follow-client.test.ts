// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../lib/server/db';
import { services } from '../lib/server/services';
import { firmSlice } from '../lib/server/state-guard';
import type { Attachment } from '../lib/types/models';

/**
 * A client's files belong to the client's engagements, never to a staff member. Whenever a client moves
 * (to another staff member, or forward a year) its files go with it: none lost, none duplicated, links kept.
 */
const firmId = 'firm_blynt_uk';
const preparer = { id: 'usr_test_preparer', name: 'Test Preparer', role: 'preparer' as const };

const file = (over: Partial<Attachment>): Attachment =>
  ({
    id: 'att_x',
    engagement_id: 'eng_harlow_fy25',
    workpaper_id: null,
    file_key: 'key_x',
    filename: 'x.pdf',
    mime: 'application/pdf',
    size: 10,
    sha256: 'hash_x',
    category: 'Other',
    is_permanent: false,
    uploaded_by: preparer.id,
    uploaded_by_name: preparer.name,
    uploaded_at: '2025-06-01T09:00:00.000Z',
    links: [],
    ...over,
  }) as Attachment;

beforeEach(() => db.seed(true));

describe('a client reassigned to another staff member', () => {
  it('takes every file, with its links, to the new person and away from the old one', () => {
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id)!;
    db.attachments.push(
      file({ id: 'att_live', engagement_id: eng.id, workpaper_id: wp.id, category: 'Lease agreement', links: [{ attachment_id: 'att_live', anchor_json: { kind: 'row', table: 'schedule', row: 'row_1' } }] as any }),
      file({ id: 'att_archived', engagement_id: eng.id, workpaper_id: wp.id, archived_at: '2026-01-01T00:00:00.000Z' } as any)
    );
    const assign = (userId: string, clientIds: string[]) => {
      db.memberships.find((m) => m.user_id === userId)!.client_ids = clientIds;
    };
    const filesSeenBy = (userId: string) => (firmSlice(db.exportState() as any, firmId, userId).attachments as Attachment[]).filter((a) => a.engagement_id === eng.id);

    assign('usr_test_preparer', [eng.client_id]);
    assign('usr_test_reviewer', []);
    const before = filesSeenBy('usr_test_preparer');
    expect(before.map((a) => a.id)).toEqual(expect.arrayContaining(['att_live', 'att_archived']));
    expect(filesSeenBy('usr_test_reviewer')).toEqual([]);

    // The transfer: nothing is copied or re-uploaded, only the assignment changes
    assign('usr_test_preparer', []);
    assign('usr_test_reviewer', [eng.client_id]);
    const after = filesSeenBy('usr_test_reviewer');
    expect(after).toEqual(before); // the same files: ids, links, categories, archived state
    expect(filesSeenBy('usr_test_preparer')).toEqual([]);
  });
});

describe('a client rolled forward to the next year', () => {
  it('carries each permanent file once, on the same paper, with its links, category and archived state', () => {
    const pyWp = db.workpapers.find((w) => w.engagement_id === 'eng_harlow_fy25')!;
    db.attachments.push(
      file({ id: 'att_lease', workpaper_id: pyWp.id, filename: 'lease.pdf', category: 'Lease agreement', is_permanent: true, links: [{ attachment_id: 'att_lease', anchor_json: { kind: 'row', table: 'schedule', row: 'row_7' } }] as any }),
      file({ id: 'att_old', filename: 'old-lease.pdf', is_permanent: true, archived_at: '2025-08-01T00:00:00.000Z' } as any),
      file({ id: 'att_binned', filename: 'wrong.pdf', is_permanent: true, deleted_at: '2025-08-02T00:00:00.000Z' } as any),
      file({ id: 'att_year', filename: 'bank-statement-2025.pdf' }) // this year's evidence stays with this year
    );
    const result = services.executeRollForward(firmId, preparer, 'eng_harlow_fy25', {
      new_period_start: '2026-10-01',
      new_period_end: '2027-09-30',
      manager_override: true,
      override_reason: 'Testing that files follow the client',
    });
    const newEng = result.new_engagement.id;
    const carried = db.attachments.filter((a) => a.engagement_id === newEng && ['lease.pdf', 'old-lease.pdf', 'wrong.pdf', 'bank-statement-2025.pdf'].includes(a.filename));

    expect(carried.map((a) => a.filename).sort()).toEqual(['lease.pdf', 'old-lease.pdf']);
    const lease = carried.find((a) => a.filename === 'lease.pdf')!;
    const newWp = db.workpapers.find((w) => w.engagement_id === newEng && w.ref === pyWp.ref)!;
    expect(lease).toMatchObject({ workpaper_id: newWp.id, category: 'Lease agreement', is_permanent: true, file_key: 'key_x', sha256: 'hash_x', uploaded_by_name: preparer.name });
    expect(lease.links).toEqual([{ attachment_id: lease.id, anchor_json: { kind: 'row', table: 'schedule', row: 'row_7' } }]);
    expect((carried.find((a) => a.filename === 'old-lease.pdf') as any).archived_at).toBe('2025-08-01T00:00:00.000Z');

    // Nothing is taken from the year it came from
    expect(db.attachments.filter((a) => a.engagement_id === 'eng_harlow_fy25' && ['att_lease', 'att_old', 'att_binned', 'att_year'].includes(a.id))).toHaveLength(4);
  });
});
