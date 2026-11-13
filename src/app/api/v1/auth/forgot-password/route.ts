import { syncIn, syncOut } from '@/lib/server/store';
import { jsonResponse, errorResponse, publicOrigin } from '@/lib/server/api-helpers';
import { requestPasswordReset } from '@/lib/server/invites';
import { sendMail } from '@/lib/server/mail';
import { resetEmail } from '@/lib/invite-email';

// Public. Always replies { ok: true } so it can't be used to find which emails have accounts.
// shortcut: no rate limit and not constant-time, so repeated requests re-send mail and timing leaks whether an account exists; add throttling when abuse shows up.
export async function POST(req: Request) {
  try {
    await syncIn();
    const body = await req.json().catch(() => ({}));
    const reset = requestPasswordReset(String(body.email || ''));
    let devLink: string | undefined;
    if (reset) {
      await syncOut();
      const link = `${publicOrigin(req)}/reset-password?token=${reset.token}`;
      const mail = resetEmail(reset.name, link);
      await sendMail(reset.email, mail.subject, mail.body);
      // Development only: hand back the link so the flow can be tested without working mail.
      // Never in production — this endpoint is unauthenticated, so returning a link there
      // would let anyone take over any account by typing its email address.
      if (process.env.NODE_ENV !== 'production') devLink = link;
    }
    return jsonResponse(devLink ? { ok: true, devLink } : { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
