// 3D exhibition hall for a portfolio — stage 0, the device test (2026-11-11).
//
// A room is built from the portfolio's own artworks: the cover hangs on the
// far wall under the portfolio's title, the rest go round the walls in the
// portfolio's order, each framed with a mat, a pool of light above it and a
// label card beside it whose lower half is a "View large" button. Visitors
// walk (W A S D / arrow keys / wheel; a joystick on touch screens), look
// round by dragging, tap the floor to walk there, and tap an artwork or its
// label to walk up to it — the page's own lightbox then opens it large, with
// its stories, likes and comments.
//
// Opened by js/portfolio.js on ?view=3d (not linked from anywhere yet);
// &g3dtest=N repeats the works up to N, to try a full hall on a phone.
// An ES module loaded on demand: three.js (jsDelivr's one-file bundle,
// pinned) arrives only when the hall opens, so the 2D page costs nothing.
//
// Android lessons (css/tarot.css, 2026-10-10/11): the hall is one canvas,
// i.e. one GPU layer, under a few fixed controls that keep layers of their
// own; and it draws only while something moves — idle, the GPU rests.
//
// Needs tr and fmtCompletedYear (js/i18n), escapeHtml, toast, screenHistory,
// artworkDisplayUrl and collectionItemCountText (common.js) and openLightbox
// (lightbox.js) loaded first. Styles: css/gallery3d.css.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.187.0/+esm';

// ---------- measurements (metres) ----------
const EYE = 1.6;                  // eye height
const ROOM_H = 4.0;
const HANG = 1.5, COVER_HANG = 1.65;   // centre heights of an artwork / the cover
const ART_H = 1.15, ART_W = 1.6;       // largest ordinary artwork
const COVER_H = 1.5, COVER_W = 2.2;
const MAT = 0.06, BORDER = 0.045, FRAME_D = 0.035;
const LABEL_W = 0.42, LABEL_H = 0.21, LABEL_GAP = 0.16, LABEL_Y = 1.2;
const MIN_GAP = 0.8, CORNER = 0.9, DOOR_W = 2.4;
const WALK = 1.6, RUN = 2.8, TURN = 1.8;          // m/s, m/s, rad/s
const KEEP_OFF = 0.55;                            // never closer to a wall
const FOCUS_DIST = 4.5, FOCUS_COS = Math.cos(0.4);
const HIRES_DIST = 3.6, HIRES_MAX = 2, HIRES_COS = Math.cos(1.0);
const PITCH_MAX = 0.62;
const WALL_COLOR = 0xebe8e1;
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
// Any CSS colour (the viewer's hsl() accent included) to #rrggbb.
function cssToHex(css, fallback) {
  try {
    const g = document.createElement('canvas').getContext('2d');
    g.fillStyle = fallback; g.fillStyle = css || fallback;
    return /^#[0-9a-f]{6}$/i.test(g.fillStyle) ? g.fillStyle : fallback;
  } catch (e) { return fallback; }
}

