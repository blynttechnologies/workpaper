import { syncIn, syncOut } from '@/lib/server/store';
import { errorResponse, getActorFromRequest, jsonResponse } from '@/lib/server/api-helpers';
import { addTaxEntry, removeTaxEntry } from '@/lib/server/tax-library';

export const dynamic = 'force-dynamic';

// A practice's own dated entry: { key, value, from, to?, source, note? }
export async function POST(req: Request) {
  try {
    await syncIn();
    const entry = addTaxEntry(getActorFromRequest(req), await req.json().catch(() => ({})));
    await syncOut();
    return jsonResponse(entry, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

// ?id=
export async function DELETE(req: Request) {
  try {
    await syncIn();
    removeTaxEntry(getActorFromRequest(req), new URL(req.url).searchParams.get('id') ?? '');
    await syncOut();
    return jsonResponse({ removed: true });
  } catch (err) {
    return errorResponse(err);
  }
}
