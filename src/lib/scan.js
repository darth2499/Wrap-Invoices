// Receipt scanning in the browser, no big libraries:
//   1. find the paper (bright shape on a darker background),
//   2. straighten it (perspective correction),
//   3. clean it up: even out shadows, then push paper to white and ink to black.

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toCanvas(src, maxSide) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const blobOf = (canvas, type = 'image/jpeg', q = 0.86) => new Promise((r) => canvas.toBlob(r, type, q));

function grayOf(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return g;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function otsu(g) {
  const hist = new Float64Array(256);
  for (const v of g) hist[Math.max(0, Math.min(255, v | 0))]++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
const triArea = (a, b, c) => Math.abs(cross(a, b, c)) / 2;
const polyArea = (ps) => Math.abs(ps.reduce((s, p, i) => s + (p.x * ps[(i + 1) % ps.length].y - ps[(i + 1) % ps.length].x * p.y), 0)) / 2;

/** Reduce a convex polygon to 4 corners by repeatedly dropping the least important vertex. */
function toQuad(hull) {
  const ps = [...hull];
  while (ps.length > 4) {
    let best = 0, bestA = Infinity;
    for (let i = 0; i < ps.length; i++) {
      const a = triArea(ps[(i - 1 + ps.length) % ps.length], ps[i], ps[(i + 1) % ps.length]);
      if (a < bestA) { bestA = a; best = i; }
    }
    ps.splice(best, 1);
  }
  return ps;
}

function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // sorted clockwise starting from the left-ish; rotate so the first is top-left (smallest x+y)
  let start = 0;
  sorted.forEach((p, i) => { if (p.x + p.y < sorted[start].x + sorted[start].y) start = i; });
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]); // tl, tr, br, bl (clockwise in screen coords)
}

/** Finds the receipt's 4 corners in a small analysis image, or null. */
export function findPaper(canvas) {
  const { width: w, height: h } = canvas;
  const g = boxBlur(grayOf(canvas), w, h, 2);
  const t = otsu(g);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) mask[i] = g[i] > t ? 1 : 0;
  // Largest bright connected region.
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1, bestSize = 0, bestTouches = 0;
  const stack = new Int32Array(w * h);
  let id = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    let sp = 0, size = 0, touches = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches++;
      if (x > 0 && mask[i - 1] && label[i - 1] === -1) { label[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && label[i + 1] === -1) { label[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && label[i - w] === -1) { label[i - w] = id; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && label[i + w] === -1) { label[i + w] = id; stack[sp++] = i + w; }
    }
    if (size > bestSize) { bestSize = size; bestId = id; bestTouches = touches; }
    id++;
  }
  const area = w * h;
  if (bestId < 0 || bestSize < area * 0.08) return null;
  // A region hugging the whole border is the background, not a receipt.
  if (bestTouches > 2 * (w + h) * 0.6) return null;
  const pts = [];
  for (let y = 0; y < h; y++) {
    let minX = -1, maxX = -1;
    for (let x = 0; x < w; x++) if (label[y * w + x] === bestId) { if (minX < 0) minX = x; maxX = x; }
    if (minX >= 0) pts.push({ x: minX, y }, { x: maxX + 1, y });
  }
  const hull = convexHull(pts);
  if (hull.length < 4) return null;
  const quad = toQuad(hull);
  const qa = polyArea(quad);
  // The quad should explain the region well and not be the whole photo.
  if (qa < bestSize * 0.85 || qa > area * 0.97) return null;
  return orderCorners(quad);
}

/** Solves the 3×3 homography mapping dst(u,v) → src(x,y) from 4 point pairs. */
function homography(dst, src) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i];
    const { x, y } = src[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  // Gaussian elimination
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const hm = b.map((v, i) => v / A[i][i]);
  return [...hm, 1];
}

