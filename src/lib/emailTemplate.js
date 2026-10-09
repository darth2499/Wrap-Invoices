// The emails clients receive (invoice, reminder, quote, statement), styled like Wrap.
// Plain JS with no imports so the same file runs in the app (live preview) and on the server
// (copied into supabase/functions/_shared/web by scripts/sync-shared.mjs).
// Email apps ignore most modern CSS, so this uses tables and inline styles only.

const C = {
  bg: '#f6f6f4', card: '#ffffff', ink: '#16161a', ink2: '#45464d', muted: '#5f6168', faint: '#9a9ba1',
  line: '#e6e6e2', line2: '#efefec', sunken: '#f1f1ee',
  bad: '#b42318', badBg: '#fdecea', warn: '#8a4b0b', warnBg: '#fff1e0', good: '#0b5e52', goodBg: '#e3f4ef', accentInk: '#2433a8', accentBg: '#e8edff',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export const money = (v) => `${n(v) < 0 ? '-' : ''}$${Math.abs(n(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const shortDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const daysPast = (iso, today) => (iso ? Math.floor((new Date(`${today}T12:00:00`) - new Date(`${String(iso).slice(0, 10)}T12:00:00`)) / 86400000) : 0);
const plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;

function pill(text, tone) {
  const t = { bad: [C.badBg, C.bad], warn: [C.warnBg, C.warn], good: [C.goodBg, C.good], info: [C.accentBg, C.accentInk], plain: [C.sunken, C.ink2] }[tone] || [C.sunken, C.ink2];
  return `<span style="display:inline-block;background:${t[0]};color:${t[1]};font-size:12px;font-weight:600;line-height:1;padding:6px 10px;border-radius:999px;white-space:nowrap">${esc(text)}</span>`;
}

function shell({ business, preheader, body, footer }) {
  const initial = esc((business.name || 'W').trim().charAt(0).toUpperCase());
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(preheader)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}">
<tr><td align="center" style="padding:28px 14px 36px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};color:${C.ink}">
<tr><td style="padding:0 2px 18px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:32px;height:32px;background:${C.ink};color:#ffffff;border-radius:9px;text-align:center;vertical-align:middle;font-size:15px;font-weight:700">${initial}</td>
    <td style="padding-left:10px;font-size:15px;font-weight:600">${esc(business.name)}</td>
  </tr></table>
</td></tr>
${body}
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:${C.faint}">
  ${[business.name, business.email, business.phone, business.website].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}
  ${footer ? `<br>${footer}` : ''}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function messageBlock(message) {
  return message?.trim()
    ? `<tr><td style="padding:0 2px 20px;font-size:15px;line-height:1.65;color:${C.ink};white-space:pre-line">${esc(message.trim())}</td></tr>`
    : '';
}

function button(href, label, accent) {
  const bg = /^#[0-9a-f]{3,8}$/i.test(accent || '') ? accent : C.ink;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr>
    <td style="background:${bg};border-radius:10px"><a href="${esc(href)}" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)} &rarr;</a></td>
  </tr></table>`;
}

const metaRow = (k, v, strong) => `<tr>
  <td style="padding:7px 0;font-size:13px;color:${C.muted}">${esc(k)}</td>
  <td align="right" style="padding:7px 0;font-size:13px;color:${C.ink};${strong ? 'font-weight:600' : ''}">${esc(v)}</td>
</tr>`;

/**
 * Invoice, quote or reminder email.
 * e: { kind, number, issueDate, dueDate, total, paid, link, business:{name,email,phone,website}, accent,
 *      clientName, notes, lines:[{item, description, amount}], receiptCount, paymentInstructions, message, isReminder, today }
 */
