// Makes the moving parts of the sky page's photograph (2026-09-27): the
// trees cut out so they can sway, the photograph without them underneath,
// two sea layers that shimmer, and the brightest stars to twinkle.
//
//   node tools/sky-scene.js
//   node tools/sky-scene.js sky/ConstellationNightSkyBackground.png --loop 160
//
// It starts from the ORIGINAL photograph (not committed — sky/*.png is in
// .gitignore), because in sky/night-loop.webp the trees at the left edge are
// already cross-faded with the right edge and no longer black. It cuts the
// trees out there, then applies the same seamless loop tools/sky-art.js
// --loop applies (the last --loop columns faded into the first, stretched
// back to full width) to the bare photograph and to the trees alike, so
// every layer lines up with the old sky/night-loop.webp and with
// js/sky-figures.js.
//
// Writes:
//   sky/night-bare.webp              the looped photograph with the trees painted out
//   sky/trees-{left,mid,right}.webp  the tree silhouettes, cropped
//   sky/sea-glint.webp               the lights on the water, lifted out
//   sky/sea-wave-{a,b}.webp          wave crests that roll in, two random sets
//   js/sky-scene.js                  where each layer sits + the twinkling stars
//                                    (the page reads it; do not edit it by hand)
//
// How the trees come out: they are near black (every channel ≤ 16) while
// the sea, the sky and the far hills are not. That mask, grown by a few
// pixels, is filled in from its edges and then smoothed until it has no
// seams (harmonic fill) — this is the photograph without trees. Each tree
// pixel's alpha is how much darker it is than that filled-in background, so
// the silhouette's soft edges stay soft. The trees only lean a few pixels,
// so the painted-out part never has to hold detail.
//
// The layers are split in three: the left and right groups meet across the
// loop seam and must sway together; the middle group sways on its own. The
// left/middle split is at the column with the fewest tree pixels.
//
// sharp comes with node_modules (wrangler). This folder is not served
// (functions/tools/[[path]].js answers 404).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const args = process.argv.slice(2);
const SRC = args.find(a => !a.startsWith('--')) || 'sky/ConstellationNightSkyBackground.png';
const LOOP = Number((args[args.indexOf('--loop') + 1]) || 160) || 160;
const OUT_DIR = 'sky';
const JS_OUT = 'js/sky-scene.js';

// Highest a tree reaches in each band of columns (original photograph).
// The band 900–1300 has none, and 1300–1700 starts low so the dark island
// (almost as black as a tree) is never taken for one.
function treeTop(x) { return x < 300 ? 560 : x < 900 ? 722 : x < 1300 ? Infinity : x < 1700 ? 772 : 640; }
const SEA_TOP = 738;          // the far shore, in the looped photograph
const GLINT_TOP = 757;        // below the shore lights, so they stay put
const GROW = 4;               // painted-out margin around the trees

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// The loop of tools/sky-art.js --loop, on raw pixels with `ch` channels:
// columns x < B take the photo's column x faded (smoothstep) into column
// W - B + x, the last B columns are dropped, and sharp stretches the result
// back to W.
async function loopImage(buf, W, H, ch) {
  const B = LOOP, Pw = W - B, out = Buffer.alloc(Pw * H * ch);
  for (let y = 0; y < H; y++) for (let x = 0; x < Pw; x++) {
    const o = (y * Pw + x) * ch, a = (y * W + x) * ch;
    if (x >= B) { for (let c = 0; c < ch; c++) out[o + c] = buf[a + c]; continue; }
    const u = x / B, t = u * u * (3 - 2 * u), b = (y * W + W - B + x) * ch;
    for (let c = 0; c < ch; c++) out[o + c] = Math.round(buf[a + c] * t + buf[b + c] * (1 - t));
  }
  let img = sharp(out, { raw: { width: Pw, height: H, channels: ch } })
    .resize(W, H, { fit: 'fill', kernel: 'lanczos3' });
  // sharp widens a one-channel raw image to three unless told otherwise.
  if (ch === 1) img = img.toColourspace('b-w');
  const res = await img.raw().toBuffer({ resolveWithObject: true });
  if (res.info.channels !== ch) throw new Error(`loopImage: expected ${ch} channels, got ${res.info.channels}`);
  return res.data;
}

