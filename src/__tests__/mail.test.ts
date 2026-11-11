import { describe, it, expect, vi, afterEach } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    send = send;
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { sendMail } from '../lib/server/mail';

afterEach(() => {
  delete process.env.MAIL_FROM;
  send.mockReset();
});

describe('sending email', () => {
  it('sends nothing when no sender is set up', async () => {
    expect(await sendMail('a@b.test', 'Hi', 'Body')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends from MAIL_FROM to the person', async () => {
    process.env.MAIL_FROM = 'Blynt Workpapers <noreply@blynt.co.uk>';
    send.mockResolvedValue({ MessageId: '1' });
    expect(await sendMail('pooma@example.test', 'Subject', 'Body')).toBe(true);
    const input = send.mock.calls[0][0].input;
    expect(input.FromEmailAddress).toBe('Blynt Workpapers <noreply@blynt.co.uk>');
    expect(input.Destination.ToAddresses).toEqual(['pooma@example.test']);
    expect(input.Content.Simple.Body.Text.Data).toBe('Body');
  });

  it('reports failure instead of throwing when SES refuses', async () => {
    process.env.MAIL_FROM = 'noreply@blynt.co.uk';
    send.mockRejectedValue(new Error('Email address is not verified'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendMail('x@y.test', 'S', 'B')).toBe(false);
  });
});
