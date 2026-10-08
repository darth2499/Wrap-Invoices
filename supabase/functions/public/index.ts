// public — what clients see through a shared link (no sign-in).
//   invoice:      /#/i/<token>   → invoice/quote, its lines and attached receipts
//   pdf:          the invoice PDF, made here from the saved invoice (never from what's on the client's screen)
//   accept_quote: client approves a quote
//   statement:    /#/s/<token>   → every open invoice for one client
//   ping:         keeps the free Supabase project awake
import { admin, appUrl, cors, HttpError, json, presign, r2Get, serve } from "../_shared/util.ts";
// @ts-ignore: plain JS shared with the app (copied by scripts/sync-shared.mjs)
import { buildInvoicePdf as buildPdfJs, imageBytes, pdfFileName } from "../_shared/web/pdf.js";
const buildInvoicePdf = buildPdfJs as unknown as (opts: Record<string, unknown>) => Promise<Uint8Array>;

const TOKEN_RE = /^[a-f0-9]{48,64}$/;

async function business(db: ReturnType<typeof admin>, ownerId: string) {
  const { data: p } = await db.from("profiles")
    .select("business_name, business_email, address, phone, website, logo_key, template, accent, payment_instructions, footer_note")
    .eq("id", ownerId).single();
  if (!p) return null;
  const logo_url = p.logo_key ? await presign(p.logo_key, "GET", 3600) : null;
  return { ...p, logo_key: undefined, logo_url };
}

/**
 * Short code tied to this exact version and balance of the invoice. Signed with a server-only secret,
 * so it can't be made up: the code on a PDF must match the one shown on the live link.
 */
