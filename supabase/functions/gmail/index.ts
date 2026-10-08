// gmail — connect your Gmail and send invoices / reminders / statements from it.
import { admin, appUrl, HttpError, json, money, requireUser, serve } from "../_shared/util.ts";
import { buildInvoiceEmail, buildStatementEmail, googleAccessToken, invoiceEmailData, sendGmail, shareLink } from "../_shared/email.ts";

serve(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const db = admin();

  if (body.action === "connect") {
    const refresh = String(body.refresh_token ?? "");
    if (!refresh) throw new HttpError(400, "Google didn't return a Gmail permission. Try again.");
    const access = await googleAccessToken(refresh);
    // Make sure the "send email" permission was actually granted.
    const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access)}`);
    const scopes = info.ok ? String((await info.json()).scope ?? "") : "";
    if (!scopes.includes("gmail.send")) throw new HttpError(400, "Gmail permission wasn't granted. Tick the “Send email on your behalf” box on Google's screen.");
    const who = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${access}` } });
    const emailAddress: string = (who.ok ? (await who.json()).email : null) || user.email || "";
    if (!emailAddress) throw new HttpError(400, "Couldn't find your Gmail address. Try again.");
    await db.from("gmail_tokens").upsert({ owner_id: user.id, email: emailAddress, refresh_token: refresh, updated_at: new Date().toISOString() });
    await db.from("profiles").update({ gmail_email: emailAddress }).eq("id", user.id);
    return json({ ok: true, email: emailAddress });
  }

  if (body.action === "disconnect") {
    await db.from("gmail_tokens").delete().eq("owner_id", user.id);
    await db.from("profiles").update({ gmail_email: null }).eq("id", user.id);
    return json({ ok: true });
  }

  if (body.action === "send") {
    const { data: tok } = await db.from("gmail_tokens").select("*").eq("owner_id", user.id).single();
    if (!tok) throw new HttpError(400, "Connect Gmail in Settings first.");
    const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).single();
    const business = profile?.business_name || tok.email;
    const to = String(body.to ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.split(",")[0].trim())) throw new HttpError(400, "Add a valid email address");

    // Statement for a client
    if (body.type === "statement") {
      const { data: client } = await db.from("clients").select("*").eq("id", body.client_id).eq("owner_id", user.id).single();
      if (!client) throw new HttpError(404, "Client not found");
      const link = `${appUrl()}/#/s/${client.statement_token}`;
      const { data: open } = await db.from("invoices").select("id, number, issue_date, due_date, total")
        .eq("client_id", client.id).eq("kind", "invoice").eq("status", "sent").order("issue_date");
      const ids = (open ?? []).map((i) => i.id);
      const { data: sp } = ids.length ? await db.from("payments").select("invoice_id, amount").in("invoice_id", ids) : { data: [] as { invoice_id: string; amount: number }[] };
      const paidBy: Record<string, number> = {};
      for (const p of sp ?? []) paidBy[p.invoice_id] = (paidBy[p.invoice_id] ?? 0) + Number(p.amount);
      const email = buildStatementEmail({
        link, clientName: client.name, message: String(body.message ?? ""), accent: profile?.accent ?? "#16161A",
        business: { name: business, email: profile?.business_email || null, phone: profile?.phone || null, website: profile?.website || null },
        invoices: (open ?? []).map((i) => ({ number: i.number, issueDate: i.issue_date, dueDate: i.due_date, due: Number(i.total) - (paidBy[i.id] ?? 0) })).filter((i) => i.due > 0.009),
      });
      await sendGmail(tok.refresh_token, {
        fromName: business, fromEmail: tok.email, to, cc: body.cc, subject: String(body.subject ?? `Statement from ${business}`), ...email,
      });
      return json({ ok: true });
    }

    // Invoice / quote / reminder
    const { data: inv } = await db.from("invoices").select("*").eq("id", body.invoice_id).eq("owner_id", user.id).single();
    if (!inv) throw new HttpError(404, "Invoice not found");
    if (inv.status === "void") throw new HttpError(400, "This invoice is void");
    const isReminder = body.type === "reminder";
    const data = await invoiceEmailData(db, inv, profile, business);
    const paid = data.paid;
    const email = buildInvoiceEmail({
      ...data,
      link: shareLink(appUrl(), inv.share_token), message: String(body.message ?? ""), isReminder,
    });
    await sendGmail(tok.refresh_token, {
      fromName: business, fromEmail: tok.email, to, cc: body.cc || undefined,
      subject: String(body.subject ?? `${inv.kind === "quote" ? "Quote" : "Invoice"} #${inv.number} from ${business}`),
      ...email,
    });
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    if (isReminder) {
      patch.last_reminder_at = now;
      patch.reminders_sent = (inv.reminders_sent ?? 0) + 1;
    } else {
      patch.sent_at = now;
      if (inv.status === "draft") patch.status = "sent";
    }
    await db.from("invoices").update(patch).eq("id", inv.id);
    await db.from("invoice_events").insert({
      owner_id: user.id, invoice_id: inv.id, type: isReminder ? "reminder" : "sent",
      detail: `${isReminder ? "Reminder" : "Emailed"} to ${to} · ${money(Number(inv.total) - paid)} due`,
    });
    return json({ ok: true });
  }

  throw new HttpError(400, "Unknown action");
});