// ---------- pictures drawn on canvases ----------
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
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
function yearOf(sub) {
  return sub.art_completed_date && typeof fmtCompletedYear === 'function' ? fmtCompletedYear(sub.art_completed_date) : '';
}
// The label card beside an artwork: title, artist · year, material, and a
// "View large" pill — the button the visitor presses.
function labelCanvas(sub, artist) {
  const c = makeCanvas(512, 256), g = c.getContext('2d');
  g.fillStyle = '#fbfaf7'; roundRect(g, 1, 1, 510, 254, 14); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 2; g.stroke();
  g.textBaseline = 'top';
  g.fillStyle = '#1d1b18'; g.font = `700 32px ${FONT}`;
  let y = 22;
  for (const l of wrapText(g, sub.art_title || tr('untitledArtwork'), 464, 2)) { g.fillText(l, 24, y); y += 40; }
  const meta = [artist, yearOf(sub)].filter(Boolean).join(' · ');
  g.fillStyle = '#5d5850'; g.font = `500 23px ${FONT}`;
  if (meta) { g.fillText(wrapText(g, meta, 464, 1)[0] || '', 24, y + 4); y += 31; }
  if (sub.art_material) { g.fillStyle = '#7a746a'; g.font = `400 21px ${FONT}`; g.fillText(wrapText(g, sub.art_material, 464, 1)[0] || '', 24, y + 6); }
  const bh = 52, by = 256 - bh - 18, bx = 24;
  g.font = `700 23px ${FONT}`;
  const bw = Math.min(464, 68 + g.measureText(tr('g3dView')).width);
  g.fillStyle = '#1d1b18'; roundRect(g, bx, by, bw, bh, bh / 2); g.fill();
  drawMagnifier(g, bx + 28, by + bh / 2 - 3, 9, '#fbfaf7', 3.5);
  g.fillStyle = '#fbfaf7'; g.textBaseline = 'middle';
  g.fillText(tr('g3dView'), bx + 52, by + bh / 2 + 1);
  return c;
}
// The portfolio's name on the far wall, above the cover (2048×400).
function titleCanvas(title, artist, count) {
  const c = makeCanvas(2048, 400), g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#26221d';
  let size = 128;
  g.font = `800 ${size}px ${FONT}`;
  while (size > 72 && g.measureText(title).width > 1900) { size -= 6; g.font = `800 ${size}px ${FONT}`; }
  g.fillText(wrapText(g, title, 1900, 1)[0] || '', 1024, 150);
  g.fillStyle = 'rgba(38,34,29,.78)'; g.font = `600 58px ${FONT}`;
  g.fillText([artist, count].filter(Boolean).join(' · '), 1024, 300);
  return c;
}
// A soft pool of light thrown on the wall by the spot above an artwork.
function haloCanvas() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 112, 6, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return c;
}
// Warm oak planks, 25 cm wide, one tile per 2 m.
function floorCanvas() {
  const c = makeCanvas(1024, 1024), g = c.getContext('2d');
  const planks = 8, pw = 1024 / planks;
  for (let i = 0; i < planks; i++) {
    const l = 56 + ((i * 37) % 9) - 4;
    g.fillStyle = `hsl(31 32% ${l}%)`; g.fillRect(i * pw, 0, pw, 1024);
    g.strokeStyle = `hsla(28 36% ${l - 12}% / .32)`; g.lineWidth = 2;
    for (let k = 0; k < 9; k++) {
      const x0 = i * pw + 8 + ((k * 53 + i * 17) % (pw - 16));
      g.beginPath(); g.moveTo(x0, 0);
      for (let yy = 0; yy <= 1024; yy += 32) g.lineTo(x0 + Math.sin((yy + k * 40 + i * 90) / 110) * 3.5, yy);
      g.stroke();
    }
    g.fillStyle = 'rgba(48,32,20,.55)';
    g.fillRect(i * pw, 0, 2, 1024);
    g.fillRect(i * pw, (i * 389) % 1024, pw, 2);
  }
  return c;
}
function placeholderCanvas() {
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = '#cfcac0'; g.fillRect(0, 0, 256, 256);
  drawMagnifier(g, 118, 118, 30, 'rgba(0,0,0,.25)', 10);
  return c;
}

// ---------- the floor plan ----------
// Wall stretches artworks can hang on, walked clockwise from the entrance:
// left wall, far wall either side of the cover, right wall, and (only when
// the room would otherwise get very long) the entrance wall either side of
// the door. `along` runs to the visitor's right as they face the wall.
function wallStretches(W, D, cover, withEntrance) {
  const hx = W / 2, hz = D / 2, out = [];
  out.push({ key: 'left', ox: -hx, oz: hz - CORNER, dx: 0, dz: -1, nx: 1, nz: 0, len: D - 2 * CORNER });
  const coverLeft = cover ? -cover.fw / 2 : 0;
  const coverRight = cover ? cover.fw / 2 + LABEL_GAP + LABEL_W : 0;
  out.push({ key: 'backL', ox: -hx + CORNER, oz: -hz, dx: 1, dz: 0, nx: 0, nz: 1, len: (coverLeft - MIN_GAP) - (-hx + CORNER) });
  out.push({ key: 'backR', ox: coverRight + MIN_GAP, oz: -hz, dx: 1, dz: 0, nx: 0, nz: 1, len: (hx - CORNER) - (coverRight + MIN_GAP) });
  out.push({ key: 'right', ox: hx, oz: -hz + CORNER, dx: 0, dz: 1, nx: -1, nz: 0, len: D - 2 * CORNER });
  if (withEntrance) {
    out.push({ key: 'entR', ox: hx - CORNER, oz: hz, dx: -1, dz: 0, nx: 0, nz: -1, len: (hx - CORNER) - (DOOR_W / 2 + MIN_GAP) });
    out.push({ key: 'entL', ox: -DOOR_W / 2 - MIN_GAP, oz: hz, dx: -1, dz: 0, nx: 0, nz: -1, len: (-DOOR_W / 2 - MIN_GAP) - (-hx + CORNER) });
  }
  return out;
}
const footprint = a => a.fw + LABEL_GAP + LABEL_W;
// Shares the artworks out over the stretches in order, in proportion to
// their lengths, so a short portfolio spreads round the room instead of
// crowding the first wall. Null when some stretch would be too tight.
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
// The smallest comfortable room that holds everything (W across, D deep).
function planRoom(cover, works) {
  for (let D = 7; D <= 80; D += 0.5) {
    const W = clamp(Math.round(D * 1.5) / 2, 7, 18);
    for (const withEntrance of D > 14 ? [false, true] : [false]) {
      const stretches = wallStretches(W, D, cover, withEntrance);
      const groups = shareOut(stretches, works);
      if (groups) return { W, D, stretches, groups };
    }
  }
  return null;
}

