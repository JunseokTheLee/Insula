// The sky page (/{lang}/stars).
//
// Shape of it (2026-09-21→22, user direction):
//   * the constellation you are WORKING ON fills a big stage in the middle
//   * every constellation you have is a chip under it; picking one stages it
//   * a full-screen view, for every constellation at once
//
// PERFORMANCE (2026-09-22, "버벅거린다"). There are NO SVG filters on this
// page: feGaussianBlur re-runs every time the thing it wraps changes, and
// every star animated, so a phone was doing hundreds of filter passes a
// frame. A radial gradient looks the same and costs nothing once painted.
// The background star field is five <path>s, not 190 <circle>s, and only
// the first ANIM_BUDGET sparkles breathe. Those three drift as one group
// (a Milky Way, user 2026-09-22) — a transform, which costs nothing per
// frame; the constellation above them never moves.
//
// Needs sb, me, tr, common.js (getSiteSettings/toast/openArtworkById/
// profileUrl/cdnUrl), lightbox.js (the artwork a star opens) and
// constellations.js (the shapes) already loaded.
"use strict";

(function starsPage() {
  const root = document.getElementById('starsPage');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  let settings = {};
  let viewId = null;          // whose sky is on screen
  let viewName = '';
  let myStars = [];           // the list, already in the order they light
  let groups = [];            // split into constellations
  let picked = 0;             // which constellation is on the stage

  let uidN = 0;               // unique ids for per-SVG gradients
  const ANIM_BUDGET = 46;     // how many sparkles may breathe at once
  let animLeft = ANIM_BUDGET;

  const FIND = '#FFD98E';     // find the piece — warm
  const COLOR = '#9EC7FF';    // colour by number — cool
  const isMine = () => !!(me.id && viewId === me.id);

  function el(name, attrs) {
    const n = document.createElementNS(SVG, name);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  // A seeded generator: a given sky's background must be the same every time
  // it is painted, or it would reshuffle on every click.
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

  // ---------- shared SVG furniture (gradients only, never filters) ----------
  function skyDefs(svg, accent) {
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
    const lg = el('linearGradient', { id: id + 'l', x1: '0', y1: '0', x2: '1', y2: '1' });
    lg.appendChild(el('stop', { offset: '0', 'stop-color': accent, 'stop-opacity': '.95' }));
    lg.appendChild(el('stop', { offset: '.5', 'stop-color': '#ffffff', 'stop-opacity': '.85' }));
    lg.appendChild(el('stop', { offset: '1', 'stop-color': accent, 'stop-opacity': '.95' }));
    defs.appendChild(lg);
    return { halo, line: `url(#${id}l)` };
  }
  // The far field: a slow river of light behind the constellation.
  //
  // Few nodes, many sub-circles. The stars are split into five bands that
  // fade on different clocks, so what the eye sees is stars changing
  // brightness rather than one layer pulsing, and all five sit in a group
  // that slides exactly one field-width and starts over. Every star is
  // therefore drawn twice, one width apart, which is what makes the loop
  // seamless; the svg viewport clips the copy that is off screen.
  //
  // Cost: six painted nodes and seven animations, every one of them a
  // transform or an opacity — the two the compositor can run by itself.
  // No filter, ever: see the note at the top of the file.
  const WAY_SPEED = 7;        // user units per second: noticed only if you wait
  const WAY_BANDS = 5;        // five clocks, so no two stars blink together
  function scatter(svg, w, h, seed, n) {
    const r = rnd(seed);
    const bands = new Array(WAY_BANDS).fill('');
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = (r() * h).toFixed(1), q = +(r() * 1.4 + .35).toFixed(2);
      const dot = cx => `M${cx.toFixed(1)} ${y} m${-q} 0 a${q} ${q} 0 1 0 ${q * 2} 0 a${q} ${q} 0 1 0 ${-q * 2} 0 `;
      bands[i % WAY_BANDS] += dot(x) + dot(x + w);
    }
    // A faint band of haze for the stars to run along, drawn under them.
    const gid = 'way' + (++uidN);
    const dd = el('defs', {});
    const rg = el('radialGradient', { id: gid });
    rg.appendChild(el('stop', { offset: '0', 'stop-color': '#dce7ff', 'stop-opacity': '.14' }));
    rg.appendChild(el('stop', { offset: '.55', 'stop-color': '#c9d8ff', 'stop-opacity': '.06' }));
    rg.appendChild(el('stop', { offset: '1', 'stop-color': '#c9d8ff', 'stop-opacity': '0' }));
    dd.appendChild(rg);
    svg.appendChild(dd);
    svg.appendChild(el('ellipse', {
      cx: (w * .5).toFixed(1), cy: (h * .46).toFixed(1), rx: (w * .78).toFixed(1), ry: (h * .23).toFixed(1),
      transform: `rotate(-13 ${(w * .5).toFixed(1)} ${(h * .46).toFixed(1)})`,
      fill: `url(#${gid})`, class: 'st-haze', 'aria-hidden': 'true',
    }));
    const g = el('g', { class: 'st-way', 'aria-hidden': 'true' });
    g.style.setProperty('--way', (-w) + 'px');
    g.style.animationDuration = Math.round(w / WAY_SPEED) + 's';
    bands.forEach((d, i) => {
      const p = el('path', { d, fill: '#fff', opacity: .34, class: 'st-way-band' });
      p.style.animationDuration = (6.5 + i * 1.4).toFixed(1) + 's';
      p.style.animationDelay = (-i * 1.7).toFixed(1) + 's';
      g.appendChild(p);
    });
    svg.appendChild(g);
  }
  function meteor(svg, x, y, delay) {
    const g = el('g', { class: 'st-meteor', 'aria-hidden': 'true' });
    g.style.animationDelay = delay + 's';
    g.append(
      el('line', { x1: x, y1: y, x2: x - 54, y2: y - 30, stroke: '#fff', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: .85 }),
      el('circle', { cx: x, cy: y, r: 2.1, fill: '#fff' }),
    );
    svg.appendChild(g);
  }

  // ---------- one star ----------
  function drawStar(parent, x, y, R, star, defs, seedIdx) {
    if (!star) {
      parent.append(
        el('circle', { cx: x, cy: y, r: R * 0.62, fill: 'none', stroke: 'rgba(255,255,255,.10)', 'stroke-width': 1, 'stroke-dasharray': '3 5' }),
        el('circle', { cx: x, cy: y, r: Math.max(2, R * 0.22), fill: 'rgba(255,255,255,.3)' }),
      );
      return null;
    }
    const colour = star.source === 'find' ? FIND : COLOR;
    // A colouring star earned on the hard board burns a little bigger.
    const k = star.level >= 3 ? 1.22 : star.level >= 2 ? 1.08 : 1;
    const g = el('g', { class: 'st-hit', tabindex: '0', role: 'button' });
    const halo = el('circle', { cx: x, cy: y, r: R * 3.1 * k, fill: defs.halo(colour) });
    const spark = el('path', { d: sparkPath(R * 2.2 * k), fill: colour, opacity: .95, transform: `translate(${x} ${y})` });
    breathe(spark, ((seedIdx * 0.53) % 4).toFixed(2));
    const burst = el('circle', { cx: x, cy: y, r: R * 1.15 * k, fill: 'none', stroke: '#fff', 'stroke-width': 1.1, opacity: 0, class: 'st-burst' });
    const core = el('circle', { cx: x, cy: y, r: R * 0.42 * k, fill: '#fff' });
    const hit = el('circle', { cx: x, cy: y, r: Math.max(16, R * 1.9), fill: 'transparent' });
    g.append(halo, spark, burst, core, hit);

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

  // ---------- the stage: one constellation, big ----------
  const STAGE_W = 960, STAGE_H = 600;
  function renderStage() {
    const host = $('stStageSky'), stage = $('stStage');
    if (!host || !groups.length) { if (stage) stage.hidden = true; return; }
    const group = groups[Math.min(picked, groups.length - 1)];
    const shape = constellationShape(group.index);
    const night = constellationNight(group.index);
    stage.style.setProperty('--st-accent', night.accent);
    host.innerHTML = '';
    resetAnim();

    const svg = el('svg', { viewBox: `0 0 ${STAGE_W} ${STAGE_H}`, class: 'st-sky', role: 'img', preserveAspectRatio: 'xMidYMid slice' });
    svg.setAttribute('aria-label', constellationName(group.index));
    const defs = skyDefs(svg, night.accent);
    scatter(svg, STAGE_W, STAGE_H, group.index + 7, 90);
    meteor(svg, STAGE_W * 0.82, 70, 2);

    const S = 4.4, ox = (STAGE_W - 100 * S) / 2, oy = (STAGE_H - 100 * S) / 2;
    const at = i => [ox + shape.stars[i][0] * S, oy + shape.stars[i][1] * S];

    const lines = el('g', {});
    shape.links.forEach(([a, b], n) => {
      const [x1, y1] = at(a), [x2, y2] = at(b);
      const lit = !!(group.stars[a] && group.stars[b]);
      const line = el('line', {
        x1, y1, x2, y2,
        stroke: lit ? defs.line : 'rgba(255,255,255,.11)',
        'stroke-width': lit ? 2.4 : 1.4, 'stroke-linecap': 'round',
        'stroke-dasharray': lit ? null : '5 9', opacity: lit ? .95 : 1,
      });
      if (lit) {
        const len = Math.hypot(x2 - x1, y2 - y1);
        line.setAttribute('class', 'st-line-lit');
        line.style.setProperty('--len', len);
        line.style.strokeDasharray = len;
        line.style.animationDelay = (n * 0.12) + 's';
      }
      lines.appendChild(line);
    });
    svg.appendChild(lines);

    const hits = [], dots = el('g', {});
    shape.stars.forEach((_, i) => {
      const [x, y] = at(i);
      const made = drawStar(dots, x, y, 17, group.stars[i] || null, defs, i);
      if (made) hits.push(made);
    });
    svg.appendChild(dots);
    host.appendChild(svg);
    wireTips(host, svg, hits);

    $('stStageNight').textContent = nightName(group.index);
    $('stStageName').textContent = constellationName(group.index);
    $('stStageLine').textContent = group.full ? constellationLine(group.index)
      : tr('starsNextIn', { n: STAR_CONSTELLATION_SIZE - group.stars.length });
    const pips = $('stStagePips');
    pips.innerHTML = '';
    for (let i = 0; i < STAR_CONSTELLATION_SIZE; i++) {
      const p = document.createElement('span');
      const s = group.stars[i];
      p.className = 'st-pip' + (s ? ' on' : '');
      if (s) p.style.setProperty('--pip', s.source === 'find' ? FIND : COLOR);
      pips.appendChild(p);
    }
    stage.hidden = false;
  }

  // A card that follows whichever star the pointer is over.
  function wireTips(host, svg, hits) {
    if (!hits.length) return;
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
      // getScreenCTM, not a width ratio: a sky drawn with
      // preserveAspectRatio=slice can scale its axes differently.
      const panel = host.getBoundingClientRect();
      const m = svg.getScreenCTM();
      let px = 0, py = 0;
      if (m) { const p = svg.createSVGPoint(); p.x = hit.x; p.y = hit.y; const o = p.matrixTransform(m); px = o.x; py = o.y; }
      tip.style.left = (px - panel.left) + 'px';
      tip.style.top = (py - panel.top) + 'px';
      tip.classList.add('on');
    };
    const hide = () => tip.classList.remove('on');
    for (const hit of hits) {
      hit.g.addEventListener('pointerenter', () => show(hit));
      hit.g.addEventListener('focus', () => show(hit));
      hit.g.addEventListener('pointerleave', hide);
      hit.g.addEventListener('blur', hide);
    }
    host.addEventListener('pointerleave', hide);
  }

  // ---------- the strip: pick any constellation ----------
  function renderStrip() {
    const wrap = $('stStripWrap'), strip = $('stStrip');
    if (!wrap || !strip) return;
    strip.innerHTML = '';
    if (!groups.length) { wrap.hidden = true; return; }
    groups.forEach((g, i) => {
      const shape = constellationShape(g.index);
      const night = constellationNight(g.index);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-chip' + (g.full ? ' done' : ' going') + (i === picked ? ' on' : '');
      b.style.setProperty('--st-accent', night.accent);
      b.setAttribute('aria-pressed', String(i === picked));
      const svg = el('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
      shape.links.forEach(([p, q]) => {
        const lit = !!(g.stars[p] && g.stars[q]);
        svg.appendChild(el('line', {
          x1: shape.stars[p][0], y1: shape.stars[p][1], x2: shape.stars[q][0], y2: shape.stars[q][1],
          stroke: lit ? night.accent : 'rgba(255,255,255,.14)', 'stroke-width': lit ? 2 : 1.2, 'stroke-linecap': 'round',
        }));
      });
      shape.stars.forEach(([x, y], k) => {
        const s = g.stars[k];
        svg.appendChild(el('circle', { cx: x, cy: y, r: s ? 4.6 : 2, fill: s ? (s.source === 'find' ? FIND : COLOR) : 'rgba(255,255,255,.22)' }));
      });
      const no = document.createElement('span'); no.className = 'st-chip-no'; no.textContent = g.index + 1;
      const nm = document.createElement('span'); nm.className = 'st-chip-name'; nm.textContent = constellationName(g.index);
      b.append(svg, no, nm);
      b.addEventListener('click', () => { picked = i; renderStage(); renderStrip(); });
      strip.appendChild(b);
    });
    wrap.hidden = false;
  }

  // ---------- full screen ----------
  // Drawn fresh when it opens and thrown away on close, so it costs nothing
  // while shut.
  let fullOpen = false, scrollLock = '';
  function openFull() {
    const box = $('stFull'), body = $('stFullBody'), title = $('stFullTitle');
    if (!box) return;
    body.innerHTML = '';
    title.textContent = tr('starsFullTitle', { n: groups.filter(g => g.full).length });
    body.appendChild(allSkySvg());
    box.hidden = false;
    // Never record our own lock as the value to restore.
    if (!fullOpen) scrollLock = document.documentElement.style.overflow;
    fullOpen = true;
    document.documentElement.style.overflow = 'hidden';
    // The page behind is covered; stop paying for its animations.
    document.documentElement.classList.add('st-full-open');
    $('stFullClose').focus();
  }
  function closeFull() {
    const box = $('stFull');
    if (!box || !fullOpen) return;
    box.hidden = true;
    $('stFullBody').innerHTML = '';
    fullOpen = false;
    document.documentElement.style.overflow = scrollLock;
    document.documentElement.classList.remove('st-full-open');
  }
  // Every constellation on one field, laid out to suit the screen's shape.
  function allSkySvg() {
    const n = Math.max(1, groups.length);
    const ar = (window.innerWidth || 1000) / Math.max(360, (window.innerHeight || 800) - 150);
    let cols = Math.max(1, Math.round(Math.sqrt(n * ar)));
    cols = Math.min(cols, n);
    const rows = Math.ceil(n / cols);
    const CELL = 100, W = cols * CELL, H = rows * CELL;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'st-full-sky', role: 'img' });
    svg.setAttribute('aria-label', tr('starsFullTitle', { n: groups.filter(g => g.full).length }));
    const defs = skyDefs(svg, '#9EC7FF');
    scatter(svg, W, H, 5, Math.min(260, n * 40));
    resetAnim();

    groups.forEach((g, k) => {
      const shape = constellationShape(g.index);
      const night = constellationNight(g.index);
      const cx = (k % cols) * CELL, cy = Math.floor(k / cols) * CELL;
      const S = 0.74, ox = cx + (CELL - 100 * S) / 2, oy = cy + (CELL - 100 * S) / 2 - 4;
      const at = i => [ox + shape.stars[i][0] * S, oy + shape.stars[i][1] * S];
      for (const [a, b] of shape.links) {
        const [x1, y1] = at(a), [x2, y2] = at(b);
        const lit = !!(g.stars[a] && g.stars[b]);
        svg.appendChild(el('line', {
          x1, y1, x2, y2, stroke: lit ? night.accent : 'rgba(255,255,255,.12)',
          'stroke-width': lit ? 1.1 : .7, 'stroke-linecap': 'round', 'stroke-dasharray': lit ? null : '2 4',
        }));
      }
      shape.stars.forEach((_, i) => {
        const [x, y] = at(i);
        const s = g.stars[i];
        if (!s) { svg.appendChild(el('circle', { cx: x, cy: y, r: 1.1, fill: 'rgba(255,255,255,.22)' })); return; }
        const colour = s.source === 'find' ? FIND : COLOR;
        svg.appendChild(el('circle', { cx: x, cy: y, r: 7, fill: defs.halo(colour) }));
        const sp = el('path', { d: sparkPath(4.4), fill: colour, opacity: .95, transform: `translate(${x} ${y})` });
        breathe(sp, (((k * 6 + i) * 0.31) % 4).toFixed(2));
        svg.appendChild(sp);
        svg.appendChild(el('circle', { cx: x, cy: y, r: 1.5, fill: '#fff' }));
      });
      const t = el('text', {
        x: cx + CELL / 2, y: cy + CELL - 5, 'text-anchor': 'middle',
        fill: g.full ? 'rgba(242,244,251,.82)' : 'rgba(242,244,251,.38)',
        'font-size': 6.4, 'font-weight': 700, 'font-family': 'Pretendard, sans-serif',
      });
      t.textContent = `${g.index + 1}. ${constellationName(g.index)}`;
      svg.appendChild(t);
    });
    return svg;
  }

  // ---------- summary ----------
  function renderSummary(list) {
    const host = $('stSummary');
    const full = groupIntoConstellations(list).filter(g => g.full).length;
    const week = Date.now() - 7 * 86400000;
    const recent = list.filter(s => Date.parse(s.earned_at) >= week).length;
    const rest = list.length % STAR_CONSTELLATION_SIZE;
    const bits = [tr('starsCount', { n: list.length }), tr('starsConstellationCount', { n: full })];
    if (list.length) bits.push(tr('starsNextIn', { n: STAR_CONSTELLATION_SIZE - rest }));
    if (recent) bits.push(tr('starsThisWeek', { n: recent }));
    host.textContent = list.length ? bits.join(' · ') : '';
  }

  // ---------- share ----------
  function shareCanvas(group) {
    const W = 1200, H = 630;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1024'); bg.addColorStop(1, '#0c1330');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const neb = ctx.createRadialGradient(W * .22, H * .2, 10, W * .22, H * .2, 520);
    neb.addColorStop(0, 'rgba(120,150,255,.28)'); neb.addColorStop(1, 'rgba(120,150,255,0)');
    ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
    const r = rnd(group.index + 11);
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    for (let i = 0; i < 180; i++) { ctx.beginPath(); ctx.arc(r() * W, r() * H, r() * 1.5 + .3, 0, 7); ctx.fill(); }

    const shape = constellationShape(group.index);
    const night = constellationNight(group.index);
    const S = 3.3, ox = W / 2 - 50 * S, oy = 96;
    const at = i => [ox + shape.stars[i][0] * S, oy + shape.stars[i][1] * S];
    ctx.strokeStyle = night.accent; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.shadowColor = night.accent; ctx.shadowBlur = 16;
    for (const [a, b] of shape.links) {
      const [x1, y1] = at(a), [x2, y2] = at(b);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    shape.stars.forEach((_, i) => {
      const [x, y] = at(i);
      const s = group.stars[i];
      const c = !s ? 'rgba(255,255,255,.2)' : s.source === 'find' ? FIND : COLOR;
      ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 28;
      ctx.globalAlpha = .22; ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill();
    });
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#F4F6FF';
    ctx.font = 'bold 48px Pretendard, sans-serif';
    ctx.fillText(constellationName(group.index), W / 2, 518);
    ctx.fillStyle = 'rgba(244,246,255,.74)';
    ctx.font = '24px Pretendard, sans-serif';
    ctx.fillText(constellationLine(group.index), W / 2, 558);
    ctx.fillStyle = 'rgba(244,246,255,.5)';
    ctx.font = '20px Pretendard, sans-serif';
    ctx.fillText('weavo.art', W / 2, 600);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  async function shareConstellation() {
    const btn = $('stShare');
    const done = groups.filter(g => g.full);
    if (!done.length) { toast(tr('starsShareNone')); return; }
    const onStage = groups[Math.min(picked, groups.length - 1)];
    const group = onStage && onStage.full ? onStage : done[done.length - 1];
    btn.disabled = true;
    try {
      const blob = await shareCanvas(group);
      if (!blob) throw new Error('no image');
      const file = new File([blob], `weavo-constellation-${group.index + 1}.png`, { type: 'image/png' });
      const text = tr('starsShareText', { name: constellationName(group.index) });
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
    $('stStage').hidden = true;
    $('stStripWrap').hidden = true;
    $('stAllWrap').hidden = true;
  }
  function renderMine(res) {
    const empty = $('stEmpty');
    myStars = res.rows;
    groups = groupIntoConstellations(myStars);
    const going = groups.findIndex(g => !g.full);
    picked = going === -1 ? groups.length - 1 : going;
    renderSummary(myStars);

    $('stMineTitle').textContent = isMine() || !viewName
      ? tr('starsMineTitle') : tr('starsOtherTitle', { name: viewName });

    if (res.missing || res.failed || !myStars.length) {
      hideSky();
      empty.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = res.missing ? tr('starsOff') : res.failed ? tr('starsLoadFailed')
        : (isMine() || !viewId ? tr('starsEmptyMine') : tr('starsEmptyOther'));
      empty.appendChild(p);
      if (!res.missing && !res.failed && (isMine() || !viewId)) {
        const hint = document.createElement('p');
        hint.className = 'st-empty-hint';
        hint.textContent = tr('starsEmptyMineHint');
        empty.appendChild(hint);
      }
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    $('stAllWrap').hidden = false;
    renderStage();
    renderStrip();
  }

  async function load() {
    const params = new URLSearchParams(location.search);
    const wanted = params.get('user');
    viewId = wanted || me.id || null;
    viewName = '';
    const owner = $('stOwner');

    if (!viewId) {
      hideSky();
      $('stSummary').textContent = '';
      const empty = $('stEmpty');
      empty.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = tr('starsSignIn');
      empty.appendChild(p);
      empty.hidden = false;
      owner.hidden = true;
      return;
    }
    if (wanted && wanted !== me.id) {
      const { data } = await sb.from('profiles').select('username,name,stars_hidden').eq('id', wanted).maybeSingle();
      viewName = (data && (data.username || data.name)) || '';
      if (data && data.stars_hidden) {
        hideSky();
        $('stSummary').textContent = '';
        $('stEmpty').textContent = tr('starsHiddenNotice');
        $('stEmpty').hidden = false;
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
      return;
    }
    $('stHide').addEventListener('change', e => setHidden(e.target.checked));
    $('stShare').addEventListener('click', shareConstellation);
    $('stAll').addEventListener('click', openFull);
    $('stFullClose').addEventListener('click', closeFull);
    $('stFull').addEventListener('click', e => { if (e.target === $('stFull')) closeFull(); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && fullOpen) closeFull(); });
    await load();
  })();

  // Signing in or out changes whose sky this is.
  document.addEventListener('weavo:authchange', () => { load(); });
})();
