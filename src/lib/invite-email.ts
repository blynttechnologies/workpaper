/** The invitation email: a short welcome, the role, and the one-time link. Used by the server and the Add staff dialog. */
export function inviteEmail(name: string, role: string, link: string, firm?: string) {
  const origin = link ? new URL(link).origin : '';
  return {
    subject: `You're invited to Blynt Workpapers${firm ? ` at ${firm}` : ''}`,
    body: [
      `Hi ${name},`,
      '',
      `You have been given access to Blynt Workpapers${firm ? ` at ${firm}` : ''} as ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}.`,
      '',
      'Use this link to set your password and sign in. It works once and expires in 7 days:',
      link,
      '',
      `After that, sign in any time at ${origin}/login with this email address.`,
      '',
      'Please do not forward this email.',
    ].join('\n'),
  };
}

/** The password-reset email: a one-time link that expires in an hour. */
export function resetEmail(name: string, link: string) {
  const origin = link ? new URL(link).origin : '';
  return {
    subject: 'Reset your Blynt Workpapers password',
    body: [
      `Hi ${name},`,
      '',
      'We received a request to reset your Blynt Workpapers password. Use this link to set a new one. It works once and expires in one hour:',
      link,
      '',
      `If you did not ask for this, ignore this email and your password stays the same. You can still sign in at ${origin}/login.`,
      '',
      'Please do not forward this email.',
    ].join('\n'),
  };
}
