import crypto from 'crypto';
import { saveFile, syncIn, syncOut } from '@/lib/server/store';
import { errorResponse, jsonResponse, getActorFromRequest, requireEngagementAccess } from '@/lib/server/api-helpers';
import { services } from '@/lib/server/services';
import { db } from '@/lib/server/db';

export async function GET(req: Request) {
  try {
    await syncIn();
    const url = new URL(req.url);
    const engagementId = url.searchParams.get('engagementId');
    if (!engagementId) {
      return jsonResponse({ error: 'engagementId query parameter is required' }, 400);
    }
    const actor = requireEngagementAccess(req, engagementId);
    const folder = url.searchParams.get('folder'); // 'current' | 'permanent'
    const scheduleRef = url.searchParams.get('scheduleRef');
    const search = url.searchParams.get('search')?.toLowerCase();

    let docs = db.attachments.filter((a) => a.engagement_id === engagementId && !a.deleted_at);

    if (folder) {
      docs = docs.filter((d) => (folder === 'permanent' ? d.is_permanent || d.folder === 'permanent' : !d.is_permanent && d.folder !== 'permanent'));
    }
    if (scheduleRef) {
      docs = docs.filter((d) => d.linked_schedule_ref === scheduleRef || (d.links || []).some((l: any) => l.anchor_json?.schedule === scheduleRef));
    }
    if (search) {
      docs = docs.filter((d) => d.filename.toLowerCase().includes(search) || (d.ai_tag && d.ai_tag.toLowerCase().includes(search)));
    }

    return jsonResponse({ documents: docs });
  } catch (err) {
    return errorResponse(err);
  }
}

// Lambda function URLs accept request bodies up to 6 MB; 4 MB leaves headroom (same as /files)
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    await syncIn();
    // The Documents page sends the file itself: store its bytes so it can be opened and read with AI
    if ((req.headers.get('content-type') || '').startsWith('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      const engagementId = String(form.get('engagement_id') || '');
      if (!(file instanceof File) || !engagementId) return jsonResponse({ error: 'A file and engagement_id are required' }, 400);
      const actor = requireEngagementAccess(req, engagementId);
      const bytes = Buffer.from(await file.arrayBuffer());
      if (!bytes.length) return jsonResponse({ error: 'The file is empty.' }, 400);
      if (bytes.length > MAX_FILE_BYTES) return jsonResponse({ error: 'Files can be up to 4 MB each.' }, 413);
      const key = `file_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      await saveFile({ id: key, mime: file.type || 'application/octet-stream', filename: file.name, sha256, bytes });
      db.uploads.push({ file_key: key, firm_id: actor.firmId, uploaded_by: actor.id, uploaded_at: new Date().toISOString() });
      const folder = form.get('folder') === 'permanent' ? 'permanent' : 'current';
      const result = services.uploadAttachment(actor.firmId, actor, engagementId, null, {
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        size: bytes.length,
        content: bytes,
        is_permanent: folder === 'permanent',
        folder,
        file_key: key,
      });
      await syncOut();
      return jsonResponse({ attachment: result, is_duplicate: (result as any).is_duplicate });
    }
    const body = await req.json();
    const { engagementId, workpaperId, filename, mime, size, content, category, is_permanent, folder } = body;

    if (!engagementId || !filename || content === undefined) {
      return jsonResponse({ error: 'engagementId, filename and content are required' }, 400);
    }

    const actor = requireEngagementAccess(req, engagementId);
    const result = services.uploadAttachment(actor.firmId, actor, engagementId, workpaperId || null, {
      filename,
      mime: mime || 'application/pdf',
      size: Number(size || 1024),
      content,
      category,
      is_permanent: !!is_permanent || folder === 'permanent',
      folder: folder || (is_permanent ? 'permanent' : 'current'),
    });

    await syncOut();
    return jsonResponse({ attachment: result, is_duplicate: (result as any).is_duplicate });
  } catch (err) {
    return errorResponse(err);
  }
}
