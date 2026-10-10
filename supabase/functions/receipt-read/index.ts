// receipt-read — reads a receipt (or an old invoice for importing) and returns structured details.
//
// Readers, in order of preference:
//   1. Cloudflare Workers AI — FREE (10,000 "neurons"/day ≈ 100+ receipts/day). Needs CF_AI_TOKEN (+ account id).
//   2. Anthropic Claude — paid, most accurate. Used when ANTHROPIC_API_KEY is set and RECEIPT_PROVIDER isn't "cloudflare".
// Set RECEIPT_PROVIDER to "cloudflare" or "anthropic" to force one.
import { admin, bytesToBase64, env, HttpError, json, r2Get, requireUser, serve } from "../_shared/util.ts";
import { sharedRules, vote } from "../_shared/scanVotes.ts";
// @ts-ignore: plain JS shared with the app (copied by scripts/sync-shared.mjs)
import * as scan from "../_shared/web/scanRules.js";
// deno-lint-ignore no-explicit-any
const rulesLib = scan as any; // (if it's ever missing, reading still works, just without learned fixes)

// Keep in sync with src/lib/categories.js
const CATEGORIES = [
  "Advertising", "Car & truck", "Parking & tolls", "Commissions & fees", "Contract labor",
  "Equipment (depreciation / Sec. 179)", "Insurance", "Legal & professional", "Office expense",
  "Equipment rental", "Rent – other", "Repairs & maintenance", "Supplies", "Taxes & licenses",
  "Travel", "Meals", "Utilities", "Software & subscriptions", "Education", "Other",
];

const RECEIPT_RULES = `You are reading a receipt for a freelance video/audio professional's business bookkeeping.

Find the amount that was ACTUALLY PAID. Rules:
- Prefer the line labelled TOTAL, AMOUNT PAID, AMOUNT CHARGED, CARD TOTAL, or the card/payment line at the bottom.
- If a tip was handwritten or added after the printed total, total_paid = printed total + tip (use a handwritten grand total if present).
- Ignore SUBTOTAL, individual items, "cash tendered", "change", "you saved", "points", and pre-authorization amounts.
- For hotel folios, use the total charges paid (payments line), not the remaining balance (often 0.00).
- For parking stubs, use the amount paid.
- If two totals disagree, choose the one at the payment step and set confidence to "low".
- Split checks: when the card paid only part of the total ("Amount Applied $40.00", "Card amount", "Payment 1 of 2"), the person paid that part: total_paid = that charged amount + its tip, and put the charged amount (before tip) in "charged".
- A price with a quantity (e.g. "2x 50.00", "2 @ $50") is a per-item price, not the total: the total is the amount charged (e.g. "USD 100.00").
- Tickets and airline/baggage receipts: the total is the currency amount line (e.g. "USD 100.00"), not a fee or per-bag price.
- Copy the date exactly as printed into "date_printed" (e.g. "10/09/2026 8:48 pm"). Don't reorder it; it's worked out afterwards.
- "country": the 2-letter country of the business, from its address, phone number, currency or language (e.g. "US"), or null.
Pick the best tax category for the expense from this list: ${CATEGORIES.join("; ")}.`;

const RECEIPT_JSON = `Reply with ONLY one JSON object, no other text, in exactly this shape (use null when unknown):
{"is_receipt": true, "vendor": "Business name", "date_printed": "as printed", "date": "YYYY-MM-DD", "country": "US", "total_paid": 0.00, "total_label": "the words printed next to that amount", "charged": null, "subtotal": null, "tax": null, "tip": null,
 "currency": "USD", "reasoning": "one short sentence: which line is the total and why",
 "amounts": [{"label": "Subtotal", "amount": 0.00}], "category": "one of the categories", "confidence": "high|medium|low"}
"amounts" lists every OTHER money amount someone might confuse with the total (subtotal, tax, tip, items, tendered, change).`;

// Which way is up: the browser sends one picture with the receipt shown four ways (each turned a quarter more),
// labeled A, B, C and D.
const UPRIGHT = `This picture shows the same photo four times, each turned a different way, labeled A (top left), B (top right), C (bottom left) and D (bottom right).
Look at the printed words and numbers. In which copy does the text read normally: horizontal lines, left to right, right side up?
Reply with ONLY this JSON: {"upright": "A"} (or "B", "C", "D").`;

