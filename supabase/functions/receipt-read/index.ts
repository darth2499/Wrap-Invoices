// receipt-read — reads a scanned receipt with Claude and returns vendor, date and the amount actually paid.
import { bytesToBase64, env, HttpError, json, r2Get, requireUser, serve } from "../_shared/util.ts";

// Keep in sync with src/lib/categories.js
const CATEGORIES = [
  "Advertising", "Car & truck", "Parking & tolls", "Commissions & fees", "Contract labor",
  "Equipment (depreciation / Sec. 179)", "Insurance", "Legal & professional", "Office expense",
  "Equipment rental", "Rent – other", "Repairs & maintenance", "Supplies", "Taxes & licenses",
  "Travel", "Meals", "Utilities", "Software & subscriptions", "Education", "Other",
];

const TOOL = {
  name: "save_receipt",
  description: "Save the details read from the receipt image.",
  input_schema: {
    type: "object",
    properties: {
      is_receipt: { type: "boolean", description: "False if the image is not a receipt or invoice at all." },
      vendor: { type: ["string", "null"], description: "Business name as a person would say it, e.g. 'Delta Hotels', 'McDonald's'." },
      date: { type: ["string", "null"], description: "Purchase date as YYYY-MM-DD." },
      total_paid: {
        type: ["number", "null"],
        description: "The FINAL amount the customer actually paid / was charged, including tax and tip. Never a subtotal, item price, change due, or 'amount tendered'.",
      },
      subtotal: { type: ["number", "null"] },
      tax: { type: ["number", "null"] },
      tip: { type: ["number", "null"], description: "Tip/gratuity, including a handwritten one." },
      currency: { type: "string", description: "ISO code, usually USD." },
      reasoning: { type: "string", description: "One short sentence: which line you used as total_paid and why." },
      amounts: {
        type: "array",
        description: "Every other money amount on the receipt that someone might confuse with the total (subtotal, tax, tip, item lines, cash tendered, change, balance).",
        items: {
          type: "object",
          properties: { label: { type: "string" }, amount: { type: "number" } },
          required: ["label", "amount"],
        },
      },
      category: { type: "string", enum: CATEGORIES },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["is_receipt", "vendor", "date", "total_paid", "reasoning", "amounts", "category", "confidence", "currency"],
  },
};

const PROMPT = `You are reading a receipt for a freelance video/audio professional's business bookkeeping.

Find the amount that was ACTUALLY PAID. Rules:
- Prefer the line labelled TOTAL, AMOUNT PAID, AMOUNT CHARGED, CARD TOTAL, or the card/payment line at the bottom.
- If a tip was handwritten or added after the printed total, total_paid = printed total + tip (use a handwritten grand total if present).
- Ignore SUBTOTAL, individual items, "cash tendered", "change", "you saved", "points", and pre-authorization amounts.
- For hotel folios, use the total charges paid (payments line), not the remaining balance (often $0.00).
- For parking stubs, use the amount paid.
- If two copies of a total appear, they should match; if they don't, choose the one at the payment step and set confidence to "low".
- Dates in US format MM/DD/YY should be converted to YYYY-MM-DD.
Pick the best tax category for the expense. Call save_receipt exactly once.`;

const INVOICE_TOOL = {
  name: "save_invoice",
  description: "Save the details of an invoice that was issued by the user (for importing old invoices).",
  input_schema: {
    type: "object",
    properties: {
      number: { type: "string", description: "Invoice number without '#'" },
      client_name: { type: "string", description: "The 'Bill to' name" },
      client_email: { type: ["string", "null"] },
      client_address: { type: ["string", "null"], description: "Bill-to address, lines separated by \\n" },
      issue_date: { type: "string", description: "YYYY-MM-DD" },
      due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string" }, description: { type: ["string", "null"] }, note: { type: ["string", "null"] },
            qty: { type: "number" }, rate: { type: "number" }, amount: { type: "number" },
          },
          required: ["item", "qty", "rate", "amount"],
        },
      },
      total: { type: "number" },
      payments: {
        type: "array",
        items: { type: "object", properties: { date: { type: "string" }, amount: { type: "number" }, method: { type: ["string", "null"] } }, required: ["amount"] },
      },
      amount_due: { type: "number" },
      notes: { type: ["string", "null"], description: "Notes / terms text" },
    },
    required: ["number", "client_name", "issue_date", "lines", "total", "amount_due"],
  },
};

serve(async (req) => {
  const user = await requireUser(req);
  const { key, mime, mode } = await req.json();
  if (typeof key !== "string" || !key.startsWith(`${user.id}/`)) throw new HttpError(403, "Not your file");

  const file = await r2Get(key);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, "File is too large to read (20 MB max)");
  const type = (mime || file.headers.get("content-type") || "image/jpeg").toLowerCase();
  const data = bytesToBase64(bytes);

  const media = type.includes("pdf")
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: type.includes("png") ? "image/png" : type.includes("webp") ? "image/webp" : "image/jpeg", data } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env("RECEIPT_MODEL", "claude-sonnet-4-5"),
      max_tokens: mode === "invoice" ? 8000 : 1024,
      tools: [mode === "invoice" ? INVOICE_TOOL : TOOL],
      tool_choice: { type: "tool", name: mode === "invoice" ? "save_invoice" : "save_receipt" },
      messages: [{
        role: "user",
        content: [media, {
          type: "text",
          text: mode === "invoice"
            ? "This is an invoice the user sent to a client (e.g. exported from Wave). Read every line item across all pages, keeping each item's description lines. Call save_invoice once."
            : PROMPT,
        }],
      }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(502, `Receipt reader failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const out = await res.json();
  const call = (out.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!call) throw new HttpError(502, "Receipt reader returned nothing");
  const r = call.input;
  if (mode === "invoice") return json(r);

  // Sanity check: subtotal + tax + tip should equal the total. Flag it if not.
  let check: "ok" | "mismatch" | "unknown" = "unknown";
  if (r.total_paid != null && r.subtotal != null) {
    const sum = Number(r.subtotal) + Number(r.tax ?? 0) + Number(r.tip ?? 0);
    check = Math.abs(sum - Number(r.total_paid)) < 0.02 ? "ok" : "mismatch";
    if (check === "mismatch" && r.confidence === "high") r.confidence = "medium";
  }
  return json({ ...r, check });
});
