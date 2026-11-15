import { jsonResponse, errorResponse } from '@/lib/server/api-helpers';
import { autoSyncKeyOk, autoSyncXero } from '@/lib/server/xero-auto-sync';
import { freshWrite } from '@/lib/server/store';
import { learnNightly } from '@/lib/server/learning';
import { fetchTaxSources, recordTaxCheck, taxCheckDue } from '@/lib/server/tax-watch';

export const dynamic = 'force-dynamic';

// The end-of-day run: the Xero sync, then learning from the day's confirmed work. EventBridge Scheduler
// invokes the Lambda and the web adapter passes its payload here (AWS_LWA_PASS_THROUGH_PATH); the path
// is public, so the payload's key is the guard.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!autoSyncKeyOk(body?.key)) return jsonResponse({ error: 'Not allowed.' }, 403);
    const synced = await autoSyncXero();
    // After the sync, so the night's pulls keep the mappings people confirmed today
    const learned = await freshWrite(() => learnNightly());
    // Once a weekend: has GOV.UK changed a page the tax library cites?
    const taxCheck = taxCheckDue() ? await fetchTaxSources().then((r) => freshWrite(() => recordTaxCheck(r))) : null;
    return jsonResponse({ ...synced, learned, taxCheck });
  } catch (err) {
    return errorResponse(err);
  }
}