// What invoices from common apps look like (so any of them reads right).
const INVOICE_FORMATS = `Invoices come from many apps and templates: Wave, QuickBooks, FreshBooks, Xero, Zoho, Square, PayPal, Stripe, HoneyBook, Invoice2go, Bonsai, Harvest, Word/Google Docs/Excel templates, or handwritten.
- The invoice number may be labelled "Invoice #", "Invoice No.", "Inv", "Number", "Reference" or "Document #".
- Dates: "Invoice date", "Date", "Issued", "Date of issue"; due: "Due date", "Payment due", "Due", or terms like "Net 30" (then due = issue date + 30 days).
- Line items are often a table: Item/Service/Description, Qty/Hours/Units, Rate/Price/Unit price, Amount/Line total. A description may span several lines under the item name: keep them.
- Totals: "Subtotal", "Discount", "Tax"/"VAT"/"GST"/"Sales tax", "Shipping", "Total"; what's still owed: "Amount due", "Balance due", "Total due", "Amount Due (USD)", "Balance". Payments already made: "Paid", "Payment on <date>", "Amount paid", "Deposit received".
- Read every page. Ignore page headers/footers repeated on each page, and "Page 1 of 2".
- Never guess a number: use null for anything not printed.`;

const INVOICE_RULES = `This is an invoice the user sent to a client. Read every line item across all pages, keeping each item's description lines.\n${INVOICE_FORMATS}`;

const BILL_RULES = `This is an invoice someone sent TO the user (a bill the user has to pay), from a freelancer, vendor or company.
"from" is the business or person who SENT the invoice (usually the name/logo at the top, "From", or "Pay to"), not the "Bill to" customer.
${INVOICE_FORMATS}`;

const BILL_JSON = `Reply with ONLY one JSON object, no other text, in exactly this shape (use null when unknown):
{"is_invoice": true, "from_name": "Sender business or person", "from_email": null, "from_phone": null, "from_address": "line 1\\nline 2",
 "bill_to": "Customer name", "number": "1042", "issue_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "terms": "Net 30",
 "lines": [{"item": "Camera Operator", "description": "Shoot day (04/06)", "note": null, "qty": 1, "rate": 750.00, "amount": 750.00}],
 "subtotal": 0.00, "discount": 0.00, "tax": 0.00, "shipping": 0.00, "total": 0.00, "payments": [{"date": "YYYY-MM-DD", "amount": 0.00, "method": null}], "amount_due": 0.00,
 "currency": "USD", "notes": null}
"is_invoice" is false if this is not an invoice (a receipt, a letter, a blank page…).`;

const INVOICE_JSON = `Reply with ONLY one JSON object, no other text, in exactly this shape (use null when unknown):
{"is_invoice": true, "number": "193", "client_name": "Bill-to name", "client_email": null, "client_address": "line 1\\nline 2",
 "issue_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD",
 "lines": [{"item": "Camera Operator", "description": "Felicis (04/06)", "note": null, "qty": 1, "rate": 750.00, "amount": 750.00}],
 "subtotal": 0.00, "discount": 0.00, "tax": 0.00, "total": 0.00, "payments": [{"date": "YYYY-MM-DD", "amount": 0.00, "method": "bank payment"}], "amount_due": 0.00, "notes": "Month of April"}
"is_invoice" is false if this is not an invoice (a receipt, a letter, a blank page…). Never guess numbers: use null for anything not printed on it.`;

// ---------------------------------------------------------------- helpers
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

function toDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/**
 * The receipt's date, worked out here from the date exactly as printed (models often swap month and day).
 *   - written with a month name or as 2026-10-09: no doubt
 *   - 25/09 or 09/25: the number over 12 is the day
 *   - otherwise month first (US) unless the business is in a country that writes the day first
 *   - and never a date in the future when the other reading isn't
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_FIRST = ["US", "PH", "FM", "MH", "PW", "AS", "GU", "PR", "VI", "MP", "UM", "CA"];
function receiptDate(printed: unknown, fallback: unknown, country: unknown): string | null {
  const s = String(printed ?? "").trim();
  const iso = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  };
  const year = (y: string | undefined) => (!y ? new Date().getUTCFullYear() : y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]) ?? toDate(fallback);
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})\b/) || s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4}|\d{2})\b/);
  if (m) {
    const [mon, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const mi = MONTHS.indexOf(mon.toLowerCase().slice(0, 3));
    if (mi >= 0) return iso(year(m[3]), mi + 1, +day) ?? toDate(fallback);
  }
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?\b/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = year(m[3]);
    const md = iso(y, a, b);
    const dm = iso(y, b, a);
    if (md && !dm) return md;
    if (dm && !md) return dm;
    if (md && dm) {
      const first = String(country ?? "").toUpperCase();
      let pick = first && !MONTH_FIRST.includes(first) ? dm : md;
      const other = pick === md ? dm : md;
      const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      if (pick > soon && other <= soon) pick = other;
      return pick;
    }
  }
  return toDate(fallback);
}

/** Pulls the first JSON object out of a model reply (handles ```json fences and chatter). */
function parseJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  const s = String(raw ?? "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HttpError(502, "The receipt reader didn't return details");
  return JSON.parse(s.slice(start, end + 1));
}

