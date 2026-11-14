import { jsonResponse, errorResponse, getActorFromRequest, requireEngagementAccess } from '@/lib/server/api-helpers';
import { syncIn } from '@/lib/server/store';
import { suggestMappings } from '@/lib/server/ai/services';

export const dynamic = 'force-dynamic';

/**
 * Mapping suggestions: { items: [{ id, name, type, code, balance_p }], engagementId? } or a single { name, type, code }.
 * The auto-mapper's rules go first; accounts they cannot place are offered to the AI. Nothing is saved:
 * a suggestion changes nothing until a named user accepts it on the mapping screen.
 */
export async function POST(req: Request) {
  try {
    await syncIn();
    const body = await req.json().catch(() => ({}));
    const actor = body.engagementId ? requireEngagementAccess(req, body.engagementId) : getActorFromRequest(req);
    const items = Array.isArray(body.items)
      ? body.items.slice(0, 500).map((i: any, n: number) => ({ id: String(i.id ?? n), name: String(i.name ?? ''), type: String(i.type ?? ''), code: String(i.code ?? ''), balance_p: String(i.balance_p ?? '') }))
      : [{ id: 'single', name: String(body.name ?? ''), type: String(body.type ?? ''), code: String(body.code ?? '') }];
    const r = await suggestMappings(actor, items, 'app', { all: body.all === true, engagementId: body.engagementId ? String(body.engagementId) : undefined });
    if (!Array.isArray(body.items)) {
      const one = r.results[0];
      return jsonResponse({ label: '✦ AI suggestion', ...one, ai: r.ai, notice: 'AI output changes nothing until accepted by a named user.' });
    }
    return jsonResponse({ success: true, batch: true, count: r.results.length, ...r, notice: 'AI output changes nothing until accepted by a named user.' });
  } catch (err) {
    return errorResponse(err);
  }
}
