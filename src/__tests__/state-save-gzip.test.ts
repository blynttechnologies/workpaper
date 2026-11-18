// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({
  syncIn: async () => {},
  syncOut: async () => {},
  currentVersion: () => 1,
  hasDatabase: () => false,
}));

import { db } from '../lib/server/db';
import { createSessionToken, SESSION_COOKIE } from '../lib/server/auth';
import { GET, PUT } from '../app/api/v1/state/route';

const cookie = `${SESSION_COOKIE}=${createSessionToken('usr_admin')}`;
const gzip = (json: string) => new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();

beforeEach(() => {
  db.seed(true);
  process.env.MFA_REQUIRED = 'false';
});

describe('workspace save', () => {
  it('takes a gzipped save, so a file deleted in the browser stays deleted', async () => {
    const { data } = await (await GET(new Request('http://localhost/api/v1/state', { headers: { cookie } }))).json();
    const att = data.attachments[0];
    att.deleted_at = '2026-11-18T09:00:00.000Z';
    const res = await PUT(
      new Request('http://localhost/api/v1/state', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/gzip' },
        body: await gzip(JSON.stringify({ version: 1, data })),
      })
    );
    expect(res.status).toBe(200);
    expect(db.attachments.find((a) => a.id === att.id)?.deleted_at).toBe('2026-11-18T09:00:00.000Z');
  });
});
