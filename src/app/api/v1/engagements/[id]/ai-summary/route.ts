import { syncIn } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { summariseEngagement } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/** Engagement facts from Workpaper's rules, with a written summary when AI is available. Body: { kind: 'status' | 'exceptions' | 'management' }. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireEngagementAccess(req, id);
    const body = await req.json().catch(() => ({}));
    const kind = ['status', 'exceptions', 'management'].includes(body.kind) ? body.kind : 'status';
    return jsonResponse(await summariseEngagement(actor, id, kind));
  } catch (err) {
    return errorResponse(err);
  }
}
