// The invoice PDF and its verification code, made on the server from the saved invoice.
// Used by the client page ("Download PDF") and by emails that attach the PDF, so both are identical.
import { admin, appUrl, r2Get } from "./util.ts";
// @ts-ignore: plain JS shared with the app (copied by scripts/sync-shared.mjs)
import { buildInvoicePdf as buildPdfJs, imageBytes, pdfFileName as pdfNameJs } from "./web/pdf.js";
const buildInvoicePdf = buildPdfJs as unknown as (opts: Record<string, unknown>) => Promise<Uint8Array>;
export const pdfFileName = pdfNameJs as unknown as (inv: Record<string, unknown>) => string;

const BIZ_FIELDS = ["business_name", "business_email", "address", "phone", "website", "template", "accent", "payment_instructions", "footer_note"];

/**
 * Short code tied to this exact version and balance of the invoice. Signed with a server-only secret,
 * so it can't be made up: the code on a PDF must match the one shown on the live link.
 */
// deno-lint-ignore no-explicit-any
export async function verifyCode(inv: any, paid: number): Promise<string> {
  const secret = Deno.env.get("VERIFY_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = `${inv.id}|${inv.version}|${Number(inv.total).toFixed(2)}|${paid.toFixed(2)}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  const hex = [...sig.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** The PDF for one invoice (inv: a full invoices row with share_token). */
// deno-lint-ignore no-explicit-any
export async function invoicePdf(db: ReturnType<typeof admin>, inv: any): Promise<{ bytes: Uint8Array; fileName: string }> {
  const [{ data: lines }, { data: client }, { data: pays }, { data: prof }] = await Promise.all([
    db.from("invoice_lines").select("item, description, note, qty, rate, amount, tax_rate, kind").eq("invoice_id", inv.id).order("position"),
    inv.client_id ? db.from("clients").select("name, email, address").eq("id", inv.client_id).single() : Promise.resolve({ data: null }),
    db.from("payments").select("paid_on, amount, method").eq("invoice_id", inv.id).order("paid_on"),
    db.from("profiles").select("*").eq("id", inv.owner_id).single(),
  ]);
  const business: Record<string, unknown> = {};
  for (const k of BIZ_FIELDS) business[k] = prof?.[k] ?? null;
  business.logo_mode = prof?.logo_mode ?? "logo";
  business.logo_preset = prof?.logo_preset ?? null;
  const paid = (pays ?? []).reduce((t, p) => t + Number(p.amount), 0);
  let logo = null;
  if (prof?.logo_key) {
    try { logo = await imageBytes(new Blob([new Uint8Array(await (await r2Get(prof.logo_key)).arrayBuffer())])); } catch { logo = null; }
  }
  const bytes = await buildInvoicePdf({
    business, invoice: inv, client, lines: lines ?? [], payments: pays ?? [], logo,
    verify: { url: `${appUrl()}/#/i/${inv.share_token}`, code: await verifyCode(inv, paid) },
  });
  return { bytes, fileName: pdfFileName(inv) };
}
