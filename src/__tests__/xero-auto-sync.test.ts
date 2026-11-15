// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, freshWrite: async (f: () => unknown) => f(), currentVersion: () => 1, hasDatabase: () => false }));
vi.mock('../lib/server/xero', async (orig) => ({ ...(await orig<typeof import('../lib/server/xero')>()), xeroTbChanged: vi.fn(), pullTrialBalance: vi.fn() }));

import { db } from '../lib/server/db';
import { myWork } from '../lib/server/signoff';
import { autoSyncKey, autoSyncKeyOk, autoSyncXero } from '../lib/server/xero-auto-sync';
import { pullTrialBalance, xeroTbChanged, XeroReconnectError } from '../lib/server/xero';

const FIRM = 'firm_blynt_uk';
const admin = { id: 'usr_admin', name: 'Dev Administrator', role: 'admin' as const, firmId: FIRM, clientIds: null };
const changed = vi.mocked(xeroTbChanged);
const pull = vi.mocked(pullTrialBalance);

function client(id: string, source: 'xero' | 'csv' = 'xero', lastChecked: string | null = null) {
  db.clients.push({ id, firm_id: FIRM, name: `Client ${id}` } as any);
  db.engagements.push({ id: `eng_${id}`, firm_id: FIRM, client_id: id, period_start: '2025-01-01', period_end: '2025-12-31', status: 'fieldwork' } as any);
  db.tb_snapshots.push({ id: `snap_${id}`, engagement_id: `eng_${id}`, source, created_at: '2026-11-01T10:00:00Z' } as any);
  db.xero_connections.push({ id: `xc_${id}`, firm_id: FIRM, client_id: id, tenant_name: id, last_synced_at: null, last_checked_at: lastChecked } as any);
}

beforeEach(() => {
  db.seed(true);
  db.xero_connections = [];
  changed.mockReset();
  pull.mockReset().mockResolvedValue({ status: 200, body: { changes: [{}, {}] } });
});

describe('the end-of-day Xero sync', () => {
  it('only answers the scheduler key', () => {
    expect(autoSyncKeyOk(autoSyncKey())).toBe(true);
    expect(autoSyncKeyOk('nope')).toBe(false);
    expect(autoSyncKeyOk(undefined)).toBe(false);
  });

  it('pulls a client whose Xero balances moved and tells the team in My work', async () => {
    client('moved');
    client('same');
    client('fromfile', 'csv');
    changed.mockImplementation(async (c) => c.id === 'xc_moved');

    const out = await autoSyncXero(Date.parse('2026-11-15T22:00:00Z'));
    expect(out).toMatchObject({ checked: 2, pulled: 'eng_moved', changes: 2 });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'xc_fromfile' }), expect.anything(), expect.anything());
    expect(db.xero_connections.find((c) => c.id === 'xc_same')?.last_checked_at).toBeTruthy();

    const item = myWork(admin).find((i) => i.kind === 'ledger_changed');
    expect(item).toMatchObject({ engagement_id: 'eng_moved', ref: 'Client moved' });
    expect(item?.detail).toContain('2 accounts changed');
  });

  it('leaves a client checked earlier the same day, and pulls one changed client a run', async () => {
    client('recent', 'xero', '2026-11-15T12:00:00Z');
    client('a');
    client('b');
    changed.mockResolvedValue(true);

    await autoSyncXero(Date.parse('2026-11-15T22:00:00Z'));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(pull).toHaveBeenCalledTimes(1);
    // The second changed client isn't marked checked, so the next run pulls it
    expect(db.xero_connections.filter((c) => !c.last_checked_at).map((c) => c.id)).toHaveLength(1);
  });

  it('asks for a reconnect when Xero refuses the connection', async () => {
    client('lost');
    changed.mockRejectedValue(new XeroReconnectError());

    await autoSyncXero(Date.parse('2026-11-15T22:00:00Z'));
    expect(db.clients.find((c) => c.id === 'lost')?.reconnect_needed).toBe(true);
    expect(myWork(admin)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reconnect', client_id: 'lost' })]));
  });
});
