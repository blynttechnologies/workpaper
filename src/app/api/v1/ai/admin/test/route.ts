import { syncIn } from '@/lib/server/store';
import { errorResponse, getActorFromRequest, jsonResponse } from '@/lib/server/api-helpers';
import { requireAiAdmin } from '@/lib/server/ai/admin';
import { testProvider } from '@/lib/server/ai/gateway';
import { PROVIDER_IDS, type ProviderId } from '@/lib/server/ai/types';

export const dynamic = 'force-dynamic';

/** Test one provider's connection with a tiny request (logged and costed like any other). Body: { provider }. */
export async function POST(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    requireAiAdmin(actor);
    const { provider } = await req.json().catch(() => ({}));
    if (!PROVIDER_IDS.includes(provider)) return jsonResponse({ error: 'Unknown provider' }, 400);
    return jsonResponse(await testProvider({ firmId: actor.firmId, userId: actor.id, channel: 'app' }, provider as ProviderId));
  } catch (err) {
    return errorResponse(err);
  }
}
