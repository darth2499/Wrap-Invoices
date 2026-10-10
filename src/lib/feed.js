// "What's new" on the Overview: what happened lately and what's coming up, newest and most urgent first.
//   Happened: a client opened an invoice, a payment came in, a quote was accepted, an invoice became overdue,
//             automatic reminders went out.
//   Today:    invoices due today, receipts waiting to be checked, tax deadlines.
//   Coming:   invoices due in the next few days, tax deadlines in the next 3 weeks.
import { addDays, daysBetween, money, num } from './format.js';
import { datesFromCode } from './shoots.js';

const RECENT_DAYS = 14;

/** A tax deadline moves to the next weekday when it lands on a weekend. */
function weekday(iso) {
  const d = new Date(`${iso}T12:00:00`);
  const shift = d.getDay() === 6 ? 2 : d.getDay() === 0 ? 1 : 0;
  return shift ? addDays(iso, shift) : iso;
}

/** Federal deadlines a freelancer cares about, around today. */
export function taxDates(today, { quarterly = true, crew = false } = {}) {
  const y = Number(today.slice(0, 4));
  const out = [];
  for (const yr of [y - 1, y, y + 1]) {
    out.push({ date: weekday(`${yr}-04-15`), title: `${yr - 1} tax return due`, sub: 'Federal income tax return (Form 1040 with Schedule C)', go: '/taxes', kind: 'return' });
    if (quarterly) {
      out.push({ date: weekday(`${yr}-04-15`), title: `Q1 estimated tax due`, sub: `For ${yr} income (Jan–Mar)`, go: '/taxes/quarterly', kind: 'q' });
      out.push({ date: weekday(`${yr}-06-15`), title: `Q2 estimated tax due`, sub: `For ${yr} income (Apr–May)`, go: '/taxes/quarterly', kind: 'q' });
      out.push({ date: weekday(`${yr}-09-15`), title: `Q3 estimated tax due`, sub: `For ${yr} income (Jun–Aug)`, go: '/taxes/quarterly', kind: 'q' });
      out.push({ date: weekday(`${yr}-01-15`), title: `Q4 estimated tax due`, sub: `For ${yr - 1} income (Sep–Dec)`, go: '/taxes/quarterly', kind: 'q' });
    }
    if (crew) out.push({ date: weekday(`${yr}-01-31`), title: '1099-NEC forms due', sub: `Send them to crew you paid in ${yr - 1}`, go: '/reports/1099', kind: '1099' });
  }
  return out;
}

const ago = (iso, today) => {
  const d = daysBetween(iso.slice(0, 10), today);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};
const ahead = (iso, today) => {
  const d = daysBetween(today, iso);
  return d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
};

