import { syncIn, syncOut } from '@/lib/server/store';
import { getActorFromRequest, jsonResponse, errorResponse, publicOrigin } from '@/lib/server/api-helpers';
import { db } from '@/lib/server/db';
import { createPasswordReset } from '@/lib/server/invites';
import { sendMail } from '@/lib/server/mail';
import { resetEmail } from '@/lib/invite-email';

// The link is emailed when mail is set up, and always returned so the admin can send it by hand
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await syncIn();
    const { id } = await props.params;
    const { token, expires_at } = createPasswordReset(getActorFromRequest(req), id);
    await syncOut();
    const link = `${publicOrigin(req)}/reset-password?token=${token}`;
    const user = db.users.find((u) => u.id === id);
    const mail = resetEmail(user?.name ?? 'there', link);
    const emailed = user ? await sendMail(user.email, mail.subject, mail.body) : false;
    return jsonResponse({ link, expires_at, emailed }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
