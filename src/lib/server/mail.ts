import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/**
 * Sends a plain-text email through Amazon SES, from MAIL_FROM. Never throws: without MAIL_FROM,
 * or if SES refuses or is unreachable, it returns false and the caller falls back to sending by hand.
 */
let client: SESv2Client | null = null;

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const from = process.env.MAIL_FROM;
  if (!from) return false;
  try {
    client ??= new SESv2Client({ region: process.env.MAIL_REGION || process.env.AWS_REGION || 'eu-north-1' });
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
      }),
      { abortSignal: AbortSignal.timeout(8000) } // a stuck connection must not hold the request until the Lambda times out
    );
    return true;
  } catch (err) {
    console.error(JSON.stringify({ blynt_error: true, where: 'mail', message: (err as Error).message }));
    return false;
  }
}
