import { syncIn, freshWrite } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireAttachmentAccess } from '@/lib/server/api-helpers';
import { services } from '@/lib/server/services';
import { extractWithAi } from '@/lib/server/ai/documents';
import { db } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Read a stored document with AI (through the gateway) and keep what was read on the document. Nothing reaches a paper until filled and confirmed. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireAttachmentAccess(req, id);
    const body = await req.json().catch(() => ({}));
    const attachment = db.attachments.find((a) => a.id === id)!;
    const result = await extractWithAi(
      actor.firmId,
      { firmId: actor.firmId, userId: actor.id, channel: 'app', engagementId: attachment.engagement_id },
      { ...attachment },
      body?.overrideCategory
    );
    return jsonResponse(await freshWrite(() => services.applyExtraction(actor.firmId, actor, id, result)));
  } catch (err) {
    return errorResponse(err);
  }
}