const CODE = /\((\d{2}\/\d{2}(?:-\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:-\d{2}\/\d{2})?)*)\)/;
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const normName = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** True when most past prices sit close together (so there's a real pattern to compare against). */
const steady = (xs, m) => xs.filter((x) => Math.abs(x - m) <= m * 0.1).length >= Math.ceil(xs.length * 0.6);

/**
 * Lines (and invoice totals) on drafts and unpaid invoices from the last 45 days whose price is far (30%+) from
 * what you usually charge for the same thing: that client's past invoices first, otherwise everyone's.
 * Mileage and receipt add-ons are skipped (those amounts change every time).
 */
function priceChecks({ db, derived, today, who }) {
  const out = [];
  const invs = db.invoices.filter((i) => i.kind === 'invoice' && i.status !== 'void');
  const past = invs.filter((i) => i.status === 'sent' || i.status === 'paid');
  const prices = (inv) => {
    const list = [];
    for (const l of derived.linesFor(inv.id)) {
      if (l.receipt_id || l.kind === 'mileage' || l.kind === 'expense') continue;
      const name = normName(l.item);
      let rate = num(l.extras ? l.extras.rate : l.rate);
      // One line covering several days at qty 1 (e.g. imported "(08/02-08/03)"): compare the price per day.
      const code = String(l.extras?.desc ?? l.description ?? '').match(CODE);
      const days = code ? datesFromCode(code[1], inv.issue_date).length : 0;
      if (!l.extras && num(l.qty) === 1 && days > 1) rate /= days;
      if (name && rate > 0) list.push({ name, label: l.item, rate: Math.round(rate * 100) / 100, perDay: !l.extras && num(l.qty) === 1 && days > 1 });
      for (const a of l.extras?.items || []) {
        if (a.unit === 'mi' || a.receipt_id || !num(a.rate)) continue;
        const n = normName(a.label);
        if (n) list.push({ name: n, label: a.label, rate: num(a.rate) });
      }
    }
    return list;
  };
  const hist = new Map(); // name → [{ client, rate, inv }]
  for (const inv of past) for (const p of prices(inv)) {
    if (!hist.has(p.name)) hist.set(p.name, []);
    hist.get(p.name).push({ client: inv.client_id, rate: p.rate, inv: inv.id });
  }
  const cutoff = addDays(today, -45);
  const checking = invs.filter((i) => (i.status === 'draft' || (i.status === 'sent' && derived.paidFor(i.id) <= 0)) && String(i.issue_date || today) >= cutoff);
  for (const inv of checking) {
    const seen = new Set();
    for (const p of prices(inv)) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      const all = (hist.get(p.name) || []).filter((h) => h.inv !== inv.id);
      const mine = all.filter((h) => h.client === inv.client_id).map((h) => h.rate);
      const ref = mine.length >= 2 ? mine : all.length >= 3 ? all.map((h) => h.rate) : null;
      if (!ref) continue;
      const m = median(ref);
      if (!steady(ref, m) || Math.abs(p.rate - m) < m * 0.3) continue;
      const usual = `You usually charge ${mine.length >= 2 ? `${who(inv)} ` : ''}${money(m)}${p.perDay ? ' a day' : ''}`;
      out.push({ key: `px${inv.id}|${p.name}|${p.rate}`, icon: 'tag', tone: 'warn', dismiss: true, todo: true, when: '',
        title: `#${inv.number}: ${p.label} at ${money(p.rate)}${p.perDay ? ' a day' : ''}`, sub: `${usual} · ${p.rate > m ? 'higher' : 'lower'} than normal`, go: `/invoices/${inv.id}` });
    }
    // The whole invoice, for clients you bill about the same amount every time.
    const totals = past.filter((i) => i.client_id === inv.client_id && i.id !== inv.id).map((i) => num(i.total)).filter((t) => t > 0);
    if (totals.length >= 4 && num(inv.total) > 0) {
      const m = median(totals);
      if (steady(totals, m) && Math.abs(num(inv.total) - m) >= m * 0.3) {
        out.push({ key: `pt${inv.id}|${num(inv.total)}`, icon: 'tag', tone: 'warn', dismiss: true, todo: true, when: '',
          title: `#${inv.number} totals ${money(inv.total)}`, sub: `${who(inv)} invoices are usually about ${money(m)}`, go: `/invoices/${inv.id}` });
      }
    }
  }
  return out;
}

