// The full "add a receipt" pipeline: duplicate check → scan → upload → read with AI → duplicate check again → save.
import { sha256, extFor } from './files.js';
import { scanReceipt, shrinkOriginal, compressPhoto, orientationChoices, turnedFile } from './scan.js';
import { round2 } from './format.js';
import { pdfText, pdfFirstPageImage, pdfToJpeg, blobToBase64 } from './pdftext.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Degrees to turn a photo clockwise so its text is upright (0 when unsure). */
export async function uprightTurn(api, file) {
  try {
    const { options, picture } = await orientationChoices(file);
    const res = await api.readReceipt(null, 'image/jpeg', { mode: 'upright', image_b64: await blobToBase64(picture), image_mime: 'image/jpeg' });
    return res?.upright === 'B' ? options[1] : options[0];
  } catch {
    return 0;
  }
}

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
export const BIG_PDF = 5 * 1024 * 1024;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** A PDF over 5 MB: offer to keep a JPEG of its pages instead. Returns the JPEG blob, or null to keep the PDF. */
async function maybeShrinkPdf(file, confirm) {
  if (file.size <= BIG_PDF || !confirm) return null;
  try {
    const { blob } = await pdfToJpeg(file);
    if (!blob || blob.size >= file.size * 0.7) return null;
    const ok = await confirm({
      title: 'Save a smaller copy?',
      body: `This PDF is ${mb(file.size)}. Saved as a picture it's ${mb(blob.size)}.`,
      ok: 'Save smaller copy', cancel: 'Keep PDF',
    });
    return ok ? blob : null;
  } catch {
    return null;
  }
}

export async function addReceiptFile(file, { api, receipts, onStep = () => {}, invoiceId = null, billable = false, mode = 'clean', confirm = null }) {
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
    let readWith = {};
    let scanned = null;
    let photo = file;
    if (isPdf) {
      onStep('Reading the PDF…');
      try {
        const text = await pdfText(file, 3);
        if (text.replace(/\s/g, '').length > 30) readWith = { text };
        else readWith = { image_b64: await blobToBase64(await pdfFirstPageImage(file)), image_mime: 'image/jpeg' };
      } catch (e) {
        console.warn('PDF read failed', e);
      }
      const jpg = await maybeShrinkPdf(file, confirm);
      onStep('Uploading…');
      mime = jpg ? 'image/jpeg' : 'application/pdf';
      fileKey = await api.files.upload(jpg || file, { folder: 'receipts', ext: jpg ? 'jpg' : 'pdf' });
      uploaded.push(fileKey);
    } else {
      onStep('Turning it the right way up…');
      photo = await turnedFile(file, await uprightTurn(api, file)).catch(() => file);
      onStep('Straightening and cleaning up…');
      let scan;
      try {
        scan = await scanReceipt(photo, { mode });
      } catch (e) {
        return { status: 'error', message: `${file.name}: this photo format can't be opened here. Try a JPEG or PNG. (${e.message})` };
      }
      cropped = scan.cropped;
      scanned = scan;
      mime = 'image/jpeg';
      readWith = { image_b64: await blobToBase64(scan.read), image_mime: 'image/jpeg' };
    }

    onStep('Reading the receipt…');
    let ai = null;
    try {
      ai = await api.readReceipt(fileKey, mime, readWith);
    } catch (e) {
      ai = { error: e.message };
    }
    if (!isPdf) {
      // Read first (from the sharp copy), then store the compressed copies.
      onStep('Uploading…');
      const original = await shrinkOriginal(photo);
      [fileKey, originalKey] = await Promise.all([
        api.files.upload(scanned.scan, { folder: 'receipts', ext: 'jpg' }),
        api.files.upload(original, { folder: 'originals', ext: extFor(original.type, 'jpg') }),
      ]);
      uploaded.push(fileKey, originalKey);
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
      ai: { ...(ai || {}), cropped, file_name: file.name, compressed: true },
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

/**
 * Puts a file on an existing receipt (one imported without a file, or a swap). Photos are stored as taken
 * (no cleanup), turned upright and compressed. Old files are deleted after the new ones are saved.
 */
export async function attachToReceipt(s, r, file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  if (!isPdf && !isImage) throw new Error('Only photos and PDFs can be added');
  const hash = await sha256(file);
  const up = (blob, folder, ext) => s.api.files.upload(blob, { folder, ext });
  let patch;
  const twin = s.db.receipts.find((x) => x.id !== r.id && x.file_hash === hash);
  if (twin) throw Object.assign(new Error('This file is already saved on another receipt.'), { twin });
  if (isPdf) {
    const jpg = await maybeShrinkPdf(file, s.confirm);
    patch = jpg
      ? { file_key: await up(jpg, 'receipts', 'jpg'), original_key: null, mime: 'image/jpeg', ai: { ...(r.ai || {}), compressed: true } }
      : { file_key: await up(file, 'receipts', 'pdf'), original_key: null, mime: 'application/pdf' };
  } else {
    // Kept as the photo (no cleanup), just turned upright and compressed.
    try {
      const blob = await compressPhoto(file, { turn: await uprightTurn(s.api, file) });
      patch = { file_key: await up(blob, 'receipts', 'jpg'), original_key: null, mime: 'image/jpeg', ai: { ...(r.ai || {}), compressed: true } };
    } catch {
      // A format this browser can't open (e.g. HEIC outside Safari): store as is.
      patch = { file_key: await up(file, 'receipts', extFor(file.type, 'jpg')), original_key: null, mime: file.type || 'image/jpeg' };
    }
  }
  const old = [r.file_key, r.original_key].filter(Boolean);
  await s.update('receipts', r.id, { ...patch, file_hash: hash });
  if (old.length) await s.api.files.remove(old).catch(() => {});
  return old.length ? 'replaced' : 'added';
}
