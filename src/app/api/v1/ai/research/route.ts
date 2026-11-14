import { syncIn } from '@/lib/server/store';
import { errorResponse, jsonResponse, getActorFromRequest, requireEngagementAccess } from '@/lib/server/api-helpers';
import { research } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/** Accounting research from Workpaper's own sources (standards library, engagement facts). Body: { question, engagementId? }. */
export async function POST(req: Request) {
  try {
    await syncIn();
    const body = await req.json().catch(() => ({}));
    const actor = body.engagementId ? requireEngagementAccess(req, body.engagementId) : getActorFromRequest(req);
    return jsonResponse(await research(actor, String(body.question ?? '').slice(0, 4000), body.engagementId || undefined));
  } catch (err) {
    return errorResponse(err);
  }
}