/** Builds the feed. Each item: { key, icon, tone, title, sub, when, at, go } — `at` is when it happened (for "new" dots). */
export function buildFeed({ db, derived, statusOf, today }) {
  const items = [];
  const cutoff = addDays(today, -RECENT_DAYS);
  const who = (inv) => derived.clients[inv.client_id]?.name || 'No client';
  const invoices = db.invoices.filter((i) => i.kind === 'invoice');

  for (const inv of db.invoices) {
    // Client opened the link
    if (inv.last_viewed_at && inv.last_viewed_at.slice(0, 10) >= cutoff && inv.status !== 'void') {
      items.push({ key: `v${inv.id}${inv.last_viewed_at}`, icon: 'eye', tone: 'seen', title: `${who(inv)} opened #${inv.number}`, sub: num(inv.view_count) > 1 ? `Viewed ${inv.view_count} times` : 'First time they opened it', at: inv.last_viewed_at, when: ago(inv.last_viewed_at, today), go: `/invoices/${inv.id}` });
    }
    if (inv.kind === 'quote' && inv.status === 'accepted') {
      items.push({ key: `a${inv.id}`, icon: 'check', tone: 'good', title: `Quote #${inv.number} accepted`, sub: `${who(inv)} · turn it into an invoice`, at: inv.updated_at || today, when: ago(inv.updated_at || today, today), go: `/invoices/${inv.id}` });
    }
  }

  for (const inv of invoices.filter((i) => i.status === 'sent')) {
    const paid = derived.paidFor(inv.id);
    const st = statusOf(inv, paid, today);
    const left = num(inv.total) - paid;
    if (!inv.due_date || st.key === 'ready') continue;
    if (inv.due_date === today) {
      items.push({ key: `d${inv.id}`, icon: 'calendar', tone: 'warn', title: `#${inv.number} is due today`, sub: `${who(inv)} · ${money(left)}`, at: `${today}T00:00:00`, when: 'Today', go: `/invoices/${inv.id}`, urgent: true });
    } else if (inv.due_date < today && inv.due_date >= addDays(today, -7)) {
      // Became overdue this week (older ones are in "Needs attention")
      const day = addDays(inv.due_date, 1);
      items.push({ key: `o${inv.id}`, icon: 'bell', tone: 'bad', title: `#${inv.number} became overdue`, sub: `${who(inv)} · ${money(left)}`, at: `${day}T00:00:00`, when: ago(day, today), go: `/invoices/${inv.id}` });
    } else if (inv.due_date > today && inv.due_date <= addDays(today, 3)) {
      items.push({ key: `s${inv.id}`, icon: 'calendar', tone: 'muted', title: `#${inv.number} due soon`, sub: `${who(inv)} · ${money(left)}`, at: null, when: ahead(inv.due_date, today), go: `/invoices/${inv.id}`, upcoming: inv.due_date });
    }
  }

  // Bills you need to pay (imported invoices and payouts with a due date): coming up, due today, overdue.
  for (const p of db.crew_payouts.filter((x) => !x.paid_on && x.due_date)) {
    const name = derived.crew?.[p.crew_id]?.name || 'Crew';
    const what = `${name} · ${money(p.amount)}${p.source_number ? ` · their #${p.source_number}` : ''}`;
    const to = `/expenses/crew?payout=${p.id}`;
    if (p.due_date === today) items.push({ key: `bd${p.id}`, icon: 'cash', tone: 'warn', title: `Pay ${name} today`, sub: what, at: `${today}T00:00:00`, when: 'Today', go: to, urgent: true });
    else if (p.due_date < today) items.push({ key: `bo${p.id}`, icon: 'cash', tone: 'bad', title: `Payment to ${name} is overdue`, sub: `${what} · due ${daysBetween(p.due_date, today)} day${daysBetween(p.due_date, today) === 1 ? '' : 's'} ago`, todo: true, when: '', go: to });
    else if (p.due_date <= addDays(today, 3)) items.push({ key: `bs${p.id}`, icon: 'cash', tone: 'muted', title: `Pay ${name} soon`, sub: what, at: null, when: ahead(p.due_date, today), go: to, upcoming: p.due_date });
  }

  // Payments in
  for (const p of db.payments.filter((x) => x.paid_on && x.paid_on >= cutoff)) {
    const inv = derived.invoices[p.invoice_id];
    if (!inv) continue;
    items.push({ key: `p${p.id}`, icon: 'cash', tone: 'good', title: `${money(p.amount)} received`, sub: `${who(inv)} · #${inv.number}${inv.status === 'paid' ? ' · paid in full' : ''}`, at: p.created_at || `${p.paid_on}T12:00:00`, when: ago(p.paid_on, today), go: `/invoices/${inv.id}` });
  }

  // Automatic reminders that went out
  for (const e of db.invoice_events.filter((x) => x.type === 'reminder' && x.created_at?.slice(0, 10) >= cutoff)) {
    const inv = derived.invoices[e.invoice_id];
    if (inv) items.push({ key: `r${e.id}`, icon: 'bell', tone: 'muted', title: `${/^automatic/i.test(e.detail || '') ? 'Automatic reminder' : 'Reminder'} sent for #${inv.number}`, sub: who(inv), at: e.created_at, when: ago(e.created_at, today), go: `/invoices/${inv.id}` });
  }

  // Things to do: work that's stuck somewhere
  const age = (iso) => (iso ? daysBetween(iso.slice(0, 10), today) : 0);
  for (const inv of invoices) {
    const paid = derived.paidFor(inv.id);
    const c = derived.clients[inv.client_id];
    if (inv.status === 'draft' && age(inv.issue_date) >= 3) {
      items.push({ key: `td${inv.id}`, icon: 'edit', tone: 'warn', title: `Draft #${inv.number} has been waiting ${age(inv.issue_date)} days`, sub: `${who(inv)} · finish and send it`, todo: true, when: '', go: `/invoices/${inv.id}` });
    } else if (inv.status === 'sent' && !inv.sent_at && paid <= 0 && age(inv.issue_date) >= 2) {
      items.push({ key: `tr${inv.id}`, icon: 'mail', tone: 'warn', title: `#${inv.number} was saved but never sent`, sub: `${who(inv)} · ${age(inv.issue_date)} days since the invoice date`, todo: true, when: '', go: `/invoices/${inv.id}?do=send` });
    } else if (inv.status === 'sent' && inv.sent_at && !num(inv.view_count) && paid <= 0 && age(inv.sent_at) >= 5) {
      items.push({ key: `tn${inv.id}`, icon: 'eye', tone: 'muted', title: `${who(inv)} hasn’t opened #${inv.number}`, sub: `Sent ${age(inv.sent_at)} days ago · check the address or send it again`, todo: true, when: '', go: `/invoices/${inv.id}` });
    }
    if ((inv.status === 'draft' || (inv.status === 'sent' && !inv.sent_at)) && c && !c.email) {
      items.push({ key: `te${inv.id}`, icon: 'user', tone: 'warn', title: `Add an email for ${c.name}`, sub: `Needed to send #${inv.number}`, todo: true, when: '', go: `/clients/${c.id}` });
    }
    if (inv.status === 'sent' && inv.sent_at && inv.due_date && age(inv.due_date) >= 14 && !inv.auto_remind) {
      const lastNudge = db.invoice_events.filter((e) => e.invoice_id === inv.id && (e.type === 'reminder' || e.type === 'sent')).map((e) => e.created_at).sort().pop();
      if (!lastNudge || age(lastNudge) >= 14) items.push({ key: `tm${inv.id}`, icon: 'bell', tone: 'bad', title: `Nudge ${who(inv)} about #${inv.number}`, sub: `${age(inv.due_date)} days overdue · no reminder in 2 weeks`, todo: true, when: '', go: `/invoices/${inv.id}?do=remind` });
    }
  }
  for (const q of db.invoices.filter((i) => i.kind === 'quote' && i.status === 'accepted' && age(i.updated_at) >= 3)) {
    items.push({ key: `tq${q.id}`, icon: 'convert', tone: 'warn', title: `Turn quote #${q.number} into an invoice`, sub: `${who(q)} accepted it ${age(q.updated_at)} days ago`, todo: true, when: '', go: `/invoices/${q.id}` });
  }
  const trips = db.mileage_trips.filter((t) => t.billable && !t.invoice_id && age(t.trip_date) >= 3);
  if (trips.length) items.push({ key: 'ttrips', icon: 'car', tone: 'warn', title: `${trips.length} trip${trips.length === 1 ? '' : 's'} marked to bill`, sub: 'Add them to an invoice (Mileage)', todo: true, when: '', go: '/expenses/mileage' });
  const nocat = db.receipts.filter((r) => r.status !== 'review' && !r.category);
  if (nocat.length) items.push({ key: 'tcat', icon: 'receipt', tone: 'muted', title: `${nocat.length} receipt${nocat.length === 1 ? '' : 's'} without a category`, sub: 'Categories put them on the right tax line', todo: true, when: '', go: '/expenses' });

  // Prices that don't match what you usually charge (a typo, a missing zero, an old rate). Tapping one dismisses it.
  items.push(...priceChecks({ db, derived, today, who }));

  // Receipts waiting to be checked
  const review = db.receipts.filter((r) => r.status === 'review' && !r.ai?.manual);
  if (review.length) {
    const newest = review.map((r) => r.created_at || '').sort().pop() || today;
    items.push({ key: 'review', icon: 'receipt', tone: 'warn', title: `${review.length} receipt${review.length === 1 ? '' : 's'} to check`, sub: 'Confirm what was read automatically', at: newest, when: ago(newest, today), go: '/expenses?status=review' });
  }

  // Tax deadlines: from 3 weeks ahead until the day itself
  const crew = db.crew_payouts.some((c) => (c.paid_on || c.work_date || '').startsWith(String(Number(today.slice(0, 4)) - 1)));
  for (const t of taxDates(today, { quarterly: num(db.profile.tax_set_aside_pct) > 0, crew })) {
    if (t.date < today || t.date > addDays(today, 21)) continue;
    items.push({ key: `t${t.kind}${t.date}${t.title}`, icon: 'file', tone: t.date === today ? 'bad' : 'warn', title: t.title, sub: t.sub, at: null, when: ahead(t.date, today), go: t.go, upcoming: t.date, urgent: t.date === today });
  }

  // Urgent first, then things to do, then what happened (newest first), then what's coming (soonest first).
  const rank = (x) => (x.urgent ? 0 : x.todo ? 1 : x.upcoming ? 3 : 2);
  return items.sort((a, b) => rank(a) - rank(b)
    || (a.upcoming && b.upcoming ? a.upcoming.localeCompare(b.upcoming) : String(b.at || '').localeCompare(String(a.at || ''))));
}
