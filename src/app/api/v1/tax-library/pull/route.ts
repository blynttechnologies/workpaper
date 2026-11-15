import { syncIn } from '@/lib/server/store';
import { errorResponse, getActorFromRequest, jsonResponse } from '@/lib/server/api-helpers';
import { ServiceError } from '@/lib/server/services';
import { HAND_CHECK, pullTaxFigures } from '@/lib/server/tax-pull';

export const dynamic = 'force-dynamic';

// Reads the current figures from GOV.UK beside the library's; changes nothing (a person adds any that differ)
export async function POST(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    if (!['manager', 'partner', 'admin'].includes(actor.role)) throw new ServiceError('Only a manager or above can pull figures from GOV.UK.', 403, 'FORBIDDEN');
    const figures = await pullTaxFigures(fetch, actor.firmId);
    return jsonResponse({ pulled_at: new Date().toISOString(), figures, hand_check: HAND_CHECK });
  } catch (err) {
    return errorResponse(err);
  }
}
