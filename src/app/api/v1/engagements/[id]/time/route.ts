import { syncIn } from '@/lib/server/store';
import { jsonResponse, errorResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { ServiceError } from '@/lib/server/services';
import { db } from '@/lib/server/db';
import { heartbeat } from '@/lib/server/time-log';

/** Heartbeat from an open engagement: starts or extends the caller's time entry. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireEngagementAccess(req, id);
    const body = await req.json().catch(() => ({}));
    const entry = typeof body.entry === 'string' ? body.entry : '';
    if (!/^[A-Za-z0-9-]{8,64}$/.test(entry)) throw new ServiceError('Bad time entry id', 400, 'BAD_REQUEST');
    const eng = db.engagements.find((e) => e.id === id)!;
    const client = db.clients.find((c) => c.id === eng.client_id);
    const result = await heartbeat({
      id: entry,
      firm_id: actor.firmId,
      engagement_id: id,
      client_name: client?.name ?? 'Client',
      user_id: actor.id,
      user_name: actor.name,
    });
    return jsonResponse({ restart: result === 'restart' });
  } catch (err) {
    return errorResponse(err);
  }
}