function cleanReceipt(r: Record<string, any>) {
  const cat = CATEGORIES.find((c) => c.toLowerCase() === String(r.category ?? "").toLowerCase())
    ?? CATEGORIES.find((c) => String(r.category ?? "").toLowerCase().includes(c.toLowerCase().split(" ")[0])) ?? "Other";
  const out = {
    is_receipt: r.is_receipt !== false,
    vendor: r.vendor ? String(r.vendor).slice(0, 120) : null,
    date: receiptDate(r.date_printed, r.date, r.country),
    date_printed: r.date_printed ? String(r.date_printed).slice(0, 60) : null,
    country: r.country ? String(r.country).slice(0, 2).toUpperCase() : null,
    total_label: r.total_label ? String(r.total_label).slice(0, 40) : null,
    split: false,
    total_paid: toNum(r.total_paid ?? r.total),
    subtotal: toNum(r.subtotal),
    tax: toNum(r.tax),
    tip: toNum(r.tip),
    currency: String(r.currency || "USD").slice(0, 3).toUpperCase(),
    reasoning: String(r.reasoning ?? "").slice(0, 300),
    amounts: (Array.isArray(r.amounts) ? r.amounts : [])
      .map((a: any) => ({ label: String(a?.label ?? "").slice(0, 40), amount: toNum(a?.amount) }))
      .filter((a: any) => a.amount !== null)
      .slice(0, 12),
    category: cat,
    confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium",
    check: "unknown" as "ok" | "mismatch" | "unknown",
  };
  // The total's own line is in the list too (so a learned rule can point at it, e.g. after a split-check fix).
  if (out.total_label && out.total_paid != null && !out.amounts.some((a: any) => a.amount === out.total_paid)) out.amounts.push({ label: out.total_label, amount: out.total_paid });
  // Split check: the card paid only part of the bill. What you paid = that part + its tip (worked out here, not by the model).
  const charged = toNum(r.charged);
  const billTotal = out.subtotal != null ? out.subtotal + (out.tax ?? 0) : null;
  if (charged != null && charged > 0 && billTotal != null && charged < billTotal - 0.01) {
    out.split = true;
    out.total_paid = Math.round((charged + (out.tip ?? 0)) * 100) / 100;
    out.reasoning = `Split check: your card paid ${charged.toFixed(2)}${out.tip ? ` + ${out.tip.toFixed(2)} tip` : ""} of the ${billTotal.toFixed(2)} bill.`;
    return out;
  }
  // Sanity check: subtotal + tax + tip should equal the total. Flag it if not.
  if (out.total_paid != null && out.subtotal != null) {
    const sum = out.subtotal + (out.tax ?? 0) + (out.tip ?? 0);
    out.check = Math.abs(sum - out.total_paid) < 0.02 ? "ok" : "mismatch";
    if (out.check === "mismatch" && out.confidence === "high") out.confidence = "medium";
  }
  return out;
}

function cleanBill(r: Record<string, any>) {
  const base = cleanInvoice(r);
  const str = (v: unknown, n = 200) => (v == null || v === "" ? null : String(v).slice(0, n));
  return {
    ...base,
    from_name: str(r.from_name, 120), from_email: str(r.from_email, 120), from_phone: str(r.from_phone, 40), from_address: str(r.from_address, 300),
    bill_to: str(r.bill_to, 120), terms: str(r.terms, 60), shipping: toNum(r.shipping) ?? 0,
    currency: String(r.currency || "USD").slice(0, 3).toUpperCase(),
    amount_due: toNum(r.amount_due),
  };
}

