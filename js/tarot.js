// Constellation tarot cards (2026-10-07, user decision).
//
// A finished constellation opens as a card: the painting with its stars and
// lines, the meaning on top (성공 · 사랑 · 우정 …), what it stands for, a
// wish and three keywords, framed in the constellation's colour. Shared by
// the sky page (tap a finished constellation — js/stars.js) and the profile
// (the strip of small cards — js/profile-view.js), so both open the very
// same card. ‹ › (and ←/→, swipe) step through the other cards passed in.
//
// Needs tr/CURRENT_LANG (js/i18n), escapeHtml (common.js) and
// constellations.js (constellationShape/Name/Line, tarotFor) loaded first;
// sky-figures.js (the paintings) is optional — without it the card shows
// the stars and lines alone. Styles: css/tarot.css.
"use strict";

const TAROT = { el: null, list: [], at: 0, back: null, uid: 0 };

function tarotFigure(key) {
  return (typeof SKY_FIGURES !== 'undefined' && SKY_FIGURES[key] && SKY_FIGURES[key].img) || null;
}
// Under the name: the English name and the animal on the Korean page
// ("Leo · Lion"), just the animal on the English one — never the same word
// twice ("Phoenix · Phoenix").
function tarotSubtitle(t, name) {
  if (!t) return '';
  const parts = CURRENT_LANG === 'ko' ? [t.en, t.animal] : [t.animal];
  return parts.filter((p, i, all) => p && p !== name && all.indexOf(p) === i).join(' · ');
}
function tarotArtSvg(gi) {
  const c = constellationShape(gi);
  const img = tarotFigure(c.key);
  const box = img ? img.box : [0, 0, 100, 100];
  const id = 'tarotGlow' + (++TAROT.uid);
  const pt = i => c.stars[i];
  const lines = c.links.map(([p, q]) => `<line x1="${pt(p)[0]}" y1="${pt(p)[1]}" x2="${pt(q)[0]}" y2="${pt(q)[1]}"/>`).join('');
  const sparkle = (x, y, r) => `<path d="M${x} ${y - r}L${x + r * .26} ${y - r * .26}L${x + r} ${y}L${x + r * .26} ${y + r * .26}L${x} ${y + r}L${x - r * .26} ${y + r * .26}L${x - r} ${y}L${x - r * .26} ${y - r * .26}Z"/>`;
  const stars = c.stars.map(([x, y], i) => `<g class="tarot-star" style="--d:${(i * .23).toFixed(2)}s"><circle cx="${x}" cy="${y}" r="6" fill="url(#${id})"/>${sparkle(x, y, 2.6)}</g>`).join('');
  return `<svg class="tarot-svg" viewBox="-10 -10 120 120" aria-hidden="true">
    <defs><radialGradient id="${id}"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".3" style="stop-color:var(--acc)" stop-opacity=".45"/><stop offset="1" style="stop-color:var(--acc)" stop-opacity="0"/></radialGradient></defs>
    ${img ? `<image href="${img.src}" x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" preserveAspectRatio="xMidYMid meet" class="tarot-fig"/>` : ''}
    <g class="tarot-lines">${lines}</g><g class="tarot-stars">${stars}</g>
  </svg>`;
}
function buildTarotOverlay() {
  const el = document.createElement('div');
  el.className = 'modal-overlay tarot-overlay';
  el.id = 'tarotOverlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'tarotName');
  el.innerHTML = `
    <button type="button" class="tarot-x" data-tarot="close" aria-label="${escapeHtml(tr('tarotClose'))}">&times;</button>
    <button type="button" class="tarot-nav prev" data-tarot="prev" aria-label="${escapeHtml(tr('tarotPrev'))}">&lsaquo;</button>
    <div class="tarot-stage"><article class="tarot-card" id="tarotCard"></article></div>
    <button type="button" class="tarot-nav next" data-tarot="next" aria-label="${escapeHtml(tr('tarotNext'))}">&rsaquo;</button>`;
  el.addEventListener('click', e => {
    const act = e.target.closest('[data-tarot]');
    if (act) {
      if (act.dataset.tarot === 'close') closeTarotCard();
      else stepTarotCard(act.dataset.tarot === 'next' ? 1 : -1);
      return;
    }
    if (e.target === el || e.target.classList.contains('tarot-stage')) closeTarotCard();
  });
  // Swipe between cards on a touch screen.
  let x0 = null;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) stepTarotCard(dx < 0 ? 1 : -1);
  }, { passive: true });
  document.body.appendChild(el);
  return el;
}
function renderTarotCard(gi, flip) {
  const c = constellationShape(gi);
  const t = typeof tarotFor === 'function' ? tarotFor(c.key) : null;
  const card = document.getElementById('tarotCard');
  card.style.setProperty('--acc', c.accent);
  const name = constellationName(gi);
  const sky = Math.floor(gi / CONSTELLATIONS.length);
  card.innerHTML = `
    <div class="tarot-sheen" aria-hidden="true"></div>
    <div class="tarot-inner">
      <div class="tarot-top"><span class="tarot-num">${escapeHtml(t ? t.numeral : '')}</span><span class="tarot-orn" aria-hidden="true">✦</span><span class="tarot-num">${sky ? escapeHtml(tr('tarotSkyN', { n: sky + 1 })) : ''}</span></div>
      <div class="tarot-word">${escapeHtml(t ? t.word : name)}</div>
      <div class="tarot-art">${tarotArtSvg(gi)}</div>
      <h2 class="tarot-name" id="tarotName">${escapeHtml(name)}</h2>
      <div class="tarot-en">${escapeHtml(tarotSubtitle(t, name))}</div>
      ${t ? `<p class="tarot-meaning">${escapeHtml(t.meaning)}</p>
      <p class="tarot-wish">“${escapeHtml(t.wish)}”</p>
      <p class="tarot-line">${escapeHtml(t.line)}</p>
      <div class="tarot-tags">${t.tags.map(x => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : `<p class="tarot-meaning">${escapeHtml(constellationLine(gi))}</p>`}
      <div class="tarot-foot">Pieces of People, A Brighter Sky</div>
    </div>`;
  TAROT.el.querySelectorAll('.tarot-nav').forEach(b => { b.hidden = TAROT.list.length < 2; });
  card.classList.remove('flip');
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (flip && !still) { void card.offsetWidth; card.classList.add('flip'); }
}
// gi: the constellation's index over all skies (0 = the first Aries).
// list: the indexes ‹ › may step through (e.g. every finished one); gi is
// added when missing.
function openTarotCard(gi, list) {
  if (!TAROT.el) TAROT.el = buildTarotOverlay();
  TAROT.list = Array.isArray(list) && list.length ? list.slice() : [gi];
  if (!TAROT.list.includes(gi)) TAROT.list.unshift(gi);
  TAROT.at = TAROT.list.indexOf(gi);
  TAROT.back = document.activeElement;
  renderTarotCard(gi, true);
  TAROT.el.classList.add('open');
  setTimeout(() => { const x = TAROT.el.querySelector('.tarot-x'); if (x) x.focus({ preventScroll: true }); }, 40);
}
function stepTarotCard(d) {
  if (TAROT.list.length < 2) return;
  TAROT.at = (TAROT.at + d + TAROT.list.length) % TAROT.list.length;
  renderTarotCard(TAROT.list[TAROT.at], true);
}
function closeTarotCard() {
  if (!TAROT.el) return;
  TAROT.el.classList.remove('open');
  if (TAROT.back && TAROT.back.focus) try { TAROT.back.focus({ preventScroll: true }); } catch (e) { /* element gone */ }
}
function tarotCardOpen() { return !!(TAROT.el && TAROT.el.classList.contains('open')); }
// Keys while a card is open belong to the card — caught before the page's
// own handlers (the sky's Esc closes full screen, its arrows move the sky).
window.addEventListener('keydown', e => {
  if (!tarotCardOpen()) return;
  if (e.key === 'Escape') closeTarotCard();
  else if (e.key === 'ArrowRight') stepTarotCard(1);
  else if (e.key === 'ArrowLeft') stepTarotCard(-1);
  else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// A small card for a strip (the profile): frame, number, painting, meaning
// and name. A real link (href) for new-tab / crawlers; a plain click opens
// the full card with `list` to step through.
function tarotMiniEl(gi, href, list) {
  const c = constellationShape(gi);
  const t = typeof tarotFor === 'function' ? tarotFor(c.key) : null;
  const img = tarotFigure(c.key);
  const name = constellationName(gi);
  const a = document.createElement('a');
  a.className = 'tarot-mini';
  a.href = href || '#';
  a.style.setProperty('--acc', c.accent);
  a.setAttribute('aria-label', tr('starsOpenTarot', { name }));
  a.innerHTML = `<span class="tarot-mini-card"><span class="tarot-mini-inner">
      <span class="tarot-mini-num">${escapeHtml(t ? t.numeral : '')}</span>
      <span class="tarot-mini-word">${escapeHtml(t ? t.word : '')}</span>
      ${img ? `<img src="${img.src}" alt="" loading="lazy" decoding="async">` : `<span class="tarot-mini-svg">${tarotArtSvg(gi)}</span>`}
    </span></span>
    <span class="tarot-mini-name">${escapeHtml(name)}</span>`;
  a.addEventListener('click', e => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openTarotCard(gi, list);
  });
  return a;
}
