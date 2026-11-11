import { syncIn, syncOut } from '@/lib/server/store';
import { requireEngagementAccess, jsonResponse, errorResponse } from '@/lib/server/api-helpers';
import { XeroReconnectError, bankPaymentsAfter } from '@/lib/server/xero';

// Payments out of the bank in Xero after the period end: { engagementId, days }
export async function POST(req: Request) {
  try {
    await syncIn();
    const { engagementId, days } = await req.json().catch(() => ({}));
    const actor = requireEngagementAccess(req, String(engagementId || ''));
    try {
      const out = await bankPaymentsAfter(actor, engagementId, Number(days));
      await syncOut(); // keeps a refreshed token
      return jsonResponse(out, 200);
    } catch (err) {
      if (err instanceof XeroReconnectError) await syncOut();
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
