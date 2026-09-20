// Colour-by-number boards: turns an artwork image into a small grid of
// numbered cells with a palette, and reads/writes the stored copy in
// pixel_boards (supabase_pixel_game.sql). Shared by the coloring page
// (js/coloring.js), the upload flow (js/profile-view.js) and the admin
// "pixel boards" tool (js/admin.js).
//
// Needs js/color-engine.js (rgbToLab) and js/common.js (sb, getSiteSettings,
// isSchemaMismatchError) loaded first.
"use strict";

// Cells that are not part of the artwork (transparent PNG padding) carry
// this index: they are never painted and never counted.
const PIXEL_EMPTY = 255;
// Hard ceilings, mirrored by set_pixel_board on the server.
const PIXEL_MAX_SIDE = 128;
const PIXEL_MAX_COLORS = 64;

// Three difficulty levels per artwork (supabase_pixel_levels.sql): the same
// picture as a smaller or larger board. Sizes and palette sizes are site
// options (pixelEasyGrid … pixelHardColors); the defaults here match
// SITE_SETTING_DEFAULTS (common.js) so an unreadable settings row still
// gives a sensible board.
const PIXEL_LEVELS = [1, 2, 3];   // easy · normal · hard
const PIXEL_LEVEL_KEYS = { 1: 'Easy', 2: 'Normal', 3: 'Hard' };
const PIXEL_LEVEL_DEFAULTS = { 1: { grid: 24, colors: 10 }, 2: { grid: 40, colors: 13 }, 3: { grid: 64, colors: 16 } };
function pixelBoardOptions(settings, level) {
  const s = settings || {};
  const lv = PIXEL_LEVELS.includes(level) ? level : 2;
  const k = PIXEL_LEVEL_KEYS[lv], d = PIXEL_LEVEL_DEFAULTS[lv];
  const clamp = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  return {
    level: lv,
    grid: clamp(s['pixel' + k + 'Grid'], 12, PIXEL_MAX_SIDE, d.grid),        // cells on the long side
    colors: clamp(s['pixel' + k + 'Colors'], 4, PIXEL_MAX_COLORS, d.colors), // palette size before merging
    merge: clamp(s.pixelMergeDistance, 0, 30, 8),               // Lab ΔE under which two colours are one
    minColors: clamp(s.pixelMinColors, 2, 32, 6),               // fewer → not a board
    maxShare: 0.9,                                              // one colour covering more → not a board
  };
}

// Lab → sRGB, for palette colours that were averaged in Lab space.
function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const finv = t => (t * t * t > 0.008856 ? t * t * t : (116 * t - 16) / 903.3);
  const x = finv(fx) * 0.95047, y = finv(fy) * 1.0, z = finv(fz) * 1.08883;
  let r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  const gamma = c => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };
  return [gamma(r), gamma(g), gamma(bb)];
}

