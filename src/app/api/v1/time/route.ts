import { syncIn } from '@/lib/server/store';
import { jsonResponse, errorResponse, getActorFromRequest, canAccessEngagement } from '@/lib/server/api-helpers';
import { listEntries } from '@/lib/server/time-log';

const MANAGER_UP = ['manager', 'partner', 'admin'];

/** Time spent on clients: managers and up see all staff, everyone else only their own. */
export async function GET(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    const all = MANAGER_UP.includes(actor.role);
    const entries = (await listEntries(actor.firmId, all ? null : actor.id)).filter((e) => canAccessEngagement(actor, e.engagement_id));
    return jsonResponse({ all, entries });
  } catch (err) {
    return errorResponse(err);
  }
}
