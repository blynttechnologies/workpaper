import { describe, it, expect, beforeEach } from 'vitest';
import { heartbeat, listEntries, memoryEntries } from '../lib/server/time-log';

const base = { firm_id: 'f1', engagement_id: 'e1', client_name: 'Sivalis Group Ltd', user_id: 'u1', user_name: 'Sri' };
const at = (min: number) => new Date(Date.UTC(2026, 10, 17, 9, min));

describe('time log', () => {
  beforeEach(() => {
    memoryEntries.length = 0;
  });

  it('starts an entry and extends it with each heartbeat', async () => {
    expect(await heartbeat({ ...base, id: 'entry-0001' }, at(0))).toBe('ok');
    expect(await heartbeat({ ...base, id: 'entry-0001' }, at(1))).toBe('ok');
    expect(await heartbeat({ ...base, id: 'entry-0001' }, at(2))).toBe('ok');
    const [e] = await listEntries('f1', null);
    expect(e.started_at).toBe(at(0).toISOString());
    expect(e.ended_at).toBe(at(2).toISOString());
  });

  it('asks for a new entry after a long gap instead of counting it', async () => {
    await heartbeat({ ...base, id: 'entry-0001' }, at(0));
    expect(await heartbeat({ ...base, id: 'entry-0001' }, at(30))).toBe('restart');
    expect((await listEntries('f1', null))[0].ended_at).toBe(at(0).toISOString());
  });

  it("will not extend someone else's entry", async () => {
    await heartbeat({ ...base, id: 'entry-0001' }, at(0));
    expect(await heartbeat({ ...base, id: 'entry-0001', user_id: 'u2' }, at(1))).toBe('restart');
  });

  it('lists one person or the whole practice', async () => {
    await heartbeat({ ...base, id: 'entry-0001' }, at(0));
    await heartbeat({ ...base, id: 'entry-0002', user_id: 'u2', user_name: 'Ann' }, at(1));
    await heartbeat({ ...base, id: 'entry-0003', firm_id: 'f2' }, at(2));
    expect((await listEntries('f1', null)).map((e) => e.id)).toEqual(['entry-0002', 'entry-0001']);
    expect((await listEntries('f1', 'u2')).map((e) => e.id)).toEqual(['entry-0002']);
  });
});
