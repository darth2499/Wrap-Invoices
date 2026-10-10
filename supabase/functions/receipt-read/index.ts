// receipt-read — reads a receipt (or an old invoice for importing) and returns structured details.
//
// Readers, in order of preference:
//   1. Cloudflare Workers AI — FREE (10,000 "neurons"/day ≈ 100+ receipts/day). Needs CF_AI_TOKEN (+ account id).
//   2. Anthropic Claude — paid, most accurate. Used when ANTHROPIC_API_KEY is set and RECEIPT_PROVIDER isn't "cloudflare".
// Set RECEIPT_PROVIDER to "cloudflare" or "anthropic" to force one.
import { bytesToBase64, env, HttpError, json, r2Get, requireUser, serve } from "../_shared/util.ts";

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
- Convert US dates like MM/DD/YY to YYYY-MM-DD.
Pick the best tax category for the expense from this list: ${CATEGORIES.join("; ")}.`;

const RECEIPT_JSON = `Reply with ONLY one JSON object, no other text, in exactly this shape (use null when unknown):
{"is_receipt": true, "vendor": "Business name", "date": "YYYY-MM-DD", "total_paid": 0.00, "subtotal": null, "tax": null, "tip": null,
 "currency": "USD", "reasoning": "one short sentence: which line is the total and why",
 "amounts": [{"label": "Subtotal", "amount": 0.00}], "category": "one of the categories", "confidence": "high|medium|low"}
"amounts" lists every OTHER money amount someone might confuse with the total (subtotal, tax, tip, items, tendered, change).`;

// Which way is up: the browser sends one picture with the receipt shown four ways (each turned a quarter more),
// labeled A, B, C and D.
const UPRIGHT = `This picture shows the same photo four times, each turned a different way, labeled A (top left), B (top right), C (bottom left) and D (bottom right).
Look at the printed words and numbers. In which copy does the text read normally: horizontal lines, left to right, right side up?
Reply with ONLY this JSON: {"upright": "A"} (or "B", "C", "D").`;

const INVOICE_RULES = `This is an invoice the user sent to a client (for example exported from Wave). Read every line item across all pages, keeping each item's description lines.`;

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
    date: toDate(r.date),
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
  // Sanity check: subtotal + tax + tip should equal the total. Flag it if not.
  if (out.total_paid != null && out.subtotal != null) {
    const sum = out.subtotal + (out.tax ?? 0) + (out.tip ?? 0);
    out.check = Math.abs(sum - out.total_paid) < 0.02 ? "ok" : "mismatch";
    if (out.check === "mismatch" && out.confidence === "high") out.confidence = "medium";
  }
  return out;
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
  mode: "receipt" | "invoice" | "upright";
  text?: string; // text pulled from a PDF in the browser
  image?: { mime: string; b64: string };
  pdf?: string; // base64 PDF (Anthropic only)
}

async function readWithCloudflare(inp: Input) {
  const account = Deno.env.get("CF_ACCOUNT_ID") || env("R2_ACCOUNT_ID");
  const model = Deno.env.get("CF_AI_MODEL") || "@cf/meta/llama-4-scout-17b-16e-instruct";
  if (!inp.text && !inp.image) throw new HttpError(400, "Nothing to read");
  const rules = inp.mode === "invoice" ? INVOICE_RULES : RECEIPT_RULES;
  const shape = inp.mode === "invoice" ? INVOICE_JSON : RECEIPT_JSON;
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
        max_tokens: inp.mode === "invoice" ? 4000 : 1000,
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
  const rules = inp.mode === "invoice" ? INVOICE_RULES : RECEIPT_RULES;
  const shape = inp.mode === "invoice" ? INVOICE_JSON : RECEIPT_JSON;
  content.push({ type: "text", text: inp.mode === "upright" ? UPRIGHT : `${rules}\n\n${shape}${inp.text && !inp.pdf ? `\n\nDocument text:\n"""\n${inp.text.slice(0, 60000)}\n"""` : ""}` });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("RECEIPT_MODEL") || "claude-sonnet-4-5",
      max_tokens: inp.mode === "invoice" ? 8000 : 1200,
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
  const { key, mime, mode = "receipt", text, image_b64, image_mime } = await req.json();
  const p = provider();
  const inp: Input = { mode: mode === "invoice" ? "invoice" : mode === "upright" ? "upright" : "receipt" };

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
  return json(inp.mode === "invoice" ? cleanInvoice(raw) : { ...cleanReceipt(raw), reader: p });
});
