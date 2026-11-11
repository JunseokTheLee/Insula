// 3D exhibition hall for a portfolio (stage 0 and stage 1, 2026-11-11).
//
// The portfolio opens here by default (js/portfolio.js; "2D" leaves, and a
// button on the page comes back). The hall is built from the portfolio's own
// artworks. A few works make one room: the cover hangs in the middle of the
// far wall under the portfolio's name, the rest go round the walls in the
// portfolio's order. Every wall is the same plain white (2026-11-11: the
// coloured title wall went, for a simpler room). More works make a suite of rooms
// ("Gallery 2, 3 …") joined by doorways that alternate right and left, so no
// room ever sees past its neighbours and only those are drawn, however long
// the suite gets. Every work hangs in a slim black frame on a white mat with
// a soft shadow, under the pool of a track spot, with a label card beside it
// whose lower edge is the "View large" button. The floor is polished white
// marble that faintly mirrors the room; skylights run down the ceiling.
//
// Visitors walk (W A S D / arrow keys / wheel; a joystick on touch screens),
// look round by dragging, tap the floor to walk there (through the doorways
// when it is another room), and tap an artwork or its label to walk up to it
// — the page's own lightbox then shows it large, with its stories, likes and
// comments. ‹ › step from work to work in hanging order.
//
// An ES module loaded on demand: three.js (jsDelivr's one-file bundle,
// pinned) arrives only when a hall opens. &g3dtest=N repeats the works up to
// N to try a full hall, and turns on window.__g3d for automated checks (with
// quality adaptation off, so test pictures show the real thing).
//
// Android lessons (css/tarot.css, 2026-10-10/11): the hall is one canvas,
// i.e. one GPU layer, under a few controls that keep layers of their own and
// are shown or hidden by opacity while the hall is walked; it draws only
// while something moves; and a device that turns out too slow drops the
// floor's reflection, then resolution, by itself.
//
// Needs tr, fmtCompletedYear and collectionItemCountText (js/i18n),
// escapeHtml, toast, screenHistory and artworkDisplayUrl (common.js) and
// openLightbox and closeLightbox (lightbox.js) loaded first.
// Styles: css/gallery3d.css.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.187.0/+esm';

// ---------- measurements (metres) ----------
const EYE = 1.6;
const NEAR = 0.2;
const ROOM_H = 4.2;
const PART_T = 0.3;                                    // walls between rooms
const DOOR_W = 2.2, DOOR_H = 3.0, DOOR_RETURN = 0.6;   // their doorways, set in from a side wall
const DOOR_MARGIN = 0.55;                              // no artwork closer to a doorway
const ENTRY_W = 1.9, ENTRY_H = 2.7;                    // the way in, behind the visitor
const HANG = 1.5, COVER_HANG = 1.55;                   // centre heights
const ART_H = 1.1, ART_W = 1.5, COVER_H = 1.4, COVER_W = 2.0;
const MAT = 0.075, BORDER = 0.026, FRAME_D = 0.045, BEVEL = 0.006;
const LABEL_W = 0.36, LABEL_H = 0.2, LABEL_GAP = 0.18, LABEL_Y = 1.3;
const MIN_GAP = 0.9, CORNER = 1.0;
const SINGLE_MAX_D = 12.5, HALL_W = 11, ROOM_D = 9.5;
const WALK = 1.6, RUN = 2.8, TURN = 1.8;               // m/s, m/s, rad/s
const KEEP_OFF = 0.5, EDGE_KEEP = 0.4;                 // never closer to a wall / to a doorway's edge
const FOCUS_DIST = 4.5, FOCUS_COS = Math.cos(0.4);
const HIRES_DIST = 3.6, HIRES_MAX = 2, HIRES_COS = Math.cos(1.0);
const PITCH_MAX = 0.62;
const REFLECT = 0.12;                                  // how much of the room the marble mirrors
// Layers out from a wall. With the near plane at 0.2 m the depth buffer
// resolves under 0.2 mm as far as the hall can be seen (two rooms, ~23 m),
// so 1.5 mm between layers never flickers.
const Z_HALO = 0.003, Z_SHADOW = 0.0045, Z_GAP = 0.0035, Z_FRAME = 0.006, Z_LABEL = 0.008;
const Z_MAT = Z_FRAME + FRAME_D + 0.0015, Z_PIC = Z_MAT + 0.0015;
const SHADOW_K = 256 / 144;                            // the shadow picture's square fills 144 of its 256 px
const C = {
  wall: 0xf3f0eb, ceiling: 0xe6e2da, rim: 0xcbc4b7, gap: 0x2e2a25,
  frame: 0x181715, mat: 0xfbfaf6, bevel: 0xd8cfbf, track: 0x1c1b19, lens: 0xfff1d2, focus: 0x3e2f17,
  casing: 0x2b2722,
};
const LIGHT = { sky: 0xfffcf7, ground: 0xe8e2d8, hemi: 3.5, dir: 0.7, env: 0.5, exposure: 1.0, floor: 0xc4bfb6 };
const FONT = "'Pretendard','Noto Sans KR','Segoe UI',-apple-system,Roboto,sans-serif";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const media = q => !!(window.matchMedia && window.matchMedia(q).matches);
// The signed shortest turn from `from` to `to`.
function turnTo(to, from) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
// A small seeded generator, so the marble is the same on every visit.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Squeezes a geometry's v coordinates into [v0, v1], so a piece of wall
// carries its own slice of the wall's top-to-bottom shading.
function remapV(geo, v0, v1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
  return geo;
}
// A flat rectangular ring (outer ow×oh, inner iw×ih) facing +z.
function ringGeometry(ow, oh, iw, ih) {
  const X = ow / 2, Y = oh / 2, x = iw / 2, y = ih / 2;
  const quads = [
    [-x, y, x, y, X, Y, -X, Y],         // top band
    [-X, -Y, X, -Y, x, -y, -x, -y],     // bottom band
    [-X, -Y, -x, -y, -x, y, -X, Y],     // left band
    [x, -y, X, -Y, X, Y, x, y],         // right band
  ];
  const pos = [];
  for (const q of quads) for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k * 2], q[k * 2 + 1], 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

