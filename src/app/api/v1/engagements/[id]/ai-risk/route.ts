import { syncIn } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { riskReview } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/** Unusual balances in the trial balance against last year, for a person to check. Nothing is saved. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    return jsonResponse(await riskReview(requireEngagementAccess(req, id), id));
  } catch (err) {
    return errorResponse(err);
  }
}
