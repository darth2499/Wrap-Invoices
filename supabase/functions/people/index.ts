// people — the account owner's invite list (owner only).
//   list:   everyone invited, and whether they've signed up yet
//   invite: add someone and email them an invitation (from your connected Gmail)
//   resend: email the invitation again
//   remove: block them and permanently delete everything that belongs to their account:
//           every row they own (cascades from their login), their receipt/logo files in storage, their
//           storage records, and the invitation itself. Only rows/files with THEIR user id are touched.
import { admin, appUrl, HttpError, json, r2Delete, r2List, requireUser, serve } from "../_shared/util.ts";
import { sendGmail } from "../_shared/email.ts";
// @ts-ignore: plain JS shared with the app (copied by scripts/sync-shared.mjs)
import { buildInviteEmail as buildInviteJs } from "../_shared/web/emailTemplate.js";
const buildInviteEmail = buildInviteJs as unknown as (e: Record<string, unknown>) => { subject: string; text: string; html: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Every table with an owner_id (all of them are deleted with the login via "on delete cascade"; this list is
// only used to double-check afterwards that nothing was left behind).
const OWNED = ["clients", "projects", "catalog_items", "day_types", "tax_rates", "invoices", "invoice_lines", "invoice_revisions",
  "invoice_events", "payments", "receipts", "mileage_trips", "crew_members", "crew_payouts", "form1099", "gmail_tokens", "stored_files"];

serve(async (req) => {
  const user = await requireUser(req);
  const db = admin();
  const { data: me } = await db.from("profiles").select("*").eq("id", user.id).single();
  if (!me?.is_admin) throw new HttpError(403, "Only the account owner can manage people");
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();

  const profileOf = async (em: string) => {
    // Exact match only (ignoring capitals): wildcards in an email like "a_b@…" must never match someone else.
    const pattern = em.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data } = await db.from("profiles").select("id, email, is_admin, created_at").ilike("email", pattern).limit(5);
    return (data ?? []).filter((p) => String(p.email ?? "").trim().toLowerCase() === em);
  };

  const sendInvite = async (to: string) => {
    const { data: tok } = await db.from("gmail_tokens").select("*").eq("owner_id", user.id).maybeSingle();
    if (!tok) return false; // no Gmail connected: the invite still works, they just aren't emailed
    const from = me.business_name || user.user_metadata?.full_name || tok.email;
    const mail = buildInviteEmail({ inviter: from, inviterEmail: tok.email, to, link: `${appUrl()}/` });
    await sendGmail(tok.refresh_token, { fromName: "Wrap", fromEmail: tok.email, replyTo: tok.email, to, ...mail });
    return true;
  };

  if (body.action === "list") {
    const { data: invites } = await db.from("invites").select("email, is_admin, created_at").order("created_at");
    const out = [];
    for (const i of invites ?? []) {
      const [p] = await profileOf(i.email);
      out.push({ email: i.email, is_admin: i.is_admin, invited_at: i.created_at, joined_at: p?.created_at ?? null });
    }
    return json({ people: out, gmail: !!me.gmail_email });
  }

  if (body.action === "invite" || body.action === "resend") {
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address");
    if (body.action === "invite") {
      const { error } = await db.from("invites").upsert({ email, invited_by: user.id }, { onConflict: "email", ignoreDuplicates: true });
      if (error) throw new HttpError(500, error.message);
    } else {
      const { data: inv } = await db.from("invites").select("email").eq("email", email).maybeSingle();
      if (!inv) throw new HttpError(404, "They're not on the invite list");
    }
    let sent = false;
    try { sent = await sendInvite(email); } catch (e) { return json({ ok: true, sent: false, error: e instanceof Error ? e.message : String(e) }); }
    return json({ ok: true, sent });
  }

  if (body.action === "remove") {
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address");
    const { data: inv } = await db.from("invites").select("email, is_admin").eq("email", email).maybeSingle();
    if (inv?.is_admin) throw new HttpError(403, "The owner can't be removed");
    const profiles = await profileOf(email);
    if (profiles.length > 1) throw new HttpError(409, "More than one account has this email. Remove it in Supabase instead.");
    const target = profiles[0];
    if (target && (target.id === user.id || target.is_admin)) throw new HttpError(403, "The owner can't be removed");

    // 1. Block: off the invite list, so they can't sign up again.
    await db.from("invites").delete().eq("email", email);
    if (!target) return json({ ok: true, deleted: false });
    const id = String(target.id);
    if (!UUID_RE.test(id)) throw new HttpError(500, "Unexpected account id");

    // 2. Their files: only keys inside their own folder ("<their id>/…"), which is where every upload of theirs goes.
    const prefix = `${id}/`;
    const keys = new Set<string>();
    for (const f of await r2List()) if (f.key.startsWith(prefix)) keys.add(f.key);
    const { data: rows } = await db.from("stored_files").select("key").eq("owner_id", id);
    for (const r of rows ?? []) if (String(r.key).startsWith(prefix)) keys.add(r.key);
    let files = 0;
    for (const k of keys) { await r2Delete(k); files++; }
    await db.from("stored_files").delete().eq("owner_id", id);

    // 3. Their login: deleting it signs them out everywhere and deletes every row they own (on delete cascade).
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw new HttpError(500, `Couldn't delete the account: ${error.message}`);

    // 4. Double-check nothing of theirs is left.
    const left: string[] = [];
    for (const t of OWNED) {
      const { count } = await db.from(t).select("*", { count: "exact", head: true }).eq("owner_id", id);
      if (count) left.push(`${t} (${count})`);
    }
    const { count: prof } = await db.from("profiles").select("*", { count: "exact", head: true }).eq("id", id);
    if (prof) left.push("profile");
    return json({ ok: true, deleted: true, files, left });
  }

  throw new HttpError(400, "Unknown action");
});