async function main() {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const lumAt = (buf, p) => 0.299 * buf[p * 3] + 0.587 * buf[p * 3 + 1] + 0.114 * buf[p * 3 + 2];

  // ---- where the trees are (original photograph) ----
  const hard = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y < treeTop(x)) continue;
    const i = (y * W + x) * 3;
    if (Math.max(data[i], data[i + 1], data[i + 2]) <= 16) hard[y * W + x] = 1;
  }
  // A lone dark pixel of sky is not a tree.
  const tree = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!hard[p]) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < W && yy >= 0 && yy < H) n += hard[yy * W + xx];
    }
    if (n >= 4) tree[p] = 1;
  }
  const grown = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!tree[y * W + x]) continue;
    for (let dy = -GROW; dy <= GROW; dy++) for (let dx = -GROW; dx <= GROW; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < W && yy >= 0 && yy < H && dx * dx + dy * dy <= GROW * GROW) grown[yy * W + xx] = 1;
    }
  }

  // ---- paint them out: onion-peel fill, then harmonic smoothing ----
  const bare = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) bare[i] = data[i];
  const known = new Uint8Array(N);
  let todo = [];
  for (let p = 0; p < N; p++) { if (grown[p]) todo.push(p); else known[p] = 1; }
  const inside = todo.slice();
  while (todo.length) {
    const next = [], done = [];
    for (const p of todo) {
      const x = p % W, y = (p - x) / W;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const q = yy * W + xx;
        if (!known[q]) continue;
        r += bare[q * 3]; g += bare[q * 3 + 1]; b += bare[q * 3 + 2]; n++;
      }
      if (n) done.push([p, r / n, g / n, b / n]); else next.push(p);
    }
    if (!done.length) break;
    for (const [p, r, g, b] of done) { bare[p * 3] = r; bare[p * 3 + 1] = g; bare[p * 3 + 2] = b; known[p] = 1; }
    todo = next;
  }
  // Harmonic smoothing (Gauss–Seidel on the 4-neighbour average) removes
  // the peel's diamond streaks; the pixels outside the mask stay fixed.
  for (let it = 0; it < 120; it++) {
    for (const p of inside) {
      const x = p % W, y = (p - x) / W;
      for (let c = 0; c < 3; c++) {
        let s = 0, n = 0;
        if (x > 0) { s += bare[(p - 1) * 3 + c]; n++; }
        if (x < W - 1) { s += bare[(p + 1) * 3 + c]; n++; }
        if (y > 0) { s += bare[(p - W) * 3 + c]; n++; }
        if (y < H - 1) { s += bare[(p + W) * 3 + c]; n++; }
        bare[p * 3 + c] = s / n;
      }
    }
  }
  const bareBuf = Buffer.alloc(N * 3);
  for (let i = 0; i < N * 3; i++) bareBuf[i] = clamp(Math.round(bare[i]), 0, 255);

  // Tree alpha: how much darker than the filled-in sky behind it.
  const alpha = Buffer.alloc(N);
  for (let p = 0; p < N; p++) {
    if (!grown[p]) continue;
    const lb = lumAt(bareBuf, p), lo = lumAt(data, p);
    alpha[p] = Math.round(clamp((lb - lo) / Math.max(10, lb - 3), 0, 1) * 255);
  }

  // ---- loop both the same way the photograph was looped ----
  const bareL = await loopImage(bareBuf, W, H, 3);
  const alphaL = await loopImage(alpha, W, H, 1);
  const photoL = await loopImage(data, W, H, 3);   // for the sea and the stars
  await sharp(bareL, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 82 }).toFile(path.join(OUT_DIR, 'night-bare.webp'));

  // ---- tree layers ----
  const k = W / (W - LOOP);                  // original → looped columns
  const split1 = Math.round(bestSplit(250, 330) * k), split2 = Math.round(1100 * k);
  function bestSplit(a, b) {
    let best = a, least = Infinity;
    for (let x = a; x <= b; x++) {
      let n = 0;
      for (let y = 0; y < H; y++) n += tree[y * W + x];
      if (n < least) { least = n; best = x; }
    }
    return best;
  }
  const regionOf = x => x < split1 ? 'left' : x < split2 ? 'mid' : 'right';
  const TREE_RGB = [3, 4, 9];
  const layers = {};
  for (const name of ['left', 'mid', 'right']) {
    let x0 = W, x1 = -1, y0 = H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (regionOf(x) !== name || alphaL[y * W + x] < 10) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y;
    }
    if (x1 < 0) continue;
    // The outer groups keep the photograph's edge exactly, so the loop seam
    // stays closed when they lean.
    if (name === 'left') x0 = 0;
    if (name === 'right') x1 = W - 1;
    y0 = Math.max(0, y0 - 2);
    const w = x1 - x0 + 1, h = H - y0, buf = Buffer.alloc(w * h * 4);
    for (let y = y0; y < H; y++) for (let x = x0; x <= x1; x++) {
      const o = ((y - y0) * w + (x - x0)) * 4;
      buf[o] = TREE_RGB[0]; buf[o + 1] = TREE_RGB[1]; buf[o + 2] = TREE_RGB[2];
      buf[o + 3] = regionOf(x) === name ? alphaL[y * W + x] : 0;
    }
    await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 90, alphaQuality: 90 }).toFile(path.join(OUT_DIR, `trees-${name}.webp`));
    layers[name] = { x: x0, y: y0, w, h };
  }

  // ---- the sea (looped photograph) ----
  const treeish = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (alphaL[p] > 6) treeish[p] = 1;
  const isSea = (x, y) => {
    if (y < SEA_TOP || treeish[y * W + x]) return false;
    const i = (y * W + x) * 3;
    return photoL[i + 2] >= 30 && photoL[i + 2] >= photoL[i] * 1.15;
  };
  let sx0 = W, sx1 = 0;
  for (let y = SEA_TOP; y < H; y++) for (let x = 0; x < W; x++) if (isSea(x, y)) { if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; }
  const seaBox = { x: sx0, y: SEA_TOP, w: sx1 - sx0 + 1, h: H - SEA_TOP };

  // Glint: the bright light on the water (reflections of the shore lights
  // and the sky), lifted out so it can waver.
  {
    const bx = seaBox.x, w = seaBox.w, by = GLINT_TOP, gh = H - GLINT_TOP;
    const buf = Buffer.alloc(w * gh * 4);
    for (let y = by; y < H; y++) for (let x = bx; x < bx + w; x++) {
      if (treeish[y * W + x]) continue;
      const i = (y * W + x) * 3, m = Math.max(photoL[i], photoL[i + 1], photoL[i + 2]);
      const a = clamp((m - 48) / 70, 0, 1);
      if (!a) continue;
      const o = ((y - by) * w + (x - bx)) * 4;
      for (let c = 0; c < 3; c++) buf[o + c] = Math.min(255, photoL[i + c] * 1.15);
      buf[o + 3] = Math.round(a * 255);
    }
    await sharp(buf, { raw: { width: w, height: gh, channels: 4 } }).webp({ quality: 85, alphaQuality: 80 }).toFile(path.join(OUT_DIR, 'sea-glint.webp'));
    layers.glint = { x: bx, y: by, w, h: gh };
  }
  // Waves (2026-09-27, "파도 치는 효과"): a band of wave crests — a wavy
  // line of foam broken into runs, a paler wave face under it — drawn at the
  // TOP of an image as tall as the sea. The page slides the image down the
  // sea (translateY 0 → 100%), growing it as it comes (perspective) and
  // fading it in and out, several copies apart, so crest after crest rolls
  // in towards the viewer. Two random sets, so neighbours differ.
  const BAND = 16;
  for (const [key, seed] of [['a', 7], ['b', 19]]) {
    const { w, h } = seaBox;
    const buf = Buffer.alloc(w * h * 4);
    const r = rnd(seed);
    const p1 = r() * 6.3, p2 = r() * 6.3;
    // Foam runs: 40–220 px of crest, 15–90 px of calm between.
    const foam = new Float32Array(w);
    for (let x = Math.floor(r() * 60); x < w;) {
      const len = 40 + Math.floor(r() * 180), peak = 0.55 + r() * 0.45;
      for (let d = 0; d < len && x + d < w; d++) foam[x + d] = peak * Math.sin(Math.PI * d / len) ** 0.6;
      x += len + 15 + Math.floor(r() * 75);
    }
    for (let x = 0; x < w; x++) {
      const I = foam[x];
      if (!I) continue;
      const cy = 5 + 1.8 * Math.sin(x / 41 + p1) + 1.1 * Math.sin(x / 17 + p2);
      for (let y = 0; y < BAND && y < h; y++) {
        const crest = Math.exp(-(((y - cy) / 1.6) ** 2));
        const face = y > cy ? 0.3 * Math.exp(-(y - cy) / 5) : 0;
        const a = Math.min(1, I * (crest + face));
        if (a < 0.02) continue;
        const k = crest / (crest + face + 1e-6);             // 1 on the crest, 0 on the face
        const o = (y * w + x) * 4;
        // Moonlit water, not white paint: the crest a soft grey-blue, the face
        // barely lighter than the sea itself (2026-09-27, "너무 밝아").
        buf[o] = Math.round(70 + 60 * k); buf[o + 1] = Math.round(92 + 62 * k); buf[o + 2] = Math.round(140 + 60 * k);
        buf[o + 3] = Math.round(a * 150);
      }
    }
    await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 85, alphaQuality: 85 }).toFile(path.join(OUT_DIR, `sea-wave-${key}.webp`));
    layers['wave' + key.toUpperCase()] = { ...seaBox };
  }

  // ---- stars to twinkle: the most striking star in each patch of sky ----
  // A grid keeps them spread over the whole sky instead of all landing in
  // the Milky Way, where the brightest points are.
  const COLS = 20, ROWS = 4, TOP = 14, BOTTOM = 540;
  const best = new Map();
  for (let y = TOP; y < BOTTOM; y++) for (let x = 7; x < W - 7; x++) {
    const p = y * W + x, l = lumAt(photoL, p);
    if (l < 40) continue;
    let isMax = true, ring = 0, rn = 0;
    for (let dy = -6; dy <= 6 && isMax; dy++) for (let dx = -6; dx <= 6; dx++) {
      if (!dx && !dy) continue;
      const lj = lumAt(photoL, (y + dy) * W + x + dx);
      if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) { if (lj > l) { isMax = false; break; } }
      else if (Math.abs(dx) === 6 || Math.abs(dy) === 6) { ring += lj; rn++; }
    }
    if (!isMax) continue;
    const contrast = l - ring / rn;
    if (contrast < 10) continue;
    const cell = Math.floor(x / (W / COLS)) + ',' + Math.floor((y - TOP) / ((BOTTOM - TOP) / ROWS));
    const have = best.get(cell);
    if (!have || contrast > have[2]) best.set(cell, [x, y, contrast]);
  }
  const kept = [];
  for (const c of [...best.values()].sort((a, b) => b[2] - a[2])) {
    if (!kept.some(k => (k[0] - c[0]) ** 2 + (k[1] - c[1]) ** 2 < 42 * 42)) kept.push(c);
  }
  const twinkles = kept.sort((a, b) => a[0] - b[0])
    .map(([x, y, c]) => [x, y, +(4.5 + Math.min(1, (c - 10) / 120) * 5).toFixed(1)]);

  const v = stamp();
  const box = b => `[${b.x}, ${b.y}, ${b.w}, ${b.h}]`;
  fs.writeFileSync(JS_OUT, `// Generated by tools/sky-scene.js — do not edit by hand.
// The moving layers of the sky page's photograph: where each sits, in the
// photograph's own pixels ([x, y, width, height] of SKY_W × SKY_H in
// js/sky-figures.js), and the stars that twinkle ([x, y, size]).
// No DOM. Read by js/stars.js.
const SKY_BARE_IMAGE = '/sky/night-bare.webp?v=${v}';
const SKY_SCENE = {
  trees: [
    { key: 'left', src: '/sky/trees-left.webp?v=${v}', box: ${box(layers.left)} },
    { key: 'mid', src: '/sky/trees-mid.webp?v=${v}', box: ${box(layers.mid)} },
    { key: 'right', src: '/sky/trees-right.webp?v=${v}', box: ${box(layers.right)} },
  ],
  glint: { src: '/sky/sea-glint.webp?v=${v}', box: ${box(layers.glint)} },
  waves: [
    { src: '/sky/sea-wave-a.webp?v=${v}', box: ${box(layers.waveA)} },
    { src: '/sky/sea-wave-b.webp?v=${v}', box: ${box(layers.waveB)} },
  ],
};
const SKY_TWINKLES = ${JSON.stringify(twinkles)};
`);
  for (const f of ['night-bare', 'trees-left', 'trees-mid', 'trees-right', 'sea-glint', 'sea-wave-a', 'sea-wave-b']) {
    console.log(`${f}.webp ${(fs.statSync(path.join(OUT_DIR, f + '.webp')).size / 1024).toFixed(1)} KB`);
  }
  console.log('split', split1, split2, JSON.stringify(layers), 'twinkles', twinkles.length);
}
function stamp() {
  const d = new Date();
  // Date and time: a layer made again the same day must still get a new
  // ?v=, or browsers keep the old one for the week /sky/ is cached.
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
main().catch(e => { console.error('sky-scene:', e); process.exit(1); });
