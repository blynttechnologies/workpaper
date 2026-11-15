import { jsonResponse, errorResponse } from '@/lib/server/api-helpers';
import { autoSyncKeyOk, autoSyncXero } from '@/lib/server/xero-auto-sync';

export const dynamic = 'force-dynamic';

// The end-of-day Xero sync. EventBridge Scheduler invokes the Lambda and the web adapter passes its
// payload here (AWS_LWA_PASS_THROUGH_PATH); the path is public, so the payload's key is the guard.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!autoSyncKeyOk(body?.key)) return jsonResponse({ error: 'Not allowed.' }, 403);
    return jsonResponse(await autoSyncXero());
  } catch (err) {
    return errorResponse(err);
  }
}