// ---------- the hall ----------
let current = null;
// Back (browser, phone gesture, the app's back button) leaves the hall —
// or, with an artwork open large, closes just that (common.js screenHistory).
const hist = typeof screenHistory === 'function' ? screenHistory(() => (current ? current.back() : false)) : null;

export async function openGallery3D(opts) {
  if (current) return current;
  const hall = createHall(opts || {});
  current = hall;
  try { await hall.start(); }
  catch (e) {
    console.error('3D hall failed to start:', e);
    if (!hall.closed()) { hall.close(); toast(tr('g3dLoadFailed')); }
  }
  return hall;
}

function createHall(opts) {
  const coarse = media('(pointer: coarse)');
  const still = media('(prefers-reduced-motion: reduce)');
  const lbModal = document.getElementById('lightbox-modal');
  const lightboxOpen = () => !!lbModal && lbModal.classList.contains('open');
  const artist = opts.artist || '';

  const root = document.createElement('div');
  root.className = 'g3d';
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', tr('g3dLabel'));
  root.innerHTML = `
    <canvas class="g3d-canvas" aria-hidden="true"></canvas>
    <div class="g3d-top">
      <button type="button" class="g3d-btn g3d-exit">&larr; ${escapeHtml(tr('g3dExit'))}</button>
      <div class="g3d-name"><b></b><span></span></div>
      <button type="button" class="g3d-btn g3d-round g3d-help" aria-label="${escapeHtml(tr('g3dHelp'))}">?</button>
    </div>
    <div class="g3d-caption off" aria-live="polite"></div>
    <div class="g3d-bottom">
      <button type="button" class="g3d-btn g3d-round g3d-prev" aria-label="${escapeHtml(tr('g3dPrev'))}">&lsaquo;</button>
      <button type="button" class="g3d-btn g3d-view" disabled>
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 20 20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
        <span>${escapeHtml(tr('g3dView'))}</span></button>
      <button type="button" class="g3d-btn g3d-round g3d-next" aria-label="${escapeHtml(tr('g3dNext'))}">&rsaquo;</button>
    </div>
    <div class="g3d-stick" hidden><div class="g3d-knob"></div></div>
    <div class="g3d-intro">
      <div class="g3d-card">
        <div class="g3d-card-kicker">${escapeHtml(tr('g3dLabel'))}</div>
        <h2 class="g3d-card-title"></h2>
        <div class="g3d-card-artist"></div>
        <p class="g3d-card-desc"></p>
        <ul class="g3d-card-help"></ul>
        <div class="g3d-card-progress"><div class="g3d-bar"><i></i></div><span></span></div>
        <button type="button" class="g3d-btn g3d-enter" disabled></button>
      </div>
    </div>`;
  const $ = sel => root.querySelector(sel);
  const canvas = $('.g3d-canvas');
  const stickEl = $('.g3d-stick'), knob = $('.g3d-knob');

  let closed = false, ready = false, paused = false, introOpen = true, introIsHelp = false;
  let renderer = null, scene = null, cam = null, aniso = 1;
  let W = 8, D = 8;
  let px = 0, pz = 0, yaw = 0, pitch = 0;
  const arts = [];            // walking (clockwise) order
  const pickables = [];
  const keys = new Set();
  const stick = { id: null, x: 0, y: 0 };
  let glide = null, afterGlide = null, drag = null;
  let focus = -1, hover = -1;
  let raf = 0, last = 0, dirty = true;
  let lodTimer = 0, hoverTimer = 0;
  let previousFocus = null;
  const disposers = [];
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); disposers.push(() => target.removeEventListener(type, fn, o)); };
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  // ---------- intro card (also the help card) ----------
  function fillIntro() {
    $('.g3d-card-title').textContent = opts.title || '';
    $('.g3d-card-artist').textContent = artist;
    const desc = $('.g3d-card-desc');
    desc.textContent = opts.description || '';
    desc.hidden = !opts.description;
    const help = coarse
      ? ['g3dHelpLookTouch', 'g3dHelpWalkStick', 'g3dHelpFloor', 'g3dHelpArt']
      : ['g3dHelpLookMouse', 'g3dHelpWalkKeys', 'g3dHelpFloor', 'g3dHelpArt'];
    $('.g3d-card-help').innerHTML = help.map(k => `<li>${escapeHtml(tr(k))}</li>`).join('');
    $('.g3d-name b').textContent = opts.title || '';
    $('.g3d-name span').textContent = artist;
    $('.g3d-enter').textContent = tr('g3dEnter');
  }
  function setProgress(n, total) {
    $('.g3d-bar i').style.width = `${total ? Math.round(n / total * 100) : 0}%`;
    $('.g3d-card-progress span').textContent = tr('g3dPreparing', { n, total });
  }
  function showIntro() {
    introOpen = true; introIsHelp = true; keys.clear(); stickRelease();
    $('.g3d-intro').hidden = false;
    $('.g3d-enter').textContent = tr('g3dContinue');
    $('.g3d-enter').focus({ preventScroll: true });
  }
  function hideIntro() {
    if (!ready) return;
    introOpen = false; introIsHelp = false;
    $('.g3d-intro').hidden = true;
    stickEl.hidden = !coarse;
    root.focus({ preventScroll: true });
    wake();
  }

  // ---------- building ----------
  function prepTexture(t) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  }
  function canvasTexture(c) { return prepTexture(new THREE.CanvasTexture(c)); }
  function thumbUrl(sub) { return sub.thumb_url || artworkDisplayUrl(sub) || sub.image_url; }
  async function loadThumbs(subs) {
    const urls = [...new Set(subs.map(thumbUrl).filter(Boolean))];
    const out = new Map();
    let next = 0, done = 0;
    setProgress(0, urls.length);
    const worker = async () => {
      while (next < urls.length && !closed) {
        const url = urls[next++];
        try { out.set(url, prepTexture(await loader.loadAsync(url))); }
        catch (e) { console.error('3D hall: thumbnail failed to load:', url, e); }
        setProgress(++done, urls.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
    return out;
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
  // The cover (first by the portfolio's choice, else the first work) and
  // the rest in order; &g3dtest=N repeats the rest up to N works in all.
  function pickWorks() {
    const list = (opts.works || []).filter(Boolean);
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

  function build(cover, rest, thumbs) {
    const placeholder = canvasTexture(placeholderCanvas());
    const mk = (sub, isCover) => {
      const tex = thumbs.get(thumbUrl(sub)) || placeholder;
      return { sub, isCover, tex, ...sizeFor(tex === placeholder ? null : tex, isCover) };
    };
    const coverArt = mk(cover, true);
    const restArts = rest.map(s => mk(s, false));
    const plan = planRoom(coverArt, restArts);
    if (!plan) throw new Error('3D hall: no floor plan fits');
    W = plan.W; D = plan.D;
    const hx = W / 2, hz = D / 2;
    // the cover: centred on the far wall
    Object.assign(coverArt, { x: 0, z: -hz, nx: 0, nz: 1, cy: COVER_HANG, lx: coverArt.fw / 2 + LABEL_GAP + LABEL_W / 2, lz: -hz });
    // the rest: spread evenly along their stretches
    for (const [st, list] of plan.groups) {
      if (!list.length) continue;
      const used = list.reduce((s, a) => s + footprint(a), 0);
      const gap = (st.len - used) / (list.length + 1);
      let along = gap;
      for (const a of list) {
        const artAlong = along + a.fw / 2, labelAlong = along + a.fw + LABEL_GAP + LABEL_W / 2;
        Object.assign(a, {
          x: st.ox + st.dx * artAlong, z: st.oz + st.dz * artAlong, nx: st.nx, nz: st.nz, cy: HANG,
          lx: st.ox + st.dx * labelAlong, lz: st.oz + st.dz * labelAlong,
        });
        along += footprint(a) + gap;
      }
    }
    // walking order: clockwise from the entrance, the cover in its place
    const order = ['left', 'backL', 'COVER', 'backR', 'right', 'entR', 'entL'];
    for (const key of order) {
      if (key === 'COVER') { arts.push(coverArt); continue; }
      const st = plan.stretches.find(s => s.key === key);
      if (st && plan.groups.get(st)) arts.push(...plan.groups.get(st));
    }
    arts.forEach(a => { a.viewDist = viewDistance(a); });

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c0e);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb3a898, 3.4));
    const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
    key.position.set(-0.4, 1, 0.35);
    scene.add(key);

    // room
    const accent = cssToHex(opts.accent, '#c9b48a');
    const wallMat = new THREE.MeshLambertMaterial({ color: WALL_COLOR });
    const featureMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(WALL_COLOR).lerp(new THREE.Color(accent), 0.3) });
    const wall = (len, x, z, ry, mat) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, ROOM_H), mat);
      m.position.set(x, ROOM_H / 2, z); m.rotation.y = ry;
      scene.add(m); pickables.push(m);
    };
    wall(D, -hx, 0, Math.PI / 2, wallMat);
    wall(W, 0, -hz, 0, featureMat);
    wall(D, hx, 0, -Math.PI / 2, wallMat);
    wall(W, 0, hz, Math.PI, wallMat);
    const floorTex = canvasTexture(floorCanvas());
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(W / 2, D / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.userData.floor = true;
    scene.add(floor); pickables.push(floor);
    // Unlit: facing down, a lit ceiling only catches the floor's brown bounce.
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: 0xdcd9d2 }));
    ceiling.rotation.x = Math.PI / 2; ceiling.position.y = ROOM_H;
    scene.add(ceiling);
    const baseMat = new THREE.MeshLambertMaterial({ color: 0x3a342d });
    const baseboard = (len, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.02), baseMat);
      m.position.set(x, 0.05, z); m.rotation.y = ry; scene.add(m);
    };
    baseboard(D, -hx + 0.01, 0, Math.PI / 2); baseboard(W, 0, -hz + 0.01, 0);
    baseboard(D, hx - 0.01, 0, Math.PI / 2); baseboard(W, 0, hz - 0.01, 0);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W - 0.4, 2.5), new THREE.MeshBasicMaterial({ color: 0x1b1916 }));
    door.position.set(0, 1.25, hz - 0.006); door.rotation.y = Math.PI;
    scene.add(door);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0 });
    const strip = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stripMat);
      m.rotation.x = Math.PI / 2; m.position.set(x, ROOM_H - 0.005, z); scene.add(m);
    };
    strip(0.14, D - 2, -hx + 1.2, 0); strip(0.14, D - 2, hx - 1.2, 0); strip(W - 2.4, 0.14, 0, -hz + 1.2);
    // the title above the cover
    const tw = Math.min(W - 2 * CORNER, 5.6), th = tw / 5.12;
    const count = typeof collectionItemCountText === 'function' ? collectionItemCountText((opts.works || []).length) : '';
    const title = new THREE.Mesh(new THREE.PlaneGeometry(tw, th),
      new THREE.MeshBasicMaterial({ map: canvasTexture(titleCanvas(opts.title || '', artist, count)), transparent: true, toneMapped: false }));
    title.position.set(0, ROOM_H - 0.2 - th / 2, -hz + 0.005);
    scene.add(title);

    // artworks
    const haloTex = canvasTexture(haloCanvas());
    // Unlit: the mat must read as white paper whatever the light.
    const matMat = new THREE.MeshBasicMaterial({ color: 0xf3efe6 });
    const labels = new Map();
    const fixtures = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.035, 0.1, 10),
      new THREE.MeshLambertMaterial({ color: 0x55524c }), arts.length);
    const dummy = new THREE.Object3D();
    arts.forEach((a, i) => {
      const ry = Math.atan2(a.nx, a.nz);
      const put = (mesh, off, y, x = a.x, z = a.z) => {
        mesh.position.set(x + a.nx * off, y, z + a.nz * off); mesh.rotation.y = ry; scene.add(mesh); return mesh;
      };
      put(new THREE.Mesh(new THREE.PlaneGeometry(a.fw + 1.2, a.fh + 1.5),
        new THREE.MeshBasicMaterial({ map: haloTex, color: 0xfff3dc, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
      0.003, a.cy + 0.22);
      a.frameMat = new THREE.MeshLambertMaterial({ color: 0x26221d });
      const frame = put(new THREE.Mesh(new THREE.BoxGeometry(a.fw, a.fh, FRAME_D), a.frameMat), 0.004 + FRAME_D / 2, a.cy);
      const mat = put(new THREE.Mesh(new THREE.PlaneGeometry(a.w + 2 * MAT, a.h + 2 * MAT), matMat), 0.004 + FRAME_D + 0.001, a.cy);
      a.artMat = new THREE.MeshBasicMaterial({ map: a.tex, toneMapped: false });
      const pic = put(new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.h), a.artMat), 0.004 + FRAME_D + 0.002, a.cy);
      if (!labels.has(a.sub.id)) labels.set(a.sub.id, canvasTexture(labelCanvas(a.sub, artist)));
      const label = put(new THREE.Mesh(new THREE.PlaneGeometry(LABEL_W, LABEL_H),
        new THREE.MeshBasicMaterial({ map: labels.get(a.sub.id), toneMapped: false })), 0.006, LABEL_Y, a.lx, a.lz);
      for (const m of [frame, mat, pic, label]) { m.userData.art = i; pickables.push(m); }
      dummy.position.set(a.x + a.nx * 0.6, ROOM_H - 0.06, a.z + a.nz * 0.6);
      dummy.rotation.set(0, ry, 0.0); dummy.updateMatrix();
      fixtures.setMatrixAt(i, dummy.matrix);
    });
    scene.add(fixtures);

    cam = new THREE.PerspectiveCamera(60, 1, 0.05, 120);
    cam.rotation.order = 'YXZ';
    px = 0; pz = hz - 1.6; yaw = 0; pitch = 0;
  }

  // ---------- drawing ----------
  function syncCamera() {
    cam.position.set(px, EYE, pz);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }
  function wake() {
    dirty = true;
    if (raf || closed || paused || !ready || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    if (closed || paused) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const moving = step(dt);
    if (moving || dirty) {
      dirty = false;
      syncCamera();
      renderer.render(scene, cam);
      updateFocus();
    }
    if (afterGlide && !glide) { const f = afterGlide; afterGlide = null; f(); }
    if (moving) { if (!raf) raf = requestAnimationFrame(frame); }
    else scheduleLod();
  }
  function resize() {
    if (!renderer) return;
    const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < h ? 72 : 60;      // a phone held upright sees too narrow a slice at 60°
    cam.updateProjectionMatrix();
    wake();
  }

  // ---------- moving ----------
  const clampX = x => clamp(x, -W / 2 + KEEP_OFF, W / 2 - KEEP_OFF);
  const clampZ = z => clamp(z, -D / 2 + KEEP_OFF, D / 2 - KEEP_OFF);
  function move(forward, strafe) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    px = clampX(px - s * forward + c * strafe);
    pz = clampZ(pz - c * forward - s * strafe);
  }
  function step(dt) {
    if (glide) {
      glide.t += dt;
      const k = glide.dur ? Math.min(1, glide.t / glide.dur) : 1;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      px = glide.fx + (glide.tx - glide.fx) * e;
      pz = glide.fz + (glide.tz - glide.fz) * e;
      yaw = glide.fyaw + glide.dyaw * e;
      pitch = glide.fp + (glide.tp - glide.fp) * e;
      if (k >= 1) { afterGlide = glide.after; glide = null; }
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
  function glideTo(tx, tz, tyaw, tpitch, after) {
    const dyaw = tyaw == null ? 0 : turnTo(tyaw, yaw);
    const dist = Math.hypot(tx - px, tz - pz);
    const dur = still ? 0 : clamp(Math.max(dist / 2.6, Math.abs(dyaw) / 2.4), 0.35, 1.3);
    glide = { t: 0, dur, fx: px, fz: pz, tx, tz, fyaw: yaw, dyaw, fp: pitch, tp: tpitch == null ? pitch : tpitch, after: after || null };
    afterGlide = null;
    wake();
  }
  function cancelGlide() { glide = null; afterGlide = null; }
  // Walk up to an artwork and face it; `open` then shows it large.
  function approach(i, open) {
    const a = arts[i];
    if (!a) return;
    const tx = clampX(a.x + a.nx * a.viewDist), tz = clampZ(a.z + a.nz * a.viewDist);
    const tp = clamp(Math.atan2(a.cy - EYE, Math.hypot(a.x - tx, a.z - tz)), -PITCH_MAX, PITCH_MAX);
    glideTo(tx, tz, Math.atan2(a.nx, a.nz), tp, open ? () => openArtwork(i) : null);
  }
  function openArtwork(i) {
    const a = arts[i];
    if (!a || closed || typeof openLightbox !== 'function' || !lbModal) return;
    paused = true;
    keys.clear(); stickRelease();
    openLightbox(a.sub);
  }
  function navigate(dir) {
    if (!arts.length) return;
    const from = focus >= 0 ? focus : (dir > 0 ? -1 : arts.length);
    approach((from + dir + arts.length) % arts.length, false);
  }

  // ---------- what the visitor is looking at ----------
  function updateFocus() {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = -1, bestD = Infinity;
    arts.forEach((a, i) => {
      const dx = a.x - px, dz = a.z - pz, d = Math.hypot(dx, dz);
      if (d > FOCUS_DIST || d < 0.1) return;
      if ((dx * fx + dz * fz) / d < FOCUS_COS) return;
      if (dx * a.nx + dz * a.nz > 0) return;     // only from the front
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best === focus) return;
    focus = best;
    const cap = $('.g3d-caption'), view = $('.g3d-view');
    if (best >= 0) {
      const s = arts[best].sub;
      cap.textContent = [s.art_title || tr('untitledArtwork'), yearOf(s)].filter(Boolean).join(' · ');
      cap.classList.remove('off'); view.disabled = false;
    } else {
      cap.textContent = ''; cap.classList.add('off'); view.disabled = true;
    }
    highlight();
  }
  function highlight() {
    arts.forEach((a, i) => a.frameMat.emissive.setHex(i === focus || i === hover ? 0x8a6424 : 0x000000));
    wake();
  }
  const ndc = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  function pickAt(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    syncCamera();
    raycaster.setFromCamera(ndc, cam);
    return raycaster.intersectObjects(pickables, false)[0] || null;
  }
  function tapAt(x, y) {
    const hit = pickAt(x, y);
    if (!hit) return;
    if (hit.object.userData.art != null) approach(hit.object.userData.art, true);
    else if (hit.object.userData.floor) glideTo(clampX(hit.point.x), clampZ(hit.point.z), null, null, null);
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
  // front swap in the display image (≈350 KB, Supabase directly — fast from
  // Korea, CORS-open) and give it back when the visitor walks on.
  function scheduleLod() { clearTimeout(lodTimer); lodTimer = setTimeout(updateLod, 220); }
  function updateLod() {
    if (closed || paused || !ready) return;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const near = [];
    arts.forEach((a, i) => {
      const dx = a.x - px, dz = a.z - pz, d = Math.hypot(dx, dz);
      if (d > HIRES_DIST || (d > 0.1 && (dx * fx + dz * fz) / d < HIRES_COS)) return;
      near.push([d, i]);
    });
    near.sort((p, q) => p[0] - q[0]);
    const want = new Set(near.slice(0, HIRES_MAX).map(n => n[1]));
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
      const t = prepTexture(await loader.loadAsync(url));
      if (closed || !a.wantHi) { t.dispose(); return; }
      a.hi = t; a.artMat.map = t; wake();
    } catch (e) {
      a.hiFailed = true;     // no display image for this one: the thumbnail stays
    } finally { a.hiLoading = false; }
  }

  // ---------- input ----------
  const lookSpeed = () => (cam.fov * Math.PI / 180) / Math.max(1, canvas.clientHeight) * 1.35;
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  function stickMove(e) {
    const r = stickEl.getBoundingClientRect(), R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    stick.x = Math.abs(dx) < 0.12 ? 0 : dx;
    stick.y = Math.abs(dy) < 0.12 ? 0 : dy;
    knob.style.transform = `translate(${dx * R * 0.55}px,${dy * R * 0.55}px)`;
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
      if (stick.id !== null) return;
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
    // dialogs) and before the page's own key handlers.
    listen(document, 'keydown', e => {
      if (closed) return;
      if (e.key === 'Escape') {
        if (lightboxOpen()) return;          // the lightbox closes first
        e.preventDefault(); e.stopPropagation();
        if (introOpen && introIsHelp) hideIntro();
        else close();
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
    listen(document, 'visibilitychange', () => { if (document.hidden) keys.clear(); else wake(); });
    // The page underneath must not scroll with the hall open; the intro card
    // may scroll inside itself.
    listen(root, 'wheel', e => { if (!e.target.closest('.g3d-card')) e.preventDefault(); }, { passive: false });
    $('.g3d-exit').onclick = () => close();
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
    root.focus({ preventScroll: true });
    wake();
  }) : null;

  // ---------- life cycle ----------
  async function start() {
    previousFocus = document.activeElement;
    document.body.appendChild(root);
    document.documentElement.classList.add('g3d-open');
    fillIntro();
    wireControls();
    if (lbObserver) lbObserver.observe(lbModal, { attributes: true, attributeFilter: ['class'] });
    if (hist) {
      hist.enter(['view']);
      // Keep ?view=3d on the hall's own entry, so a reload comes back here.
      try {
        const u = new URL(location.href);
        u.searchParams.set('view', '3d');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      } catch (e) { /* history unavailable */ }
    }
    root.focus({ preventScroll: true });
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
    } catch (e) {
      console.error('3D hall: no WebGL2 context:', e);
      toast(tr('g3dUnsupported'));
      close();
      return;
    }
    aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    listen(canvas, 'webglcontextlost', e => { e.preventDefault(); if (!closed) { toast(tr('g3dLost')); close(); } });
    const { cover, rest } = pickWorks();
    if (!cover) { toast(tr('g3dEmpty')); close(); return; }
    // The label cards are drawn once, so the fonts must be in first.
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all(['500', '700', '800'].map(w => document.fonts.load(`${w} 32px Pretendard`))).catch(() => {}),
        sleep(1500),
      ]);
    }
    const thumbs = await loadThumbs([cover, ...rest]);
    if (closed) return;
    build(cover, rest, thumbs);
    ready = true;
    wireInput();
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    disposers.push(() => ro.disconnect());
    resize();
    $('.g3d-card-progress').hidden = true;
    const enter = $('.g3d-enter');
    enter.disabled = false;
    enter.focus({ preventScroll: true });
    if (opts.debug) window.__g3d = debugHandle();
  }
  function disposeScene() {
    if (!scene) return;
    const seen = new Set();
    scene.traverse(o => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m.map && !seen.has(m.map)) { seen.add(m.map); m.map.dispose(); }
        m.dispose();
      }
    });
    for (const a of arts) {
      if (a.hi) a.hi.dispose();
      if (a.tex && !seen.has(a.tex)) { seen.add(a.tex); a.tex.dispose(); }
    }
  }
  function close(how) {
    if (closed) return;
    closed = true;
    if (current === hall) current = null;
    cancelAnimationFrame(raf);
    clearTimeout(lodTimer); clearTimeout(hoverTimer);
    disposers.forEach(off => { try { off(); } catch (e) { /* already gone */ } });
    if (lbObserver) lbObserver.disconnect();
    disposeScene();
    if (renderer) {
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* lost already */ }
    }
    root.remove();
    document.documentElement.classList.remove('g3d-open');
    if (window.__g3d) delete window.__g3d;
    if (!(how && how.fromHistory) && hist) hist.leave();
    try { if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
  }
  function back() {
    if (lightboxOpen()) {
      if (typeof closeLightbox === 'function') closeLightbox();
      return true;                       // stay in the hall
    }
    close({ fromHistory: true });
    return false;
  }
  // Test hook (&g3dtest only): where things are, for automated checks.
  function debugHandle() {
    return {
      state: () => ({ px, pz, yaw, pitch, focus, W, D, works: arts.length, ready, paused, hires: arts.filter(a => a.hi).length }),
      screenOf: i => {
        const a = arts[i];
        if (!a) return null;
        syncCamera();
        const v = new THREE.Vector3(a.x + a.nx * 0.05, a.cy, a.z + a.nz * 0.05).project(cam);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
      },
      face: i => { const a = arts[i]; if (a) { cancelGlide(); px = clampX(a.x + a.nx * 4); pz = clampZ(a.z + a.nz * 4); yaw = Math.atan2(a.nx, a.nz); pitch = 0; wake(); } },
    };
  }

  const hall = { start, close, back, closed: () => closed };
  return hall;
}
