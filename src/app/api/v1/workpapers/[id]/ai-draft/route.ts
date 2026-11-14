import { syncIn } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireWorkpaperAccess } from '@/lib/server/api-helpers';
import { draftConclusion } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/** An AI draft of the paper's conclusion, kept as a draft beside the conclusion; a person writes or accepts the real one. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { actor, id } = requireWorkpaperAccess(req, (await props.params).id);
    return jsonResponse(await draftConclusion(actor, id));
  } catch (err) {
    return errorResponse(err);
  }
}