// ---------- pictures drawn on canvases ----------
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// The fixed pictures (marble, shadows, gradients) are drawn once per page.
const canvasCache = new Map();
function cachedCanvas(key, make) {
  if (!canvasCache.has(key)) canvasCache.set(key, make());
  return canvasCache.get(key);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function drawMagnifier(g, x, y, r, color, lw) {
  g.save(); g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(x + r * 0.72, y + r * 0.72); g.lineTo(x + r * 1.6, y + r * 1.6); g.stroke();
  g.restore();
}
// Lines that fit maxW — a Korean title without spaces is cut by characters.
function wrapText(g, text, maxW, maxLines) {
  const lines = []; let line = '';
  for (const word of String(text || '').split(/(\s+)/)) {
    if (!word) continue;
    if (g.measureText(line + word).width <= maxW) { line += word; continue; }
    if (line.trim()) lines.push(line.trim());
    line = '';
    if (/^\s+$/.test(word)) continue;
    let rest = word;
    while (g.measureText(rest).width > maxW && rest.length > 1) {
      let cut = rest.length;
      while (cut > 1 && g.measureText(rest.slice(0, cut)).width > maxW) cut--;
      lines.push(rest.slice(0, cut)); rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let lastLine = lines[maxLines - 1];
    while (lastLine.length > 1 && g.measureText(lastLine + '…').width > maxW) lastLine = lastLine.slice(0, -1);
    lines[maxLines - 1] = lastLine + '…';
  }
  return lines;
}
// Letter-spaced text, centred on x (the small-caps lines on the walls).
function spacedText(g, text, x, y, spacing) {
  const chars = [...String(text)];
  const width = chars.reduce((s, ch) => s + g.measureText(ch).width, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = x - width / 2;
  const align = g.textAlign;
  g.textAlign = 'left';
  for (const ch of chars) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + spacing; }
  g.textAlign = align;
  return width;
}
function yearOf(sub) {
  return sub.art_completed_date && typeof fmtCompletedYear === 'function' ? fmtCompletedYear(sub.art_completed_date) : '';
}
// The label card beside an artwork (640×356 for 0.36×0.2 m): title, artist ·
// year, material, and a "View large" pill — the button the visitor presses.
function labelCanvas(sub, artist) {
  const W = 640, H = 356, c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#fbf9f4'; roundRect(g, 1, 1, W - 2, H - 2, 10); g.fill();
  g.strokeStyle = 'rgba(30,26,20,.10)'; g.lineWidth = 2; g.stroke();
  g.textBaseline = 'top';
  g.fillStyle = '#1c1a17'; g.font = `600 40px ${FONT}`;
  let y = 30;
  for (const l of wrapText(g, sub.art_title || tr('untitledArtwork'), W - 72, 2)) { g.fillText(l, 36, y); y += 50; }
  g.fillStyle = '#6b655c'; g.font = `400 28px ${FONT}`;
  const meta = [artist, yearOf(sub)].filter(Boolean).join(' · ');
  if (meta) { g.fillText(wrapText(g, meta, W - 72, 1)[0] || '', 36, y + 6); y += 38; }
  if (sub.art_material) { g.fillStyle = '#958e83'; g.font = `400 26px ${FONT}`; g.fillText(wrapText(g, sub.art_material, W - 72, 1)[0] || '', 36, y + 8); }
  // the button: an outlined pill under a hairline
  g.fillStyle = 'rgba(30,26,20,.10)'; g.fillRect(36, H - 102, W - 72, 2);
  g.font = `600 26px ${FONT}`;
  const bh = 52, by = H - 80, bx = 36, bw = 74 + g.measureText(tr('g3dView')).width;
  g.strokeStyle = '#1c1a17'; g.lineWidth = 2.5; roundRect(g, bx, by, bw, bh, bh / 2); g.stroke();
  drawMagnifier(g, bx + 30, by + bh / 2 - 3, 9, '#1c1a17', 3);
  g.fillStyle = '#1c1a17'; g.textBaseline = 'middle';
  g.fillText(tr('g3dView'), bx + 54, by + bh / 2 + 1);
  return c;
}
// The words over the cover, dark on the white wall, laid out in metres for
// a wall area wM × hM: artist · count, the title, a gold rule and — when
// there is room — two lines of the description.
function titleCanvas(title, kicker, desc, wM, hM) {
  const PX = 400, Wc = Math.round(wM * PX), Hc = Math.round(hM * PX);
  const c = makeCanvas(Wc, Hc), g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const kick = 0.085 * PX, gap1 = 0.08 * PX, gap2 = 0.09 * PX, rule = 0.006 * PX, gap3 = 0.1 * PX, line = 0.11 * PX;
  let size = 0.42 * PX;
  g.font = `700 ${size}px ${FONT}`;
  while (size > 0.12 * PX && g.measureText(title).width > Wc * 0.94) { size -= 4; g.font = `700 ${size}px ${FONT}`; }
  g.font = `400 ${0.068 * PX}px ${FONT}`;
  let lines = desc ? wrapText(g, desc.replace(/\s+/g, ' '), Wc * 0.82, 2) : [];
  const height = () => kick + gap1 + size + gap2 + rule + (lines.length ? gap3 + lines.length * line : 0);
  if (height() > Hc * 0.92) lines = lines.slice(0, 1);
  if (height() > Hc * 0.92) lines = [];
  let y = Math.max(0, (Hc - height()) / 2);
  g.fillStyle = '#8f7a52'; g.font = `600 ${kick}px ${FONT}`;
  spacedText(g, kicker, Wc / 2, y + kick / 2, kick * 0.16);
  y += kick + gap1;
  g.fillStyle = '#23201c'; g.font = `700 ${size}px ${FONT}`;
  g.fillText(wrapText(g, title, Wc * 0.96, 1)[0] || '', Wc / 2, y + size / 2);
  y += size + gap2;
  g.fillStyle = '#b39a6a'; g.fillRect(Wc / 2 - 0.15 * PX, y, 0.3 * PX, rule);
  y += rule + gap3;
  g.fillStyle = 'rgba(35,32,28,.66)'; g.font = `400 ${0.068 * PX}px ${FONT}`;
  lines.forEach((l, i) => g.fillText(l, Wc / 2, y + line * (i + 0.5)));
  return c;
}
// "GALLERY 2" over a room's far wall.
function roomCanvas(text) {
  const c = makeCanvas(1024, 160), g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#34302a'; g.font = `600 76px ${FONT}`;
  spacedText(g, String(text).toUpperCase(), 512, 64, 16);
  g.fillStyle = 'rgba(52,48,42,.45)'; g.fillRect(482, 134, 60, 3);
  return c;
}
// A soft pool of light thrown on the wall by the spot above an artwork.
function haloCanvas() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 108, 4, 128, 122, 118);   // fades out before every edge
  // a smooth, bell-like fall-off: a knee in it shows as a ring on a dark wall
  [[0, 1], [0.2, 0.86], [0.4, 0.58], [0.6, 0.3], [0.8, 0.1], [1, 0]].forEach(([at, a]) => grad.addColorStop(at, `rgba(255,255,255,${a})`));
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return c;
}
// A frame's soft shadow on the wall: a blurred square that fills the middle
// 144 of 256 pixels, so the plane is drawn SHADOW_K times the frame's size.
function shadowCanvas() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.shadowColor = '#000'; g.shadowBlur = 34;
  g.fillStyle = '#000';
  g.fillRect(56, 56, 144, 144);
  return c;
}
// Walls a little darker towards the ceiling and the floor, as real ones are.
function wallShadeCanvas() {
  const c = makeCanvas(4, 256), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);     // top → bottom
  grad.addColorStop(0, '#e9e9e9'); grad.addColorStop(0.22, '#ffffff');
  grad.addColorStop(0.84, '#fcfcfc'); grad.addColorStop(1, '#dedede');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  return c;
}
// Along the foot of every wall, a little darkness on the floor.
function floorShadeCanvas() {
  const c = makeCanvas(4, 128), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);     // wall side → room side
  grad.addColorStop(0, 'rgba(0,0,0,.16)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  return c;
}
// A skylight's diffuser: brighter in the middle, a little shadow round
// its recessed edge, and slim mullions dividing it into panes.
function skyCanvas() {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S * 0.71);
  grad.addColorStop(0, '#fffefa'); grad.addColorStop(1, '#efebe2');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  const edge = 18;
  [[0, 0, S, edge, 0, 0, 0, edge], [0, S - edge, S, edge, 0, S, 0, S - edge],
   [0, 0, edge, S, 0, 0, edge, 0], [S - edge, 0, edge, S, S, 0, S - edge, 0]].forEach(([x, y, w, h, x0, y0, x1, y1]) => {
    const e = g.createLinearGradient(x0, y0, x1, y1);
    e.addColorStop(0, 'rgba(150,140,126,.28)'); e.addColorStop(1, 'rgba(150,140,126,0)');
    g.fillStyle = e; g.fillRect(x, y, w, h);
  });
  g.fillStyle = 'rgba(176,167,153,.34)';
  for (let k = 1; k < 4; k++) { g.fillRect(k * S / 4 - 1.5, 0, 3, S); g.fillRect(0, k * S / 4 - 1.5, S, 3); }
  return c;
}
// The way in, behind the visitor: a pair of frosted glass doors, lit from
// beyond, with bronze pulls (the bronze casing is built in 3D round it).
function entryCanvas() {
  const W = 380, H = 540, c = makeCanvas(W, H), g = c.getContext('2d');
  const glass = g.createLinearGradient(0, 0, 0, H);
  glass.addColorStop(0, '#f4f1ea'); glass.addColorStop(0.55, '#e6e1d8'); glass.addColorStop(1, '#d3cdc2');
  g.fillStyle = glass; g.fillRect(0, 0, W, H);
  const sheen = g.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0.18, 'rgba(255,255,255,0)'); sheen.addColorStop(0.3, 'rgba(255,255,255,.35)'); sheen.addColorStop(0.42, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3a3129';
  g.fillRect(W / 2 - 2, 0, 4, H);                          // where the leaves meet
  g.strokeStyle = 'rgba(58,49,41,.35)'; g.lineWidth = 2;
  g.strokeRect(14, 14, W / 2 - 28, H - 28); g.strokeRect(W / 2 + 14, 14, W / 2 - 28, H - 28);
  g.fillStyle = '#4a3e31';
  for (const x of [W / 2 - 22, W / 2 + 16]) { roundRect(g, x, H * 0.4, 6, H * 0.2, 3); g.fill(); }
  return c;
}
// Polished white marble, four different 1.2 m slabs to a 2.4 m tile: a warm
// body with soft clouds, long grey veins with fine branches, now and then a
// thread of gold, and hairline joints. Veins are stroked wide and faint,
// then narrow and dark — a soft edge without shadowBlur, which is slow on
// phones.
function marbleCanvas() {
  const S = 1024, T = 512, c = makeCanvas(S, S), g = c.getContext('2d');
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const r = seeded(11 + tx * 7 + ty * 29), ox = tx * T, oy = ty * T;
    g.save();
    g.beginPath(); g.rect(ox, oy, T, T); g.clip();
    g.fillStyle = '#eeeae3'; g.fillRect(ox, oy, T, T);
    for (let i = 0; i < 16; i++) {
      const x = ox + r() * T, y = oy + r() * T, rad = 60 + r() * 200;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      const tone = r() < 0.6 ? '196,190,181' : '250,248,244';
      grad.addColorStop(0, `rgba(${tone},${0.1 + r() * 0.14})`); grad.addColorStop(1, `rgba(${tone},0)`);
      g.fillStyle = grad; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const vein = (x, y, ang, len, w, rgb, alpha, bend) => {
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < len; s += 10) {
        ang += (r() - 0.5) * bend;
        x += Math.cos(ang) * 10; y += Math.sin(ang) * 10;
        g.lineTo(x, y);
      }
      for (const [k, a] of [[5, 0.05], [2.4, 0.11], [1, 1]]) {
        g.strokeStyle = `rgba(${rgb},${alpha * a})`; g.lineWidth = w * k; g.stroke();
      }
    };
    const flow = r() * Math.PI;        // each slab's grain runs its own way
    for (let i = 0; i < 3; i++) {
      const sx = ox + T / 2 - Math.cos(flow) * T * 0.8 + (r() - 0.5) * T * 0.7;
      const sy = oy + T / 2 - Math.sin(flow) * T * 0.8 + (r() - 0.5) * T * 0.7;
      vein(sx, sy, flow + (r() - 0.5) * 0.5, T * 1.8, 1.2 + r() * 1.6, '126,120,112', 0.55, 0.15);
    }
    for (let i = 0; i < 8; i++) vein(ox + r() * T, oy + r() * T, flow + (r() - 0.5) * 1.8, 60 + r() * 180, 0.6 + r() * 0.6, '148,142,134', 0.42, 0.34);
    if (r() < 0.7) vein(ox + T / 2 - Math.cos(flow) * T * 0.75, oy + T / 2 - Math.sin(flow) * T * 0.75, flow + 0.25, T * 1.6, 0.9, '178,151,104', 0.5, 0.13);
    g.restore();
    g.fillStyle = 'rgba(116,108,97,.34)';
    g.fillRect(ox, oy, T, 1.5); g.fillRect(ox, oy, 1.5, T);
  }
  return c;
}
function placeholderCanvas() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#d6d1c7'; g.fillRect(0, 0, 256, 256);
  drawMagnifier(g, 118, 118, 30, 'rgba(0,0,0,.22)', 10);
  return c;
}

