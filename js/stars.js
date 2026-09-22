// The sky page (/{lang}/stars).
//
// Shape of it (2026-09-21→22, user direction):
//   * the constellation you are WORKING ON fills a big stage in the middle
//   * every constellation you have is a chip under it; picking one stages it
//   * six hand-drawn "Different Us" badges
//   * THE WHALE IS YOURS. It was a shared sky at first; the user asked for
//     one you finish alone, so its 48 points are simply your own stars in the
//     order you earned them — the constellations are chapters, the whale is
//     the whole picture. Nothing extra is stored and whale_stars() is no
//     longer called.
//   * a full-screen view, for all the constellations at once or the whale
//
// PERFORMANCE (2026-09-22, "버벅거린다"). There are NO SVG filters on this
// page: feGaussianBlur re-runs every time the thing it wraps changes, and
// every star animated, so a phone was doing hundreds of filter passes a
// frame. A radial gradient looks the same and costs nothing once painted.
// The background star field is one <path>, not 190 <circle>s, and only the
// first ANIM_BUDGET sparkles breathe.
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
  // One path, many sub-circles: the far-away stars cost a single node.
  function scatter(svg, w, h, seed, n) {
    const r = rnd(seed);
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = (r() * w).toFixed(1), y = (r() * h).toFixed(1), q = +(r() * 1.4 + .35).toFixed(2);
      d += `M${x} ${y} m${-q} 0 a${q} ${q} 0 1 0 ${q * 2} 0 a${q} ${q} 0 1 0 ${-q * 2} 0 `;
    }
    svg.appendChild(el('path', { d, fill: '#fff', opacity: .34, 'aria-hidden': 'true' }));
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

  // ---------- "Different Us": six drawn badges ----------
  function badgeEmblem(key, won) {
    const id = 'bg' + (++uidN);
    const svg = el('svg', { viewBox: '0 0 72 72', class: 'st-emblem' + (won ? ' won' : ''), 'aria-hidden': 'true' });
    const defs = el('defs', {});
    const rg = el('radialGradient', { id: id + 'r', cx: '.5', cy: '.34', r: '.78' });
    rg.appendChild(el('stop', { offset: '0', 'stop-color': won ? 'rgba(255,217,142,.34)' : 'rgba(255,255,255,.07)' }));
    rg.appendChild(el('stop', { offset: '1', 'stop-color': 'rgba(255,255,255,0)' }));
    defs.appendChild(rg);
    svg.appendChild(defs);

    const ink = won ? '#FFD98E' : 'rgba(255,255,255,.34)';
    const ink2 = won ? '#9EC7FF' : 'rgba(255,255,255,.22)';
    svg.appendChild(el('circle', { cx: 36, cy: 36, r: 33, fill: `url(#${id}r)` }));
    svg.appendChild(el('circle', { cx: 36, cy: 36, r: 32, fill: 'none', stroke: won ? 'rgba(255,217,142,.5)' : 'rgba(255,255,255,.13)', 'stroke-width': 1.3 }));
    const art = el('g', {});
    const dot = (x, y, r, c) => art.appendChild(el('circle', { cx: x, cy: y, r, fill: c || ink }));
    const ring = (x, y, r, c, w) => art.appendChild(el('circle', { cx: x, cy: y, r, fill: 'none', stroke: c || ink, 'stroke-width': w || 1.6 }));
    const spark = (x, y, r, c) => art.appendChild(el('path', { d: sparkPath(r), fill: c || ink, transform: `translate(${x} ${y})` }));

    if (key === 'artists5' || key === 'artists10') {
      const n = key === 'artists5' ? 5 : 10, R = key === 'artists5' ? 17 : 19;
      ring(36, 36, R, won ? 'rgba(255,217,142,.35)' : 'rgba(255,255,255,.14)', 1.1);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const x = 36 + Math.cos(a) * R, y = 36 + Math.sin(a) * R, c = i % 2 ? ink2 : ink;
        dot(x, y - 1.6, n === 5 ? 3.1 : 2.4, c);
        const w = n === 5 ? 3.4 : 2.6;
        art.appendChild(el('path', { d: `M${x - w} ${y + w * 1.35} q${w} ${-w * 1.06} ${w * 2} 0`, fill: 'none', stroke: c, 'stroke-width': n === 5 ? 1.9 : 1.5, 'stroke-linecap': 'round' }));
      }
      spark(36, 36, n === 5 ? 7 : 6);
    } else if (key === 'bothGames') {
      art.appendChild(el('circle', { cx: 27, cy: 30, r: 9, fill: won ? 'rgba(255,217,142,.14)' : 'rgba(255,255,255,.05)' }));
      ring(27, 30, 9, ink, 2.4);
      art.appendChild(el('path', { d: 'M33.6 36.6 L41 44', fill: 'none', stroke: ink, 'stroke-width': 2.8, 'stroke-linecap': 'round' }));
      dot(49, 26, 4.2, ink2); dot(55, 35, 3.4, ink); dot(47, 39, 3, ink2);
      ring(50, 33, 11, won ? 'rgba(158,199,255,.4)' : 'rgba(255,255,255,.13)', 1.1);
    } else if (key === 'hardLevel') {
      art.appendChild(el('path', { d: 'M13 50 L26 30 L33 39 L44 21 L59 50 Z', fill: won ? 'rgba(255,217,142,.22)' : 'rgba(255,255,255,.07)' }));
      art.appendChild(el('path', { d: 'M13 50 L26 30 L33 39 L44 21 L59 50', fill: 'none', stroke: ink, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      art.appendChild(el('path', { d: 'M40 27 L44 21 L48.5 29 L44 31 Z', fill: ink2 }));
      spark(44, 17, 7.5);
    } else if (key === 'sameDay3') {
      art.appendChild(el('path', { d: 'M12 48 A 24 24 0 0 1 60 48', fill: 'none', stroke: ink, 'stroke-width': 1.8 }));
      art.appendChild(el('path', { d: 'M12 48 L60 48', fill: 'none', stroke: won ? 'rgba(255,217,142,.4)' : 'rgba(255,255,255,.16)', 'stroke-width': 1.2 }));
      spark(24, 34, 6, ink2); spark(36, 24, 8.5); spark(48, 33, 6.5, ink2);
    } else {
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 8;
        dot(36 + Math.cos(a) * 21, 36 + Math.sin(a) * 21, i % 2 ? 2.4 : 1.6, i % 2 ? ink : ink2);
      }
      ring(36, 36, 21, won ? 'rgba(255,217,142,.28)' : 'rgba(255,255,255,.1)', 1);
      spark(36, 36, 13);
      dot(36, 36, 3.2, '#fff');
    }
    svg.appendChild(art);
    return svg;
  }
  function starBadges(list) {
    const artists = new Set(list.map(s => s.author_id).filter(Boolean));
    const both = new Set(), byArtwork = new Map();
    for (const s of list) {
      const seen = byArtwork.get(s.artwork_id) || new Set();
      seen.add(s.source);
      byArtwork.set(s.artwork_id, seen);
      if (seen.size > 1) both.add(s.artwork_id);
    }
    const perDay = new Map();
    for (const s of list) {
      const d = String(s.earned_at || '').slice(0, 10);
      perDay.set(d, (perDay.get(d) || 0) + 1);
    }
    const bestDay = perDay.size ? Math.max(...perDay.values()) : 0;
    const hard = list.some(s => s.source === 'color' && s.level >= 3);
    return {
      artists5: artists.size, bothGames: both.size, hardLevel: hard ? 1 : 0,
      sameDay3: bestDay, artists10: artists.size, stars20: list.length,
    };
  }
  function renderSpecial(list) {
    const wrap = $('stSpecialWrap'), host = $('stBadges');
    if (!wrap || !host) return;
    const have = starBadges(list);
    host.innerHTML = '';
    for (const b of CONSTELLATION_SPECIAL.badges) {
      const won = (have[b.key] || 0) >= b.need;
      const li = document.createElement('li');
      li.className = 'st-badge' + (won ? ' won' : '');
      li.appendChild(badgeEmblem(b.key, won));
      const txt = document.createElement('div');
      txt.className = 'st-badge-txt';
      const nm = document.createElement('b'); nm.textContent = tr('conBadge_' + b.key);
      const hint = document.createElement('span');
      // Clamp so a finished badge reads (5/5), not (6/5).
      hint.textContent = tr('conBadgeHint_' + b.key, { have: Math.min(have[b.key] || 0, b.need) });
      txt.append(nm, hint);
      li.appendChild(txt);
      host.appendChild(li);
    }
    wrap.hidden = false;
  }

  // ---------- the whale: YOUR whole sky ----------
  // Its 48 points are your own stars in the order you earned them. Six of
  // them make a constellation, all forty-eight make the whale; past that a
  // new whale begins. No extra data — the same list drives both.
  function whaleD(from, to) {
    let d = '';
    for (let i = from; i <= to; i++) {
      const [x, y] = WHALE_STARS[i % WHALE_STARS.length];
      d += (i === from ? 'M' : 'L') + x + ' ' + y + ' ';
    }
    return d.trim();
  }
  function paintWhale(host, list, big) {
    const total = WHALE_STARS.length;
    const skies = list.length ? Math.ceil(list.length / total) : 1;
    const lit = list.slice((skies - 1) * total);
    const done = lit.length >= total;
    host.innerHTML = '';
    resetAnim();

    const svg = el('svg', { viewBox: `0 0 ${WHALE_SKY.w} ${WHALE_SKY.h}`, class: 'st-whale-svg', role: 'img' });
    svg.setAttribute('aria-label', tr('starsWhaleTitle'));
    const defs = skyDefs(svg, '#9EC7FF');
    const gid = 'wh' + (++uidN);
    const dd = el('defs', {});
    const body = el('radialGradient', { id: gid + 'b', cx: '.42', cy: '.4', r: '.72' });
    body.appendChild(el('stop', { offset: '0', 'stop-color': '#9EC7FF', 'stop-opacity': '.55' }));
    body.appendChild(el('stop', { offset: '.55', 'stop-color': '#7B86FF', 'stop-opacity': '.3' }));
    body.appendChild(el('stop', { offset: '1', 'stop-color': '#4B3FA8', 'stop-opacity': '.08' }));
    // Aurora ribbons: soft gradient stops, no blur filter (that was the cost).
    const aur = el('linearGradient', { id: gid + 'a', x1: '0', y1: '0', x2: '1', y2: '.4' });
    aur.appendChild(el('stop', { offset: '0', 'stop-color': '#5BE7C4', 'stop-opacity': '0' }));
    aur.appendChild(el('stop', { offset: '.42', 'stop-color': '#5BE7C4', 'stop-opacity': '.20' }));
    aur.appendChild(el('stop', { offset: '.7', 'stop-color': '#A78BFA', 'stop-opacity': '.18' }));
    aur.appendChild(el('stop', { offset: '1', 'stop-color': '#A78BFA', 'stop-opacity': '0' }));
    dd.append(body, aur);
    svg.appendChild(dd);
    svg.append(
      el('path', { d: 'M-60 150 C 240 60, 560 250, 1060 120 L1060 250 C 560 370, 240 180, -60 280 Z', fill: `url(#${gid}a)`, class: 'st-aurora' }),
      el('path', { d: 'M-60 330 C 300 240, 640 430, 1060 300 L1060 420 C 640 540, 300 370, -60 450 Z', fill: `url(#${gid}a)`, class: 'st-aurora st-aurora-2', opacity: .7 }),
    );
    scatter(svg, WHALE_SKY.w, WHALE_SKY.h, 3, 150);
    meteor(svg, WHALE_SKY.w * 0.92, 70, 3);

    const frac = lit.length / total;
    svg.appendChild(el('path', {
      d: whaleD(0, total) + ' Z', fill: `url(#${gid}b)`,
      opacity: (0.06 + frac * 0.5).toFixed(3), class: 'st-whale-body' + (done ? ' full' : ''),
    }));
    svg.appendChild(el('path', { d: whaleD(0, total) + ' Z', fill: 'none', stroke: 'rgba(255,255,255,.09)', 'stroke-width': 1.3, 'stroke-dasharray': '5 10', 'stroke-linecap': 'round' }));
    if (lit.length > 1) {
      const dLit = whaleD(0, lit.length - 1) + (done ? ' Z' : '');
      svg.appendChild(el('path', { d: dLit, fill: 'none', stroke: defs.line, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .95 }));
      svg.appendChild(el('path', { d: dLit, fill: 'none', stroke: '#ffffff', 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-dasharray': '46 520', opacity: .85, class: 'st-flow' }));
    }
    const br = rnd(21);
    for (let i = 0; i < 8; i++) {
      const b = el('circle', {
        cx: (br() * WHALE_SKY.w).toFixed(0), cy: (WHALE_SKY.h - 10).toFixed(0),
        r: (br() * 3.4 + 1.2).toFixed(1), fill: 'none', stroke: 'rgba(190,220,255,.5)', 'stroke-width': .9, class: 'st-bubble',
      });
      b.style.animationDelay = (br() * 16).toFixed(1) + 's';
      b.style.animationDuration = (12 + br() * 12).toFixed(1) + 's';
      svg.appendChild(b);
    }

    const hits = [];
    WHALE_STARS.forEach(([x, y], i) => {
      const star = lit[i];
      if (!star) {
        svg.appendChild(el('circle', { cx: x, cy: y, r: 3, fill: 'rgba(255,255,255,.26)' }));
        return;
      }
      const made = drawStar(svg, x, y, big ? 7 : 6, star, defs, i);
      if (made) hits.push(made);
    });
    // The eye opens once the head is drawn — the whale starts looking back.
    if (lit.length >= 4) {
      const eye = el('g', { class: 'st-whale-eye' });
      eye.append(
        el('circle', { cx: 132, cy: 236, r: 14, fill: defs.halo('#9EC7FF') }),
        el('circle', { cx: 132, cy: 236, r: 5.2, fill: '#ffffff' }),
        el('circle', { cx: 133.6, cy: 234.6, r: 1.8, fill: '#0b1226' }),
      );
      svg.appendChild(eye);
    }
    host.appendChild(svg);
    wireTips(host, svg, hits);
    return { lit: lit.length, total, done, skies };
  }
  function renderWhale(list) {
    const wrap = $('stWhaleWrap'), host = $('stWhale'), meta = $('stWhaleMeta');
    if (!wrap || !host) return;
    if (settings.starsShowWhale === false || !list.length) { wrap.hidden = true; return; }
    const r = paintWhale(host, list, false);
    $('stWhaleLead').textContent = tr('starsWhaleLead', { total: r.total });
    const bits = [tr('starsWhaleProgress', { n: r.lit, total: r.total })];
    if (r.done) bits.push(tr('starsWhaleDone'));
    else bits.push(tr('starsWhaleLeft', { n: r.total - r.lit }));
    if (r.skies > 1) bits.push(tr('starsWhaleNth', { n: r.skies }));
    meta.textContent = bits.join(' · ');
    wrap.hidden = false;
  }

  // ---------- full screen ----------
  // Drawn fresh when it opens and thrown away on close, so it costs nothing
  // while shut.
  let fullOpen = false, scrollLock = '';
  function openFull(kind) {
    const box = $('stFull'), body = $('stFullBody'), title = $('stFullTitle'), hint = $('stFullHint');
    if (!box) return;
    body.innerHTML = '';
    hint.hidden = true;
    if (kind === 'whale') {
      title.textContent = tr('starsWhaleTitle');
      const host = document.createElement('div');
      host.className = 'st-full-whale';
      body.appendChild(host);
      paintWhale(host, myStars, true);
      // A 1.9:1 picture on a portrait phone can only get so big.
      if (window.innerWidth < 700 && window.innerHeight > window.innerWidth) {
        hint.textContent = tr('starsRotateHint');
        hint.hidden = false;
      }
    } else {
      title.textContent = tr('starsFullTitle', { n: groups.filter(g => g.full).length });
      body.appendChild(allSkySvg());
    }
    box.hidden = false;
    // Only remember the page scroll on the FIRST open — switching from one
    // view to the other must not record our own lock as the value to restore.
    if (!fullOpen) scrollLock = document.documentElement.style.overflow;
    fullOpen = true;
    document.documentElement.style.overflow = 'hidden';
    $('stFullClose').focus();
  }
  function closeFull() {
    const box = $('stFull');
    if (!box || !fullOpen) return;
    box.hidden = true;
    $('stFullBody').innerHTML = '';
    fullOpen = false;
    document.documentElement.style.overflow = scrollLock;
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
    scatter(svg, W, H, 5, Math.min(420, n * 60));
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
    $('stWhaleWrap').hidden = true;
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
      renderSpecial([]);
      return;
    }
    empty.hidden = true;
    $('stAllWrap').hidden = false;
    renderStage();
    renderStrip();
    renderSpecial(myStars);
    renderWhale(myStars);
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
      renderSpecial([]);
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
        $('stSpecialWrap').hidden = true;
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
    $('stAll').addEventListener('click', () => openFull('all'));
    $('stWhaleBig').addEventListener('click', () => openFull('whale'));
    $('stFullClose').addEventListener('click', closeFull);
    $('stFull').addEventListener('click', e => { if (e.target === $('stFull')) closeFull(); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && fullOpen) closeFull(); });
    await load();
  })();

  // Signing in or out changes whose sky this is.
  document.addEventListener('weavo:authchange', () => { load(); });
})();
