import { buildId } from '@/lib/server/build-id';

export const dynamic = 'force-dynamic';

// The build that is live now. An open page compares it with the build it loaded from (NewVersionWatch).
export function GET() {
  return Response.json({ build: buildId() }, { headers: { 'Cache-Control': 'no-store' } });
}
