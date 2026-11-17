import { hasDatabase, query } from './store';

/**
 * Time staff spend with a client's engagement open. The browser sends a heartbeat each minute with the
 * same entry id; the server stamps the times, so the browser cannot claim time it did not spend.
 * Kept in its own table, not the workspace, so heartbeats never collide with saves.
 */
export interface TimeEntry {
  id: string;
  firm_id: string;
  engagement_id: string;
  client_name: string;
  user_id: string;
  user_name: string;
  started_at: string;
  ended_at: string;
}

// A gap longer than this (laptop asleep, network lost) ends the entry; the browser starts a new one
export const MAX_GAP_MS = 3 * 60_000;

// Local development without a database, and tests
export const memoryEntries: TimeEntry[] = [];

async function find(id: string): Promise<TimeEntry | undefined> {
  if (!hasDatabase()) return memoryEntries.find((e) => e.id === id);
  const rows = await query<TimeEntry>('SELECT * FROM time_entries WHERE id = $1', [id]);
  return rows[0] && { ...rows[0], started_at: new Date(rows[0].started_at).toISOString(), ended_at: new Date(rows[0].ended_at).toISOString() };
}

/** Starts the entry, or extends it to now. Returns 'restart' when the entry belongs to someone else, another engagement, or went stale. */
export async function heartbeat(entry: Omit<TimeEntry, 'started_at' | 'ended_at'>, now = new Date()): Promise<'ok' | 'restart'> {
  const at = now.toISOString();
  const existing = await find(entry.id);
  if (!existing) {
    const row: TimeEntry = { ...entry, started_at: at, ended_at: at };
    if (!hasDatabase()) memoryEntries.push(row);
    else
      await query(
        'INSERT INTO time_entries (id, firm_id, engagement_id, client_name, user_id, user_name, started_at, ended_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)',
        [row.id, row.firm_id, row.engagement_id, row.client_name, row.user_id, row.user_name, at]
      );
    return 'ok';
  }
  if (existing.user_id !== entry.user_id || existing.engagement_id !== entry.engagement_id) return 'restart';
  if (now.getTime() - new Date(existing.ended_at).getTime() > MAX_GAP_MS) return 'restart';
  if (!hasDatabase()) existing.ended_at = at;
  else await query('UPDATE time_entries SET ended_at = $2 WHERE id = $1', [entry.id, at]);
  return 'ok';
}

/** A practice's entries, newest first; only one person's when userId is given. */
export async function listEntries(firmId: string, userId: string | null): Promise<TimeEntry[]> {
  if (!hasDatabase()) {
    return memoryEntries
      .filter((e) => e.firm_id === firmId && (!userId || e.user_id === userId))
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  // shortcut: newest 5000 rows only, add a date-range filter when practices outgrow it
  const rows = await query<TimeEntry>(
    'SELECT * FROM time_entries WHERE firm_id = $1 AND ($2::text IS NULL OR user_id = $2) ORDER BY started_at DESC LIMIT 5000',
    [firmId, userId]
  );
  return rows.map((r) => ({ ...r, started_at: new Date(r.started_at).toISOString(), ended_at: new Date(r.ended_at).toISOString() }));
}
