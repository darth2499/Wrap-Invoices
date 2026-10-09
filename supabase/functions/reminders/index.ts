// reminders — runs once a day (from the database scheduler) and emails automatic reminders
// for overdue invoices that have "Auto-remind" turned on.
import { admin, appUrl, env, HttpError, json, money, serve } from "../_shared/util.ts";
import { buildInvoiceEmail, invoiceEmailData, sendGmail, shareLink } from "../_shared/email.ts";

serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== env("CRON_SECRET")) throw new HttpError(401, "Nope");
  const db = admin();
  const today = new Date().toISOString().slice(0, 10);

  const { data: invs, error } = await db.from("invoices")
    .select("*, clients(*)")
    .eq("kind", "invoice").eq("status", "sent").eq("auto_remind", true).lt("due_date", today);
  if (error) throw error;

  const results: string[] = [];
  const profiles = new Map<string, Record<string, unknown> | null>();
  const tokens = new Map<string, { email: string; refresh_token: string } | null>();

  for (const inv of invs ?? []) {
    try {
      if (!profiles.has(inv.owner_id)) {
        const { data } = await db.from("profiles").select("*").eq("id", inv.owner_id).single();
        profiles.set(inv.owner_id, data);
        const { data: t } = await db.from("gmail_tokens").select("email, refresh_token").eq("owner_id", inv.owner_id).single();
        tokens.set(inv.owner_id, t);
      }
      const profile = profiles.get(inv.owner_id) as Record<string, any> | null;
      const tok = tokens.get(inv.owner_id);
      const client = inv.clients as { name: string; email: string | null; cc_emails: string | null; contact_first?: string | null } | null;
      if (!profile || !tok || !client?.email) continue;

      const steps: number[] = [...(profile.reminder_days ?? [3, 7, 14])].sort((a, b) => a - b);
      const sent = inv.reminders_sent ?? 0;
      const overdue = Math.floor((Date.now() - new Date(inv.due_date + "T12:00:00").getTime()) / 86400000);
      if (sent >= steps.length || overdue < steps[sent]) continue;
      if (inv.last_reminder_at && Date.now() - new Date(inv.last_reminder_at).getTime() < 20 * 3600_000) continue;

      const { data: pays } = await db.from("payments").select("amount").eq("invoice_id", inv.id);
      const due = Number(inv.total) - (pays ?? []).reduce((s, p) => s + Number(p.amount), 0);
      if (due <= 0) continue;

      const business = profile.business_name || tok.email;
      const first = String(client.contact_first || "").trim() || (client.name || "").split(" ")[0] || "there";
      const message = `Hi ${first},\n\nJust a friendly reminder that invoice #${inv.number} for ${money(due)} is now ${overdue} day${overdue === 1 ? "" : "s"} past due. The details are below, and you can download the PDF and receipts from the link.\n\nThank you!\n${business}`;
      const email = buildInvoiceEmail({
        ...(await invoiceEmailData(db, inv, profile, business)),
        link: shareLink(appUrl(), inv.share_token), message, isReminder: true,
      });
      await sendGmail(tok.refresh_token, {
        fromName: business, fromEmail: tok.email, to: client.email, cc: client.cc_emails || undefined,
        subject: `Reminder: invoice #${inv.number} from ${business}`, ...email,
      });
      await db.from("invoices").update({ last_reminder_at: new Date().toISOString(), reminders_sent: sent + 1 }).eq("id", inv.id);
      await db.from("invoice_events").insert({
        owner_id: inv.owner_id, invoice_id: inv.id, type: "reminder",
        detail: `Automatic reminder to ${client.email} · ${overdue} days overdue`,
      });
      results.push(`#${inv.number}: sent`);
    } catch (e) {
      results.push(`#${inv.number}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return json({ checked: invs?.length ?? 0, results });
});
