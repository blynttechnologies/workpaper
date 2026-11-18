import { describe, it, expect } from 'vitest';
import { rebase } from '../components/layout/WorkspaceSync';

describe('keeping unsaved edits when someone else saves first', () => {
  const base = {
    attachments: [{ id: 'att_1', filename: 'statement.pdf' }, { id: 'att_2', filename: 'other.pdf' }],
    workpapers: [{ id: 'wp_1', note: 'a' }, { id: 'wp_2', note: 'b' }],
    audit_logs: [{ id: 'aud_1' }],
    view_prefs: [{ user_id: 'u', key: 'cols', value: 1 }],
  };

  it('puts a deleted file, a changed paper and a new audit entry on top of their save', () => {
    const mine = {
      ...base,
      attachments: [{ id: 'att_1', filename: 'statement.pdf', deleted_at: '2026-11-18' }, base.attachments[1]],
      workpapers: [{ id: 'wp_1', note: 'mine' }, base.workpapers[1]],
      audit_logs: [...base.audit_logs, { id: 'aud_mine' }],
    };
    // Meanwhile someone else changed the other paper, signed in (an audit entry) and attached a file
    const theirs = {
      ...base,
      attachments: [...base.attachments, { id: 'att_3', filename: 'theirs.pdf' }],
      workpapers: [base.workpapers[0], { id: 'wp_2', note: 'theirs' }],
      audit_logs: [...base.audit_logs, { id: 'aud_theirs' }],
    };
    const out = rebase(base, mine, theirs);
    expect(out.attachments).toEqual([mine.attachments[0], base.attachments[1], theirs.attachments[2]]);
    expect(out.workpapers).toEqual([{ id: 'wp_1', note: 'mine' }, { id: 'wp_2', note: 'theirs' }]);
    expect(out.audit_logs.map((a) => a.id)).toEqual(['aud_1', 'aud_theirs', 'aud_mine']);
    expect(out.view_prefs).toBe(theirs.view_prefs); // untouched here, so theirs as it is
  });

  it('removes a row this browser removed, and changes one that has no id', () => {
    const mine = { ...base, workpapers: [base.workpapers[1]], view_prefs: [{ user_id: 'u', key: 'cols', value: 2 }] };
    const out = rebase(base, mine, base);
    expect(out.workpapers).toEqual([base.workpapers[1]]);
    expect(out.view_prefs).toEqual([{ user_id: 'u', key: 'cols', value: 2 }]);
  });
});
