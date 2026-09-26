// The sky page (/{lang}/stars).
//
// One panorama (user decision 2026-09-26): a photograph of the night sky
// (sky/night.webp) fitted to the height of the screen and dragged sideways,
// with the thirteen constellations of js/constellations.js laid on it as
// painted, translucent animals (js/sky-figures.js). Every finished artwork
// lights the next star. Constellations already finished are bright and take
// their own colour, the one being filled shows where its next star goes,
// and the ones still ahead wait as faint ghosts. A caption card names the
// chosen constellation and steps through them; "크게 보기" fills the screen
// with the same sky.
//
// PERFORMANCE is part of this page's job (2026-09-22, "버벅거린다"). There
// are NO SVG filters: feGaussianBlur re-runs whenever what it wraps changes.
// Halos are radial gradients, a constellation's state is the opacity of its
// painting. Only ANIM_BUDGET sparkles breathe, the constellation being
// filled first. The photograph is one <img>, and everything else is one
// <svg> in the photograph's own pixels laid over it, so a resize changes two
// CSS sizes and redraws nothing.
//
// Needs sb, me, tr, common.js (getSiteSettings/toast/openArtworkById/
// artworkUrl/cdnUrl), lightbox.js (the artwork a star opens),
// constellations.js (which star goes where) and sky-figures.js (the
// paintings and where they sit) already loaded.
"use strict";

