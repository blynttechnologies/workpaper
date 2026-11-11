import { describe, it, expect } from 'vitest';
import { inviteEmail } from '../lib/invite-email';

describe('invitation email', () => {
  it('greets the person, names the firm and role, and carries the link and sign-in address', () => {
    const link = 'https://app.example.com/invite/abc123';
    const { subject, body } = inviteEmail('Pooma', 'preparer', link, 'Blynt Practice');
    expect(subject).toBe("You're invited to Blynt Workpapers at Blynt Practice");
    expect(body).toContain('Hi Pooma,');
    expect(body).toContain('as a preparer');
    expect(body).toContain(link);
    expect(body).toContain('https://app.example.com/login');
  });

  it('uses "an" before a role starting with a vowel', () => {
    expect(inviteEmail('Sam', 'admin', 'https://x.test/invite/t').body).toContain('as an admin');
  });
});
