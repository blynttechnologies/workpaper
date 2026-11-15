import { syncIn } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { suggestProvision } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/** The AI's suggested bad debt provision for one customer on a debtors paper: { ref, lineId }. Nothing is saved. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireEngagementAccess(req, id);
    const body = await req.json().catch(() => ({}));
    return jsonResponse(await suggestProvision(actor, id, String(body?.ref ?? ''), String(body?.lineId ?? '')));
  } catch (err) {
    return errorResponse(err);
  }
}
