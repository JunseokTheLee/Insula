// "Find the piece" game (/{lang}/game): pick an artwork that has pieces in
// the current campaign's mosaic, then find those pieces inside the mosaic.
//
// Needs js/color-engine.js (luminance, which common.js's openCellPainter
// calls), js/common.js (sb, loadProjectCells, openCellPainter, fetchAllRows,
// cdnUrl, toast, getSiteSettings, confirmDialog, isUserBlocked) and
// js/auth.js (me, authReady, openAuthModal) — in that order.
//
// The campaign page has its own zoom/pan, but it is bound to #weavoStage and
// that file opens a campaign on load — so this page carries its own copy of
// the same pattern rather than importing behaviour it would have to undo.
"use strict";

(function () {
  const root = document.getElementById('gamePage');
  if (!root) return;                 // not the game page

  // ---------- state ----------
  let settings = null;
  let project = null;                // the live campaign
  let cells = [];                    // grid colours (from the PNG when there is one)
  let filled = [];                   // {x, y, sub} for every filled cell
  let artworks = [];                 // game targets, newest first
  let statsByArtwork = {};           // artworkId -> {top, mine_ms, mine_rank}
  let target = null;                 // artwork being played
  let targetCells = [];              // the cells that belong to `target`
  let foundKeys = new Set();
  let sessionId = null;
  let startedAt = 0;                 // performance.now() at GO
  let rafId = 0;
  let listRendered = 0;              // how many cards are in the DOM
  const LIST_PAGE = 24;
  let searchTerm = '';
  let muted = false;

  const SS_KEY = 'weavo.game';       // survives an iOS reload (see restoreShell)

  // ---------- small helpers ----------
  const $ = id => document.getElementById(id);
  const fmtTime = ms => {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    const rest = (s - m * 60);
    return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
  };
  const fmtSec = ms => (Math.max(0, ms) / 1000).toFixed(2);
  const artworkKeyOf = sub => (sub.parent_id != null ? sub.parent_id : sub.id);

  function show(name) {
    for (const el of root.querySelectorAll('[data-screen]')) {
      el.hidden = el.dataset.screen !== name;
    }
    // The mosaic takes the whole phone screen while playing; the shared
    // full-screen pattern (base.css) hides the nav chrome for us.
    document.body.toggleAttribute('data-mobile-fs', name === 'play');
    document.body.classList.toggle('game-playing', name === 'play');
  }

  // ---------- sound (synthesised; the repo ships no audio files) ----------
  let audioCtx = null;
  function beep(kind) {
    if (muted) return;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      // Correct: a short rising pair. Wrong: one low, quickly damped blip.
      if (kind === 'correct') {
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.setValueAtTime(990, t + 0.07);
      } else if (kind === 'done') {
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(784, t + 0.09);
        osc.frequency.setValueAtTime(1046, t + 0.18);
      } else {
        osc.frequency.setValueAtTime(180, t);
      }
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'done' ? 0.34 : 0.16));
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + (kind === 'done' ? 0.36 : 0.18));
    } catch (e) { /* audio is a nicety; never break play for it */ }
  }
  function setMuted(on) {
    muted = on;
    for (const b of root.querySelectorAll('[data-mute]')) {
      b.textContent = on ? '🔇' : '🔊';
      b.setAttribute('aria-label', on ? tr('gameSoundOff') : tr('gameSoundOn'));
      b.setAttribute('aria-pressed', String(on));
    }
    try { localStorage.setItem('weavo.gameMuted', on ? '1' : '0'); } catch (e) {}
  }

  // ---------- data ----------
  async function loadCampaign() {
    const { data, error } = await sb.from('mosaic_projects')
      .select('*').eq('is_archived', false)
      .order('created_at', { ascending: false }).limit(1);
    if (error) { console.error('game: load campaign error:', error); return null; }
    return (data && data[0]) || null;
  }

  // Every filled cell of the campaign, with just enough of its submission to
  // draw the mosaic AND to decide which artwork a cell belongs to. Same
  // shape the home hero already fetches, so the cost is known: ~163 bytes
  // per filled cell after gzip.
  async function loadFilledCells(p) {
    const cols = 'x,y,mosaic_submissions!mosaic_pixels_submission_id_fkey'
      + '(id,parent_id,piece_row,piece_col,piece_n,avg_r,avg_g,avg_b,micro_thumb)';
    const res = await fetchAllRows(
      () => sb.from('mosaic_pixels').select(cols)
        .eq('project_id', p.id).eq('filled', true).not('submission_id', 'is', null),
      { orderBy: 'id', expected: p.width * p.height }
    );
    if (res.error) { console.error('game: load filled cells error:', res.error); return []; }
    return (res.data || [])
      .filter(px => px.mosaic_submissions)
      .map(px => ({ x: px.x, y: px.y, sub: px.mosaic_submissions }));
  }

  // One request for every artwork that owns a filled cell — never one per
  // artwork.
  async function loadArtworks(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from('mosaic_submissions')
        .select('id,art_title,author_id,author_name,thumb_url,image_url,piece_n,created_at')
        .in('id', ids.slice(i, i + 200));
      if (error) { console.error('game: load artworks error:', error); break; }
      out.push(...(data || []));
    }
    return out;
  }

  // Rankings are a bonus: if this fails the artwork list still works.
  async function loadStats(projectId) {
    try {
      const { data, error } = await sb.rpc('game_artwork_stats', { p_project_id: projectId });
      if (error) { console.error('game: stats error:', error); return {}; }
      return data || {};
    } catch (e) { console.error('game: stats threw:', e); return {}; }
  }

  // ---------- artwork list ----------
  function visibleArtworks() {
    if (!searchTerm) return artworks;
    const q = searchTerm.toLowerCase();
    return artworks.filter(a =>
      (a.art_title || '').toLowerCase().includes(q) ||
      (a.author_name || '').toLowerCase().includes(q));
  }

  function medalRow(entry, i) {
    const medal = ['🥇', '🥈', '🥉'][i] || '';
    const row = document.createElement('div');
    row.className = 'gl-medal';
    const m = document.createElement('span'); m.className = 'gl-m'; m.textContent = medal;
    const n = document.createElement('span'); n.className = 'gl-n';
    n.textContent = entry.name || tr('anonymous');
    const t = document.createElement('span'); t.className = 'gl-t';
    t.textContent = fmtSec(entry.ms);
    row.append(m, n, t);
    return row;
  }

  function cardFor(a) {
    const used = a._used;
    const totalPieces = (a.piece_n && a.piece_n > 1) ? a.piece_n * a.piece_n : used;
    const st = statsByArtwork[String(a.id)] || null;
    const rankingOn = settings.gameRankingEnabled !== false;

    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.artworkId = a.id;

    const thumb = document.createElement('img');
    thumb.className = 'game-card-thumb';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    thumb.src = cdnUrl(a.thumb_url || a.image_url);
    thumb.alt = '';
    card.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'game-card-body';

    const title = document.createElement('div');
    title.className = 'game-card-title';
    title.textContent = a.art_title || tr('untitledArtwork');
    const author = document.createElement('div');
    author.className = 'game-card-author';
    author.textContent = a.author_name || tr('anonymous');
    const pieces = document.createElement('div');
    pieces.className = 'game-card-pieces';
    pieces.textContent = tr('gameUsedPieces', { used, total: totalPieces });
    body.append(title, author, pieces);

    if (rankingOn && st && st.top && st.top.length) {
      const board = document.createElement('div');
      board.className = 'game-card-board';
      st.top.slice(0, 3).forEach((e, i) => board.appendChild(medalRow(e, i)));
      body.appendChild(board);
    }
    if (rankingOn && st && st.mine_ms != null) {
      const mine = document.createElement('div');
      mine.className = 'game-card-mine';
      mine.textContent = tr('gameMyBestRank', { time: fmtSec(st.mine_ms), rank: st.mine_rank });
      body.appendChild(mine);
    }
    card.appendChild(body);

    // The play button is its own control, so a future link on the title
    // cannot collide with starting a game.
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'admin-btn primary game-card-play';
    play.textContent = tr('gamePlay');
    play.onclick = () => confirmStart(a);
    card.appendChild(play);
    return card;
  }

  function renderList(reset) {
    const list = $('gameList');
    const rows = visibleArtworks();
    if (reset) { list.innerHTML = ''; listRendered = 0; }
    const next = rows.slice(listRendered, listRendered + LIST_PAGE);
    for (const a of next) list.appendChild(cardFor(a));
    listRendered += next.length;
    $('gameListEmpty').hidden = rows.length !== 0;
    $('gameListMore').hidden = listRendered >= rows.length;
    $('gameListCount').textContent = tr('gameArtworkCount', { n: rows.length });
  }

  // ---------- start confirmation ----------
  async function confirmStart(a) {
    const st = statsByArtwork[String(a.id)] || null;
    const rankingOn = settings.gameRankingEnabled !== false;
    const lines = [tr('gameConfirmPieces', {
      total: (a.piece_n && a.piece_n > 1) ? a.piece_n * a.piece_n : a._used,
      used: a._used,
    })];
    if (rankingOn && st && st.mine_ms != null) lines.push(tr('gameConfirmMine', { time: fmtSec(st.mine_ms) }));
    if (rankingOn && st && st.top && st.top.length) lines.push(tr('gameConfirmBest', { time: fmtSec(st.top[0].ms) }));
    if (!me.id) lines.push(tr('gameConfirmAnon'));

    const ok = await confirmDialog(lines.join('\n'), {
      title: a.art_title || tr('untitledArtwork'),
      okLabel: tr('gameStart'),
    });
    if (!ok) return;

    if (!me.id && settings.gameAnonymousPlayEnabled === false) {
      toast(tr('gameNeedSignIn'));
      openAuthModal();
      return;
    }
    // Remember where we were so returning lands on the same card.
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify({
        projectId: project.id, artworkId: a.id, scrollY: window.scrollY,
      }));
    } catch (e) {}
    beginGame(a);
  }

  // ---------- mosaic rendering ----------
  let stage, canvas, ctx, cellPx = 6;
  let scale = 1, panX = 0, panY = 0;

  function buildMosaic() {
    stage = $('gameStage');
    canvas = $('gameCanvas');
    cellPx = Math.max(4, Math.min(12, Math.floor(4000 / Math.max(project.width, project.height))));
    canvas.width = project.width * cellPx;
    canvas.height = project.height * cellPx;
    ctx = canvas.getContext('2d');

    const paint = typeof openCellPainter === 'function'
      ? openCellPainter(cells, settings)
      : (r, g, b) => `rgb(${r},${g},${b})`;
    const byKey = new Map(filled.map(f => [`${f.x},${f.y}`, f]));
    for (const c of cells) {
      const hit = byKey.get(`${c.x},${c.y}`);
      ctx.fillStyle = hit
        ? `rgb(${hit.sub.avg_r},${hit.sub.avg_g},${hit.sub.avg_b})`
        : paint(c.target_r, c.target_g, c.target_b);
      ctx.fillRect(c.x * cellPx, c.y * cellPx, cellPx, cellPx);
    }
    // micro_thumb is a 16×16 data URI already in hand — no extra request.
    for (const f of filled) {
      if (!f.sub.micro_thumb) continue;
      const img = new Image();
      img.onload = () => ctx.drawImage(img, f.x * cellPx, f.y * cellPx, cellPx, cellPx);
      img.src = f.sub.micro_thumb;
    }
    fitAll();
  }

  function applyTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    const layer = $('gameMarks');
    layer.style.transform = canvas.style.transform;
    $('gameZoomLevel').textContent = Math.round(scale * 100) + '%';
  }
  function fitAll() {
    const r = stage.getBoundingClientRect();
    const s = Math.min(r.width / canvas.width, r.height / canvas.height);
    scale = s > 0 ? s : 1;
    panX = (r.width - canvas.width * scale) / 2;
    panY = (r.height - canvas.height * scale) / 2;
    applyTransform();
  }
  function zoomBy(factor, cx, cy) {
    const r = stage.getBoundingClientRect();
    const ox = (cx == null ? r.width / 2 : cx);
    const oy = (cy == null ? r.height / 2 : cy);
    const next = Math.max(0.2, Math.min(40, scale * factor));
    // Keep the point under the cursor fixed while the scale changes.
    panX = ox - (ox - panX) * (next / scale);
    panY = oy - (oy - panY) * (next / scale);
    scale = next;
    applyTransform();
  }

  // Stage coords -> cell coords. Works at any zoom because it inverts the
  // same transform the canvas is drawn with.
  function cellAt(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const x = (clientX - r.left - panX) / scale / cellPx;
    const y = (clientY - r.top - panY) / scale / cellPx;
    if (x < 0 || y < 0 || x >= project.width || y >= project.height) return null;
    return { x: Math.floor(x), y: Math.floor(y) };
  }

  function markCell(x, y, cls) {
    const el = document.createElement('div');
    el.className = 'game-mark ' + cls;
    el.style.left = `${x * cellPx}px`;
    el.style.top = `${y * cellPx}px`;
    el.style.width = `${cellPx}px`;
    el.style.height = `${cellPx}px`;
    $('gameMarks').appendChild(el);
    return el;
  }

  // ---------- play ----------
  async function beginGame(a) {
    target = a;
    foundKeys = new Set();
    sessionId = null;
    targetCells = filled.filter(f => artworkKeyOf(f.sub) === a.id);

    show('play');
    $('gameMarks').innerHTML = '';
    $('gameCountdown').hidden = false;
    $('gameCountdown').textContent = tr('gamePreparing');

    renderTargetPanel();
    // The mosaic is fitted to the stage, so the stage must be laid out
    // first. Reading a rect forces that synchronously — rAF would be the
    // obvious choice but it never fires in a hidden tab, which would leave
    // the game stuck on "preparing" forever (same trap as the modal-lock
    // observer, CLAUDE.md 7).
    stage = $('gameStage');
    void stage.getBoundingClientRect();
    buildMosaic();

    // Preload the artwork image so the countdown covers the download, not
    // the clock (the timer must never include network time).
    await new Promise(resolve => {
      const img = $('gameTargetImg');
      if (img.complete && img.naturalWidth) return resolve();
      img.onload = img.onerror = () => resolve();
    });

    if (me.id) {
      try {
        const { data, error } = await sb.rpc('start_game', { p_project_id: project.id, p_artwork_id: a.id });
        if (error) { console.error('game: start_game error:', error); }
        else if (data) sessionId = data.session_id;
      } catch (e) { console.error('game: start_game threw:', e); }
    }

    await countdown();
    startedAt = performance.now();
    tick();
  }

  function countdown() {
    const el = $('gameCountdown');
    const steps = ['3', '2', '1', tr('gameGo')];
    return new Promise(resolve => {
      let i = 0;
      const step = () => {
        if (i >= steps.length) { el.hidden = true; return resolve(); }
        el.textContent = steps[i];
        el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
        i++;
        setTimeout(step, 700);
      };
      step();
    });
  }

  function tick() {
    cancelAnimationFrame(rafId);
    const run = () => {
      const ms = performance.now() - startedAt;
      const el = $('gameTimer');
      if (el && !el.dataset.hidden) el.textContent = fmtTime(ms);
      rafId = requestAnimationFrame(run);
    };
    run();
  }

  function renderTargetPanel() {
    const img = $('gameTargetImg');
    img.src = cdnUrl(target.thumb_url || target.image_url);
    img.alt = target.art_title || '';
    $('gameTargetTitle').textContent = target.art_title || tr('untitledArtwork');
    $('gameTargetAuthor').textContent = target.author_name || tr('anonymous');

    const n = (target.piece_n && target.piece_n > 1) ? target.piece_n : 1;
    const grid = $('gameTargetGrid');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    const usedSet = new Set(targetCells.map(f => `${f.sub.piece_row},${f.sub.piece_col}`));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cellEl = document.createElement('div');
        const inUse = n === 1 ? true : usedSet.has(`${r},${c}`);
        // Status is never colour alone: unused cells are faded and border-
        // less, used-but-unfound get a dashed outline, found get a check.
        cellEl.className = 'gt-cell ' + (inUse ? 'in-use' : 'unused');
        cellEl.dataset.pos = `${r},${c}`;
        grid.appendChild(cellEl);
      }
    }
    updateProgress();
  }

  function updateProgress() {
    const total = targetCells.length;
    const got = foundKeys.size;
    const pct = total ? Math.round((got / total) * 100) : 0;
    for (const el of root.querySelectorAll('[data-progress]')) {
      el.textContent = `${got} / ${total}`;
    }
    for (const el of root.querySelectorAll('[data-progress-pct]')) {
      el.textContent = pct + '%';
    }
    const bar = $('gameProgressBar');
    if (bar) bar.style.width = pct + '%';
  }

  function onStageClick(ev) {
    if (!target || !startedAt) return;
    const hit = cellAt(ev.clientX, ev.clientY);
    if (!hit) return;
    const key = `${hit.x},${hit.y}`;
    const cell = targetCells.find(f => f.x === hit.x && f.y === hit.y);
    if (!cell) {
      beep('wrong');
      const m = markCell(hit.x, hit.y, 'wrong');
      setTimeout(() => m.remove(), 420);
      return;
    }
    if (foundKeys.has(key)) {
      // Re-clicking something already found is not a mistake.
      const m = markCell(hit.x, hit.y, 'again');
      setTimeout(() => m.remove(), 320);
      return;
    }
    foundKeys.add(key);
    beep('correct');
    markCell(hit.x, hit.y, 'found');
    const pos = `${cell.sub.piece_row},${cell.sub.piece_col}`;
    const gt = $('gameTargetGrid').querySelector(`[data-pos="${pos}"]`);
    if (gt) gt.classList.add('found');
    updateProgress();
    if (foundKeys.size >= targetCells.length) finish();
  }

  // ---------- finish ----------
  async function finish() {
    cancelAnimationFrame(rafId);
    const localMs = performance.now() - startedAt;
    beep('done');
    show('result');

    $('gameResultTime').textContent = fmtSec(localMs);
    $('gameResultArtwork').textContent = target.art_title || tr('untitledArtwork');
    $('gameResultNote').textContent = '';
    $('gameResultRetry').hidden = true;
    $('gameConfetti').innerHTML = '';

    if (!me.id) {
      $('gameResultNote').textContent = tr('gameAnonNoRecord');
      return;
    }
    if (!sessionId) {
      $('gameResultNote').textContent = tr('gameRecordFailed');
      $('gameResultRetry').hidden = true;   // no session to retry against
      return;
    }
    await submitResult();
  }

  async function submitResult() {
    const note = $('gameResultNote');
    note.textContent = tr('gameSaving');
    try {
      const { data, error } = await sb.rpc('finish_game', { p_session_id: sessionId });
      if (error) throw error;
      const rankingOn = settings.gameRankingEnabled !== false;
      // Server time is the official one; show it rather than the local clock.
      $('gameResultTime').textContent = fmtSec(data.elapsed_ms);
      const bits = [];
      if (data.first_record) bits.push(tr('gameFirstRecord'));
      else if (data.personal_best) bits.push(tr('gamePersonalBest'));
      if (rankingOn && data.rank <= 3) {
        bits.push([tr('gameGold'), tr('gameSilver'), tr('gameBronze')][data.rank - 1]);
        confetti();
      } else if (data.personal_best || data.first_record) {
        confetti();
      }
      if (rankingOn) bits.push(tr('gameRankOf', { rank: data.rank, players: data.players }));
      note.textContent = bits.join(' · ');
      $('gameResultRetry').hidden = true;
      // The list behind us is now stale for this artwork.
      await refreshStats();
    } catch (e) {
      console.error('game: finish_game failed:', e);
      note.textContent = tr('gameRecordFailed');
      $('gameResultRetry').hidden = false;
    }
  }

  async function refreshStats() {
    statsByArtwork = await loadStats(project.id);
  }

  // Canvas confetti — no library, and it does nothing when the visitor asked
  // for reduced motion.
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = $('gameConfetti');
    const c = document.createElement('canvas');
    const w = host.clientWidth || 320, h = host.clientHeight || 240;
    c.width = w; c.height = h;
    host.appendChild(c);
    const cx = c.getContext('2d');
    const colors = ['#1A3C2B', '#9EFFBF', '#E8B84B', '#C0522F', '#5B8DFF'];
    const bits = Array.from({ length: 70 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * 80, y: h / 3,
      vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 5,
      s: 4 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI,
    }));
    let frames = 0;
    (function draw() {
      cx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.vy += 0.18; b.x += b.vx; b.y += b.vy; b.rot += 0.1;
        cx.save(); cx.translate(b.x, b.y); cx.rotate(b.rot);
        cx.fillStyle = b.c; cx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.6);
        cx.restore();
      }
      if (++frames < 150) requestAnimationFrame(draw); else c.remove();
    })();
  }

  // ---------- leaving a game ----------
  async function quitGame() {
    const ok = await confirmDialog(tr('gameQuitMessage'), {
      title: tr('gameQuitTitle'), okLabel: tr('gameQuitOk'),
    });
    if (!ok) return;
    endPlay();
  }
  function endPlay() {
    cancelAnimationFrame(rafId);
    startedAt = 0;
    sessionId = null;
    show('list');
    renderList(true);
    restoreListPosition();
  }

  function restoreListPosition() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch (e) {}
    if (!saved || saved.projectId !== project.id) return;
    const card = $('gameList').querySelector(`[data-artwork-id="${saved.artworkId}"]`);
    if (card) {
      card.scrollIntoView({ block: 'center' });
      card.classList.add('just-played');
      setTimeout(() => card.classList.remove('just-played'), 1600);
    } else if (saved.scrollY) {
      window.scrollTo(0, saved.scrollY);
    }
  }

  // ---------- input wiring ----------
  function wireStage() {
    // Called once at boot, before any game has been built — so this reads the
    // element itself rather than relying on buildMosaic() having run.
    stage = $('gameStage');
    if (!stage) return;
    let dragging = false, moved = false, lastX = 0, lastY = 0, pinch = 0;

    stage.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      panX += dx; panY += dy; lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    });
    const up = e => {
      if (!dragging) return;
      dragging = false;
      try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
      if (!moved) onStageClick(e);
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', () => { dragging = false; });

    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // Pinch: two fingers on the stage only, so the browser's own page zoom
    // elsewhere is untouched (no user-scalable=no anywhere on this site).
    stage.addEventListener('touchstart', e => {
      if (e.touches.length === 2) pinch = dist(e.touches);
    }, { passive: true });
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

    function dist(t) {
      return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    }

    // Layout changes must not reset the game: only the framing is redone.
    let resizeTimer = 0;
    addEventListener('resize', () => {
      if (!document.body.classList.contains('game-playing')) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { applyTransform(); }, 120);
    });
  }

  // ---------- boot ----------
  async function boot() {
    try { muted = localStorage.getItem('weavo.gameMuted') === '1'; } catch (e) {}

    settings = await getSiteSettings().catch(() => ({}));
    setMuted(settings.gameSoundDefault === false ? true : muted);

    if (settings.gameEnabled === false) {
      show('off');
      return;
    }

    project = await loadCampaign();
    if (!project) { show('nocampaign'); return; }
    $('gameCampaignTitle').textContent = project.title || '';

    const [cellsRes, filledRows] = await Promise.all([
      loadProjectCells(project),
      loadFilledCells(project),
    ]);
    cells = (cellsRes && cellsRes.cells) || [];
    filled = filledRows;
    if (!filled.length) { show('nocampaign'); return; }

    // Artwork targets = the distinct artworks owning a filled cell.
    const usedCount = new Map();
    for (const f of filled) {
      const id = artworkKeyOf(f.sub);
      usedCount.set(id, (usedCount.get(id) || 0) + 1);
    }
    const rows = await loadArtworks([...usedCount.keys()]);
    artworks = rows
      .filter(a => !isUserBlocked(a.author_id))
      .map(a => ({ ...a, _used: usedCount.get(a.id) || 0 }))
      .filter(a => a._used > 0)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    statsByArtwork = settings.gameRankingEnabled === false ? {} : await loadStats(project.id);

    wireStage();
    renderList(true);
    // Straight into the artwork list — the page itself is the introduction.
    show('list');
    restoreListPosition();
  }

  // ---------- controls ----------
  $('gameListMore').onclick = () => renderList(false);
  $('gameSearch').oninput = e => { searchTerm = e.target.value.trim(); renderList(true); };
  $('gameQuit').onclick = quitGame;
  $('gameResultBack').onclick = endPlay;
  $('gameResultRetry').onclick = submitResult;
  $('gameZoomIn').onclick = () => zoomBy(1.4);
  $('gameZoomOut').onclick = () => zoomBy(1 / 1.4);
  $('gameZoomReset').onclick = fitAll;
  for (const b of root.querySelectorAll('[data-mute]')) b.onclick = () => setMuted(!muted);
  $('gameTimer').onclick = function () {
    const on = this.dataset.hidden === '1';
    this.dataset.hidden = on ? '' : '1';
    this.textContent = on ? fmtTime(performance.now() - startedAt) : '––:––';
  };
  // The bottom sheet on phones: drag the handle, or tap it to toggle.
  const sheet = $('gameSheet');
  if (sheet) {
    // Sizes are set inline rather than by a class: the collapsed values live
    // in game.css, and these two are the only thing the handle changes.
    $('gameSheetHandle').onclick = () => {
      const open = !sheet.classList.contains('expanded');
      sheet.classList.toggle('expanded', open);
      sheet.style.maxHeight = open ? '78vh' : '';
      const img = $('gameTargetImg');
      if (img) img.style.maxHeight = open ? '46vh' : '';
    };
  }
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('game-playing')) quitGame();
  });

  authReady.then(boot).catch(err => {
    console.error('game: boot failed:', err);
    show('nocampaign');
  });
})();