// Builds a board from an image element (same-origin: an upload preview or
// a /img/ URL, so the canvas stays readable).
//   { ok, reason, w, h, palette: [[r,g,b],…], cells: Uint8Array, colors, total }
// Steps: downscale to the grid → Lab per cell → median cut to `colors`
// boxes → merge boxes closer than ΔE `merge` → nearest palette colour per
// cell → palette sorted light-to-dark (number 1 is the lightest, the
// convention every colour-by-number app uses). Cells whose pixel is (near)
// transparent become PIXEL_EMPTY.
function buildPixelBoard(img, opts) {
  const o = opts || pixelBoardOptions(null);
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return { ok: false, reason: 'no-image' };
  const n = o.grid;
  const w = w0 >= h0 ? n : Math.max(4, Math.round(n * w0 / h0));
  const h = w0 >= h0 ? Math.max(4, Math.round(n * h0 / w0)) : n;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const count = w * h;
  const labs = new Float32Array(count * 3);
  const idx = [];
  for (let i = 0; i < count; i++) {
    if (d[i * 4 + 3] < 40) continue;                 // transparent padding: not a cell
    const lab = rgbToLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    labs[i * 3] = lab.L; labs[i * 3 + 1] = lab.a; labs[i * 3 + 2] = lab.b;
    idx.push(i);
  }
  if (!idx.length) return { ok: false, reason: 'no-image' };

  // Median cut in Lab. The box with the widest axis (weighted by size, so a
  // big nearly-flat box still gets split before a tiny spread-out one) is
  // split at its median on that axis.
  const rangeOf = box => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const i of box) for (let k = 0; k < 3; k++) { const v = labs[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  };
  let boxes = [idx];
  while (boxes.length < o.colors) {
    let bi = -1, bs = 0, bch = 0;
    for (let b = 0; b < boxes.length; b++) {
      if (boxes[b].length < 2) continue;
      const r = rangeOf(boxes[b]);
      const ch = r[0] >= r[1] && r[0] >= r[2] ? 0 : (r[1] >= r[2] ? 1 : 2);
      const score = r[ch] * Math.sqrt(boxes[b].length);
      if (score > bs) { bs = score; bi = b; bch = ch; }
    }
    if (bi < 0) break;                               // every box is a single colour already
    const box = boxes[bi];
    box.sort((p, q) => labs[p * 3 + bch] - labs[q * 3 + bch]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  let pal = boxes.map(box => {
    let L = 0, a = 0, b = 0;
    for (const i of box) { L += labs[i * 3]; a += labs[i * 3 + 1]; b += labs[i * 3 + 2]; }
    const m = box.length;
    return { L: L / m, a: a / m, b: b / m, n: m };
  });
  // Merge palette entries that would look like the same colour with two
  // numbers (the experiment behind DevDocs/PixelColoringReview_20260918
  // produced grey 2 next to grey 4). Closest pair first, weighted by size.
  const dE = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
  while (pal.length > 2) {
    let bi = -1, bj = -1, best = Infinity;
    for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) {
      const e = dE(pal[i], pal[j]);
      if (e < best) { best = e; bi = i; bj = j; }
    }
    if (best >= o.merge) break;
    const p = pal[bi], q = pal[bj], m = p.n + q.n;
    pal[bi] = { L: (p.L * p.n + q.L * q.n) / m, a: (p.a * p.n + q.a * q.n) / m, b: (p.b * p.n + q.b * q.n) / m, n: m };
    pal.splice(bj, 1);
  }
  // Nearest palette colour per cell (plain ΔE — for painting, lightness
  // matters as much as hue, unlike the mosaic matcher's de-weighting).
  const assign = new Int16Array(count).fill(-1);
  const used = new Int32Array(pal.length);
  for (const i of idx) {
    let bi = 0, bd = Infinity;
    for (let p = 0; p < pal.length; p++) {
      const e = (labs[i * 3] - pal[p].L) ** 2 + (labs[i * 3 + 1] - pal[p].a) ** 2 + (labs[i * 3 + 2] - pal[p].b) ** 2;
      if (e < bd) { bd = e; bi = p; }
    }
    assign[i] = bi; used[bi]++;
  }
  // Drop palette entries nothing landed on, sort light-to-dark, remap.
  const order = pal.map((p, i) => ({ p, i })).filter(x => used[x.i] > 0).sort((x, y) => y.p.L - x.p.L);
  const remap = new Int16Array(pal.length).fill(-1);
  order.forEach((x, newIdx) => { remap[x.i] = newIdx; });
  const cells = new Uint8Array(count).fill(PIXEL_EMPTY);
  for (const i of idx) cells[i] = remap[assign[i]];
  const palette = order.map(x => labToRgb(x.p.L, x.p.a, x.p.b));
  const colors = palette.length;
  const total = idx.length;
  let maxShare = 0;
  for (const x of order) maxShare = Math.max(maxShare, used[x.i] / total);
  let ok = true, reason = null;
  if (colors < o.minColors) { ok = false; reason = 'few-colors'; }
  else if (maxShare > o.maxShare) { ok = false; reason = 'flat'; }
  return { ok, reason, w, h, palette, cells, colors, total };
}

// ---------- byte packing ----------
// Boards and progress travel as base64 text: one byte per cell for the
// board, one bit per cell for progress. btoa needs a binary string, built
// in chunks so a 16k-cell board does not blow the argument limit.
function pixelBytesToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return btoa(s);
}
function pixelBase64ToBytes(b64) {
  const s = atob(b64 || '');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function pixelBitsNew(cellCount) { return new Uint8Array(Math.ceil(cellCount / 8)); }
function pixelBitGet(bits, i) { return (bits[i >> 3] >> (i & 7)) & 1; }
function pixelBitSet(bits, i) { bits[i >> 3] |= (1 << (i & 7)); }
function pixelBitCount(bits) {
  let n = 0;
  for (let i = 0; i < bits.length; i++) { let b = bits[i]; while (b) { b &= b - 1; n++; } }
  return n;
}

// ---------- stored boards (pixel_boards) ----------
// PostgREST says "no such table" in a couple of ways depending on where it
// noticed; all of them mean supabase_pixel_game.sql is not applied yet.
function isPixelSchemaMissing(error) {
  return !!error && (isSchemaMismatchError(error) || error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST200');
}
function pixelBoardFromRow(row) {
  if (!row) return null;
  return {
    ok: true, w: row.w, h: row.h, palette: row.palette || [], colors: row.colors, level: row.level || 2,
    cells: pixelBase64ToBytes(row.cells), total: row.total, version: row.version || 1, source: 'db',
  };
}
// Every stored board (all levels) of a batch of artworks:
// { boards: Map(`${artworkId}:${level}` → board), missing }. `missing` = the
// table (or its level column) is not there; callers then build boards on
// the fly and keep progress on the device.
async function fetchPixelBoards(ids) {
  const boards = new Map();
  const list = [...new Set((ids || []).filter(id => id != null))];
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await sb.from('pixel_boards')
      .select('artwork_id,level,w,h,palette,cells,colors,total,version')
      .in('artwork_id', list.slice(i, i + 200));
    if (error) {
      if (isPixelSchemaMissing(error)) return { boards, missing: true };
      console.error('load pixel boards error:', error);
      return { boards, missing: false, error };
    }
    for (const row of (data || [])) boards.set(`${row.artwork_id}:${row.level || 2}`, pixelBoardFromRow(row));
  }
  return { boards, missing: false };
}
// Writes one level's board through set_pixel_board (artist or admin only —
// the RPC checks). Resolves { version } | { missing: true } | { error }.
async function savePixelBoard(artworkId, level, board) {
  const { data, error } = await sb.rpc('set_pixel_board', {
    p_artwork_id: artworkId, p_level: level, p_w: board.w, p_h: board.h,
    p_palette: board.palette, p_cells: pixelBytesToBase64(board.cells), p_colors: board.colors,
  });
  if (error) {
    if (isPixelSchemaMissing(error)) return { missing: true };
    console.error('set_pixel_board error:', error);
    return { error };
  }
  return { version: Number(data) || 1 };
}
// Build + store every level in one go, from the upload preview or a /img/
// image. Resolves { saved, boards, unsuitable, reason, missing, error }:
// `unsuitable` when no level could be made (blank, single colour, very low
// contrast), `missing` when the SQL is not applied, `error` the last save
// failure. Levels a picture is too plain for are simply skipped.
async function makePixelBoardFor(artworkId, img, settings) {
  const s = settings || await getSiteSettings().catch(() => null);
  const out = { saved: 0, boards: {}, unsuitable: false, reason: null, missing: false, error: null };
  let built = 0;
  for (const level of PIXEL_LEVELS) {
    const board = buildPixelBoard(img, pixelBoardOptions(s, level));
    if (!board.ok) { out.reason = board.reason; continue; }
    built++;
    const res = await savePixelBoard(artworkId, level, board);
    if (res.missing) { out.missing = true; break; }
    if (res.error) { out.error = res.error; continue; }
    out.saved++;
    out.boards[level] = { ...board, level, version: res.version };
  }
  out.unsuitable = built === 0;
  return out;
}
