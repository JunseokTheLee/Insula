// Color-matching engine shared by the home page (new-project grid creation)
// and the project page (reshape + artwork submission placement).
"use strict";

function luminance(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

// Cells that land on a (near-)fully transparent part of the reference
// image are left out of the grid entirely — no mosaic_pixels row is ever
// created for them, so they can never be matched against and render as a
// permanent gap rather than a fake color. Also used below to keep
// transparent padding around an uploaded artwork from skewing its average.
const TRANSPARENT_ALPHA_THRESHOLD = 5;
// Sampled over a grid and alpha-weighted, rather than the old trick of
// drawImage-ing straight down to a single pixel: browsers composite that
// 1x1 downscale in premultiplied-alpha space, so any transparent padding
// around the artwork (very common on uploaded PNGs) dragged the average
// toward black instead of being ignored. Sampling manually and skipping/
// weighting by alpha gives a color that actually represents the artwork.
const AVG_COLOR_SAMPLE_SIZE = 48;
function imageAverageColor(imgEl) {
  const c = document.createElement('canvas');
  c.width = AVG_COLOR_SAMPLE_SIZE; c.height = AVG_COLOR_SAMPLE_SIZE;
  const ctx = c.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, AVG_COLOR_SAMPLE_SIZE, AVG_COLOR_SAMPLE_SIZE);
  const d = ctx.getImageData(0, 0, AVG_COLOR_SAMPLE_SIZE, AVG_COLOR_SAMPLE_SIZE).data;
  let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < TRANSPARENT_ALPHA_THRESHOLD) continue;
    rSum += d[i] * a; gSum += d[i + 1] * a; bSum += d[i + 2] * a; aSum += a;
  }
  if (!aSum) return { r: 255, g: 255, b: 255 }; // fully transparent artwork — nothing to sample
  return { r: Math.round(rSum / aSum), g: Math.round(gSum / aSum), b: Math.round(bSum / aSum) };
}
function imageToColorGrid(imgEl, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < TRANSPARENT_ALPHA_THRESHOLD) continue;
      cells.push({ x, y, target_r: d[i], target_g: d[i + 1], target_b: d[i + 2] });
    }
  }
  return cells;
}
// sRGB -> CIE Lab (D65 white point). Lab separates lightness (L*) from
// hue/chroma (a*/b*) far better than RGB does: darkening a color scales
// all three RGB channels toward zero together, so two dark colors of
// completely different hues (dark green vs dark navy) end up numerically
// close in RGB even though they don't look alike, while two colors of the
// *same* hue at different lightness (dark green vs light green) end up
// numerically far apart. In Lab, a*/b* stay roughly independent of L*, so
// hue differences show up as hue differences regardless of shade — and
// for desaturated/gray colors a*/b* naturally collapse toward zero, so
// (unlike raw HSL hue-angle) there's no spurious "hue" to weight in the
// first place.
function rgbToLab(r, g, b) {
  const toLinear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750) / 1.0;
  const z = (lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : (t * 903.3 + 16) / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
// Weighting L* well below its natural scale (rather than 1:1) deliberately
// prioritizes hue/chroma matches over shade matches — a dark green and a
// light green should be judged "closer" than a dark green and a dark
// navy, which is the opposite of what plain RGB distance was doing. 0.2
// was picked empirically: it's low enough to flip that dark-green-vs-
// dark-navy-vs-light-green ordering for realistic saturated colors, but
// not 0 — fully ignoring L* would let a pitch-black and a neon-bright
// patch of the "same" hue be treated as interchangeable, which would
// wreck the overall light/dark structure (and legibility) of the
// finished mosaic. Still returns a squared distance — callers that need
// the actual distance take Math.sqrt() of the result, same as before.
const LIGHTNESS_WEIGHT = 0.2;
function colorDistanceSq(a, b) {
  const la = rgbToLab(a.r, a.g, a.b), lb = rgbToLab(b.r, b.g, b.b);
  const dL = la.L - lb.L, da = la.a - lb.a, db = la.b - lb.b;
  return LIGHTNESS_WEIGHT * dL * dL + da * da + db * db;
}
// Lab distance (with the lightness de-weighting above) tops out around
// ~45 for black-vs-white and can reach ~250 for polar-opposite vivid hues
// (e.g. pure green vs pure blue) — a much smaller range than the old
// RGB-based metric's ~0-765. Above this, the closest open cell is
// different enough from the artwork's average color that it won't
// visually read as a match — flag it for the user.
const POOR_MATCH_DISTANCE = 60;

// Greedy nearest-color assignment used when reshaping a project onto a
// new grid: each already-submitted piece claims the closest still-free
// cell in the new grid, one at a time. Not globally optimal (a proper
// assignment-problem solver would minimize total color error across all
// pieces at once), but it's a fast, simple approximation that's good
// enough for redistributing a few hundred/thousand submissions in the
// browser, and it reuses the exact same distance metric the live
// claim-a-cell flow already uses, so results feel consistent.
function assignToClosestCells(items, cells) {
  const pool = cells.slice();
  const assignments = [];
  for (const item of items) {
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = colorDistanceSq(item, { r: pool[i].target_r, g: pool[i].target_g, b: pool[i].target_b });
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const cell = pool.splice(bestIdx, 1)[0];
    assignments.push({ item, cell });
  }
  return assignments;
}
// Nudges a greedy assignment closer to globally optimal without the
// O(n^2) cost of checking every pair: each iteration tries one random
// pair of already-assigned items and keeps the swap only if it lowers
// total color error. Bounded to a fixed multiple of n so it stays cheap
// even at thousands of pieces, and in practice gets close to what a true
// (but much slower) optimal-assignment solver would produce.
const SWAP_PASS_MAX_ITERATIONS = 200000;
function improveAssignmentWithSwaps(assignments) {
  const n = assignments.length;
  if (n < 2) return assignments;
  const dist = (item, cell) => colorDistanceSq(item, { r: cell.target_r, g: cell.target_g, b: cell.target_b });
  const err = assignments.map(a => dist(a.item, a.cell));
  const iterations = Math.min(SWAP_PASS_MAX_ITERATIONS, n * 25);
  for (let iter = 0; iter < iterations; iter++) {
    const i = (Math.random() * n) | 0;
    const j = (Math.random() * n) | 0;
    if (i === j) continue;
    const ai = assignments[i], aj = assignments[j];
    const newI = dist(ai.item, aj.cell);
    const newJ = dist(aj.item, ai.cell);
    if (newI + newJ < err[i] + err[j]) {
      const tmp = ai.cell; ai.cell = aj.cell; aj.cell = tmp;
      err[i] = newI; err[j] = newJ;
    }
  }
  return assignments;
}
