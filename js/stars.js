// The sky page (/{lang}/stars) — one player's stars grouped into
// constellations, the "Different Us" badge constellation, and the whale
// everybody builds together.
// Needs sb, me, tr, common.js (getSiteSettings/toast/openArtworkById/
// profileUrl), lightbox.js (the artwork a star opens) and constellations.js
// (the shapes) already loaded.
//
// Everything drawn here comes from ONE read of user_star_list plus one of
// whale_stars (supabase_stars.sql). Stars are awarded by DB triggers when a
// game is finished, so this page only ever reads.
"use strict";

(function stars() {
  const root = document.getElementById('starsPage');
  if (!root) return;
  const $ = id => document.getElementById(id);

  let settings = {};
  let viewId = null;          // whose sky is on screen
  let viewName = '';
  let myStars = [];           // the list, already in the order they light
  let whale = [];

  const FIND_COLOR = '#FFD98E';
  const COLOR_COLOR = '#9EC7FF';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    const n = document.createElementNS(SVG_NS, name);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  const isMine = () => !!(me.id && viewId === me.id);

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

  // ---------- one constellation, drawn into a group ----------
  // ox/oy place it inside the night's 300×200 field; the shapes are authored
  // on a 0–100 square and shrink to 80 so neighbours do not touch.
  function drawConstellation(g, group, ox, oy, accent) {
    const shape = constellationShape(group.index);
    const at = i => [ox + 10 + shape.stars[i][0] * 0.8, oy + 10 + shape.stars[i][1] * 0.8];
    for (const [a, b] of shape.links) {
      const [x1, y1] = at(a), [x2, y2] = at(b);
      const lit = group.stars[a] && group.stars[b];
      g.appendChild(el('line', {
        x1, y1, x2, y2,
        stroke: lit ? accent : 'rgba(255,255,255,.10)',
        'stroke-width': lit ? 0.9 : 0.6,
        'stroke-dasharray': lit ? null : '2 3',
      }));
    }
    shape.stars.forEach((_, i) => {
      const [x, y] = at(i);
      const star = group.stars[i];
      if (!star) {
        g.appendChild(el('circle', { cx: x, cy: y, r: 1.1, fill: 'rgba(255,255,255,.18)' }));
        return;
      }
      const colour = star.source === 'find' ? FIND_COLOR : COLOR_COLOR;
      // A colouring star earned on the hard board burns a little bigger.
      const r = 2.2 + (star.level >= 3 ? 0.9 : star.level >= 2 ? 0.4 : 0);
      const halo = el('circle', { cx: x, cy: y, r: r + 2.4, fill: colour, opacity: .16 });
      const dot = el('circle', { cx: x, cy: y, r, fill: colour, class: 'st-star' });
      dot.setAttribute('tabindex', '0');
      dot.setAttribute('role', 'button');
      const title = star.art_title || tr('untitledArtwork');
      const game = tr(star.source === 'find' ? 'starsGameFind' : 'starsGameColor');
      const label = `${title} · ${star.author_name || tr('anonymous')} · ${game}`;
      dot.setAttribute('aria-label', label);
      const t = el('title'); t.textContent = label; dot.appendChild(t);
      const open = () => {
        if (!star.alive) { toast(tr('starsGoneArtwork')); return; }
        if (typeof openArtworkById === 'function') openArtworkById(star.artwork_id);
        else location.href = artworkUrl(star.artwork_id);
      };
      dot.addEventListener('click', open);
      dot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      g.append(halo, dot);
    });
  }

  // ---------- a night: up to six constellations on one field ----------
  function nightEl(groups, nightIndex) {
    const night = constellationNight(groups[0].index);
    const box = document.createElement('section');
    box.className = 'st-night';
    box.style.setProperty('--st-accent', night.accent);

    const head = document.createElement('div');
    head.className = 'st-night-head';
    const h = document.createElement('h3');
    h.textContent = nightName(groups[0].index);
    const count = document.createElement('span');
    const full = groups.filter(g => g.full).length;
    count.className = 'st-night-count';
    count.textContent = tr('starsConstellationCount', { n: full });
    head.append(h, count);

    const svg = el('svg', { viewBox: '0 0 300 200', class: 'st-sky', role: 'img' });
    svg.setAttribute('aria-label', nightName(groups[0].index));
    // Faint thread from one constellation to the next: the night reads as one
    // growing figure rather than six separate doodles.
    groups.forEach((g, k) => {
      if (k === 0 || !groups[k - 1].full) return;
      const prev = groups[k - 1];
      const pShape = constellationShape(prev.index), cShape = constellationShape(g.index);
      const pc = [(k - 1) % 3, Math.floor((k - 1) / 3)], cc = [k % 3, Math.floor(k / 3)];
      const last = pShape.stars[pShape.stars.length - 1], first = cShape.stars[0];
      svg.appendChild(el('line', {
        x1: pc[0] * 100 + 10 + last[0] * 0.8, y1: pc[1] * 100 + 10 + last[1] * 0.8,
        x2: cc[0] * 100 + 10 + first[0] * 0.8, y2: cc[1] * 100 + 10 + first[1] * 0.8,
        stroke: 'rgba(255,255,255,.14)', 'stroke-width': 0.5, 'stroke-dasharray': '1 4',
      }));
    });
    groups.forEach((g, k) => {
      const grp = el('g', {});
      drawConstellation(grp, g, (k % 3) * 100, Math.floor(k / 3) * 100, night.accent);
      svg.appendChild(grp);
    });

    const caps = document.createElement('ol');
    caps.className = 'st-caps';
    caps.start = groups[0].index + 1;
    for (const g of groups) {
      const li = document.createElement('li');
      li.className = 'st-cap' + (g.full ? ' done' : '');
      const nm = document.createElement('b');
      nm.textContent = constellationName(g.index);
      const line = document.createElement('span');
      line.textContent = g.full ? constellationLine(g.index)
        : tr('starsNextIn', { n: STAR_CONSTELLATION_SIZE - g.stars.length });
      li.append(nm, line);
      caps.appendChild(li);
    }
    box.append(head, svg, caps);
    return box;
  }

  // ---------- "Different Us": six badges, not six artworks ----------
  // Every test reads the star list that is already on screen, so nothing new
  // is stored and a badge can never disagree with the sky above it.
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
    const bestDay = Math.max(0, ...perDay.values());
    const hard = list.some(s => s.source === 'color' && s.level >= 3);
    return {
      artists5: artists.size, bothGames: both.size, hardLevel: hard ? 1 : 0,
      sameDay3: bestDay, artists10: artists.size, stars20: list.length,
    };
  }
  function renderSpecial(list) {
    const wrap = $('stSpecialWrap'), host = $('stSpecial');
    if (!wrap || !host) return;
    const have = starBadges(list);
    host.innerHTML = '';

    const svg = el('svg', { viewBox: '0 0 100 100', class: 'st-sky st-sky-special', role: 'img' });
    svg.setAttribute('aria-label', tr('starsSpecialTitle'));
    const sp = CONSTELLATION_SPECIAL;
    const won = sp.badges.map(b => (have[b.key] || 0) >= b.need);
    for (const [a, b] of sp.links) {
      svg.appendChild(el('line', {
        x1: sp.stars[a][0], y1: sp.stars[a][1], x2: sp.stars[b][0], y2: sp.stars[b][1],
        stroke: won[a] && won[b] ? '#FFD98E' : 'rgba(255,255,255,.10)',
        'stroke-width': won[a] && won[b] ? 0.9 : 0.6,
        'stroke-dasharray': won[a] && won[b] ? null : '2 3',
      }));
    }
    sp.stars.forEach(([x, y], i) => {
      if (won[i]) svg.appendChild(el('circle', { cx: x, cy: y, r: 5, fill: '#FFD98E', opacity: .18 }));
      svg.appendChild(el('circle', { cx: x, cy: y, r: won[i] ? 2.8 : 1.2, fill: won[i] ? '#FFD98E' : 'rgba(255,255,255,.18)' }));
    });

    const ul = document.createElement('ul');
    ul.className = 'st-badges';
    sp.badges.forEach((b, i) => {
      const li = document.createElement('li');
      li.className = 'st-badge' + (won[i] ? ' won' : '');
      const mark = document.createElement('span');
      mark.className = 'st-badge-mark';
      mark.textContent = won[i] ? '★' : '☆';
      mark.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      const nm = document.createElement('b');
      nm.textContent = tr('conBadge_' + b.key);
      const hint = document.createElement('span');
      hint.textContent = tr('conBadgeHint_' + b.key, { have: have[b.key] || 0 });
      txt.append(nm, hint);
      li.append(mark, txt);
      ul.appendChild(li);
    });
    host.append(svg, ul);
    wrap.hidden = false;
  }

  // ---------- the shared whale ----------
  function renderWhale(rows) {
    const wrap = $('stWhaleWrap'), host = $('stWhale'), list = $('stWhaleList');
    if (!wrap || !host) return;
    if (!rows || settings.starsShowWhale === false) { wrap.hidden = true; return; }
    whale = rows;
    const total = WHALE_STARS.length;
    // Once a sky is FULL the next completion starts the one after it. Using
    // ceil (not floor) keeps an exactly-full whale on screen instead of
    // blanking it the moment it is finished.
    const skies = rows.length ? Math.ceil(rows.length / total) : 1;
    const lit = rows.slice((skies - 1) * total);
    host.innerHTML = ''; list.innerHTML = '';

    const svg = el('svg', { viewBox: `0 0 ${WHALE_SKY.w} ${WHALE_SKY.h}`, class: 'st-whale-svg', role: 'img' });
    svg.setAttribute('aria-label', tr('starsWhaleTitle'));
    for (const [a, b] of WHALE_LINKS) {
      const on = a < lit.length && b < lit.length;
      svg.appendChild(el('line', {
        x1: WHALE_STARS[a][0], y1: WHALE_STARS[a][1], x2: WHALE_STARS[b][0], y2: WHALE_STARS[b][1],
        stroke: on ? 'rgba(158,199,255,.65)' : 'rgba(255,255,255,.07)',
        'stroke-width': on ? 2 : 1.2, 'stroke-dasharray': on ? null : '4 8',
      }));
    }
    WHALE_STARS.forEach(([x, y], i) => {
      const row = lit[i];
      if (!row) { svg.appendChild(el('circle', { cx: x, cy: y, r: 2.4, fill: 'rgba(255,255,255,.16)' })); return; }
      const mine = me.id && row.user_id === me.id;
      const c = mine ? '#9EFFBF' : '#FFF4D6';
      svg.appendChild(el('circle', { cx: x, cy: y, r: 11, fill: c, opacity: .14 }));
      const dot = el('circle', { cx: x, cy: y, r: mine ? 6 : 5, fill: c, class: 'st-star' });
      const who = row.username || tr('starsWhaleAnon');
      const t = el('title'); t.textContent = tr('starsWhaleBy', { name: who, nth: row.constellation });
      dot.appendChild(t);
      svg.appendChild(dot);
    });
    host.appendChild(svg);

    const cap = Math.max(1, Number(settings.whaleStarsPerPlayer) || 3);
    $('stWhaleLead').textContent = tr('starsWhaleLead', { cap });
    const mineCount = me.id ? lit.filter(r => r.user_id === me.id).length : 0;
    const bits = [tr('starsWhaleProgress', { n: lit.length, total })];
    if (mineCount) bits.push(tr('starsWhaleMine', { n: mineCount }));
    if (lit.length >= total) bits.push(tr('starsWhaleDone'));
    const meta = document.createElement('p');
    meta.className = 'st-whale-meta';
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
    const groups = groupIntoConstellations(list);
    const full = groups.filter(g => g.full).length;
    const week = Date.now() - 7 * 86400000;
    const recent = list.filter(s => Date.parse(s.earned_at) >= week).length;
    const rest = list.length % STAR_CONSTELLATION_SIZE;
    const bits = [
      tr('starsCount', { n: list.length }),
      tr('starsConstellationCount', { n: full }),
    ];
    if (list.length) bits.push(tr('starsNextIn', { n: STAR_CONSTELLATION_SIZE - rest }));
    if (recent) bits.push(tr('starsThisWeek', { n: recent }));
    host.textContent = bits.join(' · ');
  }

  // ---------- share ----------
  function shareCanvas(group) {
    const W = 1200, H = 630;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1020'); bg.addColorStop(1, '#131a2e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // A scatter of faint background stars, seeded so the card is reproducible.
    let seed = group.index * 9301 + 49297;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    for (let i = 0; i < 120; i++) { ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, rnd() * 1.4 + .3, 0, 7); ctx.fill(); }

    const shape = constellationShape(group.index);
    const night = constellationNight(group.index);
    const S = 3.4, ox = W / 2 - 50 * S, oy = 110;
    const at = i => [ox + shape.stars[i][0] * S, oy + shape.stars[i][1] * S];
    ctx.strokeStyle = night.accent; ctx.lineWidth = 2.2;
    for (const [a, b] of shape.links) {
      const [x1, y1] = at(a), [x2, y2] = at(b);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    shape.stars.forEach((_, i) => {
      const [x, y] = at(i);
      const s = group.stars[i];
      const c = !s ? 'rgba(255,255,255,.2)' : s.source === 'find' ? FIND_COLOR : COLOR_COLOR;
      ctx.fillStyle = c; ctx.globalAlpha = .18;
      ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = '#F4F6FF';
    ctx.font = 'bold 46px Pretendard, sans-serif';
    ctx.fillText(constellationName(group.index), W / 2, 512);
    ctx.fillStyle = 'rgba(244,246,255,.72)';
    ctx.font = '24px Pretendard, sans-serif';
    ctx.fillText(constellationLine(group.index), W / 2, 552);
    ctx.fillStyle = 'rgba(244,246,255,.5)';
    ctx.font = '20px Pretendard, sans-serif';
    ctx.fillText('weavo.art', W / 2, 596);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  async function shareConstellation() {
    const btn = $('stShare');
    const groups = groupIntoConstellations(myStars).filter(g => g.full);
    if (!groups.length) { toast(tr('starsShareNone')); return; }
    const group = groups[groups.length - 1];
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

  // ---------- render ----------
  function renderMine(res) {
    const nights = $('stNights'), empty = $('stEmpty');
    nights.innerHTML = '';
    myStars = res.rows;
    renderSummary(myStars);

    $('stMineTitle').textContent = isMine() || !viewName
      ? tr('starsMineTitle') : tr('starsOtherTitle', { name: viewName });

    if (res.missing) { empty.textContent = tr('starsOff'); empty.hidden = false; return; }
    if (res.failed) { empty.textContent = tr('starsLoadFailed'); empty.hidden = false; return; }
    if (!myStars.length) {
      empty.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = isMine() || !viewId ? tr('starsEmptyMine') : tr('starsEmptyOther');
      empty.appendChild(p);
      if (isMine() || !viewId) {
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
    const groups = groupIntoConstellations(myStars);
    for (let i = 0; i < groups.length; i += CONSTELLATIONS_PER_NIGHT) {
      nights.appendChild(nightEl(groups.slice(i, i + CONSTELLATIONS_PER_NIGHT), i / CONSTELLATIONS_PER_NIGHT));
    }
    renderSpecial(myStars);
  }

  async function load() {
    const params = new URLSearchParams(location.search);
    const wanted = params.get('user');
    viewId = wanted || me.id || null;
    viewName = '';
    const owner = $('stOwner');

    if (!viewId) {
      $('stSummary').textContent = '';
      $('stNights').innerHTML = '';
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
        $('stSummary').textContent = '';
        $('stNights').innerHTML = '';
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
