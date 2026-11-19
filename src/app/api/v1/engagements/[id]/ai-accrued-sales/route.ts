import { syncIn } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { reviewAccruedSales } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/** The AI's reading of sales the accrued income search found: { ids }. Nothing is saved. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireEngagementAccess(req, id);
    const body = await req.json().catch(() => ({}));
    return jsonResponse(await reviewAccruedSales(actor, id, { ids: Array.isArray(body?.ids) ? body.ids.map(String) : [] }));
  } catch (err) {
    return errorResponse(err);
  }
}
