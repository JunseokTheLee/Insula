// Constellation tarot cards (2026-10-07, user decision).
//
// A finished constellation opens as a card: the painting with its stars and
// lines, the meaning on top (성공 · 사랑 · 우정 …), what it stands for, a
// wish and three keywords, framed in the constellation's colour. Shared by
// the sky page (tap a finished constellation — js/stars.js) and the profile
// (the strip of small cards — js/profile-view.js), so both open the very
// same card. ‹ › (and ←/→, swipe) step through the other cards passed in.
// The game result's constellation celebration hands over to the card too
// (js/star-celebrate.js), and "save / share" turns the card into a
// 1080 × 1620 picture (tarotCardBlob — the paintings are same-origin, so
// the canvas can be exported).
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
    <div class="tarot-stage"><article class="tarot-card" id="tarotCard"></article>
      <div class="tarot-actions"><button type="button" class="tarot-share" data-tarot="share">${escapeHtml(tr('tarotShare'))}</button></div></div>
    <button type="button" class="tarot-nav next" data-tarot="next" aria-label="${escapeHtml(tr('tarotNext'))}">&rsaquo;</button>`;
  el.addEventListener('click', e => {
    const act = e.target.closest('[data-tarot]');
    if (act) {
      const what = act.dataset.tarot;
      if (what === 'close') closeTarotCard();
      else if (what === 'share') shareTarotCard(act);
      else stepTarotCard(what === 'next' ? 1 : -1);
      return;
    }
    if (e.target === el || e.target.classList.contains('tarot-stage') || e.target.classList.contains('tarot-actions')) closeTarotCard();
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

// ---------- the card as a picture (save / share) ----------
// The same card drawn on a 1080 × 1620 canvas: frame, colour wash, number,
// meaning, painting with its stars and lines, name, what it stands for, the
// wish, keywords and the site. Text wraps on spaces (Korean is spaced too).
function tarotWrap(ctx, text, maxW) {
  const words = String(text || '').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
function tarotRound(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
async function tarotCardBlob(gi) {
  const W = 1080, H = 1620;
  const c = constellationShape(gi);
  const t = typeof tarotFor === 'function' ? tarotFor(c.key) : null;
  const name = constellationName(gi);
  const acc = c.accent;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const SANS = "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  const SERIF = "Georgia, 'Times New Roman', serif";
  // the gold edge, then the night inside it
  const gold = ctx.createLinearGradient(0, 0, W, H);
  gold.addColorStop(0, '#F4E3B4'); gold.addColorStop(.32, '#9D7B3D'); gold.addColorStop(.52, '#F6E8BE'); gold.addColorStop(.78, '#8A672B'); gold.addColorStop(1, '#E7CF95');
  ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H);
  tarotRound(ctx, 24, 24, W - 48, H - 48, 56); ctx.fillStyle = gold; ctx.fill();
  tarotRound(ctx, 32, 32, W - 64, H - 64, 50);
  const night = ctx.createLinearGradient(0, 0, 0, H);
  night.addColorStop(0, '#151b3c'); night.addColorStop(.62, '#0b1026'); night.addColorStop(1, '#120e28');
  ctx.fillStyle = night; ctx.fill();
  ctx.save(); tarotRound(ctx, 32, 32, W - 64, H - 64, 50); ctx.clip();
  const wash = ctx.createRadialGradient(W / 2, 640, 20, W / 2, 640, 520);
  wash.addColorStop(0, acc); wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = .3; ctx.fillStyle = wash; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  // a fixed scatter of specks (same picture every time)
  let seed = 7 + gi * 13;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 90; i++) { ctx.globalAlpha = .25 + rnd() * .6; ctx.beginPath(); ctx.arc(60 + rnd() * (W - 120), 60 + rnd() * (H - 120), .8 + rnd() * 1.8, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.restore();
  // inner double rule
  ctx.strokeStyle = 'rgba(233,210,154,.6)'; ctx.lineWidth = 2;
  tarotRound(ctx, 58, 58, W - 116, H - 116, 34); ctx.stroke();
  ctx.strokeStyle = 'rgba(233,210,154,.25)';
  tarotRound(ctx, 72, 72, W - 144, H - 144, 28); ctx.stroke();

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  // number, ornament, sky
  ctx.fillStyle = '#E9D29A';
  ctx.font = `32px ${SERIF}`;
  ctx.textAlign = 'left'; ctx.fillText(t ? t.numeral : '', 110, 140);
  const sky = Math.floor(gi / CONSTELLATIONS.length);
  ctx.textAlign = 'right'; ctx.fillText(sky ? tr('tarotSkyN', { n: sky + 1 }) : '', W - 110, 140);
  ctx.textAlign = 'center'; ctx.font = `44px ${SERIF}`; ctx.fillText('✦', W / 2, 146);
  // the meaning
  ctx.fillStyle = acc; ctx.font = `800 92px ${SANS}`;
  ctx.fillText(t ? t.word : name, W / 2, 262);
  // the painting, its lines and stars in a 660px square
  const AX = (W - 660) / 2, AY = 300, AS = 660 / 100;
  const img = tarotFigure(c.key);
  if (img) {
    try {
      const im = await loadImageEl(img.src);
      const [bx, by, bw, bh] = img.box;
      const k = Math.min(bw / im.naturalWidth, bh / im.naturalHeight);
      const dw = im.naturalWidth * k, dh = im.naturalHeight * k;
      ctx.globalAlpha = .92;
      ctx.drawImage(im, AX + (bx + (bw - dw) / 2) * AS, AY + (by + (bh - dh) / 2) * AS, dw * AS, dh * AS);
      ctx.globalAlpha = 1;
    } catch (e) { /* the stars alone */ }
  }
  const P = i => [AX + c.stars[i][0] * AS, AY + c.stars[i][1] * AS];
  ctx.strokeStyle = acc; ctx.globalAlpha = .8; ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (const [p, q] of c.links) { const [x1, y1] = P(p), [x2, y2] = P(q); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  ctx.globalAlpha = 1;
  c.stars.forEach((_, i) => {
    const [x, y] = P(i);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 40);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.3, acc); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = .55; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#FFF8E2';
    const r = 17, n = r * .26;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + n, y - n); ctx.lineTo(x + r, y); ctx.lineTo(x + n, y + n);
    ctx.lineTo(x, y + r); ctx.lineTo(x - n, y + n); ctx.lineTo(x - r, y); ctx.lineTo(x - n, y - n); ctx.closePath(); ctx.fill();
  });
  // name and the line under it
  let y = 1040;
  ctx.fillStyle = '#fff'; ctx.font = `800 70px ${SANS}`; ctx.fillText(name, W / 2, y);
  const sub = tarotSubtitle(t, name);
  if (sub) { y += 54; ctx.fillStyle = '#E9D29A'; ctx.font = `italic 36px ${SERIF}`; ctx.fillText(sub, W / 2, y); }
  if (t) {
    y += 70; ctx.fillStyle = 'rgba(244,246,255,.86)'; ctx.font = `36px ${SANS}`;
    for (const ln of tarotWrap(ctx, t.meaning, 840).slice(0, 3)) { ctx.fillText(ln, W / 2, y); y += 50; }
    y += 14; ctx.fillStyle = '#fff'; ctx.font = `700 38px ${SANS}`;
    for (const ln of tarotWrap(ctx, '“' + t.wish + '”', 860).slice(0, 2)) { ctx.fillText(ln, W / 2, y); y += 52; }
    ctx.fillStyle = 'rgba(244,246,255,.62)'; ctx.font = `italic 32px ${SERIF}`; ctx.fillText(t.line, W / 2, y + 2); y += 76;
    // keywords as pills
    ctx.font = `600 32px ${SANS}`;
    const pads = t.tags.map(x => ctx.measureText(x).width + 56);
    let x = (W - (pads.reduce((a, b) => a + b, 0) + 20 * (pads.length - 1))) / 2;
    t.tags.forEach((tag, i) => {
      tarotRound(ctx, x, y - 44, pads[i], 62, 31);
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill();
      ctx.strokeStyle = 'rgba(233,210,154,.6)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(tag, x + pads[i] / 2, y - 2);
      x += pads[i] + 20;
    });
  }
  ctx.fillStyle = 'rgba(233,210,154,.7)'; ctx.font = `italic 28px ${SERIF}`;
  ctx.fillText('Pieces of People, A Brighter Sky · weavo.art', W / 2, H - 86);
  return new Promise(res => cv.toBlob(res, 'image/png'));
}
// Phones: the share sheet with the picture. Elsewhere: copied to the
// clipboard where allowed, and saved as a file either way.
async function shareTarotCard(btn) {
  const gi = TAROT.list[TAROT.at];
  if (gi == null) return;
  if (btn) btn.disabled = true;
  try {
    const blob = await tarotCardBlob(gi);
    if (!blob) throw new Error('no image');
    const key = constellationShape(gi).key;
    const file = new File([blob], `weavo-card-${key}.png`, { type: 'image/png' });
    const t = typeof tarotFor === 'function' ? tarotFor(key) : null;
    const text = tr('tarotShareText', { name: constellationName(gi), word: t ? t.word : '' });
    const url = `${location.origin}/${CURRENT_LANG}/stars`;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text, url }); } catch (e) { /* cancelled */ }
      return;
    }
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; }
      catch (e) { console.warn('tarot: clipboard image copy refused:', e); }
    }
    const dl = document.createElement('a');
    dl.href = URL.createObjectURL(blob);
    dl.download = file.name;
    document.body.appendChild(dl); dl.click(); dl.remove();
    setTimeout(() => URL.revokeObjectURL(dl.href), 4000);
    if (typeof toast === 'function') toast(tr(copied ? 'tarotCopied' : 'tarotSaved'));
  } catch (e) {
    console.error('tarot: share failed:', e);
    if (typeof toast === 'function') toast(tr('tarotShareFailed'));
  } finally {
    if (btn) btn.disabled = false;
  }
}

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
