import { syncIn, syncOut } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { ServiceError } from '@/lib/server/services';
import { learnFromConfirmed } from '@/lib/server/learning';

export const dynamic = 'force-dynamic';

/** "Learn now": turns this engagement's confirmed mappings into client rules straight away, as the nightly run does. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireEngagementAccess(req, id);
    if (!['reviewer', 'manager', 'partner', 'admin'].includes(actor.role)) throw new ServiceError('Only a reviewer or above can teach Blynt from this file.', 403, 'FORBIDDEN');
    const out = learnFromConfirmed(actor.firmId, [id], actor);
    await syncOut();
    return jsonResponse(out);
  } catch (err) {
    return errorResponse(err);
  }
}
