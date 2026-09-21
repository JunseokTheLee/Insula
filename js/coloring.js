// Colour-by-number game (/{lang}/coloring): pick an artwork, fill its
// numbered cells with the palette colour of the same number, and the artist's
// picture appears. No timer and no ranking (see supabase_pixel_game.sql for
// why) — progress is kept per player, the artist is told when someone
// finishes, and finished boards show on the player's profile.
//
// Needs js/color-engine.js (rgbToLab), js/common.js (sb, getSiteSettings,
// cdnUrl, toast, ARTWORK_ROW_COLS, isUserBlocked, isSchemaMismatchError,
// bindArtworkLightbox, artworkUrl, profileUrl, loadImageEl), js/auth.js (me,
// authReady, openAuthModal), js/lightbox.js (the artwork a card links to) and
// js/pixel-board.js — in that order.
//
// Works before supabase_pixel_game.sql is applied: boards are then built in
// the browser when a board is opened and progress stays on the device.
"use strict";

(function () {
  const root = document.getElementById('coloringPage');
  if (!root) return;

  const $ = id => document.getElementById(id);
  const LIST_PAGE = 24;
  const SS_KEY = 'weavo.coloring.list';          // where the list was when a board was opened
  const LS_PREFIX = 'weavo.coloring.progress.';  // + artwork id + '.' + level: progress on this device
  const LS_PREFS = 'weavo.coloring.prefs';        // sound / numbers / move-mode toggles
  const LEVELS = PIXEL_LEVELS;                    // 1 easy · 2 normal · 3 hard (pixel-board.js)

  // ---------- state ----------
  let settings = {};
  let dbMissing = false;        // pixel_boards is not there: boards are built on the fly
  let rows = [];                // the browse list, in this visit's random order
  let allIds = [];              // every eligible artwork id, ascending (the day's pick walks this)
  let randomIds = [];           // the same ids shuffled once per load, minus the ones under "continue" / "finished"
  let pageFrom = 0;             // next slice of randomIds
  let listDone = false;
  let listToken = 0;            // bumps on every reset; a slower earlier load is dropped
  let searchTerm = '';
  const known = new Map();      // artwork id -> row, for everything fetched so far
  const boards = new Map();     // `${artworkId}:${level}` -> stored board
  const progress = new Map();   // `${artworkId}:${level}` -> { count, total, completed, version, filled, at, source }
  const completions = new Map();// artwork id -> finished player count
  const previews = new Map();   // artwork id -> thumbnail Image the card previews are drawn from
  let unsuitable = new Set();   // ids whose on-the-fly board could not be made
  try { unsuitable = new Set(JSON.parse(sessionStorage.getItem('weavo.coloring.unsuitable') || '[]')); } catch (e) {}

  // ---------- levels ----------
  const key = (id, level) => `${id}:${level}`;
  function levelName(level) { return tr(level === 1 ? 'cgLevelEasy' : level === 3 ? 'cgLevelHard' : 'cgLevelNormal'); }
  function gridFor(level) { return pixelBoardOptions(settings, level).grid; }
  function recOf(id, level) { return progress.get(key(id, level)) || null; }
  // Highest level finished (0 = none); the level with an attempt under way
  // (the furthest along; 0 = none); and where a plain "colour it" goes.
  function bestDone(id) { let best = 0; for (const l of LEVELS) { const r = recOf(id, l); if (r && r.completed) best = l; } return best; }
  function inProgress(id) {
    let pick = 0, most = -1;
    for (const l of LEVELS) { const r = recOf(id, l); if (r && r.count && !r.completed && r.count > most) { most = r.count; pick = l; } }
    return pick;
  }
  function suggestedLevel(id) {
    const going = inProgress(id);
    if (going) return going;
    for (const l of LEVELS) { const r = recOf(id, l); if (!r || !r.completed) return l; }
    return 3;
  }
  function mineIds() {
    const ids = new Set();
    for (const [k, r] of progress) if (r.completed || r.count) ids.add(Number(k.split(':')[0]));
    return ids;
  }
  function atOf(id) { let t = 0; for (const l of LEVELS) { const r = recOf(id, l); if (r && r.at > t) t = r.at; } return t; }

  // panMode: paint by tap only, one finger moves the board (the old way).
  // Off = smart drag (2026-09-20): a press on a cell of the chosen number
  // paints and keeps painting as the finger moves; a press anywhere else
  // moves. The old `drag` key is ignored — it was stored for everyone who
  // ever touched another toggle, so it says nothing about a choice.
  let prefs = { muted: false, numbers: false, panMode: false };
  let storedPrefs = {};
  try { storedPrefs = JSON.parse(localStorage.getItem(LS_PREFS) || '{}'); } catch (e) {}
  delete storedPrefs.drag;
  prefs = { ...prefs, ...storedPrefs };
  function savePrefs() { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (e) {} }

  // The board being played
  let art = null, board = null, bits = null, painted = 0, wrong = new Map();
  let remaining = [];           // per palette index
  let selected = null;          // palette index
  let cursor = null;            // keyboard cell {x, y}
  let startedAt = 0;
  let dirty = 0, saveTimer = 0, savedOnline = true;
  let cellPx = 24, scale = 1, panX = 0, panY = 0;
  let stage, baseCv, baseCtx, hlCv, hlCtx, numCv, numCtx;

  // ---------- screens ----------
  function show(name) {
    for (const el of root.querySelectorAll('[data-screen]')) el.hidden = el.dataset.screen !== name;
    document.body.toggleAttribute('data-mobile-fs', name === 'play');
    document.body.classList.toggle('coloring-playing', name === 'play');
  }

  // ---------- sound (synthesised, same approach as game.js) ----------
  let audioCtx = null, audioOut = null, audioSoft = false, brightWave = null, lastFillAt = 0;
  // Master stage: a soft clipper (2026-09-21). Up to 0.7 of full scale it is
  // a straight wire; above, the tops round off towards 0.98 instead of
  // clipping hard — so overlapping pops of a fast stroke never crackle, and
  // the volume option can push a sound PAST full scale, where it cannot get
  // taller, only denser (which the ear hears as louder). The first version
  // used a compressor here; its low threshold flattened everything to the
  // same level, so the upper half of the volume slider did nothing.
  function audioTarget() {
    if (audioOut) return audioOut;
    try {
      const RANGE = 4;                       // the curve covers inputs of ±4
      const pre = audioCtx.createGain();
      pre.gain.value = 1 / RANGE;
      const shaper = audioCtx.createWaveShaper();
      const n = 4096, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = ((i / (n - 1)) * 2 - 1) * RANGE, ax = Math.abs(x);
        // 0.98, not 1.0: the 2x oversampling filter overshoots by a hair.
        curve[i] = Math.sign(x) * (ax <= 0.7 ? ax : 0.7 + 0.28 * Math.tanh((ax - 0.7) / 0.28));
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      pre.connect(shaper); shaper.connect(audioCtx.destination);
      audioOut = pre; audioSoft = true;
    } catch (e) { audioOut = audioCtx.destination; audioSoft = false; }
    return audioOut;
  }
  // The tone of the pops and chimes: a fundamental with five overtones. A
  // triangle (the first version) has almost no energy at 1.4–4 kHz, where
  // phone speakers and ears are most sensitive — at the same peak this
  // sounds much louder. Odd overtones as sines and even ones as cosines keep
  // the peaks from lining up: the most energy under a peak of 1 among the
  // phase sets tried (RMS 0.67 of peak; a triangle has 0.58).
  function brightTone() {
    if (brightWave) return brightWave;
    const amp = [0, 1, 0.55, 0.4, 0.28, 0.18, 0.1];
    const real = new Float32Array(amp.length), imag = new Float32Array(amp.length);
    for (let k = 1; k < amp.length; k++) { if (k % 2) imag[k] = amp[k]; else real[k] = amp[k]; }
    brightWave = audioCtx.createPeriodicWave(real, imag);
    return brightWave;
  }
  function unlockAudio() {
    try {
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) {}
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const src = audioCtx.createBufferSource();
      src.buffer = audioCtx.createBuffer(1, 1, 22050);
      src.connect(audioCtx.destination);
      src.start(0);
    } catch (e) { /* sound is a nicety */ }
  }
  function beep(kind) {
    if (prefs.muted) return;
    try {
      if (!audioCtx) unlockAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      // A stroke fills several cells a frame: one pop per 35 ms is a quick
      // patter, not a stack of oscillators.
      if (kind === 'fill') { const now = performance.now(); if (now - lastFillAt < 35) return; lastFillAt = now; }
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      // Loudness, asked for twice (2026-09-21). Full scale is the ceiling,
      // so beyond it only the SHAPE of a sound can get louder: a brighter
      // tone (brightTone), pops that ring longer, and a volume option that
      // may drive the peaks past 1.0 into the soft clipper (audioTarget) —
      // denser and louder, a little rougher from about 150% up. The first
      // version peaked at 0.14 / 0.2 / 0.26 / 0.15 with a plain triangle.
      let peak = 0.65, stop = 0.15;
      if (kind === 'fill') osc.frequency.setValueAtTime(720, t);
      else if (kind === 'color') { osc.frequency.setValueAtTime(520, t); osc.frequency.setValueAtTime(780, t + 0.07); peak = 0.68; stop = 0.26; }
      else if (kind === 'done') { osc.frequency.setValueAtTime(523, t); osc.frequency.setValueAtTime(784, t + 0.09); osc.frequency.setValueAtTime(1046, t + 0.18); peak = 0.7; stop = 0.5; }
      else { osc.type = 'square'; osc.frequency.setValueAtTime(400, t); osc.frequency.exponentialRampToValueAtTime(220, t + 0.14); peak = 0.4; stop = 0.16; }
      if (kind !== 'wrong') { try { osc.setPeriodicWave(brightTone()); } catch (e) { osc.type = 'triangle'; } }
      const out = audioTarget();
      const vol = Number(settings && settings.pixelSoundVolume);
      peak = peak * (Number.isFinite(vol) && vol > 0 ? vol : 100) / 100;
      // Without the soft clipper (it could not be built) stay under full scale.
      peak = Math.max(0.001, Math.min(audioSoft ? 3.5 : 0.95, peak));
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + stop);
      osc.connect(gain); gain.connect(out);
      osc.start(t); osc.stop(t + stop + 0.02);
    } catch (e) { /* never break play for a sound */ }
  }
  function applyToggles() {
    for (const b of root.querySelectorAll('[data-mute]')) {
      b.textContent = prefs.muted ? '🔇' : '🔊';
      b.setAttribute('aria-pressed', String(prefs.muted));
      b.setAttribute('aria-label', prefs.muted ? tr('gameSoundOff') : tr('gameSoundOn'));
    }
    for (const b of root.querySelectorAll('[data-numbers]')) b.setAttribute('aria-pressed', String(prefs.numbers));
    for (const b of root.querySelectorAll('[data-pan]')) {
      b.setAttribute('aria-pressed', String(prefs.panMode));
      b.setAttribute('aria-label', tr(prefs.panMode ? 'cgPanModeOn' : 'cgPanModeOff'));
    }
    const note = $('cgDragNote');
    if (note) { note.hidden = false; note.textContent = tr(prefs.panMode ? 'cgHintPan' : 'cgHintDrag'); }
    if (numCv) updateNumbersVisibility();
  }

  // ---------- device progress ----------
  function localKey(id, level) { return LS_PREFIX + id + '.' + level; }
  function readLocal(id, level) {
    try { return JSON.parse(localStorage.getItem(localKey(id, level)) || 'null'); } catch (e) { return null; }
  }
  function writeLocal(id, level, rec) {
    try { localStorage.setItem(localKey(id, level), JSON.stringify(rec)); } catch (e) { /* private mode */ }
  }

  // ---------- data ----------
  // Artworks the game offers: no pieces, not opted out, public. The filters
  // fall back while their SQL files are not applied (hand-run, CLAUDE.md §6).
  function eligibleQuery(select, withOptOut, withPieces, withPublic) {
    let q = sb.from('mosaic_submissions').select(select);
    if (withPieces) q = q.is('parent_id', null);
    if (withOptOut) q = q.or('coloring_opt_out.is.null,coloring_opt_out.eq.false');
    if (withPublic) q = q.eq('is_public', true);
    if (searchTerm) {
      const t = searchTerm.replace(/[%,()]/g, ' ').trim();
      if (t) q = q.or(`art_title.ilike.%${t}%,author_name.ilike.%${t}%`);
    }
    return q;
  }
  async function withFallbacks(run) {
    let { data, error } = await run(true, true, true);
    if (error && isSchemaMismatchError(error)) ({ data, error } = await run(true, true, false));
    if (error && isSchemaMismatchError(error)) ({ data, error } = await run(false, true, false));
    if (error && isSchemaMismatchError(error)) ({ data, error } = await run(false, false, false));
    return { data, error };
  }
  // Every eligible id, ascending. Ids only: a thousand of them weigh less
  // than one card thumbnail; the rows come page by page below.
  async function loadIds() {
    const { data, error } = await withFallbacks((a, b, c) => eligibleQuery('id', a, b, c).order('id', { ascending: true }).limit(1000));
    if (error) { console.error('coloring: load artwork ids error:', error); return []; }
    return (data || []).map(r => r.id);
  }
  // Rows for some ids (chunked); blocked authors and pictureless rows are
  // dropped. Everything fetched is remembered in `known`.
  async function fetchRows(ids) {
    const want = [...new Set(ids)].filter(id => id != null && !known.has(id));
    for (let i = 0; i < want.length; i += 100) {
      const { data, error } = await sb.from('mosaic_submissions').select(ARTWORK_ROW_COLS).in('id', want.slice(i, i + 100));
      if (error) { console.error('coloring: load artworks error:', error); break; }
      for (const r of (data || [])) if (!isUserBlocked(r.author_id) && (r.thumb_url || r.image_url)) known.set(r.id, r);
    }
    return ids.map(id => known.get(id)).filter(Boolean);
  }
  function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  async function loadPage() {
    const slice = randomIds.slice(pageFrom, pageFrom + LIST_PAGE);
    pageFrom += slice.length;
    if (pageFrom >= randomIds.length) listDone = true;
    return slice.length ? fetchRows(slice) : [];
  }
  async function loadBoardsFor(ids) {
    if (dbMissing) return;
    const want = [...new Set(ids)].filter(id => !LEVELS.some(l => boards.has(key(id, l))));
    if (!want.length) return;
    const res = await fetchPixelBoards(want);
    if (res.missing) { dbMissing = true; return; }
    for (const [k, b] of res.boards) boards.set(k, b);
  }
  async function loadCompletionsFor(list) {
    if (dbMissing || settings.pixelShowCompletions === false) return;
    const ids = list.map(a => a.id);
    if (!ids.length) return;
    try {
      const { data, error } = await sb.rpc('pixel_completion_counts', { p_ids: ids });
      if (error) { if (!isPixelSchemaMissing(error)) console.error('coloring: completion counts error:', error); return; }
      for (const r of (data || [])) completions.set(r.artwork_id, r.completions);
    } catch (e) { console.error('coloring: completion counts threw:', e); }
  }
  // The signed-in player's own rows (RLS keeps it to theirs), merged with
  // whatever this device remembers — the copy with more cells wins. Keys
  // from before levels existed (no ".level") are dropped: their boards are gone.
  async function loadMyProgress() {
    progress.clear();
    if (me.id && !dbMissing) {
      const { data, error } = await sb.from('pixel_progress').select('artwork_id,level,board_version,filled,filled_count,completed_at,updated_at');
      if (error) { if (isPixelSchemaMissing(error)) dbMissing = true; else console.error('coloring: load progress error:', error); }
      for (const r of (data || [])) {
        progress.set(key(r.artwork_id, r.level || 2), { count: r.filled_count, completed: !!r.completed_at, version: r.board_version, filled: r.filled, at: Date.parse(r.updated_at) || 0, source: 'db' });
      }
    }
    try {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(LS_PREFIX)) continue;
        const parts = k.slice(LS_PREFIX.length).split('.');
        if (parts.length !== 2) { drop.push(k); continue; }
        const id = Number(parts[0]), level = Number(parts[1]);
        const rec = readLocal(id, level);
        if (!rec || !LEVELS.includes(level)) continue;
        const have = progress.get(key(id, level));
        if (!have || (rec.count || 0) > (have.count || 0)) {
          progress.set(key(id, level), { count: rec.count || 0, total: rec.total, completed: !!rec.completed, version: rec.version, filled: rec.bits, at: rec.at || 0, source: 'local' });
        }
      }
      for (const k of drop) localStorage.removeItem(k);
    } catch (e) { /* storage blocked */ }
    // Server rows carry no total: their boards do (only mine — a handful).
    const need = [...mineIds()];
    if (need.length) await loadBoardsFor(need);
  }

  // ---------- list ----------
  function totalOf(id, level) {
    const r = recOf(id, level), b = boards.get(key(id, level));
    return (r && r.total) || (b && b.total) || 0;
  }
  function pct(id, level) {
    const r = recOf(id, level);
    if (!r || !r.count) return 0;
    const t = totalOf(id, level);
    return t ? Math.min(100, Math.round((r.count / t) * 100)) : 0;
  }
  // The card shows the artwork as a pixel board rather than the picture:
  // grey at the hard level's cell count until the player has finished it,
  // in colour at the highest level they finished. Drawn from the 480px
  // thumbnail into a canvas of that many cells; CSS scales it up pixel by
  // pixel. Same origin (/img/), so the pixels can be read back for the grey.
  function previewInto(a, canvas) {
    const done = bestDone(a.id);
    const grid = gridFor(done || 3);
    const paint = img => {
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      if (!w0 || !h0) return;
      const w = w0 >= h0 ? grid : Math.max(4, Math.round(grid * w0 / h0));
      const h = w0 >= h0 ? Math.max(4, Math.round(grid * h0 / w0)) : grid;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      canvas.classList.toggle('done', !!done);
      canvas.style.filter = '';
      if (done) return;
      try {
        const d = ctx.getImageData(0, 0, w, h), px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          // Lifted lightness: a light grey board, like the unpainted cells in play.
          const g = 118 + (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * 0.52;
          px[i] = px[i + 1] = px[i + 2] = g;
        }
        ctx.putImageData(d, 0, 0);
      } catch (e) { canvas.style.filter = 'grayscale(1) brightness(1.2)'; }   // a tainted canvas: CSS does the grey
    };
    let img = previews.get(a.id);
    if (img && img.complete && img.naturalWidth) { paint(img); return; }
    if (!img) { img = new Image(); img.decoding = 'async'; img.src = cdnUrl(a.thumb_url || a.image_url); previews.set(a.id, img); }
    img.addEventListener('load', () => paint(img), { once: true });
  }
  function levelChip(a, level) {
    const r = recOf(a.id, level);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cg-level';
    const name = document.createElement('span'); name.textContent = levelName(level);
    const state = document.createElement('small');
    if (r && r.completed) { b.classList.add('done'); state.textContent = '✓'; }
    else if (r && r.count) { b.classList.add('midway'); state.textContent = pct(a.id, level) + '%'; }
    else state.textContent = String(gridFor(level));
    b.append(name, state);
    b.title = tr('cgLevelTitle', { level: levelName(level), n: gridFor(level) });
    if (unsuitable.has(a.id)) b.disabled = true;
    b.onclick = () => openBoard(a, level);
    return b;
  }
  function cardFor(a) {
    const done = bestDone(a.id), going = inProgress(a.id);
    const card = document.createElement('div');
    card.className = 'cg-card';
    card.dataset.artworkId = a.id;

    const link = document.createElement('a');
    link.className = 'cg-card-thumb-link';
    link.href = artworkUrl(a.id);
    link.setAttribute('aria-label', a.art_title ? tr('artworkThumbAlt', { title: a.art_title, name: a.author_name || tr('anonymous') }) : tr('artworkImgAltFallback', { name: a.author_name || tr('anonymous') }));
    const canvas = document.createElement('canvas');
    canvas.className = 'cg-card-pix';
    canvas.width = 4; canvas.height = 4;
    link.appendChild(canvas);
    previewInto(a, canvas);
    if (done || going) {
      const badge = document.createElement('span');
      badge.className = 'cg-card-badge' + (done ? ' done' : '');
      badge.textContent = done ? tr('cgLevelDoneBadge', { level: levelName(done) }) : pct(a.id, going) + '%';
      link.appendChild(badge);
    }
    if (typeof bindArtworkLightbox === 'function') bindArtworkLightbox(link, a.id);

    const body = document.createElement('div');
    body.className = 'cg-card-body';
    const title = document.createElement('div'); title.className = 'cg-card-title'; title.textContent = a.art_title || tr('untitledArtwork');
    const by = document.createElement('div'); by.className = 'cg-card-author'; by.textContent = a.author_name || tr('anonymous');
    const meta = document.createElement('div'); meta.className = 'cg-card-meta';
    const n = completions.get(a.id);
    meta.textContent = n ? tr('cgCompletions', { n }) : '';
    body.append(title, by, meta);
    const levels = document.createElement('div'); levels.className = 'cg-levels';
    for (const l of LEVELS) levels.appendChild(levelChip(a, l));
    body.appendChild(levels);
    if (going) {
      const bar = document.createElement('div'); bar.className = 'cg-card-bar';
      const fill = document.createElement('i'); fill.style.width = pct(a.id, going) + '%';
      bar.appendChild(fill); body.appendChild(bar);
    }
    const actions = document.createElement('div'); actions.className = 'cg-card-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-btn' + (going ? ' primary' : '');
    const lvl = suggestedLevel(a.id);
    btn.textContent = going ? tr('cgResume', { pct: pct(a.id, going) }) : (done ? tr('cgAgain') : tr('cgStart'));
    if (unsuitable.has(a.id)) { btn.disabled = true; btn.textContent = tr('cgUnsuitableShort'); }
    btn.onclick = () => openBoard(a, lvl);
    // The original picture, one tap away (the board on the card stands in for it).
    const orig = document.createElement('button');
    orig.type = 'button';
    orig.className = 'admin-btn cg-icon-btn';
    orig.textContent = '🖼';
    orig.title = tr('cgViewOriginal'); orig.setAttribute('aria-label', tr('cgViewOriginal'));
    orig.onclick = () => { if (typeof openArtworkById === 'function') openArtworkById(a.id); else location.href = artworkUrl(a.id); };
    actions.append(btn, orig);
    body.appendChild(actions);
    card.append(link, body);
    // Small controls in the picture's top-left corner (the badge holds the
    // top-right): ✕ drops an attempt under way, 📤 shares the finished
    // picture. The action row below has no room for a third button.
    if (done || going) {
      const corners = document.createElement('div');
      corners.className = 'cg-card-corners';
      if (going) {
        const x = document.createElement('button');
        x.type = 'button'; x.className = 'cg-card-corner discard'; x.textContent = '✕';
        x.title = tr('cgDiscard'); x.setAttribute('aria-label', tr('cgDiscard'));
        x.onclick = () => discardProgress(a);
        corners.appendChild(x);
      }
      if (done) {
        const sh = document.createElement('button');
        sh.type = 'button'; sh.className = 'cg-card-corner'; sh.textContent = '📤';
        sh.title = tr('cgSharePicture'); sh.setAttribute('aria-label', tr('cgSharePicture'));
        sh.onclick = () => shareFromCard(a, sh);
        corners.appendChild(sh);
      }
      card.appendChild(corners);
    }
    return card;
  }
  async function renderList(reset) {
    const list = $('cgList');
    const token = reset ? ++listToken : listToken;
    if (reset) {
      list.innerHTML = ''; rows = []; pageFrom = 0; listDone = false;
      allIds = await loadIds();
      if (token !== listToken) return;
      // A search is a flat list of everything that matches; otherwise the
      // artworks already shown under "continue" / "finished" stay out of it.
      const mine = searchTerm ? new Set() : mineIds();
      randomIds = shuffle(allIds.filter(id => !mine.has(id)));
    }
    const more = $('cgMore');
    more.disabled = true;
    const page = await loadPage();
    await loadCompletionsFor(page);
    if (token !== listToken) return;   // a newer reset superseded this load
    for (const a of page) { rows.push(a); list.appendChild(cardFor(a)); }
    $('cgEmpty').hidden = rows.length !== 0;
    more.hidden = listDone;
    more.disabled = false;
    $('cgCount').textContent = tr('cgCount', { n: rows.length }) + (listDone ? '' : '+');
    if (reset) renderToday();
  }
  // Started-but-unfinished and finished artworks, above the browse list. An
  // artwork with an attempt under way sits under "continue" even when a
  // lower level of it is finished.
  let mineToken = 0;
  async function renderMine() {
    const box = $('cgMine'), resumeGrid = $('cgResumeGrid'), doneGrid = $('cgDoneGrid');
    if (!box || !resumeGrid || !doneGrid) return;
    const token = ++mineToken;
    if (searchTerm) { box.hidden = true; return; }
    const resume = [], done = [];
    for (const id of mineIds()) { if (inProgress(id)) resume.push(id); else if (bestDone(id)) done.push(id); }
    const byRecent = (x, y) => atOf(y) - atOf(x);
    resume.sort(byRecent); done.sort(byRecent);
    const list = await fetchRows([...resume, ...done]);
    if (token !== mineToken) return;
    await loadCompletionsFor(list);
    if (token !== mineToken) return;
    resumeGrid.innerHTML = ''; doneGrid.innerHTML = '';
    for (const id of resume) { const a = known.get(id); if (a) resumeGrid.appendChild(cardFor(a)); }
    for (const id of done) { const a = known.get(id); if (a) doneGrid.appendChild(cardFor(a)); }
    $('cgResumeBlock').hidden = !resumeGrid.children.length;
    $('cgDoneBlock').hidden = !doneGrid.children.length;
    box.hidden = !resumeGrid.children.length && !doneGrid.children.length;
  }
  // The day's artwork: the same one for everyone, changing tomorrow — except
  // that a player who has finished it (at any level) is shown the next one
  // in the same daily walk, so the box always offers something new.
  let todayToken = 0;
  async function renderToday() {
    const box = $('cgToday');
    if (!box) return;
    const token = ++todayToken;
    if (searchTerm || !allIds.length) { box.hidden = true; return; }
    const day = Math.floor(Date.now() / 86400000);
    let pick = null;
    for (let k = 0; k < allIds.length; k++) {
      const id = allIds[(day + k) % allIds.length];
      if (unsuitable.has(id) || bestDone(id)) continue;
      pick = id; break;
    }
    if (pick == null) { box.hidden = true; return; }
    const a = (await fetchRows([pick]))[0];
    if (token !== todayToken) return;
    if (!a) { box.hidden = true; return; }
    $('cgTodayThumb').src = cdnUrl(a.thumb_url || a.image_url);
    $('cgTodayThumb').alt = a.art_title || '';
    $('cgTodayTitle').textContent = a.art_title || tr('untitledArtwork');
    $('cgTodayBy').textContent = a.author_name || tr('anonymous');
    const btn = $('cgTodayPlay');
    const going = inProgress(a.id);
    btn.textContent = going ? tr('cgResume', { pct: pct(a.id, going) }) : tr('cgStart');
    btn.onclick = () => openBoard(a, suggestedLevel(a.id));
    const lv = $('cgTodayLevels');
    if (lv) { lv.innerHTML = ''; for (const l of LEVELS) lv.appendChild(levelChip(a, l)); }
    box.hidden = false;
  }
  function refreshCard(id) {
    const a = known.get(id);
    if (!a) return;
    for (const old of root.querySelectorAll(`.cg-card[data-artwork-id="${id}"]`)) old.replaceWith(cardFor(a));
  }
  function restoreListPosition() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch (e) {}
    try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
    if (!saved) { window.scrollTo(0, 0); return; }
    const card = root.querySelector(`.cg-card[data-artwork-id="${saved.artworkId}"]`);
    if (card) {
      card.scrollIntoView({ block: 'center' });
      card.classList.add('just-played');
      setTimeout(() => card.classList.remove('just-played'), 1600);
    } else if (saved.scrollY) window.scrollTo(0, saved.scrollY);
  }
  // ---------- opening a board ----------
  async function openBoard(a, level) {
    level = LEVELS.includes(level) ? level : suggestedLevel(a.id);
    if (!me.id && settings.pixelAnonymousPlay === false) { toast(tr('cgNeedSignIn')); openAuthModal(); return; }
    unlockAudio();
    try { sessionStorage.setItem(SS_KEY, JSON.stringify({ artworkId: a.id, scrollY: window.scrollY })); } catch (e) {}
    known.set(a.id, a);
    art = a;
    cursor = null;
    const cur = $('cgCursor');
    if (cur) cur.hidden = true;
    show('play');
    playHistory.enter(['artwork', 'level']);
    // Once: how the stroke and the move gestures split.
    if (!prefs.tipShown && !prefs.panMode) { toast(tr('cgTipDrag')); prefs.tipShown = true; savePrefs(); }
    $('cgLoading').hidden = false;
    $('cgLoading').textContent = tr('gamePreparing');
    fillSidePanel(a, level);
    let b = boards.get(key(a.id, level)) || null;
    try {
      if (!b && !dbMissing) { await loadBoardsFor([a.id]); b = boards.get(key(a.id, level)) || null; }
      if (art !== a) return;
      if (!b) {
        // No stored board: a direct link may point at an artwork the artist
        // has taken out of the game (the list never shows those). One small
        // read; a missing column just means the option does not exist yet.
        if (!dbMissing) {
          const { data: row } = await sb.from('mosaic_submissions').select('coloring_opt_out').eq('id', a.id).maybeSingle();
          if (row && row.coloring_opt_out) { toast(tr('cgNotHere')); endPlay(); return; }
        }
        // Same origin through /img/, so the canvas stays readable.
        const img = await loadImageEl(cdnUrl(a.thumb_url || a.image_url));
        const built = buildPixelBoard(img, pixelBoardOptions(settings, level));
        if (!built.ok) {
          unsuitable.add(a.id);
          try { sessionStorage.setItem('weavo.coloring.unsuitable', JSON.stringify([...unsuitable])); } catch (e) {}
          toast(tr('cgUnsuitable'));
          refreshCard(a.id);
          renderToday();
          endPlay();
          return;
        }
        b = { ...built, level, version: 0, source: 'local' };
        // The artist (or an admin) opening their own artwork stores the board
        // for everyone; other players keep an on-device copy.
        if (!dbMissing && me.id && (me.id === a.author_id || me.isAdmin)) {
          const saved = await savePixelBoard(a.id, level, built);
          if (saved.version) { b.version = saved.version; b.source = 'db'; boards.set(key(a.id, level), b); }
          else if (saved.missing) dbMissing = true;
        }
      }
    } catch (e) {
      console.error('coloring: board failed:', e);
      toast(tr('cgBoardFailed'));
      endPlay();
      return;
    }
    if (art !== a) return;   // the player left meanwhile
    board = b;
    board.level = level;
    for (const el of root.querySelectorAll('[data-art-level]')) el.textContent = tr('cgLevelLine', { level: levelName(level), w: b.w, h: b.h, colors: b.colors });
    loadProgressInto(a, b);
    buildStage();
    buildPalette();
    updateProgress();
    applyToggles();
    startedAt = performance.now();
    $('cgLoading').hidden = true;
    // Pick the lightest colour that still has cells, so a first tap paints.
    selectColor(firstOpenColor());
  }
  function fillSidePanel(a, level) {
    const name = a.author_name || tr('anonymous');
    for (const el of root.querySelectorAll('[data-art-title]')) el.textContent = a.art_title || tr('untitledArtwork');
    for (const el of root.querySelectorAll('[data-art-level]')) el.textContent = levelName(level);
    const thumb = $('cgSideThumb');
    if (thumb) thumb.src = cdnUrl(a.thumb_url || a.image_url);
    const peek = $('cgPeek');
    if (peek) peek.src = cdnUrl(a.thumb_url || a.image_url);
    const by = $('cgSideBy');
    if (by) {
      by.textContent = '';
      const link = document.createElement('a');
      link.href = a.author_id ? profileUrl(a.author_id) : '#';
      link.textContent = name;
      by.appendChild(link);
    }
  }
  function loadProgressInto(a, b) {
    const cells = b.w * b.h;
    bits = pixelBitsNew(cells);
    painted = 0; wrong = new Map();
    const p = recOf(a.id, b.level);
    // Progress belongs to one board version: a rebuilt board starts clean. A
    // finished board starts clean too — colouring it again is a new attempt.
    if (p && p.filled && (p.version == null || p.version === b.version)) {
      try {
        const got = pixelBase64ToBytes(p.filled);
        if (got.length === bits.length && pixelBitCount(got) < b.total) bits = got;
      } catch (e) { /* unreadable: start clean */ }
    }
    remaining = new Array(b.colors).fill(0);
    for (let i = 0; i < cells; i++) {
      const c = b.cells[i];
      if (c === PIXEL_EMPTY) { if (pixelBitGet(bits, i)) bits[i >> 3] &= ~(1 << (i & 7)); continue; }
      if (pixelBitGet(bits, i)) painted++; else remaining[c]++;
    }
    dirty = 0;
  }
  // ---------- stage ----------
  function greyFor(rgb) {
    // Unpainted cells keep only the lightness of their colour, as a light
    // grey — enough to hint at the shapes, not enough to give the picture
    // away before it is coloured.
    const L = rgbToLab(rgb[0], rgb[1], rgb[2]).L;
    const g = Math.round(178 + (L / 100) * 66);
    return `rgb(${g},${g},${g})`;
  }
  function buildStage() {
    stage = $('cgStage');
    baseCv = $('cgBase'); hlCv = $('cgHighlight'); numCv = $('cgNumbers');
    const cells = board.w * board.h;
    const vw = window.innerWidth || screen.width || 1024;
    const small = (navigator.deviceMemory && navigator.deviceMemory < 4) || vw < 640;
    const budget = small ? 5e6 : 12e6;
    // Three layers (colour, highlight, numbers) share the budget.
    cellPx = Math.max(12, Math.min(40, Math.floor(Math.sqrt(budget / 3 / cells))));
    for (const cv of [baseCv, hlCv, numCv]) { cv.width = board.w * cellPx; cv.height = board.h * cellPx; }
    const peek = $('cgPeek');
    if (peek) { peek.style.width = baseCv.width + 'px'; peek.style.height = baseCv.height + 'px'; peek.hidden = true; }
    baseCtx = baseCv.getContext('2d'); hlCtx = hlCv.getContext('2d'); numCtx = numCv.getContext('2d');
    numCtx.font = `bold ${Math.round(cellPx * 0.46)}px Pretendard, sans-serif`;
    numCtx.textAlign = 'center'; numCtx.textBaseline = 'middle';
    for (let i = 0; i < cells; i++) drawCell(i);
    drawHighlight();
    void stage.getBoundingClientRect();
    fitAll();
  }
  function drawCell(i) {
    const c = board.cells[i];
    const x = (i % board.w) * cellPx, y = Math.floor(i / board.w) * cellPx;
    baseCtx.clearRect(x, y, cellPx, cellPx);
    numCtx.clearRect(x, y, cellPx, cellPx);
    if (c === PIXEL_EMPTY) return;
    const rgb = board.palette[c];
    if (pixelBitGet(bits, i)) {
      baseCtx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      baseCtx.fillRect(x, y, cellPx, cellPx);
      return;
    }
    baseCtx.fillStyle = greyFor(rgb);
    baseCtx.fillRect(x, y, cellPx, cellPx);
    baseCtx.strokeStyle = 'rgba(0,0,0,.10)';
    baseCtx.lineWidth = 1;
    baseCtx.strokeRect(x + 0.5, y + 0.5, cellPx - 1, cellPx - 1);
    const w = wrong.get(i);
    if (w != null) {
      // A wrong colour shows faintly, so the mistake is visible and fixable.
      const wr = board.palette[w];
      baseCtx.fillStyle = `rgba(${wr[0]},${wr[1]},${wr[2]},.42)`;
      baseCtx.fillRect(x + 1, y + 1, cellPx - 2, cellPx - 2);
    }
    numCtx.fillStyle = '#2a2f2c';
    numCtx.fillText(String(c + 1), x + cellPx / 2, y + cellPx / 2 + 1);
  }
  function drawHighlight() {
    hlCtx.clearRect(0, 0, hlCv.width, hlCv.height);
    if (selected == null) return;
    hlCtx.fillStyle = 'rgba(26,60,43,.22)';
    hlCtx.strokeStyle = 'rgba(26,60,43,.75)';
    hlCtx.lineWidth = Math.max(1, Math.round(cellPx * 0.08));
    const cells = board.w * board.h;
    for (let i = 0; i < cells; i++) {
      if (board.cells[i] !== selected || pixelBitGet(bits, i)) continue;
      const x = (i % board.w) * cellPx, y = Math.floor(i / board.w) * cellPx;
      hlCtx.fillRect(x, y, cellPx, cellPx);
      hlCtx.strokeRect(x + 1, y + 1, cellPx - 2, cellPx - 2);
    }
  }
  function applyTransform() {
    const t = `translate(${panX}px, ${panY}px) scale(${scale})`;
    for (const el of [baseCv, hlCv, numCv, $('cgLayer'), $('cgPeek')]) if (el) el.style.transform = t;
    $('cgZoomLevel').textContent = Math.round(scale * 100) + '%';
    updateNumbersVisibility();
  }
  // Numbers are only legible from a certain size on; below it they would
  // just be noise, unless the player asked to always see them.
  function updateNumbersVisibility() {
    numCv.style.opacity = (prefs.numbers || scale * cellPx >= 15) ? '1' : '0';
  }
  function fitAll() {
    const r = stage.getBoundingClientRect();
    const s = Math.min(r.width / baseCv.width, r.height / baseCv.height);
    scale = s > 0 ? s : 1;
    panX = (r.width - baseCv.width * scale) / 2;
    panY = (r.height - baseCv.height * scale) / 2;
    applyTransform();
  }
  function zoomBy(factor, cx, cy) {
    const r = stage.getBoundingClientRect();
    const ox = cx == null ? r.width / 2 : cx, oy = cy == null ? r.height / 2 : cy;
    const next = Math.max(0.15, Math.min(40, scale * factor));
    panX = ox - (ox - panX) * (next / scale);
    panY = oy - (oy - panY) * (next / scale);
    scale = next;
    applyTransform();
  }
  function cellAt(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const x = (clientX - r.left - panX) / scale / cellPx;
    const y = (clientY - r.top - panY) / scale / cellPx;
    if (x < 0 || y < 0 || x >= board.w || y >= board.h) return null;
    return { x: Math.floor(x), y: Math.floor(y) };
  }
  // Pan/zoom so the cell is centred and at least readable.
  function centerOn(x, y, minCellScreenPx) {
    const r = stage.getBoundingClientRect();
    const want = Math.max(scale, (minCellScreenPx || 0) / cellPx);
    scale = Math.min(40, want);
    panX = r.width / 2 - (x + 0.5) * cellPx * scale;
    panY = r.height / 2 - (y + 0.5) * cellPx * scale;
    applyTransform();
  }

  // ---------- palette ----------
  function firstOpenColor() {
    for (let c = 0; c < remaining.length; c++) if (remaining[c] > 0) return c;
    return null;
  }
  function buildPalette() {
    const pal = $('cgPalette');
    pal.innerHTML = '';
    board.palette.forEach((rgb, c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const L = rgbToLab(rgb[0], rgb[1], rgb[2]).L;
      b.className = 'cg-swatch ' + (L > 60 ? 'light' : 'dark');
      b.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      b.dataset.color = c;
      b.setAttribute('aria-label', tr('cgColorN', { n: c + 1 }));
      const num = document.createElement('span'); num.textContent = c + 1;
      const left = document.createElement('small');
      b.append(num, left);
      b.onclick = () => selectColor(c);
      pal.appendChild(b);
    });
    refreshPalette();
  }
  function refreshPalette() {
    for (const b of $('cgPalette').querySelectorAll('.cg-swatch')) {
      const c = Number(b.dataset.color);
      b.classList.toggle('active', c === selected);
      b.classList.toggle('done', remaining[c] === 0);
      b.querySelector('small').textContent = remaining[c] > 0 ? remaining[c] : '';
      b.setAttribute('aria-pressed', String(c === selected));
    }
  }
  function selectColor(c) {
    selected = c;
    refreshPalette();
    if (hlCtx) drawHighlight();
    const b = $('cgPalette').querySelector(`.cg-swatch[data-color="${c}"]`);
    if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ---------- painting ----------
  // `quiet` = part of a drag stroke: cells of another number are passed
  // over without the wrong-number mark and beep a tap on them gets.
  function paintCell(x, y, quiet) {
    if (!board) return;
    const i = y * board.w + x;
    const c = board.cells[i];
    if (c === PIXEL_EMPTY || pixelBitGet(bits, i)) return;
    if (selected == null) { if (!quiet) toast(tr('cgPickColor')); return; }
    if (c !== selected) {
      if (quiet) return;
      if (wrong.get(i) === selected) return;
      wrong.set(i, selected);
      drawCell(i);
      beep('wrong');
      return;
    }
    pixelBitSet(bits, i);
    wrong.delete(i);
    painted++;
    remaining[c]--;
    drawCell(i);
    // Clear this cell's highlight without repainting the whole layer.
    hlCtx.clearRect(x * cellPx, y * cellPx, cellPx, cellPx);
    beep('fill');
    dirty++;
    updateProgress();
    if (remaining[c] === 0) {
      refreshPalette();
      if (painted < board.total) { beep('color'); selectColor(firstOpenColor()); }
    } else {
      const sw = $('cgPalette').querySelector(`.cg-swatch[data-color="${c}"] small`);
      if (sw) sw.textContent = remaining[c];
    }
    if (painted >= board.total) { finish(); return; }
    if (dirty >= 40) flushSave(); else scheduleSave();
  }
  function updateProgress() {
    const pctNow = board.total ? Math.round((painted / board.total) * 100) : 0;
    for (const el of root.querySelectorAll('[data-cg-pct]')) el.textContent = pctNow + '%';
    for (const el of root.querySelectorAll('[data-cg-text]')) el.textContent = tr('cgProgress', { done: painted, total: board.total });
    $('cgProgressBar').style.width = pctNow + '%';
  }

  // ---------- saving ----------
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 4000);
  }
  function snapshot() {
    const prev = readLocal(art.id, board.level);
    const done = painted >= board.total;
    // A finished board stays finished on the record while a second attempt
    // is under way (the server keeps completed_at the same way).
    const completed = done ? Date.now() : ((prev && prev.version === board.version && prev.completed) || null);
    return { version: board.version, count: painted, total: board.total, bits: pixelBytesToBase64(bits), completed, at: Date.now() };
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    if (!board || !art) return;
    const rec = snapshot();
    writeLocal(art.id, board.level, rec);
    progress.set(key(art.id, board.level), { count: rec.count, total: rec.total, completed: !!rec.completed, version: rec.version, filled: rec.bits, at: rec.at, source: 'local' });
    dirty = 0;
    // Online only when there is a stored board to attach the bits to.
    if (!me.id || dbMissing || board.source !== 'db') return null;
    try {
      const { data, error } = await sb.rpc('save_pixel_progress', { p_artwork_id: art.id, p_level: board.level, p_filled: rec.bits });
      if (error) {
        if (isPixelSchemaMissing(error)) { dbMissing = true; return null; }
        console.error('coloring: save progress error:', error);
        if (savedOnline) toast(tr('cgSaveFailed'));
        savedOnline = false;
        return null;
      }
      savedOnline = true;
      if (data && data.completions != null) completions.set(art.id, data.completions);
      return data;
    } catch (e) { console.error('coloring: save progress threw:', e); return null; }
  }
  // iOS reloads pages freely (memory pressure, pull-to-refresh); save when
  // the page is about to go, not only on a timer.
  addEventListener('pagehide', () => { if (board) flushSave(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && board) flushSave(); });

  // ---------- finishing ----------
  async function finish() {
    beep('done');
    const elapsed = performance.now() - startedAt;
    const result = await flushSave();
    show('result');
    $('cgResultTitle').textContent = art.art_title || tr('untitledArtwork');
    const by = $('cgResultBy');
    by.textContent = '';
    const link = document.createElement('a');
    link.href = art.author_id ? profileUrl(art.author_id) : '#';
    link.textContent = art.author_name || tr('anonymous');
    by.appendChild(link);
    // The finished board first, then the artist's picture through it.
    const fig = $('cgResultFigure');
    fig.classList.remove('reveal');
    const cv = $('cgResultCanvas');
    drawFinished(cv, 12);
    const img = $('cgResultImg');
    img.src = cdnUrl(art.thumb_url || art.image_url);
    setTimeout(() => fig.classList.add('reveal'), 900);
    const bits2 = [tr('cgLevelDoneBadge', { level: levelName(board.level) }), tr('cgFinishedIn', { time: fmtDur(elapsed) })];
    if (result && result.first_completion && result.completions === 1) bits2.push(tr('cgFirstFinish'));
    else if (result && result.completions) bits2.push(tr('cgFinishedCount', { n: result.completions }));
    if (!me.id) bits2.push(tr('cgLocalOnly'));
    $('cgResultNote').textContent = bits2.join(' · ');
    confetti();
    renderNext();
    refreshCard(art.id);
    renderMine();
    window.scrollTo(0, 0);
  }
  function fmtDur(ms) {
    const total = Math.max(0, ms) / 1000;
    if (total < 60) return tr('gameDurSec', { s: total.toFixed(0) });
    const m = Math.floor(total / 60);
    return tr('gameDurMin', { m, s: Math.round(total - m * 60) });
  }
  function drawFinished(cv, px) { drawFinishedBoard(cv, px, board); }
  // Every cell in its palette colour — the finished picture of one board.
  function drawFinishedBoard(cv, px, b) {
    cv.width = b.w * px; cv.height = b.h * px;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < b.w * b.h; i++) {
      const c = b.cells[i];
      if (c === PIXEL_EMPTY) continue;
      const rgb = b.palette[c];
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect((i % b.w) * px, Math.floor(i / b.w) * px, px, px);
    }
  }
  // A card to share: the finished board with the artist's credit under it.
  function shareCardBlob(a, b) {
    const px = 16, pad = 40, cap = 96;
    const bw = b.w * px, bh = b.h * px;
    const cv = document.createElement('canvas');
    cv.width = bw + pad * 2; cv.height = bh + pad * 2 + cap;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#F7F7F5'; ctx.fillRect(0, 0, cv.width, cv.height);
    const tmp = document.createElement('canvas');
    drawFinishedBoard(tmp, px, b);
    ctx.drawImage(tmp, pad, pad);
    ctx.fillStyle = '#1A3C2B';
    ctx.font = 'bold 30px Pretendard, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText((a.art_title || tr('untitledArtwork')).slice(0, 48), pad, pad + bh + 22);
    ctx.fillStyle = '#5b6475';
    ctx.font = '22px Pretendard, sans-serif';
    ctx.fillText(tr('cgShareCaption', { name: a.author_name || tr('anonymous') }), pad, pad + bh + 60);
    return new Promise(resolve => cv.toBlob(resolve, 'image/png'));
  }
  // Shares one finished board as a picture: from the result screen (the
  // board just coloured) or from a finished card in the list (the board of
  // the highest level the player finished).
  async function sharePicture(a, b, btn) {
    if (btn) btn.disabled = true;
    try {
      const blob = await shareCardBlob(a, b);
      if (!blob) throw new Error('no image');
      const file = new File([blob], `weavo-coloring-${a.id}.png`, { type: 'image/png' });
      const text = tr('cgShareText', { title: a.art_title || tr('untitledArtwork') });
      const url = `${location.origin}${artworkUrl(a.id)}`;
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      // Phones: the share sheet carries the picture to any app. Desktops:
      // the OS sheet (Windows) offers a "copy" that copies the text, not the
      // picture, and pasting then shows nothing — so the picture itself goes
      // to the clipboard, and a file is saved as well.
      if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, url });
        return;
      }
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; }
        catch (e) { console.warn('coloring: clipboard image copy refused:', e); }
      }
      // (named dl: 'a' is the artwork here)
      const dl = document.createElement('a');
      dl.href = URL.createObjectURL(blob);
      dl.download = file.name;
      document.body.appendChild(dl); dl.click(); dl.remove();
      setTimeout(() => URL.revokeObjectURL(dl.href), 4000);
      toast(tr(copied ? 'cgCopied' : 'cgShared'));
    } catch (e) {
      if (!e || e.name !== 'AbortError') { console.error('coloring: share failed:', e); toast(tr('cgShareFailed')); }
    } finally { if (btn) btn.disabled = false; }
  }
  function shareResult() { return sharePicture(art, board, $('cgShare')); }
  // The board of one level, for sharing from the list: in memory, else from
  // the DB, else rebuilt from the thumbnail exactly as play does.
  async function boardFor(a, level) {
    let b = boards.get(key(a.id, level)) || null;
    if (!b && !dbMissing) { await loadBoardsFor([a.id]); b = boards.get(key(a.id, level)) || null; }
    if (!b) {
      const img = await loadImageEl(cdnUrl(a.thumb_url || a.image_url));
      const built = buildPixelBoard(img, pixelBoardOptions(settings, level));
      if (!built.ok) return null;
      b = { ...built, level, version: 0, source: 'local' };
    }
    return b;
  }
  async function shareFromCard(a, btn) {
    const level = bestDone(a.id);
    if (!level) return;
    btn.disabled = true;
    try {
      const b = await boardFor(a, level);
      if (!b) { toast(tr('cgShareFailed')); return; }
      await sharePicture(a, b, btn);
    } catch (e) { console.error('coloring: share from card failed:', e); toast(tr('cgShareFailed')); }
    finally { btn.disabled = false; }
  }
  // Drops an attempt under way (the ✕ on a "continue" card): the copy on
  // this device and, when signed in, the server row — through
  // drop_pixel_progress, which only ever removes the caller's own unfinished
  // row. Finished levels stay untouched.
  async function discardProgress(a) {
    const msg = tr('cgDiscardConfirm', { title: a.art_title || tr('untitledArtwork') });
    const ok = (typeof confirmDialog === 'function' && document.getElementById('confirm-modal'))
      ? await confirmDialog(msg, { okLabel: tr('cgDiscard') })
      : confirm(msg);
    if (!ok) return;
    let serverFailed = false;
    for (const l of LEVELS) {
      const r = recOf(a.id, l);
      if (!r || r.completed || !r.count) continue;
      try { localStorage.removeItem(localKey(a.id, l)); } catch (e) {}
      progress.delete(key(a.id, l));
      if (me.id && !dbMissing) {
        const { error } = await sb.rpc('drop_pixel_progress', { p_artwork_id: a.id, p_level: l });
        if (error) { serverFailed = true; if (!isPixelSchemaMissing(error)) console.error('coloring: drop progress error:', error); }
      }
    }
    // Back into the browse list when nothing of it is left under "mine".
    if (!searchTerm && !bestDone(a.id) && !root.querySelector(`#cgList .cg-card[data-artwork-id="${a.id}"]`)) {
      rows.unshift(a);
      $('cgList').prepend(cardFor(a));
      $('cgEmpty').hidden = true;
    }
    refreshCard(a.id); renderMine(); renderToday();
    toast(tr(serverFailed ? 'cgDiscardPartly' : 'cgDiscarded'));
  }
  function renderNext() {
    const row = $('cgNextRow');
    row.innerHTML = '';
    const pool = rows.filter(a => a.id !== art.id && !unsuitable.has(a.id) && !bestDone(a.id));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (const a of pool.slice(0, 3)) {
      const card = document.createElement('a');
      card.className = 'cg-next-card';
      card.href = `/${CURRENT_LANG}/coloring?artwork=${encodeURIComponent(a.id)}`;
      card.onclick = e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openBoard(a); } };
      const img = document.createElement('img'); img.src = cdnUrl(a.thumb_url || a.image_url); img.alt = '';
      const t = document.createElement('span'); t.textContent = a.art_title || tr('untitledArtwork');
      card.append(img, t);
      row.appendChild(card);
    }
    $('cgNext').hidden = !row.children.length;
  }
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = $('cgConfetti');
    host.innerHTML = '';
    const c = document.createElement('canvas');
    const w = host.clientWidth || 320, h = host.clientHeight || 240;
    c.width = w; c.height = h;
    host.appendChild(c);
    const cx = c.getContext('2d');
    const colors = ['#1A3C2B', '#9EFFBF', '#E8B84B', '#C0522F', '#5B8DFF'];
    const bitsArr = Array.from({ length: 70 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * 80, y: h / 3,
      vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 5,
      s: 4 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * Math.PI,
    }));
    let frames = 0;
    (function draw() {
      cx.clearRect(0, 0, w, h);
      for (const b of bitsArr) {
        b.vy += 0.18; b.x += b.vx; b.y += b.vy; b.rot += 0.1;
        cx.save(); cx.translate(b.x, b.y); cx.rotate(b.rot);
        cx.fillStyle = b.c; cx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.6);
        cx.restore();
      }
      if (++frames < 150) requestAnimationFrame(draw); else c.remove();
    })();
  }

  // ---------- leaving ----------
  async function leaveBoard() {
    if (board && painted < board.total) await flushSave();
    endPlay();
  }
  // Back (browser, phone gesture, app button) while playing or on the
  // result screen returns to the list — saving first — instead of leaving
  // the page (common.js screenHistory).
  const playHistory = typeof screenHistory === 'function' ? screenHistory(leaveBoard) : { enter() {}, leave() {} };
  function endPlay() {
    playHistory.leave();
    clearTimeout(saveTimer);
    const id = art && art.id;
    art = null; board = null; bits = null; cursor = null;
    setPeek(false);
    show('list');
    if (id != null) { refreshCard(id); renderMine(); renderToday(); }
    restoreListPosition();
  }

  // ---------- hint: the next cell of the selected colour ----------
  function hint() {
    if (!board) return;
    let c = selected;
    if (c == null || remaining[c] === 0) {
      c = null;
      for (let k = 0; k < remaining.length; k++) if (remaining[k] > 0 && (c == null || remaining[k] < remaining[c])) c = k;
      if (c == null) { toast(tr('cgHintNone')); return; }
      selectColor(c);
    }
    // The open cell of that colour nearest to the middle of the view.
    const r = stage.getBoundingClientRect();
    const mx = (r.width / 2 - panX) / scale / cellPx, my = (r.height / 2 - panY) / scale / cellPx;
    let best = -1, bd = Infinity;
    for (let i = 0; i < board.w * board.h; i++) {
      if (board.cells[i] !== c || pixelBitGet(bits, i)) continue;
      const dx = (i % board.w) + 0.5 - mx, dy = Math.floor(i / board.w) + 0.5 - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) { toast(tr('cgHintNone')); return; }
    const x = best % board.w, y = Math.floor(best / board.w);
    centerOn(x, y, 34);
    const f = document.createElement('div');
    f.className = 'cg-flash';
    f.style.left = (x * cellPx) + 'px'; f.style.top = (y * cellPx) + 'px';
    f.style.width = cellPx + 'px'; f.style.height = cellPx + 'px';
    $('cgLayer').appendChild(f);
    setTimeout(() => f.remove(), 1500);
    toast(tr('cgHintShown', { n: c + 1 }));
  }

  // ---------- keyboard ----------
  function moveCursor(dx, dy) {
    if (!board) return;
    if (!cursor) {
      const r = stage.getBoundingClientRect();
      cursor = cellAt(r.left + r.width / 2, r.top + r.height / 2) || { x: 0, y: 0 };
    } else {
      cursor = { x: Math.max(0, Math.min(board.w - 1, cursor.x + dx)), y: Math.max(0, Math.min(board.h - 1, cursor.y + dy)) };
    }
    const el = $('cgCursor');
    el.hidden = false;
    el.style.left = (cursor.x * cellPx) + 'px'; el.style.top = (cursor.y * cellPx) + 'px';
    el.style.width = cellPx + 'px'; el.style.height = cellPx + 'px';
    // Keep the cursor inside the view, readable.
    const r = stage.getBoundingClientRect();
    const sx = panX + (cursor.x + 0.5) * cellPx * scale, sy = panY + (cursor.y + 0.5) * cellPx * scale;
    if (sx < 40 || sy < 40 || sx > r.width - 40 || sy > r.height - 40 || scale * cellPx < 24) centerOn(cursor.x, cursor.y, 28);
  }
  addEventListener('keydown', e => {
    if (!document.body.classList.contains('coloring-playing') || !board) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key;
    if (k === 'ArrowLeft') { moveCursor(-1, 0); e.preventDefault(); }
    else if (k === 'ArrowRight') { moveCursor(1, 0); e.preventDefault(); }
    else if (k === 'ArrowUp') { moveCursor(0, -1); e.preventDefault(); }
    else if (k === 'ArrowDown') { moveCursor(0, 1); e.preventDefault(); }
    else if ((k === 'Enter' || k === ' ') && cursor) { paintCell(cursor.x, cursor.y); e.preventDefault(); }
    else if (/^[0-9]$/.test(k)) {
      const n = k === '0' ? 10 : Number(k);
      if (n <= board.colors) selectColor(n - 1);
    }
    else if (k === '[' || k === ']') {
      const dir = k === ']' ? 1 : -1;
      let c = selected == null ? 0 : selected;
      for (let t = 0; t < board.colors; t++) { c = (c + dir + board.colors) % board.colors; if (remaining[c] > 0) break; }
      selectColor(c);
    }
    else if (k === 'h' || k === 'H') hint();
    else if (k === 'Escape') leaveBoard();
  });

  // ---------- pointer wiring ----------
  function wireStage() {
    stage = $('cgStage');
    if (!stage) return;
    let down = false, moved = false, painting = false, lastX = 0, lastY = 0, pinch = 0, lastCell = -1;
    let lastBx = 0, lastBy = 0;   // where the stroke last painted, in cells (fractional)
    let spaceDown = false;         // Space + drag moves the board (desktop has no second finger)
    addEventListener('keydown', e => { if (e.code === 'Space') spaceDown = true; });
    addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
    addEventListener('blur', () => { spaceDown = false; });
    function boardPoint(clientX, clientY) {
      const r = stage.getBoundingClientRect();
      return { x: (clientX - r.left - panX) / scale / cellPx, y: (clientY - r.top - panY) / scale / cellPx };
    }
    // Every cell the segment crosses — a fast swipe leaves no gaps.
    function paintAlong(x0, y0, x1, y1) {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const cx = Math.floor(x0 + (x1 - x0) * t), cy = Math.floor(y0 + (y1 - y0) * t);
        if (cx < 0 || cy < 0 || cx >= board.w || cy >= board.h) continue;
        const i = cy * board.w + cx;
        if (i === lastCell) continue;
        lastCell = i;
        paintCell(cx, cy, true);
      }
    }
    function paintableStart(c) {
      if (!c || selected == null) return false;
      const i = c.y * board.w + c.x;
      return board.cells[i] === selected && !pixelBitGet(bits, i);
    }
    stage.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      // The zoom toolbar sits on the stage: capturing the pointer here would
      // swallow its buttons' clicks (the click needs the up on the button).
      if (e.target.closest('button, .zoom-toolbar')) return;
      down = true; moved = false; painting = false; lastX = e.clientX; lastY = e.clientY; lastCell = -1;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      if (!board) return;
      // Smart drag: a press on a cell of the chosen number starts a stroke;
      // a press anywhere else (another number, a painted cell, the margin)
      // moves the board. Middle/right button or a held Space always moves.
      // Pan mode paints by tap only, like before.
      const forcePan = e.button === 1 || e.button === 2 || spaceDown;
      const c = cellAt(e.clientX, e.clientY);
      if (!prefs.panMode && !forcePan && paintableStart(c)) {
        painting = true;
        const p = boardPoint(e.clientX, e.clientY); lastBx = p.x; lastBy = p.y;
        lastCell = c.y * board.w + c.x;
        cursor = null; $('cgCursor').hidden = true;
        paintCell(c.x, c.y, true);
      }
    });
    stage.addEventListener('pointermove', e => {
      if (!down || !board) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (painting) {
        const p = boardPoint(e.clientX, e.clientY);
        // A second finger arrived: that is a zoom, not a stroke — follow the
        // finger without painting so the stroke resumes from where it is.
        if (!pinch) paintAlong(lastBx, lastBy, p.x, p.y);
        lastBx = p.x; lastBy = p.y;
        return;
      }
      panX += dx; panY += dy; lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    });
    const up = e => {
      if (!down) return;
      down = false;
      try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
      // A tap that did not start a stroke (another number, a painted cell,
      // pan mode): the plain tap, with the wrong-number mark when it is one.
      if (!moved && !painting && board && e.button !== 1 && e.button !== 2) {
        const c = cellAt(e.clientX, e.clientY);
        if (c) { cursor = null; $('cgCursor').hidden = true; paintCell(c.x, c.y); }
      }
      painting = false;
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', () => { down = false; painting = false; });
    stage.addEventListener('contextmenu', e => e.preventDefault());   // right-drag moves
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    // Two fingers zoom (and pan) even in drag-to-paint mode.
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    stage.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = dist(e.touches); }, { passive: true });
    stage.addEventListener('touchmove', e => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      const d = dist(e.touches);
      const r = stage.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      zoomBy(d / pinch, cx, cy);
      pinch = d;
    }, { passive: false });
    stage.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = 0; });
    let resizeTimer = 0;
    addEventListener('resize', () => {
      if (!board) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyTransform, 120);
    });
  }

  // ---------- controls ----------
  $('cgMore').onclick = () => renderList(false);
  $('cgSearch').oninput = e => { searchTerm = e.target.value.trim(); clearTimeout($('cgSearch')._t); $('cgSearch')._t = setTimeout(() => { renderList(true); renderMine(); }, 250); };
  for (const b of root.querySelectorAll('[data-quit]')) b.onclick = leaveBoard;
  for (const b of root.querySelectorAll('[data-hint]')) b.onclick = hint;
  for (const b of root.querySelectorAll('[data-mute]')) b.onclick = () => { prefs.muted = !prefs.muted; if (!prefs.muted) unlockAudio(); savePrefs(); applyToggles(); };
  for (const b of root.querySelectorAll('[data-numbers]')) b.onclick = () => { prefs.numbers = !prefs.numbers; savePrefs(); applyToggles(); };
  for (const b of root.querySelectorAll('[data-pan]')) b.onclick = () => { prefs.panMode = !prefs.panMode; savePrefs(); applyToggles(); };
  $('cgZoomIn').onclick = () => zoomBy(1.4);
  $('cgZoomOut').onclick = () => zoomBy(1 / 1.4);
  $('cgZoomReset').onclick = fitAll;
  // Hold to peek: the original picture lies over the cells only while the
  // 👁 button or the side thumbnail is held down (pointer, or Space/Enter
  // on the button) — a glance without leaving the board.
  function setPeek(on) {
    const p = $('cgPeek');
    if (p) p.hidden = !(on && board);
    const b = $('cgPeekBtn');
    if (b) b.setAttribute('aria-pressed', on && board ? 'true' : 'false');
  }
  function wirePeek(el) {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      setPeek(true);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => setPeek(false));
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); setPeek(true); } });
    el.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') setPeek(false); });
    el.addEventListener('blur', () => setPeek(false));
    el.addEventListener('click', e => e.preventDefault());
  }
  wirePeek($('cgPeekBtn'));
  wirePeek($('cgSideThumb'));
  $('cgShare').onclick = shareResult;
  $('cgResultBack').onclick = endPlay;

  // ---------- boot ----------
  async function openRequested() {
    let wanted = null, level = null;
    try { const q = new URLSearchParams(location.search); wanted = q.get('artwork'); level = Number(q.get('level')) || null; } catch (e) {}
    if (!wanted) return;
    let a = known.get(Number(wanted)) || null;
    if (!a) {
      let { data, error } = await sb.from('mosaic_submissions').select(ARTWORK_ROW_COLS + ',is_public').eq('id', wanted).maybeSingle();
      if (error && isSchemaMismatchError(error)) ({ data } = await sb.from('mosaic_submissions').select(ARTWORK_ROW_COLS).eq('id', wanted).maybeSingle());
      // A private artwork readable here through a public portfolio is still
      // not a colouring board — same rule as the list.
      if (data && data.is_public === false) data = null;
      if (data && !isUserBlocked(data.author_id)) { a = data; known.set(a.id, a); }
    }
    if (!a) { toast(tr('cgNotHere')); return; }
    openBoard(a, level);
  }
  async function boot() {
    lastUid = me.id || '';
    settings = await getSiteSettings().catch(() => ({}));
    if (settings.pixelGameEnabled === false) { show('off'); return; }
    if (settings.gameSoundDefault === false && !('muted' in storedPrefs)) prefs.muted = true;
    // Site option pixelDragDefault decides the mode for anyone who never
    // chose one (admin → Site options → colouring game).
    if (!('panMode' in storedPrefs)) prefs.panMode = settings.pixelDragDefault === false;
    wireStage();
    applyToggles();
    await loadMyProgress();
    show('list');
    await renderList(true);
    renderMine();
    restoreListPosition();
    openRequested();
  }
  // Signing in or out changes whose progress is shown.
  let lastUid = null;
  document.addEventListener('weavo:authchange', () => {
    // auth.js fires this on token refreshes too; only a real sign-in/out
    // changes whose progress the list should show.
    if (lastUid === (me.id || '')) return;
    lastUid = me.id || '';
    if (!board && root.querySelector('[data-screen="list"]:not([hidden])')) loadMyProgress().then(() => { renderList(true); renderMine(); });
  });
  authReady.then(boot).catch(err => { console.error('coloring: boot failed:', err); show('off'); });
})();