// ---------- the floor plan ----------
// A hanging stretch is a length of wall where artworks go, `along` running
// to the visitor's right as they face it (ox, oz → +len·(dx, dz)); (nx, nz)
// points out of the wall into the room.
const footprint = a => a.fw + LABEL_GAP + LABEL_W;
// The walls between rooms of a suite: R−1 of them, each with a doorway near
// one side wall, on the right first and then alternating, so no room looks
// through two doorways in a row.
function makePartitions(W, D, Dr, R) {
  const hx = W / 2, out = [];
  for (let r = 0; r < R - 1; r++) {
    const side = r % 2 === 0 ? 1 : -1;
    const d0 = side > 0 ? hx - DOOR_RETURN - DOOR_W : -hx + DOOR_RETURN, d1 = d0 + DOOR_W;
    const zc = D / 2 - (r + 1) * Dr;
    out.push({
      index: r, side, zc, z0: zc - PART_T / 2, z1: zc + PART_T / 2, d0, d1, doorX: (d0 + d1) / 2,
      solids: [[-hx, d0], [d1, hx]],
      hang: side > 0 ? [-hx + CORNER, d0 - DOOR_MARGIN] : [d1 + DOOR_MARGIN, hx - CORNER],
    });
  }
  return out;
}
// The inside of room r, front (towards the entrance) to back.
function spanOf(r, R, D, parts) {
  return { top: r === 0 ? D / 2 : parts[r - 1].z0, bottom: r === R - 1 ? -D / 2 : parts[r].z1 };
}
// Room r's stretches: its side walls, its far wall (in room 0 the title
// wall, either side of the cover in its middle) and the wall it was
// entered through.
function roomStretches(W, D, R, r, parts, cover) {
  const hx = W / 2, { top, bottom } = spanOf(r, R, D, parts), depth = top - bottom;
  const out = [{ key: 'L', room: r, ox: -hx, oz: top - CORNER, dx: 0, dz: -1, nx: 1, nz: 0, len: depth - 2 * CORNER }];
  const [a, b] = r === R - 1 ? [-hx + CORNER, hx - CORNER] : parts[r].hang;
  if (r === 0) {
    const cl = -cover.fw / 2, cr = cover.fw / 2 + LABEL_GAP + LABEL_W;
    out.push({ key: 'BL', room: r, ox: a, oz: bottom, dx: 1, dz: 0, nx: 0, nz: 1, len: (cl - MIN_GAP) - a, feature: true });
    out.push({ key: 'BR', room: r, ox: cr + MIN_GAP, oz: bottom, dx: 1, dz: 0, nx: 0, nz: 1, len: b - (cr + MIN_GAP), feature: true });
  } else {
    out.push({ key: 'B', room: r, ox: a, oz: bottom, dx: 1, dz: 0, nx: 0, nz: 1, len: b - a });
  }
  out.push({ key: 'R', room: r, ox: hx, oz: bottom + CORNER, dx: 0, dz: 1, nx: -1, nz: 0, len: depth - 2 * CORNER });
  if (r > 0) {
    const [fa, fb] = parts[r - 1].hang;
    out.push({ key: 'F', room: r, ox: fb, oz: top, dx: -1, dz: 0, nx: 0, nz: -1, len: fb - fa });
  }
  return out;
}
// Shares artworks out over stretches in order, in proportion to their
// lengths, so a short list spreads round the room instead of crowding the
// first wall. Null when some stretch would be too tight.
function shareOut(stretches, works) {
  const groups = new Map(stretches.map(s => [s, []]));
  if (!works.length) return groups;
  const smallest = Math.min(...works.map(footprint));
  const usable = stretches.filter(s => s.len >= smallest + 2 * MIN_GAP);
  const total = works.reduce((s, a) => s + footprint(a), 0);
  const L = usable.reduce((s, st) => s + st.len, 0);
  if (!L) return null;
  let acc = 0;
  const bounds = usable.map(st => (acc += st.len / L * total));
  let cum = 0;
  for (const a of works) {
    const mid = cum + footprint(a) / 2;
    cum += footprint(a);
    let k = bounds.findIndex(b => mid < b);
    if (k < 0) k = usable.length - 1;
    groups.get(usable[k]).push(a);
  }
  for (const [st, list] of groups) {
    if (list.length && list.reduce((s, a) => s + footprint(a), 0) + (list.length + 1) * MIN_GAP > st.len) return null;
  }
  return groups;
}
// One room while it stays comfortable (up to 12.5 m deep); then a suite of
// rooms 11 m wide, each taking the works in order in proportion to the wall
// it has.
function planHall(cover, works) {
  for (let D = 7; D <= SINGLE_MAX_D; D += 0.5) {
    const W = clamp(Math.round(D * 1.7) / 2, 7, 11);
    const stretches = roomStretches(W, D, 1, 0, [], cover);
    const groups = shareOut(stretches, works);
    if (groups) return { W, D, R: 1, Dr: D, partitions: [], stretches, groups, coverZ: -D / 2 };
  }
  const W = HALL_W, total = works.reduce((s, a) => s + footprint(a), 0);
  const smallest = Math.min(...works.map(footprint));
  for (let R = 2; R <= 40; R++) for (const Dr of [ROOM_D, ROOM_D + 1, ROOM_D + 2]) {
    const D = R * Dr, parts = makePartitions(W, D, Dr, R);
    const per = Array.from({ length: R }, (_, r) => roomStretches(W, D, R, r, parts, cover));
    const weight = per.map(list => list.reduce((s, st) => s + (st.len >= smallest + 2 * MIN_GAP ? st.len : 0), 0));
    const sum = weight.reduce((s, w) => s + w, 0);
    if (!sum) continue;
    const runs = per.map(() => []);
    let cum = 0, edge = 0, k = 0;
    for (const a of works) {
      while (k < R - 1 && cum + footprint(a) / 2 > (edge + weight[k]) / sum * total) { edge += weight[k]; k++; }
      runs[k].push(a);
      cum += footprint(a);
    }
    const stretches = [], groups = new Map();
    let ok = true;
    for (let r = 0; r < R && ok; r++) {
      const g = shareOut(per[r], runs[r]);
      if (!g) { ok = false; break; }
      for (const st of per[r]) { stretches.push(st); groups.set(st, g.get(st) || []); }
    }
    if (ok) return { W, D, R, Dr, partitions: parts, stretches, groups, coverZ: parts[0].z1 };
  }
  return null;
}
// Does the segment a→b cross the box? (Liang–Barsky on the floor plan;
// no allocation, it runs for every artwork on every frame.)
function segmentHitsBox(ax, az, bx, bz, x0, z0, x1, z1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (let k = 0; k < 4; k++) {
    const p = k === 0 ? -dx : k === 1 ? dx : k === 2 ? -dz : dz;
    const q = k === 0 ? ax - x0 : k === 1 ? x1 - ax : k === 2 ? az - z0 : z1 - az;
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
function setViewParam(v) {
  try {
    const q = new URLSearchParams(location.search);
    if (v) q.set('view', v); else q.delete('view');
    const rest = q.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  } catch (e) { /* history unavailable */ }
}

// ---------- the hall ----------
let current = null;
// Back (browser, phone gesture, the app's back button) leaves a hall opened
// from the 2D page — or, with an artwork open large, closes just that.
const hist = typeof screenHistory === 'function' ? screenHistory(() => (current ? current.back() : false)) : null;

// Opens the hall over the page and returns it at once; it loads behind its
// intro card. opts: title, artist, description, works (rows),
// coverId, quiet (the page opened it by itself: no toasts), history (Back
// closes the hall rather than leaving the page), onClose(hall), testFill,
// debug.
export function openGallery3D(opts) {
  if (current) return current;
  const o = opts || {};
  const hall = createHall(o);
  current = hall;
  hall.start().catch(e => {
    console.error('3D hall failed to start:', e);
    if (!hall.closed()) { hall.close(); if (!o.quiet) toast(tr('g3dLoadFailed')); }
  });
  return hall;
}

function createHall(opts) {
  const coarse = media('(pointer: coarse)');
  const still = media('(prefers-reduced-motion: reduce)');
  const lbModal = document.getElementById('lightbox-modal');
  const lightboxOpen = () => !!lbModal && lbModal.classList.contains('open');
  const usesHistory = !!(hist && opts.history);
  const adapt = !opts.debug;

  const root = document.createElement('div');
  root.className = 'g3d';
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', tr('g3dLabel'));
  const chevron = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  root.innerHTML = `
    <canvas class="g3d-canvas" aria-hidden="true"></canvas>
    <div class="g3d-top">
      <button type="button" class="g3d-btn g3d-exit">${chevron('M14.5 5.5 8 12l6.5 6.5')}<span>${escapeHtml(tr('g3dExit'))}</span></button>
      <div class="g3d-name"><div class="g3d-name-in"><b></b><span></span></div></div>
      <button type="button" class="g3d-btn g3d-round g3d-help" aria-label="${escapeHtml(tr('g3dHelp'))}">?</button>
    </div>
    <div class="g3d-caption off" aria-live="polite"></div>
    <div class="g3d-bottom">
      <button type="button" class="g3d-btn g3d-round g3d-prev" aria-label="${escapeHtml(tr('g3dPrev'))}">${chevron('M14.5 5.5 8 12l6.5 6.5')}</button>
      <button type="button" class="g3d-btn g3d-view" disabled><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M15.2 15.2 20 20" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg><span>${escapeHtml(tr('g3dView'))}</span></button>
      <button type="button" class="g3d-btn g3d-round g3d-next" aria-label="${escapeHtml(tr('g3dNext'))}">${chevron('m9.5 5.5 6.5 6.5-6.5 6.5')}</button>
    </div>
    <div class="g3d-stick off"${coarse ? '' : ' hidden'}><div class="g3d-knob"></div></div>
    <div class="g3d-intro">
      <div class="g3d-card">
        <div class="g3d-card-cover" hidden><img alt="" decoding="async"></div>
        <div class="g3d-card-body">
          <div class="g3d-card-kicker">${escapeHtml(tr('g3dLabel'))}</div>
          <h2 class="g3d-card-title"></h2>
          <div class="g3d-card-artist"></div>
          <p class="g3d-card-desc"></p>
          <ul class="g3d-card-help"></ul>
          <div class="g3d-card-actions">
            <button type="button" class="g3d-btn g3d-enter" disabled><i class="g3d-enter-fill"></i><span class="g3d-enter-label"></span></button>
            <button type="button" class="g3d-btn g3d-flat g3d-to2d">${escapeHtml(tr('g3dExit'))}</button>
          </div>
        </div>
      </div>
    </div>`;
  const $ = sel => root.querySelector(sel);
  const canvas = $('.g3d-canvas');
  const stickEl = $('.g3d-stick'), knob = $('.g3d-knob');

  let closed = false, ready = false, paused = false, lost = false;
  let introOpen = true, introIsHelp = false;
  let renderer = null, scene = null, cam = null, aniso = 1, maxAniso = 1, envRT = null, floorMat = null;
  let lights = {}, mats = {};
  let W = 8, D = 8, R = 1, Dr = 8;
  let partitions = [], rooms = [], parts = [], mirrors = [];
  let curRoom = -1, visLo = -1, visHi = -1;
  let px = 0, pz = 0, yaw = 0, pitch = 0;
  let arts = [];              // walking order
  let pickables = [];
  const keys = new Set();
  const stick = { id: null, x: 0, y: 0 };
  let glide = null, afterGlide = null, drag = null;
  let focus = -1, hover = -1;
  let raf = 0, last = 0, prevFrame = 0, dirty = true;
  let lodTimer = 0, hoverTimer = 0, residTimer = 0, lostTimer = 0, introTimer = 0;
  let tier = 0, slowFrames = 0, sampled = 0;
  let previousFocus = null, buildMs = 0;
  const thumbCache = new Map();   // url → texture, kept across rebuilds
  const disposers = [];
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); disposers.push(() => target.removeEventListener(type, fn, o)); };
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const artistName = () => opts.artist || '';
  const realWorks = () => (opts.works || []).filter(Boolean);
  const countText = () => (typeof collectionItemCountText === 'function' ? collectionItemCountText(realWorks().length) : '');

  // ---------- intro card (also the help card) ----------
  function fillIntro() {
    $('.g3d-card-title').textContent = opts.title || '';
    $('.g3d-card-artist').textContent = [artistName(), countText()].filter(Boolean).join(' · ');
    const desc = $('.g3d-card-desc');
    desc.textContent = opts.description || '';
    desc.hidden = !opts.description;
    const help = coarse
      ? ['g3dHelpLookTouch', 'g3dHelpWalkStick', 'g3dHelpFloor', 'g3dHelpArt']
      : ['g3dHelpLookMouse', 'g3dHelpWalkKeys', 'g3dHelpFloor', 'g3dHelpArt'];
    $('.g3d-card-help').innerHTML = help.map(k => `<li>${escapeHtml(tr(k))}</li>`).join('');
    const works = realWorks();
    const cover = works.find(s => s.id === opts.coverId) || works[0];
    const url = cover && (cover.thumb_url || cover.image_url);
    const box = $('.g3d-card-cover'), img = box.querySelector('img');
    if (url) { if (img.getAttribute('src') !== url) img.src = url; box.hidden = false; }
    else box.hidden = true;
    $('.g3d-name b').textContent = opts.title || '';
    updateRoomLabel();
  }
  function updateRoomLabel() {
    const bits = [artistName()];
    if (R > 1 && curRoom >= 0) bits.push(tr('g3dRoomOf', { n: curRoom + 1, total: R }));
    $('.g3d-name span').textContent = bits.filter(Boolean).join(' · ');
  }
  function setProgress(n, total) {
    $('.g3d-enter-fill').style.transform = `scaleX(${total ? (n / total).toFixed(3) : 0})`;
    $('.g3d-enter-label').textContent = tr('g3dPreparing', { n, total });
  }
  function setReady() {
    const b = $('.g3d-enter');
    b.classList.add('ready');
    b.disabled = false;
    $('.g3d-enter-label').textContent = introIsHelp ? tr('g3dContinue') : tr('g3dEnter');
  }
  function showIntro() {
    if (!ready || introOpen) return;
    introOpen = true; introIsHelp = true;
    keys.clear(); stickRelease(); cancelGlide();
    clearTimeout(introTimer);
    const el = $('.g3d-intro');
    el.hidden = false;
    $('.g3d-enter-label').textContent = tr('g3dContinue');
    requestAnimationFrame(() => { if (introOpen) el.classList.remove('out'); });
    $('.g3d-enter').focus({ preventScroll: true });
  }
  function hideIntro() {
    if (!ready || !introOpen) return;
    introOpen = false;
    const el = $('.g3d-intro');
    el.classList.add('out');
    clearTimeout(introTimer);
    introTimer = setTimeout(() => { if (!introOpen) el.hidden = true; }, still ? 0 : 400);
    stickEl.classList.remove('off');
    root.focus({ preventScroll: true });
    wake();
  }

  // ---------- textures ----------
  function prepTexture(t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; }
  function canvasTexture(c) { return prepTexture(new THREE.CanvasTexture(c)); }
  function thumbUrl(sub) { return sub.thumb_url || artworkDisplayUrl(sub) || sub.image_url; }
  async function loadThumbs(subs, quiet) {
    const urls = [...new Set(subs.map(thumbUrl).filter(Boolean))].filter(u => !thumbCache.has(u));
    let next = 0, done = 0;
    if (!quiet) setProgress(0, urls.length);
    const worker = async () => {
      while (next < urls.length && !closed) {
        const url = urls[next++];
        try { thumbCache.set(url, prepTexture(await loader.loadAsync(url))); }
        catch (e) { console.error('3D hall: thumbnail failed to load:', url, e); }
        if (!quiet) setProgress(++done, urls.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  }
  function sizeFor(tex, isCover) {
    const img = tex && tex.image;
    const iw = (img && (img.naturalWidth || img.width)) || 1, ih = (img && (img.naturalHeight || img.height)) || 1;
    const ar = clamp(iw / ih, 0.25, 4);
    const maxH = isCover ? COVER_H : ART_H, maxW = isCover ? COVER_W : ART_W;
    let h = maxH, w = h * ar;
    if (w > maxW) { w = maxW; h = w / ar; }
    return { w, h, fw: w + 2 * (MAT + BORDER), fh: h + 2 * (MAT + BORDER) };
  }
  // The cover (the portfolio's choice, else the first work) and the rest in
  // order; &g3dtest=N repeats the rest up to N works in all.
  function pickWorks() {
    const list = realWorks();
    let ci = list.findIndex(s => s.id === opts.coverId);
    if (ci < 0) ci = 0;
    const cover = list[ci];
    const rest = list.filter((_, i) => i !== ci);
    const fill = Math.min(80, Number(opts.testFill) || 0);
    if (cover && fill > list.length) {
      const base = rest.length ? rest.slice() : [cover];
      while (rest.length + 1 < fill) rest.push(base[rest.length % base.length]);
    }
    return { cover, rest };
  }
  function viewDistance(a) { return clamp(Math.max(a.fh, a.fw * 0.8) * 1.45 + 0.5, 1.5, 3.4); }

  // The light the marble reflects: a small bright room round the eye, with
  // a skylight overhead, blurred (PMREM).
  function makeEnvironment() {
    const env = new THREE.Scene(), own = [];
    const mk = (geo, color, side) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: side || THREE.FrontSide }));
      own.push(m); env.add(m); return m;
    };
    const room = mk(new THREE.BoxGeometry(12, 4.2, 12), new THREE.Color(0.66, 0.64, 0.6), THREE.BackSide);
    room.position.y = 0.5;               // the eye 1.6 m over its floor
    const sky = mk(new THREE.PlaneGeometry(6, 5), new THREE.Color(2.3, 2.25, 2.15));
    sky.rotation.x = Math.PI / 2; sky.position.y = 2.55;
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(env, 0.04);
    pm.dispose();
    own.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    return rt;
  }

  // ---------- building ----------
  function build(cover, rest) {
    const placeholder = canvasTexture(cachedCanvas('placeholder', placeholderCanvas));
    const mk = (sub, isCover) => {
      const tex = thumbCache.get(thumbUrl(sub)) || placeholder;
      return { sub, isCover, tex, ...sizeFor(tex === placeholder ? null : tex, isCover) };
    };
    const coverArt = mk(cover, true);
    const restArts = rest.map(s => mk(s, false));
    const plan = planHall(coverArt, restArts);
    if (!plan) throw new Error('3D hall: no floor plan fits');
    ({ W, D, R, Dr } = plan);
    partitions = plan.partitions;
    const hx = W / 2, hz = D / 2, coverZ = plan.coverZ;

    // --- where everything hangs ---
    Object.assign(coverArt, {
      room: 0, x: 0, z: coverZ, nx: 0, nz: 1, cy: COVER_HANG,
      lx: coverArt.fw / 2 + LABEL_GAP + LABEL_W / 2, lz: coverZ, feature: true,
    });
    for (const [st, list] of plan.groups) {
      if (!list.length) continue;
      const used = list.reduce((s, a) => s + footprint(a), 0);
      const gap = (st.len - used) / (list.length + 1);
      let along = gap;
      for (const a of list) {
        const artAlong = along + a.fw / 2, labelAlong = along + a.fw + LABEL_GAP + LABEL_W / 2;
        Object.assign(a, {
          room: st.room, x: st.ox + st.dx * artAlong, z: st.oz + st.dz * artAlong, nx: st.nx, nz: st.nz, cy: HANG,
          lx: st.ox + st.dx * labelAlong, lz: st.oz + st.dz * labelAlong, feature: !!st.feature,
        });
        along += footprint(a) + gap;
      }
    }
    // walking order: room by room, round each room's walls, the cover in its place
    arts = [];
    for (let r = 0; r < R; r++) {
      for (const key of ['L', 'BL', 'COVER', 'BR', 'B', 'R', 'F']) {
        if (key === 'COVER') { if (r === 0) arts.push(coverArt); continue; }
        const st = plan.stretches.find(s => s.key === key && s.room === r);
        const list = st && plan.groups.get(st);
        if (list) arts.push(...list);
      }
    }
    arts.forEach(a => { a.viewDist = viewDistance(a); });

    scene = new THREE.Scene();
    scene.background = new THREE.Color(C.ceiling);     // also what the marble mirrors overhead
    const hemi = new THREE.HemisphereLight(LIGHT.sky, LIGHT.ground, LIGHT.hemi);
    const sun = new THREE.DirectionalLight(0xfff4e6, LIGHT.dir);
    sun.position.set(-0.35, 1, 0.45);
    scene.add(hemi, sun);
    lights = { hemi, sun };
    pickables = [];
    mirrors = [];
    // Each room (and each wall between rooms) is a group that can rest when
    // out of sight, with its reflection — a mirrored twin under the floor,
    // seen through the polished marble — inside it.
    const container = () => {
      const g = new THREE.Group(), m = new THREE.Group();
      m.scale.y = -1; m.visible = tier === 0;
      g.add(m); scene.add(g); mirrors.push(m);
      return { g, m };
    };
    rooms = Array.from({ length: R }, container);
    parts = partitions.map(container);
    const always = container();
    const add = (mesh, where, mirror) => { where.g.add(mesh); if (mirror) where.m.add(mesh.clone()); return mesh; };

    // --- walls ---
    const shade = canvasTexture(cachedCanvas('wallShade', wallShadeCanvas));
    const wallMat = new THREE.MeshLambertMaterial({ color: C.wall, map: shade });
    mats = { wall: wallMat };
    const gapMat = new THREE.MeshBasicMaterial({ color: C.gap });
    const floorShadeMat = new THREE.MeshBasicMaterial({ map: canvasTexture(cachedCanvas('floorShade', floorShadeCanvas)), transparent: true, depthWrite: false });
    // The foot of a wall: a dark shadow gap, and a little darkness on the floor.
    const baseLine = (len, x, z, nx, nz, where) => {
      const ry = Math.atan2(nx, nz);
      const gap = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.016), gapMat);
      gap.position.set(x + nx * Z_GAP, 0.008, z + nz * Z_GAP); gap.rotation.y = ry;
      add(gap, where, true);
      const fs = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.5), floorShadeMat);
      fs.rotation.set(-Math.PI / 2, ry, 0, 'YXZ');
      fs.position.set(x + nx * 0.25, 0.002, z + nz * 0.25);
      fs.renderOrder = 2;
      add(fs, where, false);
    };
    const wallPlane = (len, x, z, nx, nz, mat, where) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, ROOM_H), mat);
      m.position.set(x, ROOM_H / 2, z); m.rotation.y = Math.atan2(nx, nz);
      add(m, where, true); pickables.push(m);
      baseLine(len, x, z, nx, nz, where);
    };
    for (let r = 0; r < R; r++) {                  // side walls, room by room
      const { top, bottom } = spanOf(r, R, D, partitions), zc = (top + bottom) / 2;
      wallPlane(top - bottom, -hx, zc, 1, 0, wallMat, rooms[r]);
      wallPlane(top - bottom, hx, zc, -1, 0, wallMat, rooms[r]);
    }
    wallPlane(W, 0, hz, 0, -1, wallMat, rooms[0]);  // the entrance wall…
    const entry = new THREE.Mesh(new THREE.PlaneGeometry(ENTRY_W, ENTRY_H), new THREE.MeshBasicMaterial({ map: canvasTexture(cachedCanvas('entry', entryCanvas)), toneMapped: false }));
    entry.position.set(0, ENTRY_H / 2, hz - 0.004); entry.rotation.y = Math.PI;
    add(entry, rooms[0], true);                     // …with the doors in, in a bronze casing
    const casingMat = new THREE.MeshLambertMaterial({ color: C.casing });
    const cw = 0.05;
    for (const sx of [-1, 1]) {
      const j = new THREE.Mesh(new THREE.BoxGeometry(cw, ENTRY_H + cw, 0.04), casingMat);
      j.position.set(sx * (ENTRY_W + cw) / 2, (ENTRY_H + cw) / 2, hz - 0.02);
      add(j, rooms[0], true);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(ENTRY_W + 2 * cw, cw, 0.04), casingMat);
    head.position.set(0, ENTRY_H + cw / 2, hz - 0.02);
    add(head, rooms[0], true);
    // the far wall: in a single room, the one with the cover and the title
    wallPlane(W, 0, -hz, 0, 1, wallMat, rooms[R - 1]);
    // the walls between rooms; the first one's face towards the entrance
    // carries the cover and the title
    partitions.forEach((p, i) => {
      const where = parts[i];
      const piece = (x0, x1, y0, y1) => {
        const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, PART_T);
        if (y0 > 0) remapV(geo, y0 / ROOM_H, y1 / ROOM_H);
        const m = new THREE.Mesh(geo, wallMat);
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, p.zc);
        add(m, where, true); pickables.push(m);
      };
      for (const [x0, x1] of p.solids) piece(x0, x1, 0, ROOM_H);
      piece(p.d0, p.d1, DOOR_H, ROOM_H);            // over the doorway
      for (const [x0, x1] of p.solids) {
        baseLine(x1 - x0, (x0 + x1) / 2, p.z1, 0, 1, where);
        baseLine(x1 - x0, (x0 + x1) / 2, p.z0, 0, -1, where);
      }
    });

    // --- the floor: polished marble, faintly mirroring the room ---
    const marble = canvasTexture(cachedCanvas('marble', marbleCanvas));
    marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
    marble.repeat.set(W / 2.4, D / 2.4);
    marble.anisotropy = Math.min(8, maxAniso);
    envRT = makeEnvironment();
    floorMat = new THREE.MeshStandardMaterial({
      map: marble, color: LIGHT.floor, roughness: 0.2, metalness: 0, envMap: envRT.texture, envMapIntensity: LIGHT.env,
      transparent: tier === 0, opacity: tier === 0 ? 1 - REFLECT : 1,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.renderOrder = 1;
    floor.userData.floor = true;
    always.g.add(floor); pickables.push(floor);

    // --- the ceiling: a skylight over each room, tracks with spots along the walls ---
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: C.ceiling, toneMapped: false }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM_H;
    always.g.add(ceil);
    const skyMat = new THREE.MeshBasicMaterial({ map: canvasTexture(cachedCanvas('sky', skyCanvas)), toneMapped: false });
    const rimMat = new THREE.MeshBasicMaterial({ color: C.rim, toneMapped: false });
    for (let r = 0; r < R; r++) {
      const { top, bottom } = spanOf(r, R, D, partitions), zc = (top + bottom) / 2;
      const sw = Math.max(2, W - 4.6), sd = Math.max(2, top - bottom - 3.8);
      const rim = new THREE.Mesh(new THREE.PlaneGeometry(sw + 0.14, sd + 0.14), rimMat);
      rim.rotation.x = Math.PI / 2; rim.position.set(0, ROOM_H - 0.003, zc);
      add(rim, rooms[r], true);
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd), skyMat);
      sky.rotation.x = Math.PI / 2; sky.position.set(0, ROOM_H - 0.006, zc);
      add(sky, rooms[r], true);
    }
    const dummy = new THREE.Object3D();
    const trackMat = new THREE.MeshLambertMaterial({ color: C.track });
    const runs = plan.stretches.filter(st => !st.feature && st.len > 1.2)
      .map(st => [st.ox + st.dx * st.len / 2, st.oz + st.dz * st.len / 2, st.nx, st.nz, st.len]);
    {
      const [a, b] = R > 1 ? partitions[0].hang : [-hx + CORNER, hx - CORNER];
      runs.push([(a + b) / 2, coverZ, 0, 1, b - a]);  // one run along the title wall
    }
    const tracks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.026, 0.034), trackMat, runs.length);
    runs.forEach(([mx, mz, nx, nz, len], i) => {
      dummy.position.set(mx + nx * 1.0, ROOM_H - 0.022, mz + nz * 1.0);
      dummy.rotation.set(0, Math.atan2(nx, nz), 0);
      dummy.scale.set(len, 1, 1);
      dummy.updateMatrix();
      tracks.setMatrixAt(i, dummy.matrix);
    });
    const n = arts.length;
    const heads = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.038, 0.12, 14), trackMat, n);
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 6), trackMat, n);
    const lenses = new THREE.InstancedMesh(new THREE.CircleGeometry(0.026, 18), new THREE.MeshBasicMaterial({ color: C.lens, toneMapped: false }), n);
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), aim = new THREE.Vector3(), hp = new THREE.Vector3();
    arts.forEach((a, i) => {
      hp.set(a.x + a.nx * 1.0, ROOM_H - 0.15, a.z + a.nz * 1.0);
      aim.set(a.x, a.cy, a.z);
      dir.subVectors(aim, hp).normalize();
      dummy.scale.set(1, 1, 1);
      dummy.position.copy(hp);
      dummy.quaternion.setFromUnitVectors(up, dir.clone().negate());
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      dummy.position.copy(hp).addScaledVector(dir, 0.062);
      dummy.lookAt(aim);
      dummy.updateMatrix();
      lenses.setMatrixAt(i, dummy.matrix);
      const stemTop = ROOM_H - 0.035, stemBottom = hp.y + 0.04;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(hp.x, (stemTop + stemBottom) / 2, hp.z);
      dummy.scale.set(1, stemTop - stemBottom, 1);
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);
    });
    always.g.add(tracks, heads, stems, lenses);

    // --- the artworks ---
    const haloTex = canvasTexture(cachedCanvas('halo', haloCanvas));
    const shadowTex = canvasTexture(cachedCanvas('shadow', shadowCanvas));
    const haloMat = new THREE.MeshBasicMaterial({ map: haloTex, color: 0xfff1da, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: shadowTex, transparent: true, opacity: 0.3, depthWrite: false });
    const labelShadowMat = shadowMat.clone(); labelShadowMat.opacity = 0.14;
    const matMat = new THREE.MeshBasicMaterial({ color: C.mat, toneMapped: false });
    const bevelMat = new THREE.MeshBasicMaterial({ color: C.bevel, toneMapped: false });
    const labelTexBy = new Map();
    arts.forEach((a, i) => {
      const where = rooms[a.room], ry = Math.atan2(a.nx, a.nz);
      const put = (mesh, off, y, mirror, x = a.x, z = a.z) => {
        mesh.position.set(x + a.nx * off, y, z + a.nz * off); mesh.rotation.y = ry;
        add(mesh, where, mirror);
        return mesh;
      };
      put(new THREE.Mesh(new THREE.PlaneGeometry(a.fw + 1.3, a.fh + 1.7), haloMat), Z_HALO, a.cy + 0.22, false).renderOrder = 3;
      put(new THREE.Mesh(new THREE.PlaneGeometry(a.fw * SHADOW_K, a.fh * SHADOW_K), shadowMat), Z_SHADOW, a.cy - 0.04, false).renderOrder = 3;
      a.frameMat = new THREE.MeshLambertMaterial({ color: C.frame });
      const frame = put(new THREE.Mesh(new THREE.BoxGeometry(a.fw, a.fh, FRAME_D), a.frameMat), Z_FRAME + FRAME_D / 2, a.cy, true);
      const mat = put(new THREE.Mesh(new THREE.PlaneGeometry(a.w + 2 * MAT, a.h + 2 * MAT), matMat), Z_MAT, a.cy, true);
      put(new THREE.Mesh(ringGeometry(a.w + 2 * BEVEL, a.h + 2 * BEVEL, a.w, a.h), bevelMat), Z_PIC, a.cy, false);
      a.artMat = new THREE.MeshBasicMaterial({ map: a.tex, toneMapped: false });
      const pic = put(new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.h), a.artMat), Z_PIC, a.cy, true);
      if (!labelTexBy.has(a.sub.id)) labelTexBy.set(a.sub.id, canvasTexture(labelCanvas(a.sub, artistName())));
      a.labelTex = labelTexBy.get(a.sub.id);
      put(new THREE.Mesh(new THREE.PlaneGeometry(LABEL_W * SHADOW_K, LABEL_H * SHADOW_K), labelShadowMat), Z_SHADOW, LABEL_Y - 0.008, false, a.lx, a.lz).renderOrder = 3;
      const label = put(new THREE.Mesh(new THREE.PlaneGeometry(LABEL_W, LABEL_H), new THREE.MeshBasicMaterial({ map: a.labelTex, toneMapped: false })), Z_LABEL, LABEL_Y, false, a.lx, a.lz);
      for (const m of [frame, mat, pic, label]) { m.userData.art = i; pickables.push(m); }
    });

    // --- words on the walls ---
    const coverTop = COVER_HANG + coverArt.fh / 2;
    const tw = R > 1 ? Math.min(2 * (partitions[0].d0 - 0.35), 6.2) : Math.min(W - 2 * CORNER - 0.4, 6.2);
    const th = clamp(ROOM_H - 0.3 - (coverTop + 0.22), 0.5, 1.6);
    const kicker = [artistName(), countText()].filter(Boolean).join(' · ');
    // Lettering is a see-through decal on the wall: it writes no depth (its
    // empty part cut the spot's light on the wall off in a straight line)
    // and is drawn after that light, so the light never washes the letters.
    const title = new THREE.Mesh(new THREE.PlaneGeometry(tw, th),
      new THREE.MeshBasicMaterial({ map: canvasTexture(titleCanvas(opts.title || '', kicker, opts.description || '', tw, th)), transparent: true, depthWrite: false, toneMapped: false }));
    title.position.set(0, coverTop + 0.22 + th / 2, coverZ + Z_LABEL);
    add(title, rooms[0], true);
    title.renderOrder = 4;            // after the light; its reflection keeps 0, before the floor
    for (let r = 1; r < R; r++) {
      const { bottom } = spanOf(r, R, D, partitions);
      const x = r < R - 1 ? (partitions[r].hang[0] + partitions[r].hang[1]) / 2 : 0;
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2 * 160 / 1024),
        new THREE.MeshBasicMaterial({ map: canvasTexture(roomCanvas(tr('g3dRoomN', { n: r + 1 }))), transparent: true, depthWrite: false, toneMapped: false }));
      tag.position.set(x, 3.4, bottom + Z_LABEL);
      tag.renderOrder = 4;
      add(tag, rooms[r], false);
    }

    if (!cam) {
      cam = new THREE.PerspectiveCamera(60, 1, NEAR, 160);
      cam.rotation.order = 'YXZ';
    }
    curRoom = -1; visLo = visHi = -1;
  }
  function teardownScene() {
    if (!scene) return;
    const keep = new Set(thumbCache.values()), done = new Set();
    scene.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (done.has(m)) continue;
        done.add(m);
        const t = m.map;
        if (t && !keep.has(t) && !done.has(t)) { done.add(t); t.dispose(); }
        m.dispose();
      }
    });
    for (const a of arts) { a.stale = true; if (a.hi) { a.hi.dispose(); a.hi = null; } }
    if (envRT) { envRT.dispose(); envRT = null; }
    scene = null; floorMat = null;
    arts = []; pickables = []; rooms = []; parts = []; mirrors = []; partitions = [];
  }

  // ---------- rooms: only the near ones are drawn ----------
  function roomAt(z) { return R <= 1 ? 0 : clamp(Math.floor((D / 2 - z) / Dr), 0, R - 1); }
  // The rooms in sight: the visitor's and its neighbours — both sides'
  // neighbours while they stand in a doorway.
  function updateRooms() {
    const room = roomAt(pz);
    if (room !== curRoom) { curRoom = room; updateRoomLabel(); }
    const a = roomAt(pz + 1.2), b = roomAt(pz - 1.2);
    const lo = Math.max(0, Math.min(a, b) - 1), hi = Math.min(R - 1, Math.max(a, b) + 1);
    if (lo === visLo && hi === visHi) return;
    visLo = lo; visHi = hi;
    rooms.forEach((c, i) => { c.g.visible = i >= lo && i <= hi; });
    parts.forEach((c, i) => { c.g.visible = rooms[i].g.visible || rooms[i + 1].g.visible; });
    scheduleResidency();
  }
  // Pictures of rooms well out of sight give their GPU memory back (three.js
  // uploads them again from the kept images); those of the rooms just
  // beyond are uploaded ahead, one at a time, so stepping through a doorway
  // never stalls on them.
  function scheduleResidency() { clearTimeout(residTimer); residTimer = setTimeout(manageResidency, 250); }
  function manageResidency() {
    if (closed || !ready || lost || !scene) return;
    const lo = visLo - 1, hi = visHi + 1;
    const near = a => a.room >= lo && a.room <= hi;
    const keep = new Set();
    for (const a of arts) if (near(a)) { keep.add(a.tex); keep.add(a.labelTex); }
    for (const a of arts) {
      if (near(a)) continue;
      if (a.hi) { a.artMat.map = a.tex; a.hi.dispose(); a.hi = null; }
      if (!keep.has(a.tex)) a.tex.dispose();
      if (!keep.has(a.labelTex)) a.labelTex.dispose();
    }
    const todo = [...keep];
    const pump = () => {
      if (closed || lost || !scene) return;
      const t = todo.shift();
      if (!t) return;
      try { renderer.initTexture(t); } catch (e) { /* uploaded on first use instead */ }
      residTimer = setTimeout(pump, 30);
    };
    pump();
  }

  // ---------- drawing ----------
  function syncCamera() {
    cam.position.set(px, EYE, pz);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }
  function wake() {
    dirty = true;
    if (raf || closed || paused || lost || !ready || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    if (closed || paused || lost) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const moving = step(dt);
    if (moving || dirty) {
      dirty = false;
      updateRooms();
      syncCamera();
      renderer.render(scene, cam);
      updateFocus();
      if (moving && prevFrame && adapt) judgeSpeed(now - prevFrame);
    }
    prevFrame = moving ? now : 0;
    if (afterGlide && !glide) { const f = afterGlide; afterGlide = null; f(); }
    if (moving) { if (!raf) raf = requestAnimationFrame(frame); }
    else scheduleLod();
  }
  // Too slow a device loses the floor's reflection first, then resolution.
  // Slow means under ~22 fps: a device held to 30 fps by a power-saving
  // mode would gain nothing from a plainer hall.
  function judgeSpeed(ms) {
    if (tier >= 2) return;
    sampled++;
    if (ms > 45) slowFrames++;
    if (sampled < 45) return;
    if (slowFrames / sampled > 0.5) setTier(tier + 1);
    sampled = slowFrames = 0;
  }
  function setTier(t) {
    tier = clamp(t, 0, 2);
    const reflect = tier === 0;
    mirrors.forEach(m => { m.visible = reflect; });
    if (floorMat) { floorMat.transparent = reflect; floorMat.opacity = reflect ? 1 - REFLECT : 1; floorMat.needsUpdate = true; }
    console.info(`3D hall: quality tier ${tier}`);
    resize();
  }
  function resize() {
    if (!renderer || !cam) return;
    const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight);
    renderer.setPixelRatio(tier >= 2 ? 1 : Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < h ? 72 : 60;      // a phone held upright sees too narrow a slice at 60°
    cam.updateProjectionMatrix();
    wake();
  }

  // ---------- moving ----------
  // Inside the hall and out of the walls between rooms: pushed out the
  // shortest way, so the visitor slides along a wall instead of stopping.
  function settle(x, z) {
    const xMin = -W / 2 + KEEP_OFF, xMax = W / 2 - KEEP_OFF, zMin = -D / 2 + KEEP_OFF, zMax = D / 2 - KEEP_OFF;
    x = clamp(x, xMin, xMax); z = clamp(z, zMin, zMax);
    for (let i = 0; i < partitions.length; i++) {
      const p = partitions[i], z0 = p.z0 - EDGE_KEEP, z1 = p.z1 + EDGE_KEEP;
      if (z <= z0 || z >= z1) continue;
      for (let k = 0; k < p.solids.length; k++) {
        const x0 = p.solids[k][0] - EDGE_KEEP, x1 = p.solids[k][1] + EDGE_KEEP;
        if (x <= x0 || x >= x1) continue;
        const m = Math.min(x - x0, x1 - x, z1 - z, z - z0);
        if (m === x - x0) x = x0; else if (m === x1 - x) x = x1; else if (m === z1 - z) z = z1; else z = z0;
      }
    }
    return [clamp(x, xMin, xMax), clamp(z, zMin, zMax)];
  }
  // In steps of 0.2 m at most: one big step (a fast wheel sends 0.6 m at
  // once) could land past the middle of a wall, which settle would then
  // resolve to the far side.
  function move(forward, strafe) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const dx = -s * forward + c * strafe, dz = -c * forward - s * strafe;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
    for (let i = 0; i < n; i++) [px, pz] = settle(px + dx / n, pz + dz / n);
  }
  function step(dt) {
    if (glide) {
      glide.t += dt;
      const k = glide.dur ? Math.min(1, glide.t / glide.dur) : 1;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      // along the path by distance walked
      let dist = e * glide.L, i = 0;
      while (i < glide.segs.length - 1 && dist > glide.segs[i]) { dist -= glide.segs[i]; i++; }
      const a = glide.path[i], b = glide.path[i + 1], f = glide.segs[i] ? Math.min(1, dist / glide.segs[i]) : 1;
      px = a[0] + (b[0] - a[0]) * f;
      pz = a[1] + (b[1] - a[1]) * f;
      const endYaw = glide.fyaw + glide.dyaw;
      if (glide.segs.length > 1) {
        // through a doorway: look where the path goes, then at what it leads to
        const want = k < 0.8 ? Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) : endYaw;
        yaw += turnTo(want, yaw) * Math.min(1, dt * (k < 0.8 ? 5 : 9));
      } else {
        yaw = glide.fyaw + glide.dyaw * e;
      }
      pitch = glide.fp + (glide.tp - glide.fp) * e;
      if (k >= 1) { yaw = endYaw; afterGlide = glide.after; glide = null; }
      return true;
    }
    let f = 0, s = 0, t = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD')) s += 1;
    if (keys.has('KeyA')) s -= 1;
    if (keys.has('ArrowLeft') || keys.has('KeyQ')) t += 1;
    if (keys.has('ArrowRight') || keys.has('KeyE')) t -= 1;
    if (stick.id !== null) { f -= stick.y; s += stick.x; }
    if (!f && !s && !t) return false;
    const mag = Math.hypot(f, s);
    if (mag > 1) { f /= mag; s /= mag; }
    const speed = keys.has('Shift') ? RUN : WALK;
    yaw += t * TURN * dt;
    move(f * speed * dt, s * speed * dt);
    return true;
  }
  // The way from here to (tx, tz): through the doorway of every wall in
  // between, from a point just before it to a point just after it.
  function route(tx, tz) {
    const pts = [], dirZ = Math.sign(tz - pz) || 1, reach = PART_T / 2 + 0.9;
    const crossed = partitions.filter(p => (pz - p.zc) * (tz - p.zc) < 0)
      .sort((p, q) => (dirZ < 0 ? q.zc - p.zc : p.zc - q.zc));
    crossed.forEach((p, i) => {
      const inDoor = i === 0 && Math.abs(pz - p.zc) < reach && px > p.d0 && px < p.d1;
      if (!inDoor) pts.push([p.doorX, p.zc - dirZ * reach]);
      pts.push([p.doorX, p.zc + dirZ * reach]);
    });
    pts.push([tx, tz]);
    return pts;
  }
  function glideTo(tx, tz, tyaw, tpitch, after) {
    [tx, tz] = settle(tx, tz);
    const path = [[px, pz], ...route(tx, tz)];
    const segs = [];
    let L = 0;
    for (let i = 1; i < path.length; i++) {
      const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      segs.push(l); L += l;
    }
    const dyaw = tyaw == null ? 0 : turnTo(tyaw, yaw);
    const dur = still ? 0 : clamp(Math.max(L / 2.6, Math.abs(dyaw) / 2.4), 0.35, 5);
    glide = { t: 0, dur, path, segs, L, fyaw: yaw, dyaw, fp: pitch, tp: tpitch == null ? pitch : tpitch, after: after || null };
    afterGlide = null;
    wake();
  }
  function cancelGlide() { glide = null; afterGlide = null; }
  // Walk up to an artwork and face it; `open` then shows it large.
  function fitDistance(a) {
    const tanV = Math.tan(cam.fov * Math.PI / 360), tanH = tanV * cam.aspect;
    return clamp(Math.max(a.viewDist, (a.fw / 2 + 0.2) / tanH, (a.fh / 2 + 0.25) / tanV), 1.5, 6);
  }
  function approach(i, open) {
    const a = arts[i];
    if (!a) return;
    const dist = fitDistance(a);
    const [tx, tz] = settle(a.x + a.nx * dist, a.z + a.nz * dist);
    const tp = clamp(Math.atan2(a.cy - EYE, Math.hypot(a.x - tx, a.z - tz)), -PITCH_MAX, PITCH_MAX);
    glideTo(tx, tz, Math.atan2(a.nx, a.nz), tp, open ? () => openArtwork(i) : null);
  }
  function openArtwork(i) {
    const a = arts[i];
    if (!a || closed || typeof openLightbox !== 'function' || !lbModal) return;
    paused = true;
    keys.clear(); stickRelease();
    // The lightbox is the page's own, outside the hall: the hall steps out of
    // the way of keyboard focus and screen readers until it closes.
    root.inert = true;
    try { openLightbox(a.sub); }
    catch (e) {
      console.error('3D hall: lightbox failed to open:', e);
      root.inert = false; paused = false; wake();
      return;
    }
    const x = document.getElementById('lightbox-close');
    if (x) x.focus({ preventScroll: true });
  }
  function navigate(dir) {
    if (!arts.length || !ready || introOpen) return;
    const from = focus >= 0 ? focus : (dir > 0 ? -1 : arts.length);
    approach((from + dir + arts.length) % arts.length, false);
  }

  // ---------- what the visitor is looking at ----------
  function blocked(ax, az, bx, bz) {
    for (let i = 0; i < partitions.length; i++) {
      const p = partitions[i];
      for (let k = 0; k < p.solids.length; k++) {
        if (segmentHitsBox(ax, az, bx, bz, p.solids[k][0], p.z0, p.solids[k][1], p.z1)) return true;
      }
    }
    return false;
  }
  function updateFocus() {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < arts.length; i++) {
      const a = arts[i], dx = a.x - px, dz = a.z - pz, d = Math.hypot(dx, dz);
      if (d > FOCUS_DIST || d < 0.1 || d >= bestD) continue;
      if ((dx * fx + dz * fz) / d < FOCUS_COS) continue;
      if (dx * a.nx + dz * a.nz > 0) continue;       // only from the front
      if (blocked(px, pz, a.x + a.nx * 0.08, a.z + a.nz * 0.08)) continue;
      bestD = d; best = i;
    }
    if (best === focus) return;
    focus = best;
    const cap = $('.g3d-caption'), view = $('.g3d-view');
    if (best >= 0) {
      const s = arts[best].sub, year = yearOf(s);
      cap.innerHTML = `<b>${escapeHtml(s.art_title || tr('untitledArtwork'))}</b>${year ? `<span>${escapeHtml(year)}</span>` : ''}`;
      cap.classList.remove('off'); view.disabled = false;
    } else {
      cap.classList.add('off'); view.disabled = true;
    }
    highlight();
  }
  function highlight() {
    arts.forEach((a, i) => a.frameMat.emissive.setHex(i === focus || i === hover ? C.focus : 0x000000));
    wake();
  }
  const ndc = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  function pickAt(x, y) {
    if (!scene) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    syncCamera();
    raycaster.setFromCamera(ndc, cam);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.find(h => h.object.parent && h.object.parent.visible) || null;
  }
  function tapAt(x, y) {
    const hit = pickAt(x, y);
    if (!hit) return;
    if (hit.object.userData.art != null) approach(hit.object.userData.art, true);
    else if (hit.object.userData.floor) glideTo(hit.point.x, hit.point.z, null, null, null);
  }
  function hoverAt(x, y) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (closed || !ready || introOpen || paused) return;
      const hit = pickAt(x, y);
      const i = hit && hit.object.userData.art != null ? hit.object.userData.art : -1;
      canvas.classList.toggle('pick', i >= 0);
      if (i !== hover) { hover = i; highlight(); }
    }, 40);
  }

  // ---------- sharper pictures near the visitor ----------
  // Walls carry the thumbnails (≈50 KB); the two or three works close in
  // front swap in the display image (≈350 KB, from Supabase directly — fast
  // from Korea, CORS-open), decoded off the main thread first, and give it
  // back when the visitor walks on.
  function scheduleLod() { clearTimeout(lodTimer); lodTimer = setTimeout(updateLod, 220); }
  function updateLod() {
    if (closed || paused || !ready || !scene) return;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const near = [];
    arts.forEach((a, i) => {
      const dx = a.x - px, dz = a.z - pz, d = Math.hypot(dx, dz);
      if (d > HIRES_DIST || (d > 0.1 && (dx * fx + dz * fz) / d < HIRES_COS)) return;
      if (blocked(px, pz, a.x + a.nx * 0.08, a.z + a.nz * 0.08)) return;
      near.push([d, i]);
    });
    near.sort((p, q) => p[0] - q[0]);
    const want = new Set(near.slice(0, HIRES_MAX).map(v => v[1]));
    if (focus >= 0) want.add(focus);
    arts.forEach((a, i) => {
      a.wantHi = want.has(i);
      if (a.wantHi && !a.hi && !a.hiLoading && !a.hiFailed) loadHi(a);
      else if (!a.wantHi && a.hi) { a.artMat.map = a.tex; a.hi.dispose(); a.hi = null; wake(); }
    });
  }
  async function loadHi(a) {
    const url = artworkDisplayUrl(a.sub);
    if (!url || url === thumbUrl(a.sub)) { a.hiFailed = true; return; }
    a.hiLoading = true;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      if (closed || a.stale || !a.wantHi) return;
      const t = prepTexture(new THREE.Texture(img));
      t.needsUpdate = true;
      a.hi = t; a.artMat.map = t;
      wake();
    } catch (e) {
      a.hiFailed = true;          // no display image for this one: the thumbnail stays
    } finally { a.hiLoading = false; }
  }

  // ---------- input ----------
  const lookSpeed = () => (cam.fov * Math.PI / 180) / Math.max(1, canvas.clientHeight) * 1.35;
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  function stickMove(e) {
    const r = stickEl.getBoundingClientRect(), Rr = r.width / 2;
    let dx = (e.clientX - (r.left + Rr)) / Rr, dy = (e.clientY - (r.top + Rr)) / Rr;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    stick.x = Math.abs(dx) < 0.12 ? 0 : dx;
    stick.y = Math.abs(dy) < 0.12 ? 0 : dy;
    knob.style.transform = `translate(${(dx * Rr * 0.55).toFixed(1)}px,${(dy * Rr * 0.55).toFixed(1)}px)`;
    wake();
  }
  function stickRelease() { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; }
  function wireInput() {
    listen(canvas, 'pointerdown', e => {
      if (!ready || introOpen || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, type: e.pointerType };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: plain events still arrive */ }
      canvas.classList.add('dragging');
    });
    listen(canvas, 'pointermove', e => {
      if (drag && e.pointerId === drag.id) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > (drag.type === 'mouse' ? 4 : 9)) { drag.moved = true; cancelGlide(); }
        if (drag.moved) {
          const k = lookSpeed();
          yaw += dx * k;
          pitch = clamp(pitch + dy * k, -PITCH_MAX, PITCH_MAX);
          wake();
        }
        return;
      }
      if (e.pointerType === 'mouse' && !drag) hoverAt(e.clientX, e.clientY);
    });
    const endDrag = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const tap = e.type === 'pointerup' && !drag.moved && performance.now() - drag.t < 600;
      drag = null;
      canvas.classList.remove('dragging');
      if (tap) tapAt(e.clientX, e.clientY);
    };
    listen(canvas, 'pointerup', endDrag);
    listen(canvas, 'pointercancel', endDrag);
    listen(canvas, 'contextmenu', e => e.preventDefault());
    listen(canvas, 'wheel', e => {
      e.preventDefault();
      if (!ready || introOpen) return;
      cancelGlide();
      move(clamp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025), -0.6, 0.6), 0);
      wake();
    }, { passive: false });
    listen(stickEl, 'pointerdown', e => {
      if (stick.id !== null || introOpen) return;
      stick.id = e.pointerId;
      try { stickEl.setPointerCapture(e.pointerId); } catch (err) { /* see above */ }
      cancelGlide();
      stickMove(e);
    });
    listen(stickEl, 'pointermove', e => { if (e.pointerId === stick.id) stickMove(e); });
    const stickEnd = e => { if (e.pointerId === stick.id) stickRelease(); };
    listen(stickEl, 'pointerup', stickEnd);
    listen(stickEl, 'pointercancel', stickEnd);
  }
  function wireControls() {
    // Capture phase: before auth.js's window-level Escape (which closes
    // dialogs) and the page's own key handlers.
    listen(document, 'keydown', e => {
      if (closed) return;
      if (e.key === 'Escape') {
        if (lightboxOpen()) return;          // the lightbox closes first
        e.preventDefault(); e.stopPropagation();
        if (introOpen && introIsHelp) hideIntro();
        else close();
        return;
      }
      // Tab stays inside the hall: the card's buttons while it is up, else the bars'.
      if (e.key === 'Tab' && !lightboxOpen()) {
        const items = [...root.querySelectorAll(introOpen ? '.g3d-intro button' : '.g3d-top button, .g3d-bottom button')]
          .filter(b => !b.disabled && b.offsetParent !== null);
        if (!items.length) { e.preventDefault(); return; }
        const at = items.indexOf(document.activeElement);
        let to = null;
        if (e.shiftKey) { if (at <= 0) to = items[items.length - 1]; }
        else if (at < 0 || at === items.length - 1) to = items[0];
        if (to) { e.preventDefault(); to.focus(); }
        return;
      }
      if (lightboxOpen() || !ready || introOpen || e.altKey || e.ctrlKey || e.metaKey) return;
      if (MOVE_KEYS.has(e.code)) { e.preventDefault(); keys.add(e.code); cancelGlide(); wake(); }
      else if (e.key === 'Shift') keys.add('Shift');
      else if (e.key === 'Enter' && focus >= 0 && (document.activeElement === root || document.activeElement === document.body)) {
        e.preventDefault(); approach(focus, true);
      }
    }, true);
    listen(document, 'keyup', e => { keys.delete(e.code); if (e.key === 'Shift') keys.delete('Shift'); }, true);
    listen(window, 'blur', () => keys.clear());
    listen(document, 'visibilitychange', () => {
      if (document.hidden) keys.clear();
      else { armLostTimer(); wake(); }
    });
    // The page underneath must not scroll; the card may scroll inside itself.
    listen(root, 'wheel', e => { if (!e.target.closest('.g3d-card')) e.preventDefault(); }, { passive: false });
    $('.g3d-exit').onclick = () => close();
    $('.g3d-to2d').onclick = () => close();
    $('.g3d-help').onclick = () => showIntro();
    $('.g3d-enter').onclick = () => hideIntro();
    $('.g3d-prev').onclick = () => navigate(-1);
    $('.g3d-next').onclick = () => navigate(1);
    $('.g3d-view').onclick = () => { if (focus >= 0) approach(focus, true); };
  }
  // The lightbox closing hands the walk back.
  const lbObserver = lbModal ? new MutationObserver(() => {
    if (closed || !paused || lightboxOpen()) return;
    paused = false;
    root.inert = false;
    root.focus({ preventScroll: true });
    wake();
  }) : null;

  // ---------- a lost GPU context (Android does this to background apps) ----------
  function onContextLost(e) {
    e.preventDefault();             // ask the browser to give it back
    lost = true;
    cancelAnimationFrame(raf); raf = 0;
    armLostTimer();
  }
  // Not back within a few seconds of being looked at again: the 2D page.
  function armLostTimer() {
    clearTimeout(lostTimer);
    if (!lost || closed || document.hidden) return;
    lostTimer = setTimeout(() => { if (lost && !closed && !document.hidden) { toast(tr('g3dLost')); close(); } }, 4000);
  }
  function onContextRestored() {
    lost = false;
    clearTimeout(lostTimer);
    if (closed || !scene) return;
    // Everything else is uploaded again from what three.js keeps; the
    // reflection map lived only on the GPU and is rendered again.
    if (envRT) envRT.dispose();
    envRT = makeEnvironment();
    floorMat.envMap = envRT.texture;
    floorMat.needsUpdate = true;
    wake();
  }

  // ---------- life cycle ----------
  async function start() {
    previousFocus = document.activeElement;
    document.body.appendChild(root);
    document.documentElement.classList.add('g3d-open');
    fillIntro();
    setProgress(0, 0);
    wireControls();
    if (lbObserver) lbObserver.observe(lbModal, { attributes: true, attributeFilter: ['class'] });
    // Opened from the 2D page: Back returns there. The entry underneath says
    // 2D (a reload after Back stays there); the hall's own entry is the plain
    // address, where the hall is the default.
    if (usesHistory) { setViewParam('2d'); hist.enter(); setViewParam(null); }
    root.focus({ preventScroll: true });
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
    } catch (e) {
      console.error('3D hall: no WebGL2 context:', e);
      if (!opts.quiet) toast(tr('g3dUnsupported'));
      close();
      return;
    }
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = LIGHT.exposure;
    maxAniso = renderer.capabilities.getMaxAnisotropy();
    aniso = Math.min(4, maxAniso);
    listen(canvas, 'webglcontextlost', onContextLost);
    listen(canvas, 'webglcontextrestored', onContextRestored);
    let { cover, rest } = pickWorks();
    if (!cover) { if (!opts.quiet) toast(tr('g3dEmpty')); close(); return; }
    // The label cards are drawn once, so the fonts must be in first.
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all(['400', '600', '700'].map(w => document.fonts.load(`${w} 40px Pretendard`))).catch(() => {}),
        sleep(1500),
      ]);
    }
    if (closed) return;
    await loadThumbs([cover, ...rest], false);
    if (closed) return;
    // An artwork edited or removed while this loaded: build what is there now.
    ({ cover, rest } = pickWorks());
    if (!cover) { close(); return; }
    await loadThumbs([cover, ...rest], true);
    if (closed) return;
    const t0 = performance.now();
    build(cover, rest);
    buildMs = Math.round(performance.now() - t0);
    px = 0; pz = D / 2 - 1.8; yaw = 0; pitch = 0;
    ready = true;
    wireInput();
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    disposers.push(() => ro.disconnect());
    resize();
    setReady();
    if (introOpen && (document.activeElement === root || document.activeElement === document.body)) $('.g3d-enter').focus({ preventScroll: true });
    if (opts.debug) window.__g3d = debugHandle();
  }
  // New data (an artwork edited or removed while the hall is open): rebuilt
  // in place, the visitor kept where they stand.
  async function update(next) {
    Object.assign(opts, next || {});
    if (closed) return;
    fillIntro();
    if (!ready) return;
    try {
      const { cover, rest } = pickWorks();
      if (!cover) { close(); return; }
      await loadThumbs([cover, ...rest], true);
      if (closed) return;
      const keep = [px, pz, yaw, pitch];
      cancelGlide();
      clearTimeout(residTimer); clearTimeout(lodTimer);
      teardownScene();
      focus = -1; hover = -1;
      build(cover, rest);
      [px, pz] = settle(keep[0], keep[1]);
      yaw = keep[2]; pitch = keep[3];
      $('.g3d-caption').classList.add('off');
      $('.g3d-view').disabled = true;
      updateRoomLabel();
      wake();
    } catch (e) {
      console.error('3D hall: rebuild failed:', e);
      if (!closed) close();          // half torn down: the 2D page is the safe place
    }
  }
  function close(how) {
    if (closed) return;
    closed = true;
    if (current === hall) current = null;
    cancelAnimationFrame(raf); raf = 0;
    for (const t of [lodTimer, hoverTimer, residTimer, lostTimer, introTimer]) clearTimeout(t);
    disposers.forEach(off => { try { off(); } catch (e) { /* already gone */ } });
    if (lbObserver) lbObserver.disconnect();
    teardownScene();
    for (const t of thumbCache.values()) t.dispose();
    thumbCache.clear();
    if (renderer) {
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* lost already */ }
    }
    root.remove();
    document.documentElement.classList.remove('g3d-open');
    if (window.__g3d) delete window.__g3d;
    // Back to the 2D page: through history when the hall came by it (its
    // entry is popped), else the address now says 2D, for a reload.
    if (usesHistory) { if (!(how && how.fromHistory)) hist.leave(); }
    else setViewParam('2d');
    try { if (previousFocus && previousFocus.focus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
    if (typeof opts.onClose === 'function') {
      try { opts.onClose(hall); } catch (e) { console.error('3D hall onClose failed:', e); }
    }
  }
  function back() {
    if (lightboxOpen()) {
      if (typeof closeLightbox === 'function') closeLightbox();
      // Staying: screenHistory pushes the hall's entry again, with the
      // address Back has just shown (?view=2d); the hall's own is the plain
      // one, so a reload there opens the hall.
      setTimeout(() => { if (!closed) setViewParam(null); }, 0);
      return true;
    }
    close({ fromHistory: true });
    return false;
  }
  // Test hook (&g3dtest only): where things are, for automated checks.
  function debugHandle() {
    return {
      state: () => ({ px, pz, yaw, pitch, focus, W, D, R, room: curRoom, vis: [visLo, visHi], tier, works: arts.length, ready, paused, intro: introOpen, hires: arts.filter(a => a.hi).length, buildMs }),
      arts: () => arts.map(a => ({ room: a.room, x: +a.x.toFixed(2), z: +a.z.toFixed(2), nx: a.nx, nz: a.nz, cover: !!a.isCover, title: a.sub.art_title })),
      screenOf: i => {
        const a = arts[i];
        if (!a) return null;
        syncCamera();
        const v = new THREE.Vector3(a.x + a.nx * 0.05, a.cy, a.z + a.nz * 0.05).project(cam);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
      },
      face: (i, dist) => {
        const a = arts[i];
        if (!a) return;
        cancelGlide();
        [px, pz] = settle(a.x + a.nx * (dist || 4), a.z + a.nz * (dist || 4));
        yaw = Math.atan2(a.nx, a.nz); pitch = 0; wake();
      },
      at: (x, z, y, p) => { cancelGlide(); [px, pz] = settle(x, z); yaw = y || 0; pitch = p || 0; wake(); },
      walkTo: i => approach(i, false),
      tapFloor: (x, z) => glideTo(x, z, null, null, null),
      artRoom: i => (arts[i] ? arts[i].room : null),
      doors: () => partitions.map(p => ({ zc: p.zc, doorX: p.doorX })),
      setTier: t => setTier(t),
      tune: o => {
        if (!scene) return;
        if (o.hemi != null) lights.hemi.intensity = o.hemi;
        if (o.sky != null) lights.hemi.color.set(o.sky);
        if (o.ground != null) lights.hemi.groundColor.set(o.ground);
        if (o.sun != null) lights.sun.intensity = o.sun;
        if (o.exposure != null) renderer.toneMappingExposure = o.exposure;
        if (o.floor != null) floorMat.color.set(o.floor);
        if (o.env != null) floorMat.envMapIntensity = o.env;
        if (o.rough != null) floorMat.roughness = o.rough;
        if (o.wall != null) mats.wall.color.set(o.wall);
        wake();
      },
      info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }),
    };
  }

  const hall = { start, close, back, update, closed: () => closed };
  return hall;
}
