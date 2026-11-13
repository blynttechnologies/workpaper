import { readFile, syncIn } from '@/lib/server/store';
import { canAccessFile, errorResponse, getActorFromRequest, jsonResponse } from '@/lib/server/api-helpers';
import { readStatement } from '@/lib/server/statement-reader';
import { logError } from '@/lib/server/log-error';

export const dynamic = 'force-dynamic';

/**
 * Read the balance at the year end (body: { period_end }) off an uploaded bank statement with AI, with
 * the other balances near it. `read: null` means it could not be read.
 */
export async function POST(req: Request, props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  try {
    await syncIn();
    if (!canAccessFile(getActorFromRequest(req), key)) return jsonResponse({ error: 'File not found' }, 404);
  } catch (err) {
    return errorResponse(err);
  }
  const file = await readFile(key);
  if (!file) return jsonResponse({ error: 'File not found' }, 404);
  const body = await req.json().catch(() => ({}));
  try {
    return jsonResponse({ read: await readStatement(file, typeof body?.period_end === 'string' ? body.period_end : undefined) });
  } catch (err) {
    // The file is attached either way; a failed read leaves the balance for someone to type
    logError('read-statement', err);
    return jsonResponse({ read: null });
  }
}
