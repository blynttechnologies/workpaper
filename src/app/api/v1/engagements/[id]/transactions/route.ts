import { syncIn } from '@/lib/server/store';
import { jsonResponse, errorResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { db } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// One engagement's ledger transactions, a page at a time so each response stays well under the 6 MB limit
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    requireEngagementAccess(req, id);
    const q = new URL(req.url).searchParams;
    const offset = Math.max(0, Number(q.get('offset')) || 0);
    const limit = Math.min(5000, Math.max(1, Number(q.get('limit')) || 5000));
    const all = db.transactions.filter((t) => t.engagement_id === id);
    return jsonResponse({ rows: all.slice(offset, offset + limit), total: all.length });
  } catch (err) {
    return errorResponse(err);
  }
}
