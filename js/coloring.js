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
  const LS_PREFIX = 'weavo.coloring.progress.';  // + artwork id: progress on this device
  const LS_PREFS = 'weavo.coloring.prefs';        // sound / numbers / drag-paint toggles

  // ---------- state ----------
  let settings = {};
  let dbMissing = false;        // pixel_boards is not there: boards are built on the fly
  let rows = [];                // artwork rows shown so far (newest first)
  let pageFrom = 0;             // next range() offset
  let listDone = false;
  let listToken = 0;            // bumps on every reset; a slower earlier load is dropped
  let searchTerm = '';
  let filterMode = 'all';       // all | mine
  const boards = new Map();     // artwork id -> board (stored ones)
  const progress = new Map();   // artwork id -> { count, total, completed, version }
  const completions = new Map();// artwork id -> finished player count
  let unsuitable = new Set();   // ids whose on-the-fly board could not be made
  try { unsuitable = new Set(JSON.parse(sessionStorage.getItem('weavo.coloring.unsuitable') || '[]')); } catch (e) {}

  let prefs = { muted: false, numbers: false, drag: false };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(LS_PREFS) || '{}') }; } catch (e) {}
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
  let audioCtx = null;
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
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      let peak = 0.14, stop = 0.08;
      if (kind === 'fill') { osc.type = 'triangle'; osc.frequency.setValueAtTime(720, t); }
      else if (kind === 'color') { osc.type = 'triangle'; osc.frequency.setValueAtTime(520, t); osc.frequency.setValueAtTime(780, t + 0.07); peak = 0.2; stop = 0.2; }
      else if (kind === 'done') { osc.type = 'triangle'; osc.frequency.setValueAtTime(523, t); osc.frequency.setValueAtTime(784, t + 0.09); osc.frequency.setValueAtTime(1046, t + 0.18); peak = 0.26; stop = 0.4; }
      else { osc.type = 'square'; osc.frequency.setValueAtTime(400, t); osc.frequency.exponentialRampToValueAtTime(220, t + 0.14); peak = 0.15; stop = 0.16; }
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + stop);
      osc.connect(gain); gain.connect(audioCtx.destination);
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
    for (const b of root.querySelectorAll('[data-drag]')) b.setAttribute('aria-pressed', String(prefs.drag));
    const note = $('cgDragNote');
    if (note) note.hidden = !prefs.drag;
    if (numCv) updateNumbersVisibility();
  }

  // ---------- device progress ----------
  function localKey(id) { return LS_PREFIX + id; }
  function readLocal(id) {
    try { return JSON.parse(localStorage.getItem(localKey(id)) || 'null'); } catch (e) { return null; }
  }
  function writeLocal(id, rec) {
    try { localStorage.setItem(localKey(id), JSON.stringify(rec)); } catch (e) { /* private mode */ }
  }

  // ---------- data ----------
  function normalizeRow(r) { return r; }
  // One page of artworks, newest first. Server-side search so the page never
  // has to hold every row; pieces are excluded (parent_id), and the column
  // filters fall back while their SQL is not applied.
  async function loadPage() {
    const from = pageFrom, to = pageFrom + LIST_PAGE - 1;
    const build = (withOptOut, withPieces, withPublic) => {
      let q = sb.from('mosaic_submissions').select(ARTWORK_ROW_COLS + (withOptOut ? ',coloring_opt_out' : ''));
      if (withPieces) q = q.is('parent_id', null);
      if (withOptOut) q = q.or('coloring_opt_out.is.null,coloring_opt_out.eq.false');
      if (withPublic) q = q.eq('is_public', true);   // private artworks are not coloured (supabase_portfolios.sql)
      if (searchTerm) {
        const s = searchTerm.replace(/[%,()]/g, ' ').trim();
        if (s) q = q.or(`art_title.ilike.%${s}%,author_name.ilike.%${s}%`);
      }
      if (filterMode === 'mine') {
        const ids = [...progress.keys()];
        if (!ids.length) return null;
        q = q.in('id', ids);
      }
      return q.order('created_at', { ascending: false }).range(from, to);
    };
    let q = build(true, true, true);
    if (!q) return [];
    let { data, error } = await q;
    // Newest SQL file first to go, oldest last (each is a hand-run file).
    if (error && isSchemaMismatchError(error)) ({ data, error } = await build(true, true, false));
    if (error && isSchemaMismatchError(error)) ({ data, error } = await build(false, true, false));
    if (error && isSchemaMismatchError(error)) ({ data, error } = await build(false, false, false));
    if (error) { console.error('coloring: load artworks error:', error); return []; }
    const list = (data || []).filter(a => !isUserBlocked(a.author_id) && (a.thumb_url || a.image_url));
    pageFrom += (data || []).length;
    if (!data || data.length < LIST_PAGE) listDone = true;
    return list.map(normalizeRow);
  }
  async function loadBoardsFor(list) {
    if (dbMissing) return;
    const ids = list.map(a => a.id).filter(id => !boards.has(id));
    if (!ids.length) return;
    const res = await fetchPixelBoards(ids);
    if (res.missing) { dbMissing = true; return; }
    for (const [id, b] of res.boards) boards.set(id, b);
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
  // whatever this device remembers — the copy with more cells wins.
  async function loadMyProgress() {
    progress.clear();
    if (me.id && !dbMissing) {
      const { data, error } = await sb.from('pixel_progress').select('artwork_id,board_version,filled,filled_count,completed_at');
      if (error) { if (isPixelSchemaMissing(error)) dbMissing = true; else console.error('coloring: load progress error:', error); }
      for (const r of (data || [])) {
        progress.set(r.artwork_id, { count: r.filled_count, completed: !!r.completed_at, version: r.board_version, filled: r.filled, source: 'db' });
      }
    }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(LS_PREFIX)) continue;
        const id = Number(k.slice(LS_PREFIX.length));
        const rec = readLocal(id);
        if (!rec) continue;
        const have = progress.get(id);
        if (!have || (rec.count || 0) > (have.count || 0)) {
          progress.set(id, { count: rec.count || 0, completed: !!rec.completed, version: rec.version, filled: rec.bits, source: 'local' });
        }
      }
    } catch (e) { /* storage blocked */ }
  }

  // ---------- list ----------
  function pct(id, total) {
    const p = progress.get(id);
    if (!p || !p.count) return 0;
    const t = total || p.total || 0;
    return t ? Math.min(100, Math.round((p.count / t) * 100)) : 0;
  }
  function cardFor(a) {
    const b = boards.get(a.id);
    const p = progress.get(a.id);
    // "Midway" = an attempt in progress (a second one, after finishing, too);
    // "completed" = finished at least once.
    const total = (b && b.total) || (p && p.total) || 0;
    const midway = !!(p && p.count && total && p.count < total);
    const card = document.createElement('div');
    card.className = 'cg-card';
    card.dataset.artworkId = a.id;

    const link = document.createElement('a');
    link.className = 'cg-card-thumb-link';
    link.href = artworkUrl(a.id);
    const img = document.createElement('img');
    img.className = 'cg-card-thumb';
    img.loading = 'lazy'; img.decoding = 'async';
    img.src = cdnUrl(a.thumb_url || a.image_url);
    img.alt = a.art_title ? tr('artworkThumbAlt', { title: a.art_title, name: a.author_name || tr('anonymous') }) : tr('artworkImgAltFallback', { name: a.author_name || tr('anonymous') });
    link.appendChild(img);
    if (p && (p.completed || p.count)) {
      const badge = document.createElement('span');
      badge.className = 'cg-card-badge' + (p.completed ? ' done' : '');
      badge.textContent = p.completed ? tr('cgDone') : pct(a.id, b && b.total) + '%';
      link.appendChild(badge);
    }
    if (typeof bindArtworkLightbox === 'function') bindArtworkLightbox(link, a.id);

    const body = document.createElement('div');
    body.className = 'cg-card-body';
    const title = document.createElement('div'); title.className = 'cg-card-title'; title.textContent = a.art_title || tr('untitledArtwork');
    const by = document.createElement('div'); by.className = 'cg-card-author'; by.textContent = a.author_name || tr('anonymous');
    const meta = document.createElement('div'); meta.className = 'cg-card-meta';
    const bitsMeta = [];
    if (b) bitsMeta.push(tr('cgBoardMeta', { w: b.w, h: b.h, colors: b.colors }));
    else bitsMeta.push(tr('cgBoardOnTheFly'));
    const n = completions.get(a.id);
    if (n) bitsMeta.push(tr('cgCompletions', { n }));
    meta.textContent = bitsMeta.join(' · ');
    body.append(title, by, meta);
    if (midway) {
      const bar = document.createElement('div'); bar.className = 'cg-card-bar';
      const fill = document.createElement('i'); fill.style.width = pct(a.id, total) + '%';
      bar.appendChild(fill); body.appendChild(bar);
    }
    const playWrap = document.createElement('div'); playWrap.className = 'cg-card-play';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-btn' + (midway ? ' primary' : '');
    btn.textContent = midway ? tr('cgResume', { pct: pct(a.id, total) }) : (p && p.completed ? tr('cgAgain') : tr('cgStart'));
    if (unsuitable.has(a.id)) { btn.disabled = true; btn.textContent = tr('cgUnsuitableShort'); }
    btn.onclick = () => openBoard(a);
    playWrap.appendChild(btn);
    body.appendChild(playWrap);
    card.append(link, body);
    return card;
  }
  async function renderList(reset) {
    const list = $('cgList');
    if (reset) { list.innerHTML = ''; rows = []; pageFrom = 0; listDone = false; listToken++; }
    const token = listToken;
    const more = $('cgMore');
    more.disabled = true;
    const page = await loadPage();
    await Promise.all([loadBoardsFor(page), loadCompletionsFor(page)]);
    if (token !== listToken) return;   // a newer reset superseded this load
    for (const a of page) { rows.push(a); list.appendChild(cardFor(a)); }
    $('cgEmpty').hidden = rows.length !== 0;
    more.hidden = listDone;
    more.disabled = false;
    $('cgCount').textContent = tr('cgCount', { n: rows.length }) + (listDone ? '' : '+');
    if (reset) renderToday();
  }
  // A deterministic pick for the day among the newest artworks, so
  // everyone sees the same one and it changes tomorrow.
  function renderToday() {
    const box = $('cgToday');
    if (!box) return;
    const pool = rows.filter(a => !unsuitable.has(a.id));
    if (!pool.length || searchTerm || filterMode !== 'all') { box.hidden = true; return; }
    const day = Math.floor(Date.now() / 86400000);
    const a = pool[day % pool.length];
    $('cgTodayThumb').src = cdnUrl(a.thumb_url || a.image_url);
    $('cgTodayThumb').alt = a.art_title || '';
    $('cgTodayTitle').textContent = a.art_title || tr('untitledArtwork');
    $('cgTodayBy').textContent = a.author_name || tr('anonymous');
    const btn = $('cgTodayPlay');
    btn.onclick = () => openBoard(a);
    box.hidden = false;
  }
  function refreshCard(id) {
    const a = rows.find(r => r.id === id);
    const old = $('cgList').querySelector(`[data-artwork-id="${id}"]`);
    if (a && old) old.replaceWith(cardFor(a));
  }
  function restoreListPosition() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch (e) {}
    try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
    if (!saved) { window.scrollTo(0, 0); return; }
    const card = $('cgList').querySelector(`[data-artwork-id="${saved.artworkId}"]`);
    if (card) {
      card.scrollIntoView({ block: 'center' });
      card.classList.add('just-played');
      setTimeout(() => card.classList.remove('just-played'), 1600);
    } else if (saved.scrollY) window.scrollTo(0, saved.scrollY);
  }

  // ---------- opening a board ----------
  async function openBoard(a) {
    if (!me.id && settings.pixelAnonymousPlay === false) { toast(tr('cgNeedSignIn')); openAuthModal(); return; }
    unlockAudio();
    try { sessionStorage.setItem(SS_KEY, JSON.stringify({ artworkId: a.id, scrollY: window.scrollY })); } catch (e) {}
    art = a;
    cursor = null;
    const cur = $('cgCursor');
    if (cur) cur.hidden = true;
    show('play');
    $('cgLoading').hidden = false;
    $('cgLoading').textContent = tr('gamePreparing');
    fillSidePanel(a);
    let b = boards.get(a.id) || null;
    try {
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
        const built = buildPixelBoard(img, pixelBoardOptions(settings));
        if (!built.ok) {
          unsuitable.add(a.id);
          try { sessionStorage.setItem('weavo.coloring.unsuitable', JSON.stringify([...unsuitable])); } catch (e) {}
          toast(tr('cgUnsuitable'));
          refreshCard(a.id);
          renderToday();
          endPlay();
          return;
        }
        b = { ...built, version: 0, source: 'local' };
        // The artist (or an admin) opening their own artwork stores the board
        // for everyone; other players keep an on-device copy.
        if (!dbMissing && me.id && (me.id === a.author_id || me.isAdmin)) {
          const saved = await savePixelBoard(a.id, built);
          if (saved.version) { b.version = saved.version; b.source = 'db'; boards.set(a.id, b); }
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
  function fillSidePanel(a) {
    const name = a.author_name || tr('anonymous');
    for (const el of root.querySelectorAll('[data-art-title]')) el.textContent = a.art_title || tr('untitledArtwork');
    const thumb = $('cgSideThumb');
    if (thumb) thumb.src = cdnUrl(a.thumb_url || a.image_url);
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
    const p = progress.get(a.id);
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
    for (const el of [baseCv, hlCv, numCv, $('cgLayer')]) if (el) el.style.transform = t;
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
  function paintCell(x, y) {
    if (!board) return;
    const i = y * board.w + x;
    const c = board.cells[i];
    if (c === PIXEL_EMPTY || pixelBitGet(bits, i)) return;
    if (selected == null) { toast(tr('cgPickColor')); return; }
    if (c !== selected) {
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
    const prev = readLocal(art.id);
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
    writeLocal(art.id, rec);
    progress.set(art.id, { count: rec.count, total: rec.total, completed: !!rec.completed, version: rec.version, filled: rec.bits, source: 'local' });
    dirty = 0;
    // Online only when there is a stored board to attach the bits to.
    if (!me.id || dbMissing || board.source !== 'db') return null;
    try {
      const { data, error } = await sb.rpc('save_pixel_progress', { p_artwork_id: art.id, p_filled: rec.bits });
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
    const bits2 = [tr('cgFinishedIn', { time: fmtDur(elapsed) })];
    if (result && result.first_completion && result.completions === 1) bits2.push(tr('cgFirstFinish'));
    else if (result && result.completions) bits2.push(tr('cgFinishedCount', { n: result.completions }));
    if (!me.id) bits2.push(tr('cgLocalOnly'));
    $('cgResultNote').textContent = bits2.join(' · ');
    confetti();
    renderNext();
    refreshCard(art.id);
    window.scrollTo(0, 0);
  }
  function fmtDur(ms) {
    const total = Math.max(0, ms) / 1000;
    if (total < 60) return tr('gameDurSec', { s: total.toFixed(0) });
    const m = Math.floor(total / 60);
    return tr('gameDurMin', { m, s: Math.round(total - m * 60) });
  }
  function drawFinished(cv, px) {
    cv.width = board.w * px; cv.height = board.h * px;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < board.w * board.h; i++) {
      const c = board.cells[i];
      if (c === PIXEL_EMPTY) continue;
      const rgb = board.palette[c];
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect((i % board.w) * px, Math.floor(i / board.w) * px, px, px);
    }
  }
  // A card to share: the finished board with the artist's credit under it.
  function shareCardBlob() {
    const px = 16, pad = 40, cap = 96;
    const bw = board.w * px, bh = board.h * px;
    const cv = document.createElement('canvas');
    cv.width = bw + pad * 2; cv.height = bh + pad * 2 + cap;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#F7F7F5'; ctx.fillRect(0, 0, cv.width, cv.height);
    const tmp = document.createElement('canvas');
    drawFinished(tmp, px);
    ctx.drawImage(tmp, pad, pad);
    ctx.fillStyle = '#1A3C2B';
    ctx.font = 'bold 30px Pretendard, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText((art.art_title || tr('untitledArtwork')).slice(0, 48), pad, pad + bh + 22);
    ctx.fillStyle = '#5b6475';
    ctx.font = '22px Pretendard, sans-serif';
    ctx.fillText(tr('cgShareCaption', { name: art.author_name || tr('anonymous') }), pad, pad + bh + 60);
    return new Promise(resolve => cv.toBlob(resolve, 'image/png'));
  }
  async function shareResult() {
    const btn = $('cgShare');
    btn.disabled = true;
    try {
      const blob = await shareCardBlob();
      if (!blob) throw new Error('no image');
      const file = new File([blob], `weavo-coloring-${art.id}.png`, { type: 'image/png' });
      const text = tr('cgShareText', { title: art.art_title || tr('untitledArtwork') });
      const url = `${location.origin}${artworkUrl(art.id)}`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, url });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast(tr('cgShared'));
      }
    } catch (e) {
      if (!e || e.name !== 'AbortError') { console.error('coloring: share failed:', e); toast(tr('cgShareFailed')); }
    } finally { btn.disabled = false; }
  }
  function renderNext() {
    const row = $('cgNextRow');
    row.innerHTML = '';
    const pool = rows.filter(a => a.id !== art.id && !unsuitable.has(a.id) && !(progress.get(a.id) || {}).completed);
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
  function endPlay() {
    clearTimeout(saveTimer);
    const id = art && art.id;
    art = null; board = null; bits = null; cursor = null;
    show('list');
    if (id != null) refreshCard(id);
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
    let down = false, moved = false, lastX = 0, lastY = 0, pinch = 0, lastCell = -1;
    stage.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      down = true; moved = false; lastX = e.clientX; lastY = e.clientY; lastCell = -1;
      stage.setPointerCapture(e.pointerId);
      if (prefs.drag && board) {
        const c = cellAt(e.clientX, e.clientY);
        if (c) { lastCell = c.y * board.w + c.x; paintCell(c.x, c.y); }
      }
    });
    stage.addEventListener('pointermove', e => {
      if (!down || !board) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (prefs.drag && pinch === 0) {
        const c = cellAt(e.clientX, e.clientY);
        if (c) { const i = c.y * board.w + c.x; if (i !== lastCell) { lastCell = i; paintCell(c.x, c.y); } }
        return;
      }
      panX += dx; panY += dy; lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    });
    const up = e => {
      if (!down) return;
      down = false;
      try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
      if (!moved && !prefs.drag && board) {
        const c = cellAt(e.clientX, e.clientY);
        if (c) { cursor = null; $('cgCursor').hidden = true; paintCell(c.x, c.y); }
      }
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', () => { down = false; });
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
  $('cgSearch').oninput = e => { searchTerm = e.target.value.trim(); clearTimeout($('cgSearch')._t); $('cgSearch')._t = setTimeout(() => renderList(true), 250); };
  for (const b of root.querySelectorAll('[data-filter]')) b.onclick = () => {
    filterMode = b.dataset.filter;
    for (const x of root.querySelectorAll('[data-filter]')) x.classList.toggle('active', x === b);
    renderList(true);
  };
  for (const b of root.querySelectorAll('[data-quit]')) b.onclick = leaveBoard;
  for (const b of root.querySelectorAll('[data-hint]')) b.onclick = hint;
  for (const b of root.querySelectorAll('[data-mute]')) b.onclick = () => { prefs.muted = !prefs.muted; if (!prefs.muted) unlockAudio(); savePrefs(); applyToggles(); };
  for (const b of root.querySelectorAll('[data-numbers]')) b.onclick = () => { prefs.numbers = !prefs.numbers; savePrefs(); applyToggles(); };
  for (const b of root.querySelectorAll('[data-drag]')) b.onclick = () => { prefs.drag = !prefs.drag; savePrefs(); applyToggles(); };
  $('cgZoomIn').onclick = () => zoomBy(1.4);
  $('cgZoomOut').onclick = () => zoomBy(1 / 1.4);
  $('cgZoomReset').onclick = fitAll;
  $('cgShare').onclick = shareResult;
  $('cgResultBack').onclick = endPlay;

  // ---------- boot ----------
  async function openRequested() {
    let wanted = null;
    try { wanted = new URLSearchParams(location.search).get('artwork'); } catch (e) {}
    if (!wanted) return;
    let a = rows.find(x => String(x.id) === String(wanted));
    if (!a) {
      let { data, error } = await sb.from('mosaic_submissions').select(ARTWORK_ROW_COLS + ',is_public').eq('id', wanted).maybeSingle();
      if (error && isSchemaMismatchError(error)) ({ data } = await sb.from('mosaic_submissions').select(ARTWORK_ROW_COLS).eq('id', wanted).maybeSingle());
      // A private artwork readable here through a public portfolio is still
      // not a colouring board — same rule as the list.
      if (data && data.is_public === false) data = null;
      if (data && !isUserBlocked(data.author_id)) { a = data; await loadBoardsFor([a]); }
    }
    if (!a) { toast(tr('cgNotHere')); return; }
    openBoard(a);
  }
  async function boot() {
    lastUid = me.id || '';
    settings = await getSiteSettings().catch(() => ({}));
    if (settings.pixelGameEnabled === false) { show('off'); return; }
    if (settings.gameSoundDefault === false && !('muted' in (JSON.parse(localStorage.getItem(LS_PREFS) || '{}')))) prefs.muted = true;
    wireStage();
    applyToggles();
    await loadMyProgress();
    show('list');
    await renderList(true);
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
    if (!board && root.querySelector('[data-screen="list"]:not([hidden])')) loadMyProgress().then(() => renderList(true));
  });

  authReady.then(boot).catch(err => { console.error('coloring: boot failed:', err); show('off'); });
})();
