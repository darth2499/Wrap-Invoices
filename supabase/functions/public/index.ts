// public — what clients see through a shared link (no sign-in).
//   invoice:      /#/i/<token>   → invoice/quote, its lines and attached receipts
//   pdf:          the invoice PDF, made here from the saved invoice (never from what's on the client's screen)
//   accept_quote: client approves a quote
//   statement:    /#/s/<token>   → every open invoice for one client
//   import_status / import (signed-in Wrap users only, never the sender): copy the invoice into YOUR crew payouts
//                 as a bill to pay. The sender is never told who imported it, and nothing in their account changes.
//   ping:         keeps the free Supabase project awake
import { admin, cors, HttpError, json, presign, requireUser, serve } from "../_shared/util.ts";
import { invoicePdf, verifyCode } from "../_shared/invoicePdf.ts";
import { doImport, importState } from "../_shared/importBill.ts";

const TOKEN_RE = /^[a-f0-9]{48,64}$/;

const BIZ_FIELDS = ["business_name", "business_email", "address", "phone", "website", "template", "accent", "payment_instructions", "footer_note", "date_style"];

/** What a client sees about the business, from a profiles row (one query: select *). */
// deno-lint-ignore no-explicit-any
async function bizFrom(p: any) {
  if (!p) return null;
  const out: Record<string, unknown> = {};
  for (const k of BIZ_FIELDS) out[k] = p[k] ?? null;
  out.logo_mode = p.logo_mode ?? "logo"; // 011/012 columns: defaults if those migrations haven't run
  out.logo_preset = p.logo_preset ?? null;
  out.logo_url = p.logo_key ? await presign(p.logo_key, "GET", 3600) : null;
  return out;
}
async function business(db: ReturnType<typeof admin>, ownerId: string) {
  const { data: p } = await db.from("profiles").select("*").eq("id", ownerId).single();
  return bizFrom(p);
}

// Your own visits (signed in to this account on this browser) don't count as the client opening the link.
function userIdOf(jwt: unknown): string | null {
  try {
    const part = String(jwt).split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" ? json.sub : null;
  } catch { return null; }
}
/** Runs after the reply is sent when the runtime allows it (so the client's page isn't kept waiting). */
function later(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch(() => {}));
  else return p.catch(() => {});
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

  if (body.action === "import_status" || body.action === "import") return importBill(db, req, inv, token, body.action === "import");

  // ----- view an invoice or quote -----
  if (body.action !== "pdf") return view(db, inv, body);
  if (inv.status === "void" || inv.status === "paid") throw new HttpError(400, "This invoice is closed");

  if (body.action === "pdf") {
    const { bytes, fileName } = await invoicePdf(db, inv);
    return new Response(new Blob([bytes as unknown as BlobPart]), {
      headers: {
        ...cors,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  throw new HttpError(400, "Unknown action");
});

/** The client page: everything in one round of parallel queries; the view is counted after the reply. */
// deno-lint-ignore no-explicit-any
async function view(db: ReturnType<typeof admin>, inv: any, body: any) {
  // Someone else signed in to Wrap on this browser: check their sign-in alongside everything else, so
  // "Import to Wrap" arrives with the page instead of a moment later.
  const viewer = body.viewer_token && userIdOf(body.viewer_token) !== inv.owner_id && inv.kind === "invoice" && inv.status === "sent"
    ? db.auth.getUser(String(body.viewer_token)).then(({ data }) => (data.user ? importState(db, inv, data.user.id) : null)).catch(() => null)
    : Promise.resolve(undefined);
  const [{ data: prof }, { data: lines }, { data: client }, { data: pays }, { data: receipts }] = await Promise.all([
    db.from("profiles").select("*").eq("id", inv.owner_id).single(),
    db.from("invoice_lines").select("item, description, note, qty, rate, amount, tax_rate, kind, receipt_id, extras").eq("invoice_id", inv.id).order("position"),
    inv.client_id ? db.from("clients").select("name, email, address").eq("id", inv.client_id).single() : Promise.resolve({ data: null }),
    db.from("payments").select("paid_on, amount, method").eq("invoice_id", inv.id).order("paid_on"),
    db.from("receipts").select("id, vendor, receipt_date, total, file_key, mime, billable").eq("invoice_id", inv.id).order("receipt_date"),
  ]);
  const biz = await bizFrom(prof);
  const base = { business: biz, kind: inv.kind, number: inv.number };
  if (inv.status === "void") return json({ ...base, state: "void" });
  if (inv.status === "paid") return json({ ...base, state: "paid", total: inv.total });

  const you = userIdOf(body.viewer_token) === inv.owner_id;
  if (!body.preview && !you) {
    const now = new Date().toISOString();
    const last = inv.last_viewed_at ? new Date(inv.last_viewed_at).getTime() : 0;
    later(Promise.all([
      db.from("invoices").update({ first_viewed_at: inv.first_viewed_at ?? now, last_viewed_at: now, view_count: (inv.view_count ?? 0) + 1 }).eq("id", inv.id),
      // Only log a "viewed" event once per hour so the history stays readable.
      Date.now() - last > 3600_000 ? db.from("invoice_events").insert({ owner_id: inv.owner_id, invoice_id: inv.id, type: "viewed", detail: null }) : null,
    ]));
  }
  const files = await Promise.all((receipts ?? []).map(async (r) => ({
    id: r.id,
    vendor: r.vendor,
    date: r.receipt_date,
    total: r.total,
    billable: r.billable,
    mime: r.mime,
    url: r.file_key ? await presign(r.file_key, "GET", 3600) : null,
  })));

  const imp = await viewer; // undefined: not checked · null: sign-in expired (the page checks again itself)
  return json({
    ...base,
    state: "open",
    import: imp === undefined ? undefined : imp && { state: imp.state, id: imp.mine?.id ?? null },
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
}

// ---------- Import to Wrap (the work is in _shared/importBill.ts) ----------
// deno-lint-ignore no-explicit-any
async function importBill(db: ReturnType<typeof admin>, req: Request, inv: any, token: string, doIt: boolean) {
  const user = await requireUser(req); // their own sign-in, checked by the server (not just read from the page)
  const r = await importState(db, inv, user.id);
  if (!doIt || r.state !== "new" && r.state !== "changed") return json({ state: r.state, id: r.mine?.id ?? null });
  return json(await doImport(db, inv, token, user.id, r));
}

