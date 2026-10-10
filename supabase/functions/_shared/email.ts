// Gmail sending + the invoice email template.
import { bytesToBase64, env, HttpError } from "./util.ts";

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
  bcc?: string;
  attachments?: { name: string; type: string; bytes: Uint8Array }[];
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendGmail(refreshToken: string, mail: Mail): Promise<string> {
  const token = await googleAccessToken(refreshToken);
  const boundary = "wrap_" + crypto.randomUUID();
  const files = mail.attachments ?? [];
  const mixed = "wrapmix_" + crypto.randomUUID();
  const headers = [
    `From: ${displayName(mail.fromName)} <${mail.fromEmail}>`,
    `To: ${mail.to}`,
    mail.cc ? `Cc: ${mail.cc}` : "",
    mail.bcc ? `Bcc: ${mail.bcc}` : "",
    mail.replyTo ? `Reply-To: ${mail.replyTo}` : "",
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    files.length ? `Content-Type: multipart/mixed; boundary="${mixed}"` : `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  const alternative = [
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
  // With attachments: the text/HTML versions, then each file (e.g. the invoice PDF).
  const body = files.length
    ? [
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      ...alternative,
      ...files.flatMap((f) => [
        `--${mixed}`,
        `Content-Type: ${f.type}; name="${f.name.replace(/"/g, "")}"`,
        `Content-Disposition: attachment; filename="${f.name.replace(/"/g, "")}"`,
        "Content-Transfer-Encoding: base64",
        "",
        (bytesToBase64(f.bytes).match(/.{1,76}/g) ?? []).join("\r\n"),
      ]),
      `--${mixed}--`,
    ]
    : alternative;
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

// The email designs live in src/lib/emailTemplate.js (shared with the app's live preview).
// @ts-ignore: plain JS shared with the app (copied by scripts/sync-shared.mjs)
import { buildInvoiceEmail as buildInvoiceJs, buildStatementEmail as buildStatementJs } from "./web/emailTemplate.js";

type Built = { html: string; text: string };
export const buildInvoiceEmail = buildInvoiceJs as unknown as (e: Record<string, unknown>) => Built;
export const buildStatementEmail = buildStatementJs as unknown as (e: Record<string, unknown>) => Built;

/** Everything the invoice email shows, loaded fresh from the database. */
// deno-lint-ignore no-explicit-any
export async function invoiceEmailData(db: any, inv: any, profile: any, fallbackName: string) {
  const [{ data: lines }, { data: pays }, { count }, { data: client }] = await Promise.all([
    db.from("invoice_lines").select("item, description, amount").eq("invoice_id", inv.id).order("position"),
    db.from("payments").select("amount").eq("invoice_id", inv.id),
    db.from("receipts").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).not("file_key", "is", null),
    inv.client_id ? db.from("clients").select("name").eq("id", inv.client_id).single() : Promise.resolve({ data: null }),
  ]);
  const paid = (pays ?? []).reduce((t: number, p: { amount: number }) => t + Number(p.amount), 0);
  return {
    kind: inv.kind, number: inv.number, issueDate: inv.issue_date, dueDate: inv.due_date, notes: inv.notes,
    total: Number(inv.total), paid, lines: lines ?? [], receiptCount: count ?? 0, clientName: client?.name ?? null,
    accent: profile?.accent ?? "#16161A", paymentInstructions: profile?.payment_instructions ?? null,
    business: { name: profile?.business_name || fallbackName, email: profile?.business_email || null, phone: profile?.phone || null, website: profile?.website || null },
  };
}

export function shareLink(appUrl: string, token: string): string {
  return `${appUrl}/#/i/${token}`;
}
