import { db } from '@/lib/server/db';
import { freshWrite, syncIn } from '@/lib/server/store';
import { errorResponse, getActorFromRequest, jsonResponse } from '@/lib/server/api-helpers';
import { ServiceError } from '@/lib/server/services';
import { acknowledgeTaxPage, fetchTaxSources, recordTaxCheck } from '@/lib/server/tax-watch';

export const dynamic = 'force-dynamic';

// Check the GOV.UK source pages now, instead of waiting for the weekend run
export async function POST(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    if (!['manager', 'partner', 'admin'].includes(actor.role)) throw new ServiceError('Only a manager or above can run the tax source check.', 403, 'FORBIDDEN');
    const results = await fetchTaxSources();
    const summary = await freshWrite(() => recordTaxCheck(results));
    return jsonResponse({ ...summary, watch: db.firms.find((f) => f.id === actor.firmId)?.settings?.tax_watch ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

// { slug }: mark a changed page as checked
export async function PATCH(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    const { slug } = await req.json().catch(() => ({}));
    const watch = await freshWrite(() => acknowledgeTaxPage(actor, String(slug ?? '')));
    return jsonResponse({ watch });
  } catch (err) {
    return errorResponse(err);
  }
}
