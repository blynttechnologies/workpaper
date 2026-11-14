import { NextResponse } from 'next/server';
import { syncIn } from '@/lib/server/store';
import { errorResponse, getActorFromRequest } from '@/lib/server/api-helpers';
import { requireAiAdmin, toCsv } from '@/lib/server/ai/admin';
import { listRequests } from '@/lib/server/ai/usage';

export const dynamic = 'force-dynamic';

/** The practice's AI request log as CSV (?days=, default 90). */
export async function GET(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    requireAiAdmin(actor);
    const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 90, 1), 2200);
    const rows = await listRequests(actor.firmId, new Date(Date.now() - days * 86_400_000).toISOString(), 100_000);
    return new NextResponse(toCsv(rows), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ai-requests-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
