// The sky page (/{lang}/stars).
//
// Layout (2026-09-21, user direction): the constellation you are WORKING ON
// fills a big stage in the middle; every constellation you have is a chip in
// the strip under it, and picking one puts it on the stage. Then the six
// hand-drawn "Different Us" badges, then the whale everybody builds.
//
// Needs sb, me, tr, common.js (getSiteSettings/toast/openArtworkById/
// profileUrl/cdnUrl), lightbox.js (the artwork a star opens) and
// constellations.js (the shapes) already loaded.
//
// Everything drawn here comes from ONE read of user_star_list plus one of
// whale_stars (supabase_stars.sql). Stars are awarded by DB triggers when a
// game is finished, so this page only ever reads.
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
  let uidN = 0;               // unique ids for per-SVG filters and gradients

  const FIND = '#FFD98E';     // find the piece — warm
  const COLOR = '#9EC7FF';    // colour by number — cool
  const isMine = () => !!(me.id && viewId === me.id);

  function el(name, attrs) {
    const n = document.createElementNS(SVG, name);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  // A seeded generator: the background star field of a given sky must be the
  // same every time it is painted, or the sky would reshuffle on every click.
  function rnd(seed) {
    let s = (seed * 9301 + 49297) % 233280;
    return () => (s = (s * 9301 + 49297) % 233280) / 233280;
  }
  // The four-point flare of a star, centred on 0,0.
  function sparkPath(R) {
    const w = R * 0.19;
    return `M0 ${-R} C ${w} ${-w * 1.7} ${w * 1.7} ${-w} ${R} 0`
         + ` C ${w * 1.7} ${w} ${w} ${w * 1.7} 0 ${R}`
         + ` C ${-w} ${w * 1.7} ${-w * 1.7} ${w} ${-R} 0`
         + ` C ${-w * 1.7} ${-w} ${-w} ${-w * 1.7} 0 ${-R} Z`;
  }

  // ---------- shared SVG furniture ----------
  // One <defs> per sky: a soft glow filter and the gradient the lines use.
  function skyDefs(svg, accent) {
    const id = 'sky' + (++uidN);
    const defs = el('defs', {});
    const f = el('filter', { id: id + 'g', x: '-120%', y: '-120%', width: '340%', height: '340%' });
    f.appendChild(el('feGaussianBlur', { stdDeviation: 4.2, result: 'b' }));
    const merge = el('feMerge', {});
    merge.appendChild(el('feMergeNode', { in: 'b' }));
    merge.appendChild(el('feMergeNode', { in: 'b' }));
    merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    f.appendChild(merge);
    const soft = el('filter', { id: id + 's', x: '-150%', y: '-150%', width: '400%', height: '400%' });
    soft.appendChild(el('feGaussianBlur', { stdDeviation: 9 }));
    const lg = el('linearGradient', { id: id + 'l', x1: '0', y1: '0', x2: '1', y2: '1' });
    lg.appendChild(el('stop', { offset: '0', 'stop-color': accent, 'stop-opacity': '.95' }));
    lg.appendChild(el('stop', { offset: '.5', 'stop-color': '#ffffff', 'stop-opacity': '.8' }));
    lg.appendChild(el('stop', { offset: '1', 'stop-color': accent, 'stop-opacity': '.95' }));
    defs.append(f, soft, lg);
    svg.appendChild(defs);
    return { glow: `url(#${id}g)`, soft: `url(#${id}s)`, line: `url(#${id}l)` };
  }
  // The field of far-away stars a sky sits in.
  function scatter(svg, w, h, seed, n) {
    const r = rnd(seed);
    const g = el('g', { 'aria-hidden': 'true' });
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, rad = r() * 1.5 + .35;
      const c = el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: rad.toFixed(2), fill: '#fff', opacity: (r() * .5 + .12).toFixed(2) });
      if (i % 5 === 0) { c.setAttribute('class', 'st-spark'); c.style.animationDuration = (3 + r() * 4).toFixed(1) + 's'; c.style.animationDelay = (r() * 6).toFixed(1) + 's'; }
      g.appendChild(c);
    }
    svg.appendChild(g);
  }
  // A meteor: a short bright streak that crosses now and then.
  function meteor(svg, x, y, delay) {
    const g = el('g', { class: 'st-meteor', 'aria-hidden': 'true' });
    g.style.animationDelay = delay + 's';
    const line = el('line', { x1: x, y1: y, x2: x - 54, y2: y - 30, stroke: '#fff', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: .85 });
    const head = el('circle', { cx: x, cy: y, r: 2.1, fill: '#fff' });
    g.append(line, head);
    svg.appendChild(g);
  }

  // ---------- one star ----------
  // `star` null = an empty slot. Returns the group so callers can wire it.
  function drawStar(parent, x, y, R, star, defs, seedIdx) {
    if (!star) {
      const dot = el('circle', { cx: x, cy: y, r: Math.max(2, R * 0.22), fill: 'rgba(255,255,255,.34)', class: 'st-empty-dot' });
      dot.style.animationDelay = (seedIdx * 0.7) + 's';
      const ring = el('circle', { cx: x, cy: y, r: R * 0.62, fill: 'none', stroke: 'rgba(255,255,255,.10)', 'stroke-width': 1, 'stroke-dasharray': '3 5' });
      parent.append(ring, dot);
      const t = el('title'); t.textContent = tr('starsEmptySlot');
      ring.appendChild(t);
      return null;
    }
    const colour = star.source === 'find' ? FIND : COLOR;
    // A colouring star earned on the hard board burns a little bigger.
    const k = star.level >= 3 ? 1.22 : star.level >= 2 ? 1.08 : 1;
    const g = el('g', { class: 'st-hit', tabindex: '0', role: 'button' });
    const halo = el('circle', { cx: x, cy: y, r: R * 1.7 * k, fill: colour, opacity: .3, filter: defs.soft, class: 'st-halo' });
    const spark = el('path', { d: sparkPath(R * 2.5 * k), fill: colour, opacity: .92, filter: defs.glow, class: 'st-spark', transform: `translate(${x} ${y})` });
    const burst = el('circle', { cx: x, cy: y, r: R * 1.15 * k, fill: 'none', stroke: '#fff', 'stroke-width': 1.1, opacity: 0, class: 'st-burst' });
    const core = el('circle', { cx: x, cy: y, r: R * 0.42 * k, fill: '#fff', class: 'st-core' });
    const hit = el('circle', { cx: x, cy: y, r: Math.max(16, R * 1.9), fill: 'transparent' });
    const d = (seedIdx * 0.53) % 4;
    spark.style.animationDelay = d + 's';
    halo.style.animationDelay = (d + 1.1) + 's';
    core.style.animationDelay = d + 's';
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
  // One field at every width. The panel is 16/10 on a monitor and square on
  // a phone (css), and the sky SLICES rather than letterboxes — so a narrow
  // screen crops the empty sides instead of shrinking the constellation to
  // ~6px stars, which is what a plain fit did.
  const STAGE_W = 960, STAGE_H = 600;
  function renderStage() {
    const host = $('stStageSky');
    const stage = $('stStage');
    if (!host || !groups.length) { if (stage) stage.hidden = true; return; }
    const group = groups[Math.min(picked, groups.length - 1)];
    const shape = constellationShape(group.index);
    const night = constellationNight(group.index);
    stage.style.setProperty('--st-accent', night.accent);
    host.innerHTML = '';

    const svg = el('svg', { viewBox: `0 0 ${STAGE_W} ${STAGE_H}`, class: 'st-sky', role: 'img', preserveAspectRatio: 'xMidYMid slice' });
    svg.setAttribute('aria-label', constellationName(group.index));
    const defs = skyDefs(svg, night.accent);
    scatter(svg, STAGE_W, STAGE_H, group.index + 7, 110);
    meteor(svg, STAGE_W * 0.82, 70, 2);
    meteor(svg, STAGE_W * 0.42, 160, 8);

    // The shape is authored on a 0–100 square; blow it up to a 440px square
    // in the middle of the stage.
    const S = 4.4, ox = (STAGE_W - 100 * S) / 2, oy = (STAGE_H - 100 * S) / 2;
    const at = i => [ox + shape.stars[i][0] * S, oy + shape.stars[i][1] * S];

    const lines = el('g', {});
    shape.links.forEach(([a, b], n) => {
      const [x1, y1] = at(a), [x2, y2] = at(b);
      const lit = !!(group.stars[a] && group.stars[b]);
      const line = el('line', {
        x1, y1, x2, y2,
        stroke: lit ? defs.line : 'rgba(255,255,255,.11)',
        'stroke-width': lit ? 2.4 : 1.4,
        'stroke-linecap': 'round',
        'stroke-dasharray': lit ? null : '5 9',
        filter: lit ? defs.soft : null,
        opacity: lit ? .95 : 1,
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

    const hits = [];
    const dots = el('g', {});
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

  // A card that follows the pointer to whichever star it is over. Positioned
  // against the panel, so it never leaves the sky.
  function wireTips(host, svg, hits) {
    if (!hits.length) return;
    const tip = document.createElement('div');
    tip.className = 'st-tip';
    const img = document.createElement('img');
    img.alt = '';
    const txt = document.createElement('div');
    txt.className = 'st-tip-txt';
    const t1 = document.createElement('div'); t1.className = 'st-tip-title';
    const t2 = document.createElement('div'); t2.className = 'st-tip-by';
    const t3 = document.createElement('div'); t3.className = 'st-tip-game';
    txt.append(t1, t2, t3);
    tip.append(img, txt);
    host.appendChild(tip);

    const show = (hit) => {
      const s = hit.star;
      t1.textContent = s.art_title || tr('untitledArtwork');
      t2.textContent = s.author_name || tr('anonymous');
      t3.textContent = tr(s.source === 'find' ? 'starsGameFind' : 'starsGameColor')
        + (s.level ? ' · ' + tr(s.level === 1 ? 'cgLevelEasy' : s.level === 3 ? 'cgLevelHard' : 'cgLevelNormal') : '');
      if (s.thumb) { img.src = cdnUrl(s.thumb); img.style.display = ''; } else img.style.display = 'none';
      // getScreenCTM, not a width ratio: the sky is drawn with
      // preserveAspectRatio=slice, so the two axes can scale differently
      // from the box and a ratio would put the card in the wrong place.
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

  // ---------- the strip: every constellation, pick one ----------
  function renderStrip() {
    const wrap = $('stStripWrap'), strip = $('stStrip');
    if (!wrap || !strip) return;
    strip.innerHTML = '';
    if (groups.length < 1) { wrap.hidden = true; return; }
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
          stroke: lit ? night.accent : 'rgba(255,255,255,.14)', 'stroke-width': lit ? 2 : 1.2,
          'stroke-linecap': 'round',
        }));
      });
      shape.stars.forEach(([x, y], k) => {
        const s = g.stars[k];
        svg.appendChild(el('circle', {
          cx: x, cy: y, r: s ? 4.6 : 2,
          fill: s ? (s.source === 'find' ? FIND : COLOR) : 'rgba(255,255,255,.22)',
        }));
      });
      const no = document.createElement('span');
      no.className = 'st-chip-no';
      no.textContent = g.index + 1;
      const nm = document.createElement('span');
      nm.className = 'st-chip-name';
      nm.textContent = constellationName(g.index);
      b.append(svg, no, nm);
      b.addEventListener('click', () => { picked = i; renderStage(); renderStrip(); });
      strip.appendChild(b);
    });
    wrap.hidden = false;
  }

  // ---------- "Different Us": six drawn badges ----------
  // Each emblem is its own little picture rather than a star glyph — the six
  // conditions say different things, so they should not look alike.
  function badgeEmblem(key, won) {
    const id = 'bg' + (++uidN);
    const svg = el('svg', { viewBox: '0 0 72 72', class: 'st-emblem' + (won ? ' won' : ''), 'aria-hidden': 'true' });
    const defs = el('defs', {});
    const rg = el('radialGradient', { id: id + 'r', cx: '.5', cy: '.34', r: '.78' });
    rg.appendChild(el('stop', { offset: '0', 'stop-color': won ? 'rgba(255,217,142,.34)' : 'rgba(255,255,255,.07)' }));
    rg.appendChild(el('stop', { offset: '1', 'stop-color': 'rgba(255,255,255,0)' }));
    const f = el('filter', { id: id + 'g', x: '-80%', y: '-80%', width: '260%', height: '260%' });
    f.appendChild(el('feGaussianBlur', { stdDeviation: won ? 2.4 : 0.001, result: 'b' }));
    const mg = el('feMerge', {});
    mg.appendChild(el('feMergeNode', { in: 'b' }));
    mg.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    f.appendChild(mg);
    defs.append(rg, f);
    svg.appendChild(defs);

    const ink = won ? '#FFD98E' : 'rgba(255,255,255,.34)';
    const ink2 = won ? '#9EC7FF' : 'rgba(255,255,255,.22)';
    svg.appendChild(el('circle', { cx: 36, cy: 36, r: 33, fill: `url(#${id}r)` }));
    svg.appendChild(el('circle', {
      cx: 36, cy: 36, r: 32, fill: 'none',
      stroke: won ? 'rgba(255,217,142,.5)' : 'rgba(255,255,255,.13)', 'stroke-width': 1.3,
    }));
    const art = el('g', { filter: `url(#${id}g)` });
    const dot = (x, y, r, c) => art.appendChild(el('circle', { cx: x, cy: y, r, fill: c || ink }));
    const path = (d, c, w) => art.appendChild(el('path', { d, fill: c === 'none' ? 'none' : (c || ink), stroke: c === 'none' ? (w ? ink : ink) : 'none', 'stroke-width': w || 0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const spark = (x, y, r, c) => art.appendChild(el('path', { d: sparkPath(r), fill: c || ink, transform: `translate(${x} ${y})` }));
    const ring = (x, y, r, c, w) => art.appendChild(el('circle', { cx: x, cy: y, r, fill: 'none', stroke: c || ink, 'stroke-width': w || 1.6 }));

    if (key === 'artists5' || key === 'artists10') {
      // People around a shared centre — five apart, ten closer together.
      const n = key === 'artists5' ? 5 : 10;
      const R = key === 'artists5' ? 17 : 19;
      ring(36, 36, R, won ? 'rgba(255,217,142,.35)' : 'rgba(255,255,255,.14)', 1.1);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const x = 36 + Math.cos(a) * R, y = 36 + Math.sin(a) * R;
        // a head and a shoulder line: a person, not just a dot
        dot(x, y - 1.6, n === 5 ? 3.1 : 2.4, i % 2 ? ink2 : ink);
        art.appendChild(el('path', {
          d: `M${x - (n === 5 ? 3.4 : 2.6)} ${y + (n === 5 ? 4.6 : 3.6)} q${n === 5 ? 3.4 : 2.6} ${n === 5 ? -3.6 : -2.8} ${n === 5 ? 6.8 : 5.2} 0`,
          fill: 'none', stroke: i % 2 ? ink2 : ink, 'stroke-width': n === 5 ? 1.9 : 1.5, 'stroke-linecap': 'round',
        }));
      }
      spark(36, 36, n === 5 ? 7 : 6);
    } else if (key === 'bothGames') {
      // A lens and a palette, side by side: the two games on one artwork.
      ring(27, 30, 9, ink, 2.4);
      path('M33.6 36.6 L41 44', 'none', 2.8);
      art.appendChild(el('circle', { cx: 27, cy: 30, r: 9, fill: won ? 'rgba(255,217,142,.14)' : 'rgba(255,255,255,.05)' }));
      dot(49, 26, 4.2, ink2);
      dot(55, 35, 3.4, ink);
      dot(47, 39, 3, ink2);
      ring(50, 33, 11, won ? 'rgba(158,199,255,.4)' : 'rgba(255,255,255,.13)', 1.1);
    } else if (key === 'hardLevel') {
      // A peak with a flare at the summit.
      path('M13 50 L26 30 L33 39 L44 21 L59 50 Z', won ? 'rgba(255,217,142,.22)' : 'rgba(255,255,255,.07)');
      path('M13 50 L26 30 L33 39 L44 21 L59 50', 'none', 2.2);
      path('M40 27 L44 21 L48.5 29 L44 31 Z', ink2);
      spark(44, 17, 7.5);
    } else if (key === 'sameDay3') {
      // Three stars over one horizon: three in a single day.
      path('M12 48 A 24 24 0 0 1 60 48', 'none', 1.8);
      art.appendChild(el('path', { d: 'M12 48 L60 48', stroke: won ? 'rgba(255,217,142,.4)' : 'rgba(255,255,255,.16)', 'stroke-width': 1.2, fill: 'none' }));
      spark(24, 34, 6, ink2);
      spark(36, 24, 8.5);
      spark(48, 33, 6.5, ink2);
    } else if (key === 'stars20') {
      // A cluster: one big star held by many small ones.
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
    const both = new Set();
    const byArtwork = new Map();
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
      const nm = document.createElement('b');
      nm.textContent = tr('conBadge_' + b.key);
      const hint = document.createElement('span');
      // Clamp so a finished badge reads (5/5), not (6/5).
      hint.textContent = tr('conBadgeHint_' + b.key, { have: Math.min(have[b.key] || 0, b.need) });
      txt.append(nm, hint);
      li.appendChild(txt);
      host.appendChild(li);
    }
    wrap.hidden = false;
  }

  // ---------- the shared whale ----------
  // The centrepiece. The outline is one path, not 48 separate lines, so a
  // light can travel along the part that is finished; the silhouette behind
  // it brightens as the sky fills, which is the progress bar people
  // actually look at.
  function whaleD(from, to) {
    let d = '';
    for (let i = from; i <= to; i++) {
      const [x, y] = WHALE_STARS[i % WHALE_STARS.length];
      d += (i === from ? 'M' : 'L') + x + ' ' + y + ' ';
    }
    return d.trim();
  }
  function renderWhale(rows) {
    const wrap = $('stWhaleWrap'), host = $('stWhale'), list = $('stWhaleList');
    if (!wrap || !host) return;
    if (!rows || settings.starsShowWhale === false) { wrap.hidden = true; return; }
    const total = WHALE_STARS.length;
    // Once a sky is FULL the next completion starts the one after it. Using
    // ceil (not floor) keeps an exactly-full whale on screen instead of
    // blanking it the moment it is finished.
    const skies = rows.length ? Math.ceil(rows.length / total) : 1;
    const lit = rows.slice((skies - 1) * total);
    const done = lit.length >= total;
    host.innerHTML = ''; list.innerHTML = '';

    const svg = el('svg', { viewBox: `0 0 ${WHALE_SKY.w} ${WHALE_SKY.h}`, class: 'st-whale-svg', role: 'img' });
    svg.setAttribute('aria-label', tr('starsWhaleTitle'));
    const defs = skyDefs(svg, '#9EC7FF');
    // Its own gradients: the body wash and the aurora behind it.
    const gid = 'wh' + (++uidN);
    const dd = el('defs', {});
    const body = el('radialGradient', { id: gid + 'b', cx: '.42', cy: '.4', r: '.72' });
    body.appendChild(el('stop', { offset: '0', 'stop-color': '#9EC7FF', 'stop-opacity': '.55' }));
    body.appendChild(el('stop', { offset: '.55', 'stop-color': '#7B86FF', 'stop-opacity': '.3' }));
    body.appendChild(el('stop', { offset: '1', 'stop-color': '#4B3FA8', 'stop-opacity': '.08' }));
    const aur = el('linearGradient', { id: gid + 'a', x1: '0', y1: '0', x2: '1', y2: '.4' });
    aur.appendChild(el('stop', { offset: '0', 'stop-color': '#5BE7C4', 'stop-opacity': '0' }));
    aur.appendChild(el('stop', { offset: '.4', 'stop-color': '#5BE7C4', 'stop-opacity': '.30' }));
    aur.appendChild(el('stop', { offset: '.7', 'stop-color': '#A78BFA', 'stop-opacity': '.26' }));
    aur.appendChild(el('stop', { offset: '1', 'stop-color': '#A78BFA', 'stop-opacity': '0' }));
    const blur = el('filter', { id: gid + 'f', x: '-40%', y: '-60%', width: '180%', height: '260%' });
    blur.appendChild(el('feGaussianBlur', { stdDeviation: 26 }));
    dd.append(body, aur, blur);
    svg.appendChild(dd);

    // aurora: two soft ribbons drifting behind the whale
    const a1 = el('path', { d: 'M-60 150 C 240 60, 560 250, 1060 120 L1060 220 C 560 340, 240 160, -60 250 Z', fill: `url(#${gid}a)`, filter: `url(#${gid}f)`, class: 'st-aurora' });
    const a2 = el('path', { d: 'M-60 330 C 300 240, 640 430, 1060 300 L1060 400 C 640 520, 300 350, -60 430 Z', fill: `url(#${gid}a)`, filter: `url(#${gid}f)`, class: 'st-aurora st-aurora-2', opacity: .7 });
    svg.append(a1, a2);
    scatter(svg, WHALE_SKY.w, WHALE_SKY.h, 3, 190);
    meteor(svg, WHALE_SKY.w * 0.92, 70, 3);
    meteor(svg, WHALE_SKY.w * 0.38, 46, 9);
    meteor(svg, WHALE_SKY.w * 0.66, 130, 16);

    // the body: faint from the first star, luminous when the sky is full
    const frac = lit.length / total;
    const silhouette = el('path', {
      d: whaleD(0, total) + ' Z', fill: `url(#${gid}b)`,
      opacity: (0.06 + frac * 0.5).toFixed(3),
      class: 'st-whale-body' + (done ? ' full' : ''),
    });
    svg.appendChild(silhouette);

    // the outline: the unfinished part dashed, the finished part a glowing
    // gradient with a light running along it
    svg.appendChild(el('path', {
      d: whaleD(0, total) + ' Z', fill: 'none',
      stroke: 'rgba(255,255,255,.09)', 'stroke-width': 1.3, 'stroke-dasharray': '5 10', 'stroke-linecap': 'round',
    }));
    if (lit.length > 1) {
      const dLit = whaleD(0, lit.length - 1) + (done ? ' Z' : '');
      svg.appendChild(el('path', { d: dLit, fill: 'none', stroke: defs.line, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: defs.soft, opacity: .95 }));
      const flow = el('path', { d: dLit, fill: 'none', stroke: '#ffffff', 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-dasharray': '46 520', opacity: .9, filter: defs.glow, class: 'st-flow' });
      svg.appendChild(flow);
    }

    // bubbles rising past it
    const br = rnd(21);
    for (let i = 0; i < 14; i++) {
      const b = el('circle', {
        cx: (br() * WHALE_SKY.w).toFixed(0), cy: (WHALE_SKY.h - 10).toFixed(0),
        r: (br() * 3.4 + 1.2).toFixed(1), fill: 'none',
        stroke: 'rgba(190,220,255,.5)', 'stroke-width': .9, class: 'st-bubble',
      });
      b.style.animationDelay = (br() * 16).toFixed(1) + 's';
      b.style.animationDuration = (11 + br() * 12).toFixed(1) + 's';
      svg.appendChild(b);
    }

    WHALE_STARS.forEach(([x, y], i) => {
      const row = lit[i];
      if (!row) {
        const d = el('circle', { cx: x, cy: y, r: 3, fill: 'rgba(255,255,255,.26)', class: 'st-empty-dot' });
        d.style.animationDelay = ((i * 0.31) % 4) + 's';
        svg.appendChild(d);
        return;
      }
      const mine = me.id && row.user_id === me.id;
      const c = mine ? '#9EFFBF' : '#FFF4D6';
      const halo = el('circle', { cx: x, cy: y, r: mine ? 16 : 13, fill: c, opacity: .3, filter: defs.soft, class: 'st-halo' });
      const spark = el('path', { d: sparkPath(mine ? 18 : 15), fill: c, opacity: .92, filter: defs.glow, class: 'st-spark', transform: `translate(${x} ${y})` });
      const core = el('circle', { cx: x, cy: y, r: mine ? 4.6 : 3.8, fill: '#fff', class: 'st-core' });
      const d = (i * 0.37) % 4;
      spark.style.animationDelay = d + 's'; halo.style.animationDelay = (d + 1) + 's'; core.style.animationDelay = d + 's';
      const t = el('title');
      t.textContent = tr('starsWhaleBy', { name: row.username || tr('starsWhaleAnon'), nth: row.constellation });
      spark.appendChild(t);
      svg.append(halo, spark, core);
    });

    // The eye opens once the head is drawn — the moment the whale stops
    // being a dot-to-dot and starts looking back.
    if (lit.length >= 4) {
      const eye = el('g', { class: 'st-whale-eye' });
      eye.appendChild(el('circle', { cx: 132, cy: 236, r: 13, fill: '#9EC7FF', opacity: .3, filter: defs.soft }));
      eye.appendChild(el('circle', { cx: 132, cy: 236, r: 5.2, fill: '#ffffff' }));
      eye.appendChild(el('circle', { cx: 133.6, cy: 234.6, r: 1.8, fill: '#0b1226' }));
      svg.appendChild(eye);
    }
    host.appendChild(svg);

    const cap = Math.max(1, Number(settings.whaleStarsPerPlayer) || 3);
    $('stWhaleLead').textContent = tr('starsWhaleLead', { cap });
    const mineCount = me.id ? lit.filter(r => r.user_id === me.id).length : 0;
    const bits = [tr('starsWhaleProgress', { n: lit.length, total })];
    if (mineCount) bits.push(tr('starsWhaleMine', { n: mineCount }));
    if (done) bits.push(tr('starsWhaleDone'));
    const meta = document.createElement('p');
    meta.className = 'st-whale-meta' + (done ? ' done' : '');
    meta.textContent = bits.join(' · ');
    list.appendChild(meta);

    const recent = lit.slice(-8).reverse();
    if (recent.length) {
      const ul = document.createElement('ul');
      ul.className = 'st-whale-rows';
      for (const r of recent) {
        const li = document.createElement('li');
        const who = document.createElement(r.username && r.user_id ? 'a' : 'span');
        if (who.tagName === 'A') who.href = profileUrl(r.user_id);
        who.textContent = r.username || tr('starsWhaleAnon');
        const nth = document.createElement('span');
        nth.className = 'st-whale-nth';
        nth.textContent = tr('starsConstellationCount', { n: r.constellation });
        li.append(who, nth);
        ul.appendChild(li);
      }
      list.appendChild(ul);
    }
    wrap.hidden = false;
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
    // Share what is on the stage when it is finished, otherwise the newest.
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
  async function loadWhale() {
    const { data, error } = await sb.rpc('whale_stars', { p_limit: 400 });
    if (error) {
      if (error.code !== 'PGRST202' && error.code !== '42883') console.error('stars: whale_stars error:', error);
      return null;
    }
    return data || [];
  }

  // ---------- render ----------
  function hideSky() {
    $('stStage').hidden = true;
    $('stStripWrap').hidden = true;
  }
  function renderMine(res) {
    const empty = $('stEmpty');
    myStars = res.rows;
    groups = groupIntoConstellations(myStars);
    // Open on the one being worked on; if every one is finished, the newest.
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
    renderStage();
    renderStrip();
    renderSpecial(myStars);
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
    await load();
    renderWhale(await loadWhale());
  })();

  // Signing in or out changes whose sky this is.
  document.addEventListener('weavo:authchange', () => { load(); });

})();
