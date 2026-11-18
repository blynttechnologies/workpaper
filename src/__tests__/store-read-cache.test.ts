// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A stand-in for the one workspace_state row, and a count of how often the whole row is fetched
const pg = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test';
  return { row: null as { version: number; stamp: string; data: unknown } | null, fullReads: 0, tick: 0 };
});

vi.mock('pg', () => ({
  Pool: class {
    async query(text: string, params: unknown[] = []) {
      if (text.includes('CREATE TABLE')) return { rows: [] };
      if (text.startsWith('SELECT version, updated_at::text AS stamp FROM')) return { rows: pg.row ? [{ version: pg.row.version, stamp: pg.row.stamp }] : [] };
      if (text.includes('data::text AS json')) {
        pg.fullReads++;
        return { rows: pg.row ? [{ version: pg.row.version, stamp: pg.row.stamp, json: JSON.stringify(pg.row.data) }] : [] };
      }
      if (text.includes('INSERT INTO workspace_state')) {
        if (pg.row) return { rows: [] };
        pg.row = { version: 1, stamp: `t${++pg.tick}`, data: JSON.parse(params[1] as string) };
        return { rows: [{ version: 1, stamp: pg.row.stamp }] };
      }
      if (text.includes('UPDATE workspace_state')) {
        if (!pg.row || pg.row.version !== params[2]) return { rows: [] };
        pg.row = { version: pg.row.version + 1, stamp: `t${++pg.tick}`, data: JSON.parse(params[1] as string) };
        return { rows: [{ version: pg.row.version, stamp: pg.row.stamp }] };
      }
      throw new Error(`unexpected query: ${text}`);
    }
  },
}));

import { readState, writeState } from '@/lib/server/store';

beforeEach(() => {
  pg.fullReads = 0;
});

describe('workspace read cache', () => {
  it('fetches the whole row once, then only when another save has changed it', async () => {
    expect(await readState()).toEqual({ version: 0, data: null }); // no row yet
    expect(await writeState(0, { clients: [{ id: 'c1', name: 'A' }] })).toBe(1);

    // What was just saved is served without fetching it back
    const a = await readState();
    const b = await readState();
    expect(a).toEqual({ version: 1, data: { clients: [{ id: 'c1', name: 'A' }] } });
    expect(pg.fullReads).toBe(0);

    // Each request gets its own copy: a change one handler makes and never saves does not reach the next
    (a.data!.clients[0] as { name: string }).name = 'changed, not saved';
    expect((b.data!.clients[0] as { name: string }).name).toBe('A');
    expect(((await readState()).data!.clients[0] as { name: string }).name).toBe('A');

    // Another server instance saves: the version moves on and the row is fetched again, once
    pg.row = { version: 2, stamp: 't-other', data: { clients: [{ id: 'c1', name: 'B' }] } };
    expect((await readState()).data).toEqual({ clients: [{ id: 'c1', name: 'B' }] });
    await readState();
    expect(pg.fullReads).toBe(1);

    // A row put back by hand with the same version number but another timestamp is not mistaken for the cached one
    pg.row = { version: 2, stamp: 't-restored', data: { clients: [] } };
    expect((await readState()).data).toEqual({ clients: [] });
    expect(pg.fullReads).toBe(2);
  });

  it('a save refused for a stale version drops the cache, so the next read is the saved row', async () => {
    pg.row = { version: 5, stamp: 't5', data: { clients: [{ id: 'c9' }] } };
    await readState();
    expect(await writeState(4, { clients: [] })).toBeNull();
    expect((await readState()).data).toEqual({ clients: [{ id: 'c9' }] });
    expect(pg.fullReads).toBe(2);
  });
});
