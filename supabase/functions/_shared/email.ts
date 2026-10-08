// Gmail sending + the invoice email template.
import { env, escapeHtml, HttpError, money } from "./util.ts";

export async function googleAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new HttpError(400, "Gmail permission expired or was removed. Reconnect Gmail in Settings.");
  }
  return data.access_token;
}

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function encodeHeader(s: string): string {
  // RFC 2047 so names/subjects with any characters survive.
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
}

/** Display name for From/To: quoted when plain ASCII (so commas are safe), encoded otherwise. */
function displayName(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/(["\\])/g, "\\$1")}"` : encodeHeader(s);
}

/** Base64 body wrapped at 76 characters, safe for any length or character. */
function b64Body(s: string): string {
  return b64(s).replace(/(.{76})/g, "$1\r\n");
}

export interface Mail {
  fromName: string;
  fromEmail: string;
  to: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendGmail(refreshToken: string, mail: Mail): Promise<string> {
  const token = await googleAccessToken(refreshToken);
  const boundary = "wrap_" + crypto.randomUUID();
  const headers = [
    `From: ${displayName(mail.fromName)} <${mail.fromEmail}>`,
    `To: ${mail.to}`,
    mail.cc ? `Cc: ${mail.cc}` : "",
    mail.replyTo ? `Reply-To: ${mail.replyTo}` : "",
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  const body = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Body(mail.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Body(mail.html),
    `--${boundary}--`,
  ];
  const raw = b64url(headers.join("\r\n") + "\r\n\r\n" + body.join("\r\n"));
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(502, `Gmail refused the message: ${data?.error?.message ?? res.status}`);
  return data.id;
}

export interface EmailInvoice {
  kind: string;
  number: string;
  due_date: string | null;
  total: number;
  amountDue: number;
  link: string;
  business: string;
  accent: string;
  message: string;
  isReminder: boolean;
  overdueDays?: number;
}

export function invoiceEmail(e: EmailInvoice): { text: string; html: string } {
  const label = e.kind === "quote" ? "Quote" : "Invoice";
  const due = e.due_date
    ? new Date(e.due_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";
  const status = e.isReminder && e.overdueDays && e.overdueDays > 0
    ? `${e.overdueDays} day${e.overdueDays === 1 ? "" : "s"} past due`
    : due ? `Due ${due}` : "";
  const text = `${e.message}\n\n${label} #${e.number}\nAmount due: ${money(e.amountDue)}${status ? `\n${status}` : ""}\n\nView ${label.toLowerCase()} and download receipts:\n${e.link}\n\n— ${e.business}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f6f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f4;padding:32px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16161a">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px;font-size:15px;line-height:1.6;white-space:pre-line">${escapeHtml(e.message)}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e6e6e2;border-radius:14px;padding:28px">
<div style="font-size:13px;color:#5f6168">${label} #${escapeHtml(e.number)} from ${escapeHtml(e.business)}</div>
<div style="font-size:32px;font-weight:600;margin:6px 0 4px">${money(e.amountDue)}</div>
${status ? `<div style="font-size:14px;color:${e.isReminder && (e.overdueDays ?? 0) > 0 ? "#b42318" : "#45464d"}">${escapeHtml(status)}</div>` : ""}
<a href="${e.link}" style="display:inline-block;margin-top:22px;background:${e.accent || "#16161a"};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:10px">View ${label.toLowerCase()}</a>
<div style="margin-top:14px;font-size:12px;color:#5f6168">Download the PDF and any receipts from the link.</div>
</td></tr>
<tr><td style="padding:16px 4px;font-size:12px;color:#8a8b91">Sent by ${escapeHtml(e.business)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export function shareLink(appUrl: string, token: string): string {
  return `${appUrl}/#/i/${token}`;
}
