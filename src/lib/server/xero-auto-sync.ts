import crypto from 'crypto';
import { db } from './db';
import { secret } from './auth';
import { freshWrite, syncIn, syncOut } from './store';
import { canPull } from '../periods';
import { pullTrialBalance, xeroTbChanged, XeroConnection, XeroReconnectError } from './xero';

// Once a day: the scheduler runs every 10 minutes from 22:00 to 23:50 UK time, and each client is due when not seen for 20 hours
const EVERY_MS = 20 * 60 * 60_000;
const CHECK_BUDGET_MS = 60_000;

/** The key the scheduler sends, derived from the session secret so there is nothing more to configure. */
export const autoSyncKey = () => crypto.createHmac('sha256', secret()).update('xero-auto-sync').digest('hex');

export function autoSyncKeyOk(given: unknown): boolean {
  const want = Buffer.from(autoSyncKey());
  const got = Buffer.from(typeof given === 'string' ? given : '');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const system = (firmId: string) => ({ id: 'system_xero_sync', name: 'Xero auto-sync', role: 'admin' as const, firmId });

/** The engagement the client's Xero panel pulls into, when Xero fed it last and it can still change. */
function target(clientId: string) {
  const client = db.clients.find((c) => c.id === clientId);
  if (!client || client.archived_at || client.reconnect_needed) return null;
  const eng = db.engagements.filter((e) => e.client_id === clientId).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  if (!eng || eng.status === 'locked' || !canPull(eng.period_start)) return null;
  const last = db.tb_snapshots.filter((s) => s.engagement_id === eng.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  // A trial balance imported from a file was someone's choice: Xero mustn't replace it
  return last?.source === 'xero' ? eng : null;
}

const tokens = (c: XeroConnection) => ({ access_token_enc: c.access_token_enc, refresh_token_enc: c.refresh_token_enc, expires_at: c.expires_at });

/** Applies connection fields to the latest saved workspace (Xero rotates refresh tokens, so they must not be lost). */
const saveConnections = (updates: Map<string, Partial<XeroConnection>>, reconnect: string[] = []) =>
  freshWrite(() => {
    for (const [id, fields] of updates) {
      const c = db.xero_connections.find((x) => x.id === id);
      if (c) Object.assign(c, fields);
    }
    for (const id of reconnect) {
      const client = db.clients.find((c) => c.id === id);
      if (client) client.reconnect_needed = true;
    }
  });

/**
 * Checks each connected client's Xero trial balance at the end of the day (two calls) and pulls it
 * again when a balance moved, leaving a note in My work. At most one full pull a run, since one can
 * take minutes; others found changed are checked again on the next run.
 * shortcut: 12 runs a night pull at most 12 changed clients, add runs or a queue when there are more.
 */
export async function autoSyncXero(now = Date.now()) {
  const started = Date.now(); // the time budget runs from the start of this run, not from `now` (which tests set)
  await syncIn();
  const lastSeen = (c: XeroConnection) => Math.max(Date.parse(c.last_checked_at ?? '') || 0, Date.parse(c.last_synced_at ?? '') || 0);
  const due = db.xero_connections.filter((c) => now - lastSeen(c) >= EVERY_MS - 60_000).sort((a, b) => lastSeen(a) - lastSeen(b));

  const updates = new Map<string, Partial<XeroConnection>>();
  const reconnect: string[] = [];
  let toPull: { connId: string; engagementId: string; firmId: string } | null = null;
  let checked = 0;
  for (const conn of due) {
    if (Date.now() - started > CHECK_BUDGET_MS) break;
    const eng = target(conn.client_id);
    if (!eng) continue;
    const stamp = new Date().toISOString();
    try {
      const changed = await xeroTbChanged(conn, eng.id, eng.period_end);
      checked++;
      if (changed && toPull) {
        updates.set(conn.id, tokens(conn)); // not marked checked, so the next run takes it
        continue;
      }
      if (changed) toPull = { connId: conn.id, engagementId: eng.id, firmId: conn.firm_id };
    } catch (err) {
      if (err instanceof XeroReconnectError) reconnect.push(conn.client_id);
      else console.error(JSON.stringify({ blynt_error: true, where: 'xero-auto-sync', client_id: conn.client_id, message: (err as Error).message }));
    }
    updates.set(conn.id, { ...tokens(conn), last_checked_at: stamp });
  }
  if (updates.size || reconnect.length) await saveConnections(updates, reconnect);
  if (!toPull) return { checked, pulled: null, changes: 0 };

  // saveConnections left the workspace fresh, so the pull starts from the latest copy
  const { connId, engagementId, firmId } = toPull;
  try {
    const out = await pullTrialBalance(system(firmId), engagementId);
    const conn = db.xero_connections.find((c) => c.id === connId)!;
    const changes = out.status < 400 ? (out.body.changes?.length ?? 0) : 0;
    if (changes) conn.auto_sync = { at: new Date().toISOString(), engagement_id: engagementId, changes };
    await syncOut();
    return { checked, pulled: engagementId, changes };
  } catch (err) {
    const conn = db.xero_connections.find((c) => c.id === connId);
    const clientId = conn?.client_id;
    console.error(JSON.stringify({ blynt_error: true, where: 'xero-auto-sync', client_id: clientId, message: (err as Error).message }));
    // Someone saved during the pull, or Xero refused: keep the tokens and try again next run
    await saveConnections(
      new Map(conn ? [[connId, { ...tokens(conn), last_checked_at: null }]] : []),
      err instanceof XeroReconnectError && clientId ? [clientId] : []
    );
    return { checked, pulled: null, changes: 0 };
  }
}
