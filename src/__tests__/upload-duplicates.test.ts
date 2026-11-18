// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/server/db';
import { uploadToPaper } from '@/components/workpaper/parts';

beforeEach(() => {
  db.seed(true);
  // The server answers each upload with the file's hash, as /api/v1/files does
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ file_key: 'k', sha256: 'same-hash', size: 3, mime: 'text/plain' }), { status: 201 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('attaching the same file to the same row', () => {
  it('keeps one copy per row; another row, or the paper as a whole, takes its own', async () => {
    const wp = db.workpapers.find((w) => w.id === 'wp_eng_harlow_fy26_k10')!;
    const file = () => new File(['abc'], 'statement.txt', { type: 'text/plain' });
    const first = await uploadToPaper(wp, [file()], { category: 'Statement', rowId: 'sup_a' });
    expect(first.added).toHaveLength(1);
    const again = await uploadToPaper(wp, [file()], { category: 'Statement', rowId: 'sup_a' });
    expect(again.added).toHaveLength(0);
    expect(again.errors[0]).toMatch(/already on this row/);
    expect((await uploadToPaper(wp, [file()], { category: 'Statement', rowId: 'sup_b' })).added).toHaveLength(1);
    expect((await uploadToPaper(wp, [file()], { category: 'Statement', rowId: null })).added).toHaveLength(1);
    expect(db.attachments.filter((a) => a.workpaper_id === wp.id && !a.deleted_at)).toHaveLength(3);
  });
});
