/**
 * Email through an HTTPS API (Railway Hobby blocks SMTP ports).
 * EMAIL_PROVIDER=resend|brevo, EMAIL_API_KEY=..., EMAIL_FROM=you@yourdomain.com, EMAIL_FROM_NAME=Kingdom Command Center
 */
const provider = (process.env.EMAIL_PROVIDER ?? '').toLowerCase();
const apiKey = process.env.EMAIL_API_KEY ?? '';
const from = process.env.EMAIL_FROM ?? '';
const fromName = process.env.EMAIL_FROM_NAME ?? 'Kingdom Command Center';

export const emailConfigured = () => Boolean(apiKey && from && (provider === 'resend' || provider === 'brevo'));
export const emailInfo = () => ({ configured: emailConfigured(), provider: provider || null, from: from || null });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function emailHtml(title: string, body: string, link: string | null, button: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#15203a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #d9dfea;border-radius:8px" cellpadding="0" cellspacing="0">
<tr><td style="padding:20px 24px;border-bottom:3px solid #9a7022;font-weight:bold;font-size:15px">Kingdom Command Center</td></tr>
<tr><td style="padding:22px 24px"><p style="margin:0 0 10px;font-size:18px;font-weight:bold">${esc(title)}</p>
${body ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(body)}</p>` : ''}
${link ? `<a href="${esc(link)}" style="display:inline-block;background:#9a7022;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:5px;font-size:14px">${esc(button)}</a>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #d9dfea;font-size:12px;color:#5a6680">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Throws with a readable message when sending fails, so the delivery log shows why. */
export async function sendEmail(to: string, subject: string, text: string, html: string) {
  if (!emailConfigured()) throw new Error('Email is not set up on the server.');
  let r: Response;
  if (provider === 'resend') {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, html }),
    });
  } else {
    r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: from, name: fromName }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
    });
  }
  if (!r.ok) throw new Error(`Email provider error ${r.status}: ${(await r.text()).slice(0, 300)}`);
}
