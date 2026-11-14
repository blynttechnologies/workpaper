import { syncIn, freshWrite } from '@/lib/server/store';
import { errorResponse, getActorFromRequest, jsonResponse, publicOrigin } from '@/lib/server/api-helpers';
import { db } from '@/lib/server/db';
import { controlCentre, parseSettings, requireAiAdmin } from '@/lib/server/ai/admin';

export const dynamic = 'force-dynamic';

/** AI Control Centre for the signed-in user's practice (partner or admin): providers, usage and cost, routing, outside assistants. */
export async function GET(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    requireAiAdmin(actor);
    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 30, 1), 366);
    return jsonResponse(await controlCentre(actor.firmId, publicOrigin(req), days));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Save AI settings. Only the parts sent are changed; every change is audited. */
export async function PUT(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    requireAiAdmin(actor);
    const update = parseSettings(await req.json().catch(() => ({})));
    await freshWrite(() => {
      const firm = db.firms.find((f) => f.id === actor.firmId);
      if (!firm) throw new Error('Practice not found');
      const before = firm.settings?.ai ?? {};
      const after = { ...before, ...update };
      firm.settings = { ...firm.settings, ai: after };
      db.logAudit(actor.firmId, actor, 'UPDATE_AI_SETTINGS', 'firms', firm.id, before, after);
    });
    return jsonResponse(await controlCentre(actor.firmId, publicOrigin(req)));
  } catch (err) {
    return errorResponse(err);
  }
}
