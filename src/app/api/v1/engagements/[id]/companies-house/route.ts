import { syncIn } from '@/lib/server/store';
import { db } from '@/lib/server/db';
import { errorResponse, jsonResponse, requireEngagementAccess } from '@/lib/server/api-helpers';
import { readCompaniesHouse } from '@/lib/server/companies-house';
import { logError } from '@/lib/server/log-error';

export const dynamic = 'force-dynamic';

/** The client's officers, PSCs and company details from the Companies House register. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  let companyNumber: string | undefined;
  try {
    await syncIn();
    requireEngagementAccess(req, id);
    const eng = db.engagements.find((e) => e.id === id);
    companyNumber = db.clients.find((c) => c.id === eng?.client_id)?.company_number;
  } catch (err) {
    return errorResponse(err);
  }
  if (!companyNumber) return jsonResponse({ error: "Add the company number on the client's details first." }, 400);
  try {
    const read = await readCompaniesHouse(companyNumber);
    if (!read) return jsonResponse({ error: "Companies House isn't connected yet: the API key is missing." }, 503);
    if (!read.found) return jsonResponse({ error: `Companies House has no company ${companyNumber}.` }, 404);
    return jsonResponse(read);
  } catch (err) {
    logError('companies-house', err);
    return jsonResponse({ error: "Companies House didn't answer. Try again in a minute." }, 502);
  }
}
