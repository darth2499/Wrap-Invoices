// The full "add a receipt" pipeline: duplicate check → scan → upload → read with AI → duplicate check again → save.
import { sha256, extFor } from './files.js';
import { scanReceipt, shrinkOriginal } from './scan.js';
import { round2 } from './format.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** True if two receipts look like the same purchase (same day, same total, similar vendor). */
export function looksSame(a, b) {
  if (!a.receipt_date || !b.receipt_date || a.receipt_date !== b.receipt_date) return false;
  if (a.total == null || b.total == null || Math.abs(Number(a.total) - Number(b.total)) > 0.009) return false;
  const va = norm(a.vendor);
  const vb = norm(b.vendor);
  if (!va || !vb) return true;
  return va.includes(vb) || vb.includes(va) || va.slice(0, 5) === vb.slice(0, 5);
}

/**
 * Adds one receipt file. Returns { status: 'added'|'duplicate'|'error', receipt?, message }.
 * ctx: { api, receipts (existing list), onStep(text) }
 */
export async function addReceiptFile(file, { api, receipts, onStep = () => {}, invoiceId = null, billable = false, mode = 'clean' }) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  if (!isPdf && !isImage) return { status: 'error', message: `${file.name}: only photos and PDFs can be added` };

  onStep('Checking for duplicates…');
  const hash = await sha256(file);
  const same = receipts.find((r) => r.file_hash === hash);
  if (same) return { status: 'duplicate', message: `${file.name} is already saved (${same.vendor || 'receipt'}${same.total != null ? `, $${Number(same.total).toFixed(2)}` : ''}) — skipped.`, existing: same };

  const uploaded = [];
  try {
    let fileKey;
    let originalKey = null;
    let mime;
    let cropped = false;
    if (isPdf) {
      onStep('Uploading PDF…');
      mime = 'application/pdf';
      fileKey = await api.files.upload(file, { folder: 'receipts', ext: 'pdf' });
      uploaded.push(fileKey);
    } else {
      onStep('Straightening and cleaning up…');
      let scan;
      try {
        scan = await scanReceipt(file, { mode });
      } catch (e) {
        return { status: 'error', message: `${file.name}: this photo format can't be opened here. Try a JPEG or PNG. (${e.message})` };
      }
      cropped = scan.cropped;
      mime = 'image/jpeg';
      onStep('Uploading…');
      const original = await shrinkOriginal(file);
      [fileKey, originalKey] = await Promise.all([
        api.files.upload(scan.scan, { folder: 'receipts', ext: 'jpg' }),
        api.files.upload(original, { folder: 'originals', ext: extFor(original.type, 'jpg') }),
      ]);
      uploaded.push(fileKey, originalKey);
    }

    onStep('Reading the receipt…');
    let ai = null;
    try {
      ai = await api.readReceipt(fileKey, mime);
    } catch (e) {
      ai = { error: e.message };
    }
    const row = {
      vendor: ai?.vendor || null,
      receipt_date: /^\d{4}-\d{2}-\d{2}$/.test(ai?.date || '') ? ai.date : null,
      total: ai?.total_paid != null ? round2(ai.total_paid) : null,
      subtotal: ai?.subtotal ?? null,
      tax: ai?.tax ?? null,
      tip: ai?.tip ?? null,
      category: ai?.category || null,
      file_key: fileKey,
      original_key: originalKey,
      mime,
      file_hash: hash,
      status: 'review',
      invoice_id: invoiceId,
      billable,
      ai: { ...(ai || {}), cropped, file_name: file.name },
    };

    const twin = receipts.find((r) => looksSame(r, row));
    if (twin) {
      // Same day + same amount + same place: almost certainly the same receipt (e.g. emailed copy + photo).
      // The caller can still keep it (two identical parking stubs happen) — otherwise discard() cleans up.
      return {
        status: 'duplicate', fuzzy: true, row,
        message: `${row.vendor || file.name} on ${row.receipt_date} for $${row.total?.toFixed(2)} looks like one you already saved — skipped.`,
        existing: twin,
        keep: () => api.insert('receipts', { ...row, ai: { ...row.ai, kept_possible_duplicate: true } }),
        discard: () => api.files.remove(uploaded).catch(() => {}),
      };
    }

    onStep('Saving…');
    try {
      const saved = await api.insert('receipts', row);
      return { status: 'added', receipt: saved, message: ai?.error ? `Saved, but couldn't read it automatically: ${ai.error}` : null };
    } catch (e) {
      if (/file_hash/.test(e.message)) {
        await api.files.remove(uploaded);
        return { status: 'duplicate', message: `${file.name} is already saved — skipped.` };
      }
      throw e;
    }
  } catch (e) {
    await api.files.remove(uploaded).catch(() => {});
    return { status: 'error', message: `${file.name}: ${e.message}` };
  }
}
