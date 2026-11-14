import { syncIn, syncOut } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireAttachmentAccess, requireWorkpaperAccess } from '@/lib/server/api-helpers';
import { services } from '@/lib/server/services';
import { db } from '@/lib/server/db';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await syncIn();
    const params = await props.params;
    const actor = requireAttachmentAccess(req, params.id);
    const body = await req.json();
    // A paper by id, or by reference within the document's own engagement (a bare "B-10" could match another client's)
    const engagementId = db.attachments.find((a) => a.id === params.id)?.engagement_id;
    const byRef = body.target_workpaper_ref ? db.workpapers.find((w) => w.engagement_id === engagementId && w.ref === body.target_workpaper_ref)?.id : undefined;
    const targetWorkpaperId = body.targetWorkpaperId ?? byRef;

    if (!targetWorkpaperId) {
      return jsonResponse({ error: 'targetWorkpaperId is required' }, 400);
    }

    const { id: resolvedWpId } = requireWorkpaperAccess(req, targetWorkpaperId);
    const result = services.fillScheduleFromDocument(actor.firmId, actor, params.id, resolvedWpId, body.accountId);
    await syncOut();
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}
