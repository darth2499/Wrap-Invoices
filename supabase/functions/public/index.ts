// public — what clients see through a shared link (no sign-in).
//   invoice:      /#/i/<token>   → invoice/quote, its lines and attached receipts
//   accept_quote: client approves a quote
//   statement:    /#/s/<token>   → every open invoice for one client
//   ping:         keeps the free Supabase project awake
import { admin, HttpError, json, presign, serve } from "../_shared/util.ts";

const TOKEN_RE = /^[a-f0-9]{48,64}$/;

async function business(db: ReturnType<typeof admin>, ownerId: string) {
  const { data: p } = await db.from("profiles")
    .select("business_name, business_email, address, phone, website, logo_key, template, accent, payment_instructions, footer_note")
    .eq("id", ownerId).single();
  if (!p) return null;
  const logo_url = p.logo_key ? await presign(p.logo_key, "GET", 3600) : null;
  return { ...p, logo_key: undefined, logo_url };
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
    },
    client,
    lines: lines ?? [],
    payments: pays ?? [],
    receipts: files,
  });
});
