import { freshWrite, syncIn, syncOut } from '@/lib/server/store';
import { db } from '@/lib/server/db';
import { jsonResponse, errorResponse, requireAdjustmentAccess } from '@/lib/server/api-helpers';
import { recordXeroJournal, sendJournalToXero, xeroAccountsForJournal, XeroReconnectError } from '@/lib/server/xero';

export const dynamic = 'force-dynamic';

// A refused or expired connection is saved as "reconnect needed" before it is reported
async function failed(err: unknown) {
  if (err instanceof XeroReconnectError) await syncOut().catch(() => undefined);
  return errorResponse(err);
}

// The client's Xero accounts and a suggested one for each line of the journal
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireAdjustmentAccess(req, id);
    const { connId, tokens, ...out } = await xeroAccountsForJournal(actor, id);
    // Xero may have rotated the refresh token while reading
    await freshWrite(() => {
      const c = db.xero_connections.find((x) => x.id === connId);
      if (c) Object.assign(c, tokens);
    });
    return jsonResponse(out);
  } catch (err) {
    return failed(err);
  }
}

// { accounts: { [lineId]: xeroAccountCode }, post?: boolean } — a draft in Xero unless post is set
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const actor = requireAdjustmentAccess(req, id);
    const body = await req.json().catch(() => ({}));
    const sent = await sendJournalToXero(actor, id, { accounts: body?.accounts, post: body?.post === true });
    // Xero has the journal now: save it on the latest workspace, retrying once if someone saved meanwhile
    const j = await freshWrite(() => recordXeroJournal(actor, id, sent));
    return jsonResponse(j);
  } catch (err) {
    return failed(err);
  }
}