(function starsPage() {
  const root = document.getElementById('starsPage');
  if (!root || typeof SKY_FIGURES === 'undefined' || typeof CONSTELLATIONS === 'undefined') return;
  const $ = id => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  let settings = {};
  let viewId = null;          // whose sky is on screen
  let viewName = '';
  let myStars = [];           // the list, already in the order they light
  let groups = [];            // split into constellations
  let current = 0;            // the constellation being filled (index over all skies)
  let skyNo = 0;              // which sky of thirteen is on screen
  let picked = 0;             // 0..12: the one the caption is about
  let hits = [];              // the lit stars, for the hover card

  let uidN = 0;               // unique ids for per-SVG gradients
  const ANIM_BUDGET = 46;     // how many sparkles may breathe at once
  let animLeft = ANIM_BUDGET;

  const FIND = '#FFD98E';     // find the piece — warm
  const COLOR = '#9EC7FF';    // colour by number — cool
  const STAR_R = 6.5;         // a star's size, in the photograph's pixels
  const AR = SKY_W / SKY_H;
  const isMine = () => !!(me.id && viewId === me.id);
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function el(name, attrs) {
    const n = document.createElementNS(SVG, name);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  // A seeded generator: the twinkling pinpricks must land in the same places
  // every time the sky is drawn, or they would reshuffle on every click.
  function rnd(seed) {
    let s = (seed * 9301 + 49297) % 233280;
    return () => (s = (s * 9301 + 49297) % 233280) / 233280;
  }
  function sparkPath(R) {
    const w = R * 0.19;
    return `M0 ${-R} C ${w} ${-w * 1.7} ${w * 1.7} ${-w} ${R} 0`
         + ` C ${w * 1.7} ${w} ${w} ${w * 1.7} 0 ${R}`
         + ` C ${-w} ${w * 1.7} ${-w * 1.7} ${w} ${-R} 0`
         + ` C ${-w * 1.7} ${-w} ${-w} ${-w * 1.7} 0 ${-R} Z`;
  }
  function resetAnim() { animLeft = ANIM_BUDGET; }
  function breathe(node, delay) {
    if (animLeft <= 0) return node;
    animLeft--;
    node.setAttribute('class', 'st-spark');
    node.style.animationDelay = delay + 's';
    return node;
  }

  // ---------- SVG furniture (gradients only, never filters) ----------
  function skyDefs(svg) {
    const id = 'sky' + (++uidN);
    const defs = el('defs', {});
    svg.appendChild(defs);
    const made = new Map();
    const halo = colour => {
      if (made.has(colour)) return made.get(colour);
      const gid = id + 'h' + made.size;
      const rg = el('radialGradient', { id: gid });
      rg.appendChild(el('stop', { offset: '0', 'stop-color': colour, 'stop-opacity': '.85' }));
      rg.appendChild(el('stop', { offset: '.35', 'stop-color': colour, 'stop-opacity': '.30' }));
      rg.appendChild(el('stop', { offset: '1', 'stop-color': colour, 'stop-opacity': '0' }));
      defs.appendChild(rg);
      const url = `url(#${gid})`;
      made.set(colour, url);
      return url;
    };
    return { halo };
  }
  // A few pinpricks over the photograph that fade in and out on three
  // different clocks, so the sky is never quite still. Three nodes, opacity
  // only. They stay above the horizon (y < 620).
  function twinkles(svg) {
    const r = rnd(11);
    for (let b = 0; b < 3; b++) {
      let d = '';
      for (let i = 0; i < 26; i++) {
        const x = (r() * SKY_W).toFixed(1), y = (r() * 600 + 20).toFixed(1), q = +(r() * 1.1 + .5).toFixed(2);
        d += `M${x} ${y} m${-q} 0 a${q} ${q} 0 1 0 ${q * 2} 0 a${q} ${q} 0 1 0 ${-q * 2} 0 `;
      }
      const p = el('path', { d, fill: '#fff', opacity: .4, class: 'st-tw', 'aria-hidden': 'true' });
      p.style.animationDuration = (6 + b * 1.7).toFixed(1) + 's';
      p.style.animationDelay = (-b * 2.3).toFixed(1) + 's';
      svg.appendChild(p);
    }
  }

  // ---------- one lit star ----------
  function drawStar(parent, x, y, R, star, defs, seedIdx) {
    const colour = star.source === 'find' ? FIND : COLOR;
    // A colouring star earned on the hard board burns a little bigger.
    const k = star.level >= 3 ? 1.22 : star.level >= 2 ? 1.08 : 1;
    const g = el('g', { class: 'st-hit', tabindex: '0', role: 'button' });
    const halo = el('circle', { cx: x, cy: y, r: R * 2.5 * k, fill: defs.halo(colour) });
    // The group places the sparkle; the path inside it breathes. They must be
    // two elements: the breathing is a CSS transform (scale), and a CSS
    // transform REPLACES an SVG transform attribute on the same element —
    // with both on one path every breathing sparkle jumped to the sky's top
    // left corner (2026-09-26).
    const sparkAt = el('g', { transform: `translate(${x} ${y})` });
    const spark = el('path', { d: sparkPath(R * 1.65 * k), fill: colour, opacity: .95 });
    breathe(spark, ((seedIdx * 0.53) % 4).toFixed(2));
    sparkAt.appendChild(spark);
    const burst = el('circle', { cx: x, cy: y, r: R * 1.15 * k, fill: 'none', stroke: '#fff', 'stroke-width': 1.1, opacity: 0, class: 'st-burst' });
    const core = el('circle', { cx: x, cy: y, r: R * 0.36 * k, fill: '#fff' });
    const hit = el('circle', { cx: x, cy: y, r: Math.max(16, R * 2.4), fill: 'transparent' });
    g.append(halo, sparkAt, burst, core, hit);

    const title = star.art_title || tr('untitledArtwork');
    const game = tr(star.source === 'find' ? 'starsGameFind' : 'starsGameColor');
    g.setAttribute('aria-label', `${title} · ${star.author_name || tr('anonymous')} · ${game}`);
    const open = () => {
      if (!star.alive) { toast(tr('starsGoneArtwork')); return; }
      if (typeof openArtworkById === 'function') openArtworkById(star.artwork_id);
      else location.href = artworkUrl(star.artwork_id);
    };
    g.addEventListener('click', open);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    parent.appendChild(g);
    return { g, star, x, y };
  }
  // A slot not lit yet. In the constellation being filled it is a dashed
  // ring, and the NEXT one pulses — that is where the next finished artwork
  // lands. Further ahead it is only a dot, so the sky does not fill up with
  // rings nobody can earn yet.
  function drawSlot(parent, x, y, filling, next, accent) {
    if (!filling) {
      parent.appendChild(el('circle', { cx: x, cy: y, r: 1.9, class: 'st-slot-far' }));
      return;
    }
    parent.append(
      el('circle', { cx: x, cy: y, r: STAR_R * .75, class: 'st-slot-ring' }),
      el('circle', { cx: x, cy: y, r: 2.2, class: 'st-slot-dot' }),
    );
    if (next) {
      const ring = el('circle', { cx: x, cy: y, r: STAR_R * 1.35, class: 'st-next' });
      ring.style.stroke = accent;
      parent.appendChild(ring);
    }
  }

  // ---------- the panorama ----------
  function stateOf(gi) { return gi < current ? 'done' : gi === current ? 'going' : 'locked'; }
  function drawConstellation(svg, k, defs) {
    const gi = skyNo * SKY_SIZE + k;
    const c = constellationShape(gi);
    const f = SKY_FIGURES[c.key];
    if (!f) return;                       // a constellation with no drawing yet
    const [X, Y, S] = f.at;
    const s = S / 100;
    const state = stateOf(gi);
    const got = (groups[gi] && groups[gi].stars) || [];
    const g = el('g', { class: `st-con ${state}` + (k === picked ? ' sel' : ''), 'data-k': k });
    g.style.setProperty('--acc', c.accent);

    // Pressing the constellation (not one of its stars) chooses it.
    const pick = el('rect', { x: X, y: Y, width: S, height: S, class: 'st-con-hit', tabindex: '0', role: 'button' });
    pick.setAttribute('aria-label', tr('starsPickCon', { name: constellationName(gi) }));
    pick.addEventListener('click', () => choose(k, true));
    pick.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(k, true); } });
    g.appendChild(pick);

    // The painted animal: a transparent WebP under /sky/, laid in the same
    // 0–100 box as the stars. A picture that fails to load simply leaves the
    // stars and lines on their own — the stars are the point of the page.
    const fig = el('g', { class: 'st-fig', transform: `translate(${X} ${Y}) scale(${s})`, 'aria-hidden': 'true' });
    if (f.img) {
      const [ix, iy, iw, ih] = f.img.box;
      fig.appendChild(el('image', { href: f.img.src, x: ix, y: iy, width: iw, height: ih, class: 'st-fig-art', preserveAspectRatio: 'xMidYMid meet' }));
    }
    g.appendChild(fig);

    const at = i => [X + c.stars[i][0] * s, Y + c.stars[i][1] * s];
    const lines = el('g', { 'aria-hidden': 'true' });
    c.links.forEach(([a, b], n) => {
      const [x1, y1] = at(a), [x2, y2] = at(b);
      const lit = !!(got[a] && got[b]);
      const line = el('line', { x1, y1, x2, y2, class: 'st-link' + (lit ? ' lit' : '') });
      // Lines draw themselves in, but only in the constellation being filled —
      // a whole sky of lines animating on every visit is noise.
      if (lit && state === 'going') {
        const len = Math.hypot(x2 - x1, y2 - y1);
        line.classList.add('st-line-lit');
        line.style.setProperty('--len', len);
        line.style.strokeDasharray = len;
        line.style.animationDelay = (n * 0.12) + 's';
      }
      lines.appendChild(line);
    });
    g.appendChild(lines);

    c.stars.forEach((_, i) => {
      const [x, y] = at(i);
      if (got[i]) hits.push(drawStar(g, x, y, STAR_R, got[i], defs, gi * 7 + i));
      else drawSlot(g, x, y, state === 'going', state === 'going' && i === got.length, c.accent);
    });

    const L = f.label || [50, 106];
    const t = el('text', { x: X + L[0] * s, y: Y + L[1] * s + 6, class: 'st-con-label', 'aria-hidden': 'true' });
    t.textContent = constellationName(gi);
    if (state === 'going') {
      const n = el('tspan', { class: 'st-con-count', dx: 6 });
      n.textContent = `${got.length}/${c.stars.length}`;
      t.appendChild(n);
    }
    g.appendChild(t);
    svg.appendChild(g);
  }
  function renderSky() {
    const svg = $('stSkyLayer');
    if (!svg) return;
    svg.replaceChildren();
    resetAnim();
    hits = [];
    const defs = skyDefs(svg);
    twinkles(svg);
    // The constellation being filled goes first so its sparkles get the
    // animation budget; then the finished ones, newest first.
    const order = [...Array(SKY_SIZE).keys()].sort((a, b) => {
      const rank = k => { const gi = skyNo * SKY_SIZE + k; return gi === current ? -1e6 : gi < current ? -gi : gi; };
      return rank(a) - rank(b);
    });
    for (const k of order) drawConstellation(svg, k, defs);
    wireTips($('stSkyWrap'), svg, hits);
  }

  // ---------- size, scroll, choose ----------
  // The picture always fills the height. On a wide screen that leaves almost
  // nothing to drag, so it may grow up to 10% taller than the view and lose
  // the empty top of the sky (no drawing starts above y 110).
  let scale = 1;              // CSS pixels per photograph pixel
  function layoutSky() {
    const view = $('stSkyView'), cv = $('stSkyCanvas');
    if (!view || !cv) return;
    const vw = view.clientWidth, vh = view.clientHeight;
    if (!vw || !vh) return;
    const keep = view.scrollWidth > vw ? (view.scrollLeft + vw / 2) / view.scrollWidth : null;
    let h = vh;
    if (vw > 760) {
      const want = vw * 1.3 / AR;
      if (want > h) h = Math.min(want, vh * 1.10);
    }
    const w = Math.round(h * AR);
    cv.style.width = w + 'px';
    cv.style.height = Math.round(h) + 'px';
    cv.style.top = Math.round(vh - h) + 'px';
    scale = h / SKY_H;
    if (keep != null) view.scrollLeft = keep * w - vw / 2;
    edges();
  }
  function centerOn(k, smooth) {
    const f = SKY_FIGURES[constellationShape(skyNo * SKY_SIZE + k).key];
    const view = $('stSkyView');
    if (!f || !view) return;
    const left = Math.max(0, (f.at[0] + f.at[2] / 2) * scale - view.clientWidth / 2);
    if (smooth && !reduceMotion() && view.scrollTo) view.scrollTo({ left, behavior: 'smooth' });
    else view.scrollLeft = left;
  }
  // Fades on the edges say "there is more this way".
  function edges() {
    const view = $('stSkyView'), wrap = $('stSkyWrap');
    if (!view || !wrap) return;
    wrap.classList.toggle('can-l', view.scrollLeft > 4);
    wrap.classList.toggle('can-r', view.scrollLeft + view.clientWidth < view.scrollWidth - 4);
  }
  function choose(k, scroll) {
    picked = Math.max(0, Math.min(SKY_SIZE - 1, k));
    const svg = $('stSkyLayer');
    svg.querySelectorAll('.st-con.sel').forEach(n => n.classList.remove('sel'));
    const g = svg.querySelector(`.st-con[data-k="${picked}"]`);
    if (g) g.classList.add('sel');
    renderCaption();
    if (scroll) centerOn(picked, true);
    rememberScroll();
  }
  function renderCaption() {
    const gi = skyNo * SKY_SIZE + picked;
    const c = constellationShape(gi);
    const got = (groups[gi] && groups[gi].stars) || [];
    const state = stateOf(gi);
    $('stSkyCap').style.setProperty('--cap-accent', c.accent);
    $('stCapTag').textContent = constellationGroup(gi);
    $('stCapNo').textContent = `${picked + 1} / ${SKY_SIZE}`;
    $('stCapName').textContent = constellationName(gi);
    $('stCapLine').textContent = state === 'locked' ? tr('starsConLocked', { n: c.stars.length }) : constellationLine(gi);
    const pips = $('stCapPips');
    pips.replaceChildren();
    c.stars.forEach((_, i) => {
      const p = document.createElement('span');
      const s = got[i];
      p.className = 'st-pip' + (s ? ' on' : '');
      if (s) p.style.setProperty('--pip', s.source === 'find' ? FIND : COLOR);
      pips.appendChild(p);
    });
    $('stCapCount').textContent = state === 'done' ? tr('starsConDone') : `${got.length} / ${c.stars.length}`;
    $('stCapPrev').disabled = picked === 0;
    $('stCapNext').disabled = picked === SKY_SIZE - 1;
  }

  // Dragging with a mouse. Touch already scrolls natively, and the wheel is
  // left alone on purpose: taking it over would trap a mouse user who only
  // wants to scroll the page past the sky (CLAUDE.md §7, the dead-wheel
  // regression).
  function wirePan(view) {
    let down = null, dragged = false;
    view.addEventListener('pointerdown', e => {
      dragged = false;
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = { x: e.clientX, left: view.scrollLeft, id: e.pointerId };
    });
    view.addEventListener('pointermove', e => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x;
      if (!dragged && Math.abs(dx) > 5) {
        dragged = true;
        view.classList.add('dragging');
        try { view.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
        hideHint();
      }
      if (dragged) view.scrollLeft = down.left - dx;
    });
    const end = () => { down = null; view.classList.remove('dragging'); };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    // A drag must not finish as a click on the star it started on.
    view.addEventListener('click', e => {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  // Where the sky was, so a reload or a trip back from an artwork lands on
  // the same stretch of it (CLAUDE.md §7: survive the reload).
  const SCROLL_KEY = 'weavo.stars.view';
  let scrollTimer = 0;
  function rememberScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const view = $('stSkyView');
      if (!view || !view.scrollWidth) return;
      try {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
          who: viewId || '', sky: skyNo, picked, x: view.scrollLeft / view.scrollWidth,
        }));
      } catch (e) { /* private mode */ }
    }, 250);
  }
  function restoreScroll() {
    let nav = '';
    try { nav = performance.getEntriesByType('navigation')[0].type; } catch (e) { /* old browser */ }
    if (nav !== 'reload' && nav !== 'back_forward') return false;
    try {
      const m = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
      if (!m || m.who !== (viewId || '') || m.sky !== skyNo) return false;
      choose(m.picked, false);
      const view = $('stSkyView');
      view.scrollLeft = m.x * view.scrollWidth;
      return true;
    } catch (e) { return false; }
  }

  const HINT_KEY = 'weavo.stars.dragHint';
  function showHint() {
    const h = $('stSkyHint');
    if (!h) return;
    let seen = false;
    try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch (e) { /* private mode */ }
    h.hidden = seen;
  }
  function hideHint() {
    const h = $('stSkyHint');
    if (!h || h.hidden) return;
    h.hidden = true;
    try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* private mode */ }
  }

  // ---------- full screen ----------
  // The same sky, filling the screen: the wrapper becomes fixed and the
  // layout recomputes. Nothing is drawn twice.
  let full = false, scrollLock = '';
  function setFull(on) {
    const wrap = $('stSkyWrap');
    if (!wrap || on === full) return;
    full = on;
    wrap.classList.toggle('full', on);
    $('stSkyBig').hidden = on;
    $('stSkyClose').hidden = !on;
    const html = document.documentElement;
    if (on) {
      scrollLock = html.style.overflow;
      html.style.overflow = 'hidden';
      html.classList.add('st-full-open');
      $('stSkyClose').focus();
    } else {
      html.style.overflow = scrollLock;
      html.classList.remove('st-full-open');
      $('stSkyBig').focus();
    }
    layoutSky();
    centerOn(picked, false);
  }

  // A card that follows whichever star the pointer is over.
  function wireTips(host, svg, list) {
    const old = host.querySelector('.st-tip');
    if (old) old.remove();
    if (!list.length) return;
    const tip = document.createElement('div');
    tip.className = 'st-tip';
    const img = document.createElement('img'); img.alt = '';
    const txt = document.createElement('div'); txt.className = 'st-tip-txt';
    const t1 = document.createElement('div'); t1.className = 'st-tip-title';
    const t2 = document.createElement('div'); t2.className = 'st-tip-by';
    const t3 = document.createElement('div'); t3.className = 'st-tip-game';
    txt.append(t1, t2, t3);
    tip.append(img, txt);
    host.appendChild(tip);

    const show = hit => {
      const s = hit.star;
      t1.textContent = s.art_title || tr('untitledArtwork');
      t2.textContent = s.author_name || tr('anonymous');
      t3.textContent = tr(s.source === 'find' ? 'starsGameFind' : 'starsGameColor')
        + (s.level ? ' · ' + tr(s.level === 1 ? 'cgLevelEasy' : s.level === 3 ? 'cgLevelHard' : 'cgLevelNormal') : '');
      if (s.thumb) { img.src = cdnUrl(s.thumb); img.style.display = ''; } else img.style.display = 'none';
      // getScreenCTM, not a ratio: the sky is scaled and scrolled.
      const panel = host.getBoundingClientRect();
      const m = svg.getScreenCTM();
      let px = 0, py = 0;
      if (m) { const p = svg.createSVGPoint(); p.x = hit.x; p.y = hit.y; const o = p.matrixTransform(m); px = o.x; py = o.y; }
      tip.style.left = (px - panel.left) + 'px';
      tip.style.top = (py - panel.top) + 'px';
      tip.classList.add('on');
    };
    const hide = () => tip.classList.remove('on');
    for (const hit of list) {
      hit.g.addEventListener('pointerenter', () => show(hit));
      hit.g.addEventListener('focus', () => show(hit));
      hit.g.addEventListener('pointerleave', hide);
      hit.g.addEventListener('blur', hide);
    }
  }
  function hideTip() {
    const t = document.querySelector('#stSkyWrap .st-tip.on');
    if (t) t.classList.remove('on');
  }

  // ---------- summary and the skies after the first ----------
  function renderSummary(list) {
    const host = $('stSummary');
    const done = groups.filter(g => g.full).length;
    const p = constellationProgress(list.length);
    const week = Date.now() - 7 * 86400000;
    const recent = list.filter(s => Date.parse(s.earned_at) >= week).length;
    const bits = [tr('starsCount', { n: list.length }), tr('starsConstellationCount', { n: done })];
    if (list.length) bits.push(tr('starsNextIn', { n: p.size - p.have }));
    if (recent) bits.push(tr('starsThisWeek', { n: recent }));
    host.textContent = list.length ? bits.join(' · ') : '';
  }
  // Only once someone has finished all thirteen: one button per sky.
  function renderSkies() {
    const box = $('stSkies');
    if (!box) return;
    const last = Math.floor(current / SKY_SIZE);
    box.replaceChildren();
    if (last === 0) { box.hidden = true; return; }
    for (let n = 0; n <= last; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-sky-pill' + (n === skyNo ? ' on' : '');
      b.setAttribute('aria-pressed', String(n === skyNo));
      b.textContent = tr('conSky', { n: n + 1 });
      b.addEventListener('click', () => {
        if (n === skyNo) return;
        skyNo = n;
        renderSkies();
        renderSky();
        choose(n === last ? current % SKY_SIZE : 0, false);
        centerOn(picked, false);
      });
      box.appendChild(b);
    }
    box.hidden = false;
  }

  // ---------- share ----------
  // The finished constellation on the same patch of the photograph, 1200×630.
  // The photograph is same-origin, so the canvas can still be exported.
  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image failed to load: ' + src));
      i.src = src;
    });
  }
  function skyPhoto() {
    const img = $('stSkyBg');
    if (img && img.complete && img.naturalWidth) return Promise.resolve(img);
    return loadImage(SKY_IMAGE);
  }
  // The animal on the card: its painting (same-origin, so the canvas stays
  // exportable). ctx is already in the figure's 0–100 box. Without the
  // picture the card still carries the stars, the lines and the name.
  async function drawFigure(ctx, f) {
    if (!f.img) return;
    try {
      const art = await loadImage(f.img.src);
      const [ix, iy, iw, ih] = f.img.box;
      // the same fit as preserveAspectRatio="xMidYMid meet" on the page
      const k = Math.min(iw / art.naturalWidth, ih / art.naturalHeight);
      const dw = art.naturalWidth * k, dh = art.naturalHeight * k;
      ctx.drawImage(art, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
    } catch (e) {
      console.warn('stars: share card without the painting:', e);
    }
  }
  async function shareCanvas(gi) {
    const W = 1200, H = 630;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const c = constellationShape(gi);
    const f = SKY_FIGURES[c.key];
    const got = (groups[gi] && groups[gi].stars) || [];
    try {
      const img = await skyPhoto();
      const [X, Y, S] = f.at;
      const sw = Math.min(SKY_W, S * 2.4), sh = sw * H / W;
      const sx = Math.max(0, Math.min(SKY_W - sw, X + S / 2 - sw / 2));
      const sy = Math.max(0, Math.min(SKY_H - sh, Y + S / 2 - sh / 2));
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      ctx.fillStyle = 'rgba(5,8,20,.5)';
      ctx.fillRect(0, 0, W, H);
    } catch (e) {
      console.warn('stars: share card without the photo:', e);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a1024'); bg.addColorStop(1, '#0c1330');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    }
    const S = 4.1, ox = W / 2 - 50 * S, oy = 36;
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(S, S);
    await drawFigure(ctx, f);
    ctx.restore();
    const at = i => [ox + c.stars[i][0] * S, oy + c.stars[i][1] * S];
    ctx.strokeStyle = c.accent; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.shadowColor = c.accent; ctx.shadowBlur = 16;
    for (const [a, b] of c.links) {
      const [x1, y1] = at(a), [x2, y2] = at(b);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    c.stars.forEach((_, i) => {
      const [x, y] = at(i);
      const s = got[i];
      const col = !s ? 'rgba(255,255,255,.2)' : s.source === 'find' ? FIND : COLOR;
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 28;
      ctx.globalAlpha = .22; ctx.beginPath(); ctx.arc(x, y, 20, 0, 7); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    });
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#F4F6FF';
    ctx.font = 'bold 48px Pretendard, sans-serif';
    ctx.fillText(constellationName(gi), W / 2, 518);
    ctx.fillStyle = 'rgba(244,246,255,.78)';
    ctx.font = '24px Pretendard, sans-serif';
    ctx.fillText(constellationLine(gi), W / 2, 558);
    ctx.fillStyle = 'rgba(244,246,255,.55)';
    ctx.font = '20px Pretendard, sans-serif';
    ctx.fillText('weavo.art', W / 2, 600);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  async function shareConstellation() {
    const btn = $('stShare');
    const done = groups.filter(g => g.full);
    if (!done.length) { toast(tr('starsShareNone')); return; }
    // The one in the caption if it is finished, otherwise the newest finished.
    const shown = skyNo * SKY_SIZE + picked;
    const gi = groups[shown] && groups[shown].full ? shown : done[done.length - 1].index;
    btn.disabled = true;
    try {
      const blob = await shareCanvas(gi);
      if (!blob) throw new Error('no image');
      const file = new File([blob], `weavo-constellation-${constellationShape(gi).key}.png`, { type: 'image/png' });
      const text = tr('starsShareText', { name: constellationName(gi) });
      const url = `${location.origin}/${CURRENT_LANG}/stars`;
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, url });
        return;
      }
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; }
        catch (e) { console.warn('stars: clipboard image copy refused:', e); }
      }
      const dl = document.createElement('a');
      dl.href = URL.createObjectURL(blob);
      dl.download = file.name;
      document.body.appendChild(dl); dl.click(); dl.remove();
      setTimeout(() => URL.revokeObjectURL(dl.href), 4000);
      toast(tr(copied ? 'cgCopied' : 'cgShared'));
    } catch (e) {
      if (!e || e.name !== 'AbortError') { console.error('stars: share failed:', e); toast(tr('cgShareFailed')); }
    } finally { btn.disabled = false; }
  }

  // ---------- owner controls ----------
  async function setHidden(on) {
    const box = $('stHide');
    box.disabled = true;
    const { error } = await sb.from('profiles').update({ stars_hidden: on }).eq('id', me.id);
    box.disabled = false;
    if (error) {
      console.error('stars: stars_hidden update failed:', error);
      box.checked = !on;
      toast(tr('starsHideFailed'));
      return;
    }
    toast(tr(on ? 'starsHideOn' : 'starsHideOff'));
  }

  // ---------- data ----------
  async function loadStars(userId) {
    const { data, error } = await sb.rpc('user_star_list', { p_user_id: userId, p_limit: 400 });
    if (error) {
      // The SQL file is hand-run (CLAUDE.md §6): until it is applied the page
      // says so instead of throwing a wall of red at the visitor.
      if (error.code === 'PGRST202' || error.code === '42883') return { missing: true, rows: [] };
      console.error('stars: user_star_list error:', error);
      return { failed: true, rows: [] };
    }
    return { rows: data || [] };
  }

  // ---------- render ----------
  function hideSky() {
    if (full) setFull(false);
    $('stSkyWrap').hidden = true;
    $('stSkies').hidden = true;
  }
  // The sky is shown even with no stars at all — a visitor or a new member
  // sees the thirteen outlines waiting, which is the point of the page.
  function showSky() {
    groups = groupIntoConstellations(myStars);
    const going = groups.findIndex(g => !g.full);
    current = going === -1 ? groups.length : going;
    skyNo = Math.floor(current / SKY_SIZE);
    picked = current % SKY_SIZE;
    $('stSkyWrap').hidden = false;
    renderSkies();
    renderSky();
    layoutSky();
    if (!restoreScroll()) {
      choose(picked, false);
      centerOn(picked, false);
    }
    showHint();
  }
  function setEmpty(lines) {
    const empty = $('stEmpty');
    empty.replaceChildren();
    lines.forEach((text, i) => {
      const p = document.createElement('p');
      if (i) p.className = 'st-empty-hint';
      p.textContent = text;
      empty.appendChild(p);
    });
    empty.hidden = !lines.length;
  }
  function renderMine(res) {
    myStars = res.rows;
    groups = groupIntoConstellations(myStars);
    renderSummary(myStars);
    $('stMineTitle').textContent = isMine() || !viewName
      ? tr('starsMineTitle') : tr('starsOtherTitle', { name: viewName });
    if (res.missing || res.failed) {
      hideSky();
      setEmpty([tr(res.missing ? 'starsOff' : 'starsLoadFailed')]);
      return;
    }
    if (!myStars.length) {
      setEmpty(isMine() ? [tr('starsEmptyMine'), tr('starsEmptyMineHint')] : [tr('starsEmptyOther')]);
    } else setEmpty([]);
    showSky();
  }

  async function load() {
    const params = new URLSearchParams(location.search);
    const wanted = params.get('user');
    viewId = wanted || me.id || null;
    viewName = '';
    const owner = $('stOwner');

    if (!viewId) {
      owner.hidden = true;
      $('stSummary').textContent = '';
      myStars = [];
      setEmpty([tr('starsSignIn')]);
      showSky();
      return;
    }
    if (wanted && wanted !== me.id) {
      const { data } = await sb.from('profiles').select('username,name,stars_hidden').eq('id', wanted).maybeSingle();
      viewName = (data && (data.username || data.name)) || '';
      if (data && data.stars_hidden) {
        hideSky();
        $('stSummary').textContent = '';
        setEmpty([tr('starsHiddenNotice')]);
        owner.hidden = true;
        return;
      }
    }
    owner.hidden = !isMine();
    if (isMine()) {
      const { data } = await sb.from('profiles').select('stars_hidden').eq('id', me.id).maybeSingle();
      $('stHide').checked = !!(data && data.stars_hidden);
    }
    renderMine(await loadStars(viewId));
  }

  // ---------- boot ----------
  (async function boot() {
    settings = await getSiteSettings().catch(() => ({}));
    if (settings.starsEnabled === false) {
      $('stOff').textContent = tr('starsOff');
      $('stOff').hidden = false;
      $('stMineWrap').hidden = true;
      hideSky();
      return;
    }
    const view = $('stSkyView');
    wirePan(view);
    // Only a person moving the sky dismisses the hint — the page's own
    // centring on load scrolls too, and must not count.
    let touched = false;
    for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
      view.addEventListener(ev, () => { touched = true; }, { passive: true });
    }
    view.addEventListener('scroll', () => {
      edges();
      hideTip();
      if (touched) hideHint();
      rememberScroll();
    }, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(() => layoutSky()).observe(view);
    else addEventListener('resize', layoutSky);
    $('stCapPrev').addEventListener('click', () => choose(picked - 1, true));
    $('stCapNext').addEventListener('click', () => choose(picked + 1, true));
    $('stSkyBig').addEventListener('click', () => setFull(true));
    $('stSkyClose').addEventListener('click', () => setFull(false));
    addEventListener('keydown', e => { if (e.key === 'Escape' && full) setFull(false); });
    $('stHide').addEventListener('change', e => setHidden(e.target.checked));
    $('stShare').addEventListener('click', shareConstellation);
    await load();
  })();

  // Signing in or out changes whose sky this is.
  document.addEventListener('weavo:authchange', () => { load(); });
})();