function cleanInvoice(r: Record<string, any>) {
  return {
    is_invoice: r.is_invoice !== false,
    number: String(r.number ?? "").replace(/^#/, ""),
    client_name: r.client_name ?? "",
    client_email: r.client_email ?? null,
    client_address: r.client_address ?? null,
    issue_date: toDate(r.issue_date),
    due_date: toDate(r.due_date),
    lines: (Array.isArray(r.lines) ? r.lines : []).map((l: any) => ({
      item: String(l?.item ?? "Item"), description: l?.description ?? null, note: l?.note ?? null,
      qty: toNum(l?.qty) ?? 1, rate: toNum(l?.rate), amount: toNum(l?.amount),
    })),
    subtotal: toNum(r.subtotal),
    discount: Math.abs(toNum(r.discount) ?? 0),
    tax: toNum(r.tax) ?? 0,
    total: toNum(r.total),
    payments: (Array.isArray(r.payments) ? r.payments : []).map((p: any) => ({ date: toDate(p?.date), amount: toNum(p?.amount) ?? 0, method: p?.method ?? null })),
    amount_due: toNum(r.amount_due) ?? 0,
    notes: r.notes ?? null,
  };
}

// ---------------------------------------------------------------- readers
interface Input {
  mode: "receipt" | "invoice" | "bill" | "upright";
  text?: string; // text pulled from a PDF in the browser
  image?: { mime: string; b64: string };
  pdf?: string; // base64 PDF (Anthropic only)
}

async function readWithCloudflare(inp: Input) {
  const account = Deno.env.get("CF_ACCOUNT_ID") || env("R2_ACCOUNT_ID");
  const model = Deno.env.get("CF_AI_MODEL") || "@cf/meta/llama-4-scout-17b-16e-instruct";
  if (!inp.text && !inp.image) throw new HttpError(400, "Nothing to read");
  const rules = inp.mode === "bill" ? BILL_RULES : inp.mode === "invoice" ? INVOICE_RULES : RECEIPT_RULES;
  const shape = inp.mode === "bill" ? BILL_JSON : inp.mode === "invoice" ? INVOICE_JSON : RECEIPT_JSON;
  const content: unknown[] = [{ type: "text", text: inp.mode === "upright" ? UPRIGHT : `${rules}\n\n${shape}${inp.text ? `\n\nDocument text:\n"""\n${inp.text.slice(0, 24000)}\n"""` : ""}` }];
  if (inp.image) content.push({ type: "image_url", image_url: { url: `data:${inp.image.mime};base64,${inp.image.b64}` } });

  const call = async (jsonMode: boolean) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("CF_AI_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You extract data from documents and reply with JSON only." },
          { role: "user", content },
        ],
        max_tokens: inp.mode === "invoice" || inp.mode === "bill" ? 4000 : 1000,
        temperature: 0,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  };
  let { res, body } = await call(true);
  if (!res.ok && res.status === 400) ({ res, body } = await call(false)); // some models reject JSON mode
  if (!res.ok || body.success === false) {
    const msg = body?.errors?.[0]?.message ?? `status ${res.status}`;
    if (res.status === 429 || /neuron|limit|quota/i.test(msg)) throw new HttpError(429, "Today's free receipt reading is used up (it resets every afternoon, Pacific time). You can type this one in.");
    throw new HttpError(502, `Receipt reader failed: ${msg}`);
  }
  return parseJson(body?.result?.response ?? body?.result);
}

