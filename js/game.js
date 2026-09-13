// "Find the piece" game (/{lang}/game): pick an artwork that has pieces in
// the current campaign's mosaic, then find those pieces inside the mosaic.
//
// Needs js/color-engine.js (luminance, which common.js's openCellPainter
// calls), js/common.js (sb, loadProjectCells, openCellPainter, fetchAllRows,
// cdnUrl, toast, getSiteSettings, confirmDialog, isUserBlocked,
// bindArtworkLightbox, miniAvatarEl), js/auth.js (me, authReady,
// openAuthModal) and js/lightbox.js (openLightbox, for the artwork a card
// links to) — in that order.
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
  // A bare "533.06" is hard to read as a duration — past a minute people
  // think in minutes. Under one it stays a plain seconds figure.
  const fmtSec = ms => {
    const total = Math.max(0, ms) / 1000;
    if (total < 60) return tr('gameDurSec', { s: total.toFixed(2) });
    const m = Math.floor(total / 60);
    return tr('gameDurMin', { m, s: (total - m * 60).toFixed(2) });
  };
  const artworkKeyOf = sub => (sub.parent_id != null ? sub.parent_id : sub.id);
  // Fisher-Yates: every ordering equally likely, in place, no copy of a
  // few hundred rows.
  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

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
  // Two things had to be fixed here after testing on a phone:
  //
  // 1. The wrong-answer blip was a 180 Hz sine. Phone speakers roll off hard
  //    below ~300 Hz, so it was inaudible on exactly the device most people
  //    play on. It is now a higher square tone, which also carries far more
  //    harmonics than a sine at the same gain.
  // 2. Mobile browsers only let an AudioContext start inside a user gesture,
  //    and a context created outside one stays suspended forever. unlockAudio()
  //    is called from the "start game" tap for that reason.
  let audioCtx = null;
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      // A silent one-sample buffer: iOS treats the context as genuinely
      // started only once something has actually played through it.
      const src = audioCtx.createBufferSource();
      src.buffer = audioCtx.createBuffer(1, 1, 22050);
      src.connect(audioCtx.destination);
      src.start(0);
    } catch (e) { console.error('game: audio unlock failed:', e); }
  }
  function beep(kind) {
    if (muted) return;
    try {
      if (!audioCtx) unlockAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      let peak = 0.22, stop = 0.18;
      if (kind === 'correct') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.setValueAtTime(990, t + 0.07);
      } else if (kind === 'done') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(784, t + 0.09);
        osc.frequency.setValueAtTime(1046, t + 0.18);
        peak = 0.26; stop = 0.36;
      } else if (kind === 'tick') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, t);
        peak = 0.16; stop = 0.1;
      } else if (kind === 'go') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1320, t + 0.08);
        peak = 0.24; stop = 0.26;
      } else {
        // Wrong: a short falling buzz, well inside what a phone can produce.
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.16);
        peak = 0.18;            // square is louder per unit gain than sine
        stop = 0.2;
      }
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + stop);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + stop + 0.02);
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
      + '(id,parent_id,piece_row,piece_col,piece_n,avg_r,avg_g,avg_b,micro_thumb,thumb_url,image_url)';
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

    // The thumbnail opens the artwork the way every other grid on the site
    // does — you should be able to look at what you are about to hunt for
    // without leaving the list. The link is real so it still indexes and
    // still works with Ctrl-click.
    const thumbLink = document.createElement('a');
    thumbLink.className = 'game-card-thumb-link';
    thumbLink.href = artworkUrl(a.id);
    thumbLink.setAttribute('aria-label', a.art_title || tr('untitledArtwork'));
    const thumb = document.createElement('img');
    thumb.className = 'game-card-thumb';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    thumb.src = cdnUrl(a.thumb_url || a.image_url);
    thumb.alt = '';
    thumbLink.appendChild(thumb);
    bindArtworkLightbox(thumbLink, a.id);
    card.appendChild(thumbLink);

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

  // ---------- hall of fame ----------
  // Site-wide standings, medals not times: a time only compares within one
  // artwork. Quietly stays hidden when the RPC isn't applied yet or nobody
  // has a podium finish — an empty podium says less than no podium.
  async function renderHall() {
    const box = $('gameHall');
    const list = $('gameHallList');
    if (!box || !list) return;
    if (settings.gameRankingEnabled === false) return;
    let rows = null;
    try {
      const { data, error } = await sb.rpc('game_top_players', { p_limit: 3 });
      if (error) {
        if (error.code !== 'PGRST202' && error.code !== '42883') console.error('game: top players error:', error);
        return;
      }
      rows = data;
    } catch (e) { console.error('game: top players threw:', e); return; }
    if (!Array.isArray(rows) || !rows.length) return;

    list.innerHTML = '';
    rows.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'game-hall-row';
      const rank = document.createElement('span');
      rank.className = 'gh-rank';
      rank.textContent = ['🥇', '🥈', '🥉'][i] || (i + 1);
      const name = p.username || tr('anonymous');
      const who = document.createElement('div');
      who.className = 'gh-who';
      who.appendChild(miniAvatarEl(name, p.avatar_url, p.user_id, 'gh-avatar'));
      const link = document.createElement('a');
      link.className = 'gh-name';
      link.href = profileUrl(p.username || p.user_id);
      link.textContent = name;
      who.appendChild(link);
      const medals = document.createElement('span');
      medals.className = 'gh-medals';
      for (const [icon, n, key] of [['🥇', p.gold, 'gameGold'], ['🥈', p.silver, 'gameSilver'], ['🥉', p.bronze, 'gameBronze']]) {
        const m = document.createElement('span');
        m.className = 'gh-medal';
        m.title = tr(key);
        m.textContent = icon + ' ' + (Number(n) || 0);
        medals.appendChild(m);
      }
      li.append(rank, who, medals);
      list.appendChild(li);
    });
    box.hidden = false;
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

    // Still inside the tap that confirmed the dialog — the only moment a
    // mobile browser will let audio start.
    unlockAudio();

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
    weavoMark('game:buildMosaic');
    stage = $('gameStage');
    canvas = $('gameCanvas');
    // How many canvas pixels one cell gets. This is the ceiling on how
    // sharp the mosaic can EVER be: zooming only scales this bitmap up, so
    // a cell drawn at 24px stayed soft however far anyone zoomed — which is
    // exactly what it was reported as ("확대해도 선명해지지 않는다").
    //
    // The detail pass has much more to work with than 24px: it crops a
    // piece out of the parent's 480px thumbnail, so an n=5 cut leaves 96px
    // and n=7 leaves 68px per piece. Anything under that was throwing
    // source resolution away.
    //
    // Sized by AREA rather than a flat cap, because the cost is width x
    // height x 4 bytes and a campaign can be 10,000 cells: a budget keeps
    // the worst case bounded whatever the shape. Phones get a smaller one —
    // 48MB of canvas is fine on a desktop and is not on a 3GB handset
    // (this site already had iOS reloading itself under memory pressure).
    // NOT named cells: that is the module-level grid array this function
    // hands to openCellPainter a few lines down, and shadowing it made the
    // painter receive a number ("cells is not iterable") — buildMosaic threw
    // and the game sat on "준비하고 있습니다" forever.
    const cellCount = Math.max(1, project.width * project.height);
    // innerWidth can be 0 for a window that is hidden or not laid out yet,
    // and a 0 must not be read as "phone" — fall back to the screen width.
    const vw = window.innerWidth || screen.width || 1024;
    const smallDevice = (navigator.deviceMemory && navigator.deviceMemory < 4) || vw < 640;
    const budget = smallDevice ? 5e6 : 12e6;   // canvas pixels (x4 bytes)
    cellPx = Math.max(8, Math.min(64, Math.floor(Math.sqrt(budget / cellCount))));
    canvas.width = project.width * cellPx;
    canvas.height = project.height * cellPx;
    ctx = canvas.getContext('2d');
    // Every cell is a downscale from a 480px thumbnail; the default
    // ('low') visibly muddies that.
    ctx.imageSmoothingQuality = 'high';

    detailDone.clear();
    miniPainted = false;
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

  // ---------- detail pass ----------
  // micro_thumb is 16x16 — fine while the whole mosaic is on screen, useless
  // once someone zooms in to compare a cell against the artwork panel. Every
  // piece row carries its parent's 480px thumb_url plus its own piece_row/col,
  // so the real picture can be cropped straight onto the canvas. The artwork
  // list already fetched these thumbnails, so they come from the browser cache.
  const thumbCache = new Map();          // url -> Image
  const detailDone = new Set();          // cells already repainted
  let detailTimer = 0;
  function thumbFor(url) {
    if (thumbCache.has(url)) return thumbCache.get(url);
    const img = new Image();
    img.onload = () => { clearTimeout(detailTimer); detailTimer = setTimeout(refreshDetail, 0); };
    img.onerror = () => { thumbCache.set(url, null); };
    img.src = url;
    thumbCache.set(url, img);
    return img;
  }
  function scheduleDetail() {
    clearTimeout(detailTimer);
    detailTimer = setTimeout(refreshDetail, 90);
  }
  function refreshDetail() {
    weavoMark('game:detail');
    if (!ctx || !stage) return;
    // Below this the cell is a few pixels on screen and the 16x16 micro
    // thumb already covers it. Lowered from 10 so the real artwork appears
    // while still zoomed out a fair way, not only once you are close.
    if (cellPx * scale < 6) return;
    const r = stage.getBoundingClientRect();
    const size = cellPx * scale;
    for (const fc of filled) {
      const key = fc.x + ',' + fc.y;
      if (detailDone.has(key)) continue;
      const left = panX + fc.x * cellPx * scale;
      const top = panY + fc.y * cellPx * scale;
      if (left + size < 0 || left > r.width || top + size < 0 || top > r.height) continue;
      const url = fc.sub.thumb_url || fc.sub.image_url;
      if (!url) { detailDone.add(key); continue; }
      const img = thumbFor(cdnUrl(url));
      if (!img || !img.complete || !img.naturalWidth) continue;   // repaints on load
      const n = (fc.sub.piece_n && fc.sub.piece_n > 1) ? fc.sub.piece_n : 1;
      const sw = img.naturalWidth / n, sh = img.naturalHeight / n;
      const sx = (fc.sub.piece_col || 0) * sw, sy = (fc.sub.piece_row || 0) * sh;
      try {
        ctx.drawImage(img, sx, sy, sw, sh, fc.x * cellPx, fc.y * cellPx, cellPx, cellPx);
        detailDone.add(key);
        miniPainted = false;   // canvas changed; the minimap is stale
      } catch (e) { detailDone.add(key); }   // broken image: keep the micro thumb
    }
  }

  // ---------- minimap ----------
  // Zoomed in, the mosaic gives no sense of place. The minimap is the whole
  // canvas shrunk down with a box showing what is on screen; it appears only
  // when something is actually off screen, so the full view stays uncluttered.
  let miniPainted = false;
  function paintMinimap() {
    const mm = $('gameMinimapCanvas');
    if (!mm || !canvas.width) return;
    const w = 92;
    mm.width = w;
    mm.height = Math.max(1, Math.round(w * (canvas.height / canvas.width)));
    const mctx = mm.getContext('2d');
    mctx.clearRect(0, 0, mm.width, mm.height);
    mctx.drawImage(canvas, 0, 0, mm.width, mm.height);
    miniPainted = true;
  }
  function updateMinimap() {
    const box = $('gameMinimap');
    const view = $('gameMinimapView');
    if (!box || !view || !stage || !canvas.width) return;
    const r = stage.getBoundingClientRect();
    // Visible slice of the canvas, as a 0..1 fraction.
    const vw = (r.width / scale) / canvas.width;
    const vh = (r.height / scale) / canvas.height;
    if (vw >= 1 && vh >= 1) { box.hidden = true; return; }   // all of it is on screen
    if (!miniPainted) paintMinimap();
    box.hidden = false;
    const vx = (-panX / scale) / canvas.width;
    const vy = (-panY / scale) / canvas.height;
    const pct = n => (Math.max(0, Math.min(1, n)) * 100) + '%';
    view.style.left = pct(vx);
    view.style.top = pct(vy);
    view.style.width = pct(Math.min(vw, 1 - Math.max(0, vx)));
    view.style.height = pct(Math.min(vh, 1 - Math.max(0, vy)));
  }

  function applyTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    const layer = $('gameMarks');
    layer.style.transform = canvas.style.transform;
    $('gameZoomLevel').textContent = Math.round(scale * 100) + '%';
    updateMinimap();
    scheduleDetail();
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

  // ---------- sector hint ----------
  // Splits the mosaic into a coarse grid and lights up one sector that still
  // holds a piece. It narrows ~5,000 cells to a few hundred — enough to be
  // findable, not enough to be given away. Everyone gets it on the same
  // terms, so records stay comparable.
  // Sectors are SQUARE in cells, so the highlighted area reads as a square on
  // screen and fills the stage evenly when the hint zooms to it. A fixed 6x6
  // split made them as lopsided as the campaign itself (58x86 gave sectors
  // half as wide as they were tall). Instead the side is fixed and the count
  // follows the mosaic's own proportions.
  const HINT_TARGET_SECTORS = 36;
  function hintSectorSide() {
    const area = project.width * project.height;
    return Math.max(4, Math.round(Math.sqrt(area / HINT_TARGET_SECTORS)));
  }
  let hintTimer = 0;
  let hintCount = 0;
  function showHint() {
    if (!target || !startedAt) return;
    const left = targetCells.filter(fc => !foundKeys.has(fc.x + ',' + fc.y));
    if (!left.length) return;
    const pick = left[(Math.random() * left.length) | 0];
    const side = hintSectorSide();
    const cols = Math.max(1, Math.ceil(project.width / side));
    const rows = Math.max(1, Math.ceil(project.height / side));
    // The mosaic rarely divides evenly by the side, so the last column and row
    // would be stubs — and a stub is not square. Slide those back inside
    // instead: every sector is side x side, the edge ones just overlap their
    // neighbour. The piece is still inside the box either way, and "roughly
    // here" is all this promises.
    const sc = Math.min(cols - 1, Math.floor(pick.x / side));
    const sr = Math.min(rows - 1, Math.floor(pick.y / side));
    const ox = Math.max(0, Math.min(sc * side, project.width - side));
    const oy = Math.max(0, Math.min(sr * side, project.height - side));
    const sw = Math.min(side, project.width);
    const sh = Math.min(side, project.height);
    const box = document.createElement('div');
    box.className = 'game-hint-box';
    box.style.left = (ox * cellPx) + 'px';
    box.style.top = (oy * cellPx) + 'px';
    box.style.width = (sw * cellPx) + 'px';
    box.style.height = (sh * cellPx) + 'px';
    // Clear any box still on screen first: clearTimeout alone cancelled the
    // removal but left the element, so repeated hints piled up.
    for (const old of $('gameMarks').querySelectorAll('.game-hint-box')) old.remove();
    $('gameMarks').appendChild(box);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => box.remove(), 3500);

    // Move the view onto that sector and zoom so it fills the stage. Being
    // told where to look is no help if you then have to find it by hand.
    const r = stage.getBoundingClientRect();
    const boxW = sw * cellPx, boxH = sh * cellPx;
    const fit = Math.min(r.width / boxW, r.height / boxH) * 0.88;
    scale = Math.max(0.2, Math.min(40, fit));
    panX = r.width / 2 - (ox + sw / 2) * cellPx * scale;
    panY = r.height / 2 - (oy + sh / 2) * cellPx * scale;
    applyTransform();
    beep('tick');
    hintCount++;
    const cost = Math.max(0, Number(settings.gameHintPenaltySec) || 0);
    paintTimers();   // the clock jumps by the penalty right away
    toast(cost ? tr('gameHintCost', { n: hintCount, sec: cost }) : tr('gameHintShown'));
    // The count that decides the penalty is the server's, not this one —
    // a number the browser reports could simply stay at zero.
    if (sessionId) {
      sb.rpc('use_hint', { p_session_id: sessionId })
        .then(({ error }) => { if (error) console.error('game: use_hint error:', error); });
    }
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
    hintCount = 0;
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
        beep(i === steps.length - 1 ? 'go' : 'tick');
        el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
        i++;
        setTimeout(step, 700);
      };
      step();
    });
  }

  // The HUD clock and the panel clock are two different elements — only the
  // HUD one was being written, so on desktop the timer sat at 00:00.00 for
  // the whole game. Both are updated, and both show the penalty already
  // added: the number on screen is the number that will be recorded.
  function penaltyMs() {
    return hintCount * (Math.max(0, Number(settings.gameHintPenaltySec) || 0)) * 1000;
  }
  function paintTimers() {
    const text = fmtTime(performance.now() - startedAt + penaltyMs());
    for (const el of root.querySelectorAll('.game-timer')) {
      if (el.dataset.hidden !== '1') el.textContent = text;
    }
  }
  // setInterval, not requestAnimationFrame: rAF stops in a hidden tab, so the
  // clock would freeze mid-game if someone switched away and came back to a
  // stale number. 50ms is smooth enough for a 1/100s readout and a third of
  // the work of 60fps. Elapsed time itself always comes from performance.now(),
  // so the displayed value is right no matter how often this runs.
  function tick() {
    clearInterval(rafId);
    paintTimers();
    rafId = setInterval(() => { if (startedAt) paintTimers(); }, 50);
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
    clearInterval(rafId);
    const localMs = performance.now() - startedAt;
    beep('done');
    show('result');

    $('gameResultTime').textContent = fmtSec(localMs);   // includes its own unit
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
      if (data.hints > 0 && data.penalty_ms > 0) {
        bits.push(tr('gameHintPenalty', { n: data.hints, sec: Math.round(data.penalty_ms / 1000) }));
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
    clearInterval(rafId);
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
    // In a shuffled list the artwork just played can sit past the first
    // page, so render forward until it exists (bounded by the list itself).
    while (!$('gameList').querySelector(`[data-artwork-id="${saved.artworkId}"]`)
           && listRendered < visibleArtworks().length) {
      renderList(false);
    }
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
      .filter(a => a._used > 0);
    // Shuffled, so the same few newest artworks are not what everyone plays
    // — and so a second visit is a different list. Once per load, never
    // mid-session: "더 보기" pages through this array, and reshuffling
    // between pages would repeat some artworks and hide others.
    if (settings.gameRandomOrder !== false) shuffleInPlace(artworks);
    else artworks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Too few artworks to hunt in: say so instead of opening a list that
    // cannot produce a meaningful time. start_game refuses the same case,
    // so this is the polite half of a rule the server also enforces.
    const minWorks = Math.max(0, Number(settings.gameMinArtworks) || 0);
    if (artworks.length < minWorks) {
      const note = $('gameTooFewText');
      if (note) note.textContent = tr('gameTooFew', { have: artworks.length, need: minWorks });
      show('toofew');
      return;
    }

    statsByArtwork = settings.gameRankingEnabled === false ? {} : await loadStats(project.id);

    wireStage();
    renderList(true);
    renderHall();   // its own request; the list never waits for it
    // A ?artwork= link (from a profile's medal strip) opens that artwork's
    // start dialog directly — but only if it is still in the live campaign,
    // because a medal outlives the campaign it was won in.
    // Straight into the artwork list — the page itself is the introduction.
    show('list');
    restoreListPosition();
    openRequestedArtwork();
  }

  // Runs after the list exists so the lookup uses the same rows the list
  // was built from.
  function openRequestedArtwork() {
    let wanted = null;
    try { wanted = new URLSearchParams(location.search).get('artwork'); } catch (e) {}
    if (!wanted) return;
    const a = artworks.find(x => String(x.id) === String(wanted));
    if (!a) { toast(tr('gameArtworkNotHere')); return; }
    confirmStart(a);
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
  for (const b of root.querySelectorAll('[data-hint]')) b.onclick = showHint;
  for (const b of root.querySelectorAll('[data-mute]')) b.onclick = () => {
    const next = !muted;
    if (!next) unlockAudio();   // unmuting is a gesture: use it to open audio
    setMuted(next);
  };
  for (const el of root.querySelectorAll('.game-timer')) {
    el.onclick = function () {
      const showing = this.dataset.hidden !== '1';
      this.dataset.hidden = showing ? '1' : '';
      if (showing) this.textContent = '––:––'; else paintTimers();
    };
  }
  // The bottom sheet on phones: drag the handle, or tap it to toggle.
  // ---------- bottom sheet: drag it, the way a sheet is expected to move ----------
  // Sizes are set inline rather than by a class: the collapsed values live in
  // game.css and these two are the only thing the sheet changes. A tap still
  // toggles (it is the same gesture with no distance), so nothing is lost for
  // someone using a keyboard or a mouse.
  const sheet = $('gameSheet');
  const handle = $('gameSheetHandle');
  if (sheet && handle) {
    const COLLAPSED = 34, EXPANDED = 78;    // vh
    let dragging = false, startY = 0, startVh = COLLAPSED, movedPx = 0;
    const vh = px => (px / window.innerHeight) * 100;

    function setHeight(heightVh, animate) {
      // Transitions fight a finger that is still moving, so they are only on
      // for the release.
      sheet.style.transition = animate ? '' : 'none';
      sheet.style.maxHeight = heightVh + 'vh';
      // The artwork's size is the .expanded rule's job (game.css): open means
      // one column with a big picture, closed means artwork left / numbers right.
      sheet.classList.toggle('expanded', heightVh > (COLLAPSED + EXPANDED) / 2);
    }

    handle.addEventListener('pointerdown', e => {
      dragging = true; movedPx = 0;
      startY = e.clientY;
      startVh = sheet.classList.contains('expanded') ? EXPANDED : COLLAPSED;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dy = startY - e.clientY;            // up is positive
      movedPx = Math.max(movedPx, Math.abs(dy));
      setHeight(Math.min(EXPANDED, Math.max(COLLAPSED, startVh + vh(dy))), false);
    });
    const endDrag = e => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      const dy = startY - e.clientY;
      // Under ~6px of travel this was a tap, not a drag: toggle. Otherwise
      // settle to whichever end the finger was heading for.
      const open = movedPx < 6 ? !sheet.classList.contains('expanded') : dy > 0;
      setHeight(open ? EXPANDED : COLLAPSED, true);
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', () => { dragging = false; });
    // The handle is a real button, so Enter/Space already fire a click.
    handle.addEventListener('click', e => { if (movedPx >= 6) e.preventDefault(); });
  }
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('game-playing')) quitGame();
  });

  authReady.then(boot).catch(err => {
    console.error('game: boot failed:', err);
    show('nocampaign');
  });
})();
