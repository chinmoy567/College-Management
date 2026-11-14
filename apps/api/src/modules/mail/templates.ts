const wrap = (title: string, body: string, link: string) => ({
  html: `<div style="font-family:sans-serif"><h2>${title}</h2><p>${body}</p><p><a href="${link}">${link}</a></p></div>`,
  text: `${title}\n\n${body}\n\n${link}`,
});

export const verifyEmail = (link: string) =>
  ({ subject: 'Verify your email', ...wrap('Verify your email', 'Open this link to verify your email address.', link) });
export const resetPassword = (link: string) =>
  ({ subject: 'Reset your password', ...wrap('Reset your password', 'This link works once and expires in 20 minutes.', link) });
export const changeEmail = (link: string) =>
  ({ subject: 'Confirm your new email', ...wrap('Confirm your new email', 'Open this link to confirm the change. It expires in 30 minutes.', link) });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Notice / event email: the recipient's name only, no other personal data (07 §5). */
export const notificationEmail = (name: string, e: { subject: string; text: string; html?: string }) => ({
  subject: e.subject,
  text: `Hello ${name},\n\n${e.text}\n\n${process.env.APP_URL ?? ''}/notices`,
  html: `<div style="font-family:sans-serif"><p>Hello ${esc(name)},</p>${e.html ?? `<p>${esc(e.text)}</p>`}<p><a href="${process.env.APP_URL ?? ''}/notices">Open the portal</a></p></div>`,
});
