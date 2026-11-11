import { syncIn, syncOut } from '@/lib/server/store';
import { getActorFromRequest, jsonResponse, errorResponse, publicOrigin } from '@/lib/server/api-helpers';
import { db } from '@/lib/server/db';
import { createInvite } from '@/lib/server/invites';
import { canSetUpPractice } from '@/lib/server/onboarding';
import { sendMail } from '@/lib/server/mail';
import { inviteEmail } from '@/lib/invite-email';

// Open invites for the practice (no token hashes)
export async function GET(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    if (!canSetUpPractice(actor, db.firms.find((f) => f.id === actor.firmId))) {
      return jsonResponse({ error: 'Only an admin or partner can see invitations.', code: 'FORBIDDEN' }, 403);
    }
    const open = db.invites
      .filter((i) => i.firm_id === actor.firmId && !i.accepted_at)
      .map(({ token_hash: _h, ...i }) => i);
    return jsonResponse(open);
  } catch (err) {
    return errorResponse(err);
  }
}

// The invite is emailed when mail is set up; the link is always returned so the inviter can send it by hand
export async function POST(req: Request) {
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { invite, token } = createInvite(actor, body);
    await syncOut();
    const link = `${publicOrigin(req)}/invite/${token}`;
    const mail = inviteEmail(invite.name, invite.role, link, db.firms.find((f) => f.id === actor.firmId)?.name);
    const emailed = await sendMail(invite.email, mail.subject, mail.body);
    return jsonResponse({ invite, link, emailed }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
