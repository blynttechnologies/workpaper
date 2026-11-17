import { syncIn } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { reviewAfterDateCosts } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/** The AI's reading of costs posted after the period end, for the creditors search: { days, min_p, ids? }. Nothing is saved. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireEngagementAccess(req, id);
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : undefined;
    return jsonResponse(await reviewAfterDateCosts(actor, id, { days: Number(body?.days), min_p: String(body?.min_p ?? '0'), ids }));
  } catch (err) {
    return errorResponse(err);
  }
}