export function buildInvoiceEmail(e) {
  const today = e.today || new Date().toISOString().slice(0, 10);
  const isQuote = e.kind === 'quote';
  const label = isQuote ? 'Quote' : 'Invoice';
  const due = Math.max(0, n(e.total) - n(e.paid));
  const late = !isQuote && e.dueDate ? daysPast(e.dueDate, today) : 0;
  const status = isQuote
    ? [e.dueDate ? `Valid until ${shortDate(e.dueDate)}` : 'Quote', 'info']
    : late > 0 ? [`${plural(late, 'day')} overdue`, 'bad']
      : late === 0 && e.dueDate ? ['Due today', 'warn']
        : n(e.paid) > 0 ? ['Partly paid', 'warn']
          : [e.dueDate ? `Due ${shortDate(e.dueDate)}` : 'Open', 'info'];
  const big = isQuote ? n(e.total) : due;
  const sub = isQuote
    ? 'Quote total'
    : late > 0 ? `Was due ${longDate(e.dueDate)}` : e.dueDate ? `Amount due by ${longDate(e.dueDate)}` : 'Amount due';

  const lines = (e.lines || []).filter((l) => l.item || l.description || n(l.amount));
  const shown = lines.slice(0, 6);
  const items = shown.length
    ? `<tr><td style="padding:22px 0 6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.faint}">Items</td><td></td></tr>
      ${shown.map((l) => `<tr>
        <td style="padding:9px 12px 9px 0;border-top:1px solid ${C.line2};vertical-align:top">
          <div style="font-size:14px;font-weight:600;color:${C.ink}">${esc(l.item || 'Item')}</div>
          ${l.description ? `<div style="font-size:13px;line-height:1.5;color:${C.muted};white-space:pre-line">${esc(String(l.description).split('\n').slice(0, 3).join('\n'))}</div>` : ''}
        </td>
        <td align="right" style="padding:9px 0;border-top:1px solid ${C.line2};vertical-align:top;font-size:14px;color:${C.ink};white-space:nowrap">${money(l.amount)}</td>
      </tr>`).join('')}
      ${lines.length > shown.length ? `<tr><td colspan="2" style="padding:9px 0;border-top:1px solid ${C.line2};font-size:13px;color:${C.muted}">+ ${plural(lines.length - shown.length, 'more item')} on the ${label.toLowerCase()}</td></tr>` : ''}`
    : '';

  const card = `<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:26px 26px 24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="font-size:13px;color:${C.muted}">${label} #${esc(e.number)}${e.clientName ? ` &nbsp;·&nbsp; ${esc(e.clientName)}` : ''}</td>
      <td align="right">${pill(status[0], status[1])}</td>
    </tr>
    <tr><td colspan="2" style="padding-top:10px;font-size:36px;line-height:1.1;font-weight:600;letter-spacing:-0.02em;color:${C.ink}">${money(big)}</td></tr>
    <tr><td colspan="2" style="padding-top:6px;font-size:14px;color:${late > 0 ? C.bad : C.ink2}">${esc(sub)}</td></tr>
  </table>
  ${button(e.link, `View ${label.toLowerCase()}`, e.accent)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid ${C.line}">
    <tr><td style="height:8px"></td><td></td></tr>
    ${e.notes ? metaRow('For', e.notes) : ''}
    ${e.issueDate ? metaRow(`${label} date`, longDate(e.issueDate)) : ''}
    ${e.dueDate ? metaRow(isQuote ? 'Valid until' : 'Due date', longDate(e.dueDate)) : ''}
    ${metaRow(`${label} total`, money(e.total))}
    ${!isQuote && n(e.paid) > 0 ? metaRow('Paid so far', `-${money(e.paid)}`) : ''}
    ${!isQuote ? metaRow('Amount due', money(due), true) : ''}
    ${items}
  </table>
</td></tr>`;

  const pay = !isQuote && e.paymentInstructions?.trim()
    ? `<tr><td style="padding-top:14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${C.sunken};border-radius:12px;padding:16px 18px">
        <div style="font-size:13px;font-weight:600;color:${C.ink};padding-bottom:4px">How to pay</div>
        <div style="font-size:13px;line-height:1.6;color:${C.ink2};white-space:pre-line">${esc(e.paymentInstructions.trim())}</div>
      </td></tr></table></td></tr>`
    : '';

  const html = shell({
    business: e.business || {},
    preheader: isQuote ? `Quote #${e.number}: ${money(e.total)}` : `${e.isReminder ? 'Reminder — ' : ''}Invoice #${e.number}: ${money(due)} ${late > 0 ? `${plural(late, 'day')} overdue` : 'due'}`,
    body: messageBlock(e.message) + card + pay,
    footer: isQuote ? 'This link is private to you.' : 'This link is private to you and stays active until the invoice is paid.',
  });

  const text = [
    e.message?.trim(),
    '',
    `${label} #${e.number}${e.clientName ? ` · ${e.clientName}` : ''}`,
    `${isQuote ? 'Total' : 'Amount due'}: ${money(big)} (${status[0]})`,
    e.issueDate ? `${label} date: ${longDate(e.issueDate)}` : '',
    e.dueDate ? `${isQuote ? 'Valid until' : 'Due date'}: ${longDate(e.dueDate)}` : '',
    !isQuote && n(e.paid) > 0 ? `Paid so far: ${money(e.paid)} of ${money(e.total)}` : '',
    '',
    `View the ${label.toLowerCase()}${!isQuote && e.receiptCount ? ' and receipts' : ''}:`,
    e.link,
    !isQuote && e.paymentInstructions?.trim() ? `\nHow to pay:\n${e.paymentInstructions.trim()}` : '',
    '',
    `— ${e.business?.name || ''}`,
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { html, text };
}

/**
 * Statement email: every open invoice for one client.
 * e: { link, business, accent, clientName, message, invoices:[{number, issueDate, dueDate, due}], today }
 */
export function buildStatementEmail(e) {
  const today = e.today || new Date().toISOString().slice(0, 10);
  const invs = e.invoices || [];
  const total = invs.reduce((t, i) => t + n(i.due), 0);
  const overdue = invs.filter((i) => i.dueDate && daysPast(i.dueDate, today) > 0);
  const rows = invs.slice(0, 12).map((i) => {
    const late = i.dueDate ? daysPast(i.dueDate, today) : 0;
    return `<tr>
      <td style="padding:10px 10px 10px 0;border-top:1px solid ${C.line2};font-size:14px;font-weight:600;color:${C.ink};white-space:nowrap">#${esc(i.number)}</td>
      <td style="padding:10px 10px 10px 0;border-top:1px solid ${C.line2};font-size:13px;color:${late > 0 ? C.bad : C.muted}">${late > 0 ? `${plural(late, 'day')} overdue` : i.dueDate ? `Due ${shortDate(i.dueDate)}` : shortDate(i.issueDate)}</td>
      <td align="right" style="padding:10px 0;border-top:1px solid ${C.line2};font-size:14px;color:${C.ink};white-space:nowrap">${money(i.due)}</td>
    </tr>`;
  }).join('');
  const card = `<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:26px 26px 22px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="font-size:13px;color:${C.muted}">Statement${e.clientName ? ` &nbsp;·&nbsp; ${esc(e.clientName)}` : ''}</td>
      <td align="right">${overdue.length ? pill(`${overdue.length} overdue`, 'bad') : pill(plural(invs.length, 'open invoice'), 'info')}</td>
    </tr>
    <tr><td colspan="2" style="padding-top:10px;font-size:36px;line-height:1.1;font-weight:600;letter-spacing:-0.02em">${money(total)}</td></tr>
    <tr><td colspan="2" style="padding-top:6px;font-size:14px;color:${C.ink2}">Total still due across ${plural(invs.length, 'invoice')}</td></tr>
  </table>
  ${button(e.link, 'View statement', e.accent)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px">
    ${rows}
    ${invs.length > 12 ? `<tr><td colspan="3" style="padding:10px 0;border-top:1px solid ${C.line2};font-size:13px;color:${C.muted}">+ ${plural(invs.length - 12, 'more invoice')} on the statement</td></tr>` : ''}
  </table>
</td></tr>`;
  const html = shell({ business: e.business || {}, preheader: `Statement: ${money(total)} due`, body: messageBlock(e.message) + card, footer: e.hasReceipts === false ? 'Each invoice can be opened from the statement.' : 'Each invoice and its receipts can be opened from the statement.' });
  const text = [e.message?.trim(), '', `Statement — ${money(total)} due`, ...invs.map((i) => `#${i.number}  ${money(i.due)}${i.dueDate ? `  (due ${shortDate(i.dueDate)})` : ''}`), '', 'View your statement:', e.link, '', `— ${e.business?.name || ''}`].join('\n');
  return { html, text };
}
