// Ready-made logos built from your business name and accent color — no upload, no storage used.
// The same shapes are drawn on screen (SVG) and in the PDF (pdf.js), so they always match.

export const LOGO_PRESETS = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'ring', label: 'Ring' },
  { id: 'bar', label: 'Bar' },
  { id: 'stack', label: 'Stacked' },
];

/** "Alex Rivera Films" → "AR". */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  return ((words[0]?.[0] || 'W') + (words[1]?.[0] || '')).toUpperCase();
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The preset as an SVG data URL (for <img>), sized ~ 240×64. */
export function presetLogoUrl(id, name, accent = '#16161A') {
  const ini = esc(initialsOf(name));
  const nm = esc(String(name || '').toUpperCase());
  const font = "font-family='Helvetica, Arial, sans-serif' font-weight='700'";
  let body;
  let w = 64;
  if (id === 'circle') body = `<circle cx='32' cy='32' r='30' fill='${accent}'/><text x='32' y='40' text-anchor='middle' font-size='22' fill='#fff' ${font}>${ini}</text>`;
  else if (id === 'square') body = `<rect x='2' y='2' width='60' height='60' rx='14' fill='${accent}'/><text x='32' y='40' text-anchor='middle' font-size='22' fill='#fff' ${font}>${ini}</text>`;
  else if (id === 'ring') body = `<circle cx='32' cy='32' r='28' fill='none' stroke='${accent}' stroke-width='4'/><text x='32' y='40' text-anchor='middle' font-size='21' fill='${accent}' ${font}>${ini}</text>`;
  else if (id === 'bar') { w = 260; body = `<rect x='0' y='8' width='6' height='48' fill='${accent}'/><text x='18' y='42' font-size='22' fill='#16161a' ${font} letter-spacing='1'>${nm}</text>`; }
  else { // stack
    w = 220;
    const [a, ...rest] = String(name || '').toUpperCase().split(/\s+/);
    body = `<text x='0' y='26' font-size='22' fill='#16161a' ${font}>${esc(a || '')}</text><text x='0' y='52' font-size='22' fill='${accent}' ${font}>${esc(rest.join(' '))}</text>`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='64' viewBox='0 0 ${w} 64'>${body}</svg>`)}`;
}

/**
 * Draws the preset in a PDF (pdf-lib page) with its top-left at (x, top). Returns the height used.
 * fonts: { bold }, rgb: pdf-lib's rgb(), color: accent as pdf-lib color.
 */
export function drawPresetLogo(page, { id, name, color, white, ink, bold, x, top }) {
  const ini = initialsOf(name);
  const h = 52;
  const cx = x + h / 2;
  const cy = top - h / 2;
  const center = (t, size, c) => page.drawText(t, { x: cx - bold.widthOfTextAtSize(t, size) / 2, y: cy - size * 0.36, size, font: bold, color: c });
  if (id === 'circle') { page.drawCircle({ x: cx, y: cy, size: h / 2, color }); center(ini, 18, white); }
  else if (id === 'square') { page.drawSvgPath(`M12 0 H40 Q52 0 52 12 V40 Q52 52 40 52 H12 Q0 52 0 40 V12 Q0 0 12 0 Z`, { x, y: top, color }); center(ini, 18, white); }
  else if (id === 'ring') { page.drawCircle({ x: cx, y: cy, size: h / 2 - 2, borderColor: color, borderWidth: 3 }); center(ini, 17, color); }
  else if (id === 'bar') { page.drawRectangle({ x, y: top - 44, width: 5, height: 40, color }); page.drawText(String(name || '').toUpperCase(), { x: x + 14, y: top - 30, size: 17, font: bold, color: ink }); return 46; }
  else { const [a, ...rest] = String(name || '').toUpperCase().split(/\s+/); page.drawText(a || '', { x, y: top - 18, size: 17, font: bold, color: ink }); page.drawText(rest.join(' '), { x, y: top - 40, size: 17, font: bold, color }); return 46; }
  return h;
}
