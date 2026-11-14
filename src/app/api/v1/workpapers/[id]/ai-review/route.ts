import { syncIn } from '@/lib/server/store';
import { errorResponse, jsonResponse, requireWorkpaperAccess } from '@/lib/server/api-helpers';
import { reviewWorkpaper } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/** AI review of one paper. Findings are added for a person to fix or dismiss; warnings and errors block sign-off as other findings do. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { actor, id } = requireWorkpaperAccess(req, (await props.params).id);
    return jsonResponse(await reviewWorkpaper(actor, id));
  } catch (err) {
    return errorResponse(err);
  }
}
