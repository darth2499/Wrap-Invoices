// Import to Wrap: the person you billed adds your invoice to their own crew payouts (used by the public function).
// Everything here reads or writes only (a) the invoice behind the link and (b) rows owned by the signed-in person.
import { HttpError } from "./util.ts";
// @ts-ignore: plain JS shared with the app (copied by scripts/sync-shared.mjs)
import * as shared from "./web/format.js";
// @ts-ignore: plain JS shared with the app
import * as matcher from "./web/match.js";
// Never let the client page fail to start over this: without it, dates are just kept as written.
// deno-lint-ignore no-explicit-any
const styleDates: (t: string, style: unknown, iso: unknown) => string = (shared as any).styleDates ?? ((t: string) => t);
// deno-lint-ignore no-explicit-any
type Db = any;

export async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const UNKNOWN = "Unknown sender";
/** Who sent the invoice: their business name, else the email they bill from. */
// deno-lint-ignore no-explicit-any
export function senderName(p: any): string {
  // Only what their invoice already shows (never their sign-in email).
  for (const v of [p?.business_name, p?.business_email]) {
    const t = String(v ?? "").trim();
    if (t) return t;
  }
  return UNKNOWN;
}

/** Where this invoice stands for one signed-in person: own | none | new | changed | imported. */
// deno-lint-ignore no-explicit-any
export async function importState(db: Db, inv: any, userId: string): Promise<any> {
  if (inv.owner_id === userId) return { state: "own" };
  if (inv.kind !== "invoice" || inv.status !== "sent") return { state: "none" };

  const [{ data: pays }, { data: lines }, { data: prof }] = await Promise.all([
    db.from("payments").select("amount").eq("invoice_id", inv.id),
    db.from("invoice_lines").select("item, description, note, qty, rate, amount").eq("invoice_id", inv.id).order("position"),
    db.from("profiles").select("*").eq("id", inv.owner_id).single(), // all columns: a missing newer one must not hide who sent it
  ]);
  const due = Math.round((Number(inv.total) - (pays ?? []).reduce((t: number, p: { amount: number }) => t + Number(p.amount), 0)) * 100) / 100;
  if (due <= 0) return { state: "none" };
  // Their copy is found again by a fingerprint of the invoice (the sender's ids never leave the server).
  const key = await sha256(`wrap-import:${inv.id}`);
  const version = `v2:${inv.version ?? 1}:${Number(inv.total)}:${inv.due_date ?? ""}`; // their edits, not payments
  // One import per invoice in all of Wrap: once someone has it, anyone else with the link just sees the PDF button.
  const { data: held } = await db.from("crew_payouts").select("id, owner_id, source_version, paid_on, source_detail").eq("source_key", key).limit(1);
  if (held?.[0] && held[0].owner_id !== userId) return { state: "none" };
  const mine = held?.[0] ?? null;
  // Missing items, or imported while the sender's name couldn't be read (and it can be now).
  const stale = !mine?.source_detail || (mine.source_detail.from === UNKNOWN && senderName(prof) !== UNKNOWN);
  const state = !mine ? "new" : (mine.source_version !== version || stale) && !mine.paid_on ? "changed" : "imported";
  return { state, mine, due, key, version, lines, prof };
}

// deno-lint-ignore no-explicit-any
export async function doImport(db: Db, inv: any, token: string, userId: string, r: any) {
  const { mine, due, key, version, lines, prof } = r;

  const from = senderName(prof);
  const items = [...new Set((lines ?? []).map((l: { item: string }) => String(l.item || "").trim()).filter(Boolean))];
  const row = {
    amount: due,
    due_date: inv.due_date,
    description: `Invoice #${inv.number}${items.length ? ` · ${items.slice(0, 3).join(", ")}${items.length > 3 ? "…" : ""}` : ""}`.slice(0, 200),
    source_number: String(inv.number),
    source_token: token,
    source_version: version,
    // A copy of what they billed, so you can read and copy every line without opening the link again.
    source_detail: {
      from: from, issue_date: inv.issue_date, due_date: inv.due_date, total: Number(inv.total), due,
      subtotal: Number(inv.subtotal ?? 0), discount: Number(inv.discount_total ?? 0), tax: Number(inv.tax_total ?? 0),
      lines: (lines ?? []).map((l: Record<string, unknown>) => ({
        item: l.item ?? "", description: styleDates(String(l.description ?? ""), prof?.date_style, inv.issue_date), note: l.note ?? "",
        qty: Number(l.qty), rate: Number(l.rate), amount: Number(l.amount),
      })),
    },
  };
  if (mine) {
    const { data: was } = await db.from("crew_payouts").select("crew_id").eq("id", mine.id).eq("owner_id", userId).single();
    const { error } = await db.from("crew_payouts").update(row).eq("id", mine.id).eq("owner_id", userId);
    if (error) throw new HttpError(500, error.message);
    // Fix a payee that was saved as "Unknown sender" before.
    if (was?.crew_id && from !== UNKNOWN) await db.from("crew_members").update({ name: from }).eq("id", was.crew_id).eq("owner_id", userId).eq("name", UNKNOWN);
    return { state: "imported", id: mine.id, updated: true };
  }

  // The sender as one of their payees: an existing one with the same email or name, otherwise a new one.
  const { data: crew } = await db.from("crew_members").select("id, name, email, phone, address").eq("owner_id", userId);
  const email = String(prof?.business_email || "").trim().toLowerCase();
  // Same person even if written a little differently (same email, same phone, "Bros." vs "Brothers"…). Only a sure
  // match is reused here; a maybe becomes a new payee and shows up under "possible duplicates" to merge.
  // deno-lint-ignore no-explicit-any
  const m: any = (matcher as any).findMatch?.({ name: from, email, phone: prof?.phone, address: prof?.address }, crew ?? []);
  // deno-lint-ignore no-explicit-any
  let member: any = m?.level === "same" ? m.item : (crew ?? []).find((c: { email?: string; name?: string }) => email && String(c.email || "").trim().toLowerCase() === email)
    || (crew ?? []).find((c: { email?: string; name?: string }) => String(c.name || "").trim().toLowerCase() === from.toLowerCase());
  let madeMember = false;
  if (!member) {
    const { data, error } = await db.from("crew_members").insert({ owner_id: userId, name: from, email: email || null, phone: prof?.phone || null, address: prof?.address || null }).select("id").single();
    if (error) throw new HttpError(500, `Couldn't add ${from} to your crew: ${error.message}`);
    member = data;
    madeMember = true;
  }
  const { data: made, error } = await db.from("crew_payouts").insert({ ...row, owner_id: userId, crew_id: member.id, work_date: inv.issue_date, source_key: key }).select("id").single();
  if (!error) return { state: "imported", id: made.id };
  // Didn't go in: don't leave a payee behind that nothing points to.
  if (madeMember) await db.from("crew_members").delete().eq("id", member.id).eq("owner_id", userId);
  if (error.code === "23505") {
    // Tapped twice (or two tabs): the first one won. If it's theirs, just say it's in; if someone else's, it's taken.
    const { data: other } = await db.from("crew_payouts").select("id, owner_id").eq("source_key", key).limit(1);
    if (other?.[0]?.owner_id === userId) return { state: "imported", id: other[0].id };
    return { state: "none" };
  }
  throw new HttpError(500, `Couldn't import it: ${error.message}`);
}
