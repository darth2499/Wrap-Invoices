// Finds shoot days from invoices: the dates written into line descriptions like "Press junket (05/02-05/03, 05/06)"
// (basic editor) or the days picked in the advanced editor's jobs.
import { addDays } from './format.js';

const CODE = /\((\d{2}\/\d{2}(?:-\d{2}\/\d{2})?(?:,\s*\d{2}\/\d{2}(?:-\d{2}\/\d{2})?)*)\)/;

/** "05/02-05/04, 05/06" + the invoice date → ['2026-05-02','2026-05-03','2026-05-04','2026-05-06'] */
export function datesFromCode(code, issueISO) {
  const y0 = Number(String(issueISO || '').slice(0, 4)) || new Date().getFullYear();
  const m0 = Number(String(issueISO || '').slice(5, 7)) || 12;
  const iso = (md) => {
    const [m, d] = md.split('/').map(Number);
    const y = m > m0 + 2 ? y0 - 1 : y0; // December work on a January invoice belongs to last year
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const out = [];
  for (const part of code.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [a, b] = part.split('-');
    let d = iso(a);
    const end = b ? iso(b) : d;
    for (let k = 0; d <= end && k < 62; k++, d = addDays(d, 1)) out.push(d);
  }
  return out;
}

/** [{ date, invoiceId, label }] — one entry per shoot day per job on each invoice/quote (void ones skipped). */
export function shootDays(invoices, linesFor) {
  const out = [];
  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    const seen = new Set();
    const add = (date, label) => {
      const k = `${date}|${label}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ date, invoiceId: inv.id, label });
    };
    if (inv.mode === 'advanced' && inv.jobs?.jobs?.length) {
      for (const job of inv.jobs.jobs) for (const d of job.days || []) if (d.date) add(d.date, job.company || 'Shoot');
      continue;
    }
    const lines = linesFor(inv.id);
    // Work lines first; gear/expense lines (parking, meals) only count if there's no work line with dates.
    const work = lines.filter((l) => (!l.kind || l.kind === 'labor') && CODE.test(l.description || ''));
    for (const l of work.length ? work : lines.filter((x) => CODE.test(x.description || ''))) {
      const m = String(l.description).match(CODE);
      const label = String(l.description).slice(0, m.index).trim() || l.item || 'Shoot';
      for (const d of datesFromCode(m[1], inv.issue_date)) add(d, label);
    }
  }
  return out;
}