function warp(canvas, corners) {
  const [tl, tr, br, bl] = corners;
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const W = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  const H = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  const H9 = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], [tl, tr, br, bl]);
  const sw = canvas.width;
  const sh = canvas.height;
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: true });
  const img = octx.createImageData(W, H);
  const o = img.data;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const den = H9[6] * u + H9[7] * v + 1;
      const x = (H9[0] * u + H9[1] * v + H9[2]) / den;
      const y = (H9[3] * u + H9[4] * v + H9[5]) / den;
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x)));
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(y)));
      const fx = Math.min(1, Math.max(0, x - x0));
      const fy = Math.min(1, Math.max(0, y - y0));
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const oi = (v * W + u) * 4;
      for (let k = 0; k < 3; k++) {
        o[oi + k] = (src[i00 + k] * (1 - fx) + src[i10 + k] * fx) * (1 - fy) + (src[i01 + k] * (1 - fx) + src[i11 + k] * fx) * fy;
      }
      o[oi + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Even out lighting and make text crisp. mode 'clean' keeps faint print; 'bw' is pure black & white. */
function enhance(canvas, mode = 'clean') {
  const { width: w, height: h } = canvas;
  const g = grayOf(canvas);
  // Background brightness: max over blocks (paper is the brightest thing), then smooth.
  const bs = Math.max(8, Math.round(Math.max(w, h) / 60));
  const bw = Math.ceil(w / bs);
  const bh = Math.ceil(h / bs);
  let bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const vals = [];
      for (let y = by * bs; y < Math.min(h, (by + 1) * bs); y += 2) for (let x = bx * bs; x < Math.min(w, (bx + 1) * bs); x += 2) vals.push(g[y * w + x]);
      vals.sort((a, b) => a - b);
      bg[by * bw + bx] = vals[Math.floor(vals.length * 0.9)] || 255;
    }
  }
  bg = boxBlur(bg, bw, bh, 2);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const norm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1.001, Math.max(0, y / bs - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1.001, Math.max(0, x / bs - 0.5));
      const x0 = Math.floor(fx), tx = fx - x0;
      const b00 = bg[y0 * bw + x0], b10 = bg[y0 * bw + Math.min(bw - 1, x0 + 1)];
      const b01 = bg[Math.min(bh - 1, y0 + 1) * bw + x0], b11 = bg[Math.min(bh - 1, y0 + 1) * bw + Math.min(bw - 1, x0 + 1)];
      const b = (b00 * (1 - tx) + b10 * tx) * (1 - ty) + (b01 * (1 - tx) + b11 * tx) * ty;
      norm[y * w + x] = Math.min(255, (g[y * w + x] / Math.max(1, b)) * 255);
    }
  }
  // Levels: paper → white, ink → black, with a gentle curve so faint thermal print survives.
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, Math.max(0, (i - 90) / (232 - 90)));
    lut[i] = Math.round(255 * Math.pow(v, 1.5));
  }
  if (mode === 'bw') {
    const local = boxBlur(norm, w, h, Math.max(6, Math.round(Math.max(w, h) / 80)));
    for (let i = 0; i < norm.length; i++) {
      const v = norm[i] < local[i] - 12 ? 0 : 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    }
  } else {
    for (let i = 0; i < norm.length; i++) {
      const v = lut[norm[i] | 0];
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Scan a receipt photo. Returns { scan: Blob (JPEG), cropped, width, height }.
 * mode: 'clean' (sharp grayscale, default) or 'bw' (pure black & white).
 */
export async function scanReceipt(file, { mode = 'clean', crop = true } = {}) {
  const bmp = await decode(file);
  const full = toCanvas(bmp, 2400);
  let page = full;
  let cropped = false;
  if (crop) {
    try {
      const small = toCanvas(full, 480);
      const corners = findPaper(small);
      if (corners) {
        const s = full.width / small.width;
        // Pull the corners in a touch so no dark table edge sneaks into the scan.
        const cx = corners.reduce((t, p) => t + p.x, 0) / 4;
        const cy = corners.reduce((t, p) => t + p.y, 0) / 4;
        page = warp(full, corners.map((p) => ({ x: (cx + (p.x - cx) * 0.985) * s, y: (cy + (p.y - cy) * 0.985) * s })));
        cropped = true;
      }
    } catch (e) {
      console.warn('Crop failed', e);
    }
  }
  const sized = toCanvas(page, 2000);
  const cleaned = enhance(sized, mode);
  // Read from the sharp version first; what's stored is a lighter copy (still easy to read, a fraction of the size).
  const read = await blobOf(cleaned, 'image/jpeg', 0.85);
  const scan = await blobOf(toCanvas(cleaned, 1600), 'image/jpeg', 0.72);
  return { scan, read, cropped, width: cleaned.width, height: cleaned.height };
}

/** Shrinks a big original photo before storing it (keeps it readable, saves space). */
export async function shrinkOriginal(file, maxSide = 2000) {
  if (!file.type.startsWith('image/') || file.size < 600 * 1024) return file;
  try {
    const bmp = await decode(file);
    const out = await blobOf(toCanvas(bmp, maxSide), 'image/jpeg', 0.78);
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

/**
 * Logo before upload: at most 800 px wide/tall, saved as PNG (keeps a transparent background, and the
 * server-made PDF can use it). Small PNG/JPEG logos (under 150 KB) go up as they are.
 */
export async function shrinkLogo(file) {
  const keep = /image\/(png|jpeg)/.test(file.type);
  if (keep && file.size < 150 * 1024) return file;
  try {
    const png = await blobOf(toCanvas(await decode(file), 800), 'image/png');
    return png && (!keep || png.size < file.size) ? png : file;
  } catch {
    return file;
  }
}

/** Turns a canvas clockwise by 90, 180 or 270 degrees. */
function turned(src, deg) {
  if (!deg) return src;
  const c = document.createElement('canvas');
  const side = deg % 180 !== 0;
  c.width = side ? src.height : src.width;
  c.height = side ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/**
 * True when the text in a photo runs up/down (the photo is sideways). Printed lines make the ink very uneven
 * from row to row (line, gap, line…) and much smoother across; sideways, it's the other way round.
 */
function looksSideways(src) {
  const c = toCanvas(src, 360);
  const { width: w, height: h } = c;
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0; i < w * h; i++) { g[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11; mean += g[i]; }
  mean /= w * h;
  const rows = new Float32Array(h);
  const cols = new Float32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (g[y * w + x] < mean - 40) { rows[y]++; cols[x]++; } }
  // Gaps between printed lines are rows with (almost) no ink running the whole width; sideways, they're columns.
  const gaps = (a) => {
    let lo = 0; let hi = a.length - 1;
    while (lo < hi && a[lo] === 0) lo++;
    while (hi > lo && a[hi] === 0) hi--;
    let peak = 0; for (let i = lo; i <= hi; i++) peak = Math.max(peak, a[i]);
    let n = 0; for (let i = lo; i <= hi; i++) if (a[i] <= peak * 0.04) n++;
    return hi > lo ? n / (hi - lo + 1) : 0;
  };
  const r = gaps(rows);
  const k = gaps(cols);
  return k > r * 1.5 + 0.04;
}

/**
 * Which way is up, step 1 (in the browser): printed lines show whether the photo is sideways, which leaves two
 * possible turns (0 or 180, or 90 or 270). Both are drawn side by side, labeled A and B, for the reader to pick from.
 */
export async function orientationChoices(file) {
  const bmp = await decode(file);
  const options = looksSideways(bmp) ? [90, 270] : [0, 180];
  const [a, b] = options.map((d) => turned(toCanvas(bmp, 640), d));
  const band = 56;
  const c = document.createElement('canvas');
  c.width = a.width + b.width + 24;
  c.height = Math.max(a.height, b.height) + band;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(a, 0, band);
  ctx.drawImage(b, a.width + 24, band);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('A', 12, 44);
  ctx.fillText('B', a.width + 36, 44);
  return { options, picture: await blobOf(c, 'image/jpeg', 0.8) };
}

/** The photo turned clockwise by `turn` degrees, at full quality (for the scan pipeline to work on). */
export async function turnedFile(file, turn) {
  if (!turn) return file;
  const blob = await blobOf(turned(toCanvas(await decode(file), 3000), turn), 'image/jpeg', 0.92);
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/** The photo as it will be stored: turned, at most `maxSide` px, JPEG. */
export async function compressPhoto(file, { maxSide = 2000, quality = 0.8, turn = 0 } = {}) {
  const bmp = await decode(file);
  return blobOf(turned(toCanvas(bmp, maxSide), turn), 'image/jpeg', quality);
}

/** A stored photo turned by hand (the rotate button). */
export async function rotatePhoto(blob, deg = 90) {
  const bmp = await decode(blob);
  return blobOf(turned(toCanvas(bmp, 2400), deg), 'image/jpeg', 0.82);
}