async function readWithAnthropic(inp: Input) {
  const content: unknown[] = [];
  if (inp.pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: inp.pdf } });
  if (inp.image) content.push({ type: "image", source: { type: "base64", media_type: inp.image.mime, data: inp.image.b64 } });
  const rules = inp.mode === "bill" ? BILL_RULES : inp.mode === "invoice" ? INVOICE_RULES : RECEIPT_RULES;
  const shape = inp.mode === "bill" ? BILL_JSON : inp.mode === "invoice" ? INVOICE_JSON : RECEIPT_JSON;
  content.push({ type: "text", text: inp.mode === "upright" ? UPRIGHT : `${rules}\n\n${shape}${inp.text && !inp.pdf ? `\n\nDocument text:\n"""\n${inp.text.slice(0, 60000)}\n"""` : ""}` });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("RECEIPT_MODEL") || "claude-sonnet-4-5",
      max_tokens: inp.mode === "invoice" || inp.mode === "bill" ? 8000 : 1200,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new HttpError(502, `Receipt reader failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  const text = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  return parseJson(text);
}

function provider(): "cloudflare" | "anthropic" {
  const forced = Deno.env.get("RECEIPT_PROVIDER");
  if (forced === "cloudflare" || forced === "anthropic") return forced;
  if (Deno.env.get("CF_AI_TOKEN")) return "cloudflare";
  if (Deno.env.get("ANTHROPIC_API_KEY")) return "anthropic";
  throw new HttpError(501, "Automatic reading isn't set up yet (add CF_AI_TOKEN in Supabase secrets). You can type the details in.");
}

// ---------------------------------------------------------------- handler
serve(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const { key, mime, mode = "receipt", text, image_b64, image_mime } = body;

  // ----- learning from corrections (see _shared/scanVotes.ts and src/lib/scanRules.js) -----
  if (mode === "learn") {
    const db = admin();
    const vk = rulesLib.vendorKey ? rulesLib.vendorKey(body.vendor) : "";
    if (vk && Array.isArray(body.rules)) await vote(db, user.id, vk, body.rules.slice(0, 8));
    if (body.first) await db.rpc("scan_stat", { p_fixed: !!body.fixed });
    return json({ ok: true });
  }
  if (mode === "rules") {
    const vk = rulesLib.vendorKey ? rulesLib.vendorKey(body.vendor) : "";
    return json({ rules: await sharedRules(admin(), vk) });
  }
  if (mode === "stats") {
    const db = admin();
    const { data: me } = await db.from("profiles").select("is_admin").eq("id", user.id).single();
    if (!me?.is_admin) throw new HttpError(403, "Owner only");
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data } = await db.from("scan_stats").select("day, reads, fixed").gte("day", since).order("day");
    const { count } = await db.from("scan_votes").select("*", { count: "exact", head: true });
    return json({ days: data ?? [], votes: count ?? 0 });
  }

  const p = provider();
  const inp: Input = { mode: mode === "invoice" ? "invoice" : mode === "bill" ? "bill" : mode === "upright" ? "upright" : "receipt" };

  if (typeof text === "string" && text.trim().length > 20) {
    inp.text = text;
  }
  if (typeof image_b64 === "string" && image_b64.length > 100) {
    // A small "reading copy" made in the browser (faster and uses less of the free allowance).
    if (image_b64.length > 8 * 1024 * 1024) throw new HttpError(413, "Image is too large to read");
    inp.image = { mime: String(image_mime || "image/jpeg"), b64: image_b64 };
  } else if (typeof key === "string" && key) {
    if (!key.startsWith(`${user.id}/`)) throw new HttpError(403, "Not your file");
    const isPdf = String(mime || "").includes("pdf");
    // Cloudflare's models can't open PDFs: the browser sends the PDF's text, or a picture of page 1 instead.
    if (!(isPdf && (p === "cloudflare" || inp.text))) {
      const file = await r2Get(key);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > 15 * 1024 * 1024) throw new HttpError(413, "File is too large to read");
      const type = (mime || file.headers.get("content-type") || "image/jpeg").toLowerCase();
      if (type.includes("pdf")) inp.pdf = bytesToBase64(bytes);
      else inp.image = { mime: type.includes("png") ? "image/png" : type.includes("webp") ? "image/webp" : "image/jpeg", b64: bytesToBase64(bytes) };
    }
  }
  if (!inp.text && !inp.image && !inp.pdf) throw new HttpError(400, "This PDF has no readable text. Upload a photo or screenshot of it instead.");

  const raw = p === "cloudflare" ? await readWithCloudflare(inp) : await readWithAnthropic(inp);
  if (inp.mode === "upright") {
    const pick = String(raw?.upright ?? "A").trim().toUpperCase().charAt(0);
    return json({ upright: "ABCD".includes(pick) && pick ? pick : "A" });
  }
  if (inp.mode === "invoice") return json(cleanInvoice(raw));
  if (inp.mode === "bill") return json(cleanBill(raw));
  let out: Record<string, unknown> = { ...cleanReceipt(raw), reader: p };
  // What everyone has taught Wrap about this store (3+ people agreeing), applied to what was just read.
  try {
    if (out.vendor && rulesLib.applyRules) {
      const shared = await sharedRules(admin(), rulesLib.vendorKey(out.vendor));
      if (Object.keys(shared).length) out = { ...rulesLib.applyRules(out, shared), shared_rules: shared };
    }
  } catch (e) { console.warn("shared rules", e); }
  return json(out);
});
