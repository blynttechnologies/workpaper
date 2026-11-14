import { syncIn, syncOut } from '@/lib/server/store';
import { getActorFromRequest, jsonResponse, errorResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { db } from '@/lib/server/db';
import { importTrialBalance } from '@/lib/server/tb-import';
import { ServiceError } from '@/lib/server/services';
import { canPull, mustKeep, RETENTION_YEARS } from '@/lib/periods';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await syncIn();
    const params = await props.params;
    requireEngagementAccess(req, params.id);
    const actor = getActorFromRequest(req);
    const body = await req.json();
    const out = importTrialBalance(actor, params.id, body.lines, body.source || 'csv');
    if (out.status < 400) await syncOut();
    return jsonResponse(out.body, out.status);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    await syncIn();
    const params = await props.params;
    requireEngagementAccess(req, params.id);
    const actor = getActorFromRequest(req);
    const eng = db.engagements.find((e) => e.id === params.id);
    // Past the pull window it can't be fetched again, so clearing would lose records that must be kept
    if (eng && mustKeep(eng.period_end) && !canPull(eng.period_start)) {
      throw new ServiceError(`This trial balance can't be cleared: records must be kept for ${RETENTION_YEARS} years after the year end, and this year is too old to pull again from Xero or QuickBooks.`, 409, 'RETENTION');
    }

    // Clear mappings and tb_snapshots for this engagement
    const priorCount = db.account_mappings.filter((m) => m.engagement_id === params.id).length;
    db.account_mappings = db.account_mappings.filter((m) => m.engagement_id !== params.id);
    db.tb_snapshots = db.tb_snapshots.filter((s) => s.engagement_id !== params.id);

    db.logAudit(actor.firmId, actor, 'CLEAR_TEST_DATA', 'engagements', params.id, null, {
      cleared_mappings: priorCount,
    });

    await syncOut();

    return jsonResponse({ success: true, cleared_count: priorCount });
  } catch (err) {
    return errorResponse(err);
  }
}