// deno-lint-ignore no-explicit-any
async function verifyCode(inv: any, paid: number): Promise<string> {
  const secret = Deno.env.get("VERIFY_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = `${inv.id}|${inv.version}|${Number(inv.total).toFixed(2)}|${paid.toFixed(2)}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  const hex = [...sig.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

serve(async (req) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : Object.fromEntries(new URL(req.url).searchParams);
  const db = admin();

  if (body.action === "ping") {
    await db.from("profiles").select("id", { count: "exact", head: true });
    return json({ ok: true, at: new Date().toISOString() });
  }

  const token = String(body.token ?? "");
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "Link not found");

  if (body.action === "statement") {
    const { data: client } = await db.from("clients").select("id, owner_id, name, email, address").eq("statement_token", token).single();
    if (!client) throw new HttpError(404, "Link not found");
    const { data: invs } = await db.from("invoices")
      .select("id, number, issue_date, due_date, total, status, share_token")
      .eq("client_id", client.id).eq("kind", "invoice").eq("status", "sent").order("issue_date");
    const ids = (invs ?? []).map((i) => i.id);
    const { data: pays } = ids.length
      ? await db.from("payments").select("invoice_id, amount").in("invoice_id", ids)
      : { data: [] as { invoice_id: string; amount: number }[] };
    const paidBy: Record<string, number> = {};
    for (const p of pays ?? []) paidBy[p.invoice_id] = (paidBy[p.invoice_id] ?? 0) + Number(p.amount);
    const invoices = (invs ?? []).map((i) => ({ ...i, id: undefined, paid: paidBy[i.id] ?? 0, due: Number(i.total) - (paidBy[i.id] ?? 0) }));
    return json({
      business: await business(db, client.owner_id),
      client: { name: client.name, email: client.email, address: client.address },
      invoices,
      total_due: invoices.reduce((s, i) => s + i.due, 0),
    });
  }

  const { data: inv } = await db.from("invoices").select("*").eq("share_token", token).single();
  if (!inv) throw new HttpError(404, "Link not found");

  if (body.action === "accept_quote") {
    if (inv.kind !== "quote" || !["sent", "draft"].includes(inv.status)) throw new HttpError(400, "This quote can't be accepted");
    const name = String(body.name ?? "").slice(0, 120);
    await db.from("invoices").update({ status: "accepted" }).eq("id", inv.id);
    await db.from("invoice_events").insert({ owner_id: inv.owner_id, invoice_id: inv.id, type: "accepted", detail: name ? `Accepted by ${name}` : "Accepted by client" });
    return json({ ok: true });
  }

  // ----- view an invoice or quote -----
  const biz = await business(db, inv.owner_id);
  const base = { business: biz, kind: inv.kind, number: inv.number };
  if (inv.status === "void") return json({ ...base, state: "void" });
  if (inv.status === "paid") return json({ ...base, state: "paid", total: inv.total });

  if (body.action === "pdf") {
    const [{ data: lines }, { data: client }, { data: pays }, { data: prof }] = await Promise.all([
      db.from("invoice_lines").select("item, description, note, qty, rate, amount, tax_rate, kind").eq("invoice_id", inv.id).order("position"),
      inv.client_id ? db.from("clients").select("name, email, address").eq("id", inv.client_id).single() : Promise.resolve({ data: null }),
      db.from("payments").select("paid_on, amount, method").eq("invoice_id", inv.id).order("paid_on"),
      db.from("profiles").select("logo_key").eq("id", inv.owner_id).single(),
    ]);
    const paid = (pays ?? []).reduce((t, p) => t + Number(p.amount), 0);
    let logo = null;
    if (prof?.logo_key) {
      try { logo = await imageBytes(new Blob([new Uint8Array(await (await r2Get(prof.logo_key)).arrayBuffer())])); } catch { logo = null; }
    }
    const bytes = await buildInvoicePdf({
      business: biz ?? {}, invoice: inv, client, lines: lines ?? [], payments: pays ?? [], logo,
      verify: { url: `${appUrl()}/#/i/${token}`, code: await verifyCode(inv, paid) },
    });
    return new Response(new Blob([bytes as unknown as BlobPart]), {
      headers: {
        ...cors,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFileName(inv)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (!body.preview) {
    const now = new Date().toISOString();
    await db.from("invoices").update({
      first_viewed_at: inv.first_viewed_at ?? now,
      last_viewed_at: now,
      view_count: (inv.view_count ?? 0) + 1,
    }).eq("id", inv.id);
    // Only log a "viewed" event once per hour so the history stays readable.
    const last = inv.last_viewed_at ? new Date(inv.last_viewed_at).getTime() : 0;
    if (Date.now() - last > 3600_000) {
      await db.from("invoice_events").insert({ owner_id: inv.owner_id, invoice_id: inv.id, type: "viewed", detail: null });
    }
  }

  const [{ data: lines }, { data: client }, { data: pays }, { data: receipts }] = await Promise.all([
    db.from("invoice_lines").select("item, description, note, qty, rate, amount, tax_rate, kind, receipt_id").eq("invoice_id", inv.id).order("position"),
    inv.client_id ? db.from("clients").select("name, email, address").eq("id", inv.client_id).single() : Promise.resolve({ data: null }),
    db.from("payments").select("paid_on, amount, method").eq("invoice_id", inv.id).order("paid_on"),
    db.from("receipts").select("id, vendor, receipt_date, total, file_key, original_key, mime, billable").eq("invoice_id", inv.id).order("receipt_date"),
  ]);

  const files = await Promise.all((receipts ?? []).map(async (r) => ({
    id: r.id,
    vendor: r.vendor,
    date: r.receipt_date,
    total: r.total,
    billable: r.billable,
    mime: r.mime,
    url: r.file_key ? await presign(r.file_key, "GET", 3600) : null,
  })));

  return json({
    ...base,
    state: "open",
    invoice: {
      number: inv.number, kind: inv.kind, status: inv.status, issue_date: inv.issue_date, due_date: inv.due_date,
      terms: inv.terms, notes: inv.notes, subtotal: inv.subtotal, discount_total: inv.discount_total,
      tax_total: inv.tax_total, total: inv.total, deposit_percent: inv.deposit_percent, version: inv.version,
      updated_at: inv.updated_at,
      verify_code: await verifyCode(inv, (pays ?? []).reduce((t, p) => t + Number(p.amount), 0)),
    },
    client,
    lines: lines ?? [],
    payments: pays ?? [],
    receipts: files,
  });
});
