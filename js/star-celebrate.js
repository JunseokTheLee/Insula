// The moment a game finish completes a constellation: a full-screen
// celebration over the result screen — the constellation's colour blooms,
// its stars light one by one, the lines draw between them, the painted
// animal comes up out of the dark and a burst of sparks goes off.
// Needs js/i18n/{en,ko}.js (tr), js/constellations.js and js/sky-figures.js
// loaded first (js/tarot.js is optional — with it, "get the card" hands over
// to the constellation's tarot card). Used by js/game.js and js/coloring.js.
// No library: CSS keyframes for the figure, one canvas for the sparks.
// prefers-reduced-motion shows the finished figure at once, with no sparks.
"use strict";

// Called by a result screen with the player's star count after the finish.
// `isNew` is the game's own "a star was awarded" flag; only then can this
// finish have completed a constellation. Returns true when it celebrated.
function celebrateNewConstellation(total, isNew) {
  if (!isNew || !Number.isFinite(total) || total <= 0) return false;
  if (typeof constellationProgress !== 'function') return false;
  const p = constellationProgress(total);
  if (!p.finished) return false;
  showConstellationCelebration(p.index - 1);
  return true;
}

let scOpen = null; // { el, stop } while the overlay is up

function showConstellationCelebration(index) {
  if (scOpen) closeConstellationCelebration();
  const shape = constellationShape(index);
  const figure = typeof SKY_FIGURES !== 'undefined' ? SKY_FIGURES[shape.key] : null;
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const NS = 'http://www.w3.org/2000/svg';
  const n = shape.stars.length;
  // Timeline (seconds): stars light one by one, then the lines draw, then
  // the animal and the name come up together with the burst.
  const STAR_AT = 0.7, STAR_STEP = Math.min(0.14, 1.6 / n);
  const LINE_AT = STAR_AT + n * STAR_STEP + 0.1, LINE_STEP = Math.min(0.1, 1 / Math.max(1, shape.links.length));
  const REVEAL_AT = LINE_AT + shape.links.length * LINE_STEP + 0.25;

  const el = document.createElement('div');
  el.className = 'sc-overlay' + (reduced ? ' sc-still' : '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'scName');
  el.style.setProperty('--sc-accent', shape.accent);
  el.style.setProperty('--sc-reveal', REVEAL_AT + 's');

  const canvas = document.createElement('canvas');
  canvas.className = 'sc-sparks';
  canvas.setAttribute('aria-hidden', 'true');
  el.appendChild(canvas);

  const card = document.createElement('div');
  card.className = 'sc-card';

  const kicker = document.createElement('div');
  kicker.className = 'sc-kicker';
  kicker.textContent = '✦ ' + tr('conCelebrateKicker');
  card.appendChild(kicker);

  const fig = document.createElement('div');
  fig.className = 'sc-figure';
  fig.setAttribute('aria-hidden', 'true');
  const bloom = document.createElement('div');
  bloom.className = 'sc-bloom';
  fig.appendChild(bloom);
  if (figure && figure.img) {
    const img = document.createElement('img');
    img.className = 'sc-animal';
    img.src = figure.img.src;
    img.alt = '';
    const [bx, by, bw, bh] = figure.img.box;
    img.style.left = bx + '%'; img.style.top = by + '%';
    img.style.width = bw + '%'; img.style.height = bh + '%';
    // A painting that fails to load leaves the stars and lines — the same
    // choice the sky page makes.
    img.onerror = () => img.remove();
    fig.appendChild(img);
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-4 -4 108 108');
  shape.links.forEach(([p, q], j) => {
    const ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', shape.stars[p][0]); ln.setAttribute('y1', shape.stars[p][1]);
    ln.setAttribute('x2', shape.stars[q][0]); ln.setAttribute('y2', shape.stars[q][1]);
    ln.setAttribute('pathLength', '1');
    ln.setAttribute('class', 'sc-link');
    ln.style.animationDelay = (LINE_AT + j * LINE_STEP) + 's';
    svg.appendChild(ln);
  });
  shape.stars.forEach(([x, y], i) => {
    // Position on the <g>, the pop on the inner circles: a CSS transform on
    // the same element would replace the SVG transform attribute (the same
    // trap css/stars.css notes).
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${x} ${y})`);
    const inner = document.createElementNS(NS, 'g');
    inner.setAttribute('class', 'sc-star');
    inner.style.animationDelay = (STAR_AT + i * STAR_STEP) + 's';
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('r', '5.5'); halo.setAttribute('class', 'sc-star-halo');
    const core = document.createElementNS(NS, 'circle');
    core.setAttribute('r', '2.1'); core.setAttribute('class', 'sc-star-core');
    inner.append(halo, core);
    g.appendChild(inner);
    svg.appendChild(g);
  });
  fig.appendChild(svg);
  card.appendChild(fig);

  const name = document.createElement('h2');
  name.className = 'sc-name sc-late';
  name.id = 'scName';
  name.textContent = constellationName(index);
  const line = document.createElement('p');
  line.className = 'sc-line sc-late';
  line.textContent = constellationLine(index);
  const meta = document.createElement('p');
  meta.className = 'sc-meta sc-late';
  meta.textContent = tr('conCelebrateMeta', { group: constellationGroup(index), sky: nightName(index), n });
  card.append(name, line, meta);

  const actions = document.createElement('div');
  actions.className = 'sc-actions sc-late';
  const view = document.createElement('a');
  view.className = 'sc-btn sc-btn-primary';
  view.href = `/${window.CURRENT_LANG || 'en'}/stars`;
  view.textContent = tr('conCelebrateView');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'sc-btn';
  close.textContent = tr('conCelebrateClose');
  close.onclick = closeConstellationCelebration;
  // The constellation's tarot card (js/tarot.js, 2026-10-07): the
  // celebration steps aside and the card flips in. Only when the page has
  // tarot.js; "my sky" then becomes the secondary link.
  if (typeof openTarotCard === 'function') {
    const cardBtn = document.createElement('button');
    cardBtn.type = 'button';
    cardBtn.className = 'sc-btn sc-btn-primary';
    cardBtn.textContent = tr('conCelebrateCard');
    cardBtn.onclick = () => { closeConstellationCelebration(); openTarotCard(index, [index]); };
    view.className = 'sc-btn';
    actions.append(cardBtn, view, close);
  } else {
    actions.append(view, close);
  }
  card.appendChild(actions);
  el.appendChild(card);

  el.addEventListener('click', e => { if (e.target === el || e.target === canvas) closeConstellationCelebration(); });
  document.body.appendChild(el);
  document.addEventListener('keydown', scOnKey, true);
  // A forced layout rather than rAF, so the fade starts together with the
  // keyframe timeline (rAF can lag or pause while the tab is hidden).
  void el.offsetWidth;
  el.classList.add('open');
  try { close.focus({ preventScroll: true }); } catch (e) { /* old browsers */ }

  const stop = reduced ? () => {} : runSparks(canvas, shape.accent, REVEAL_AT * 1000);
  scOpen = { el, stop };
}

function closeConstellationCelebration() {
  if (!scOpen) return;
  const { el, stop } = scOpen;
  scOpen = null;
  stop();
  document.removeEventListener('keydown', scOnKey, true);
  el.classList.remove('open');
  setTimeout(() => el.remove(), 300);
}

// Capture phase, so Escape closes this first instead of whatever the result
// screen underneath would do with it.
function scOnKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeConstellationCelebration(); }
}

// Twinkling dust across the whole screen from the start, one burst of sparks
// from the figure at `burstMs`, and a couple of shooting stars after it.
// Returns a stop function; the loop also ends by itself once the burst has
// settled, leaving only the dust, which stops ten seconds in.
function runSparks(canvas, accent, burstMs) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  const size = () => {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  window.addEventListener('resize', size);
  const dust = Array.from({ length: 90 }, () => ({
    x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.3,
    ph: Math.random() * Math.PI * 2, sp: 0.8 + Math.random() * 2,
  }));
  const COLORS = [accent, '#FFD98E', '#FFFFFF', '#9EC7FF'];
  const sparks = [];
  const shooters = [];
  let burst = false;
  const t0 = performance.now();
  let raf = 0, stopped = false;
  const frame = now => {
    if (stopped) return;
    const t = now - t0;
    ctx.clearRect(0, 0, W, H);
    // dust
    const dustFade = Math.min(1, t / 600) * (t > 9000 ? Math.max(0, 1 - (t - 9000) / 1000) : 1);
    for (const d of dust) {
      const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(d.ph + t / 1000 * d.sp))) * dustFade;
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2); ctx.fill();
    }
    // the burst, from the figure's centre
    if (!burst && t >= burstMs) {
      burst = true;
      const fig = canvas.parentNode && canvas.parentNode.querySelector('.sc-figure');
      const r = fig ? fig.getBoundingClientRect() : { left: W / 2, top: H / 2, width: 0, height: 0 };
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      for (let i = 0; i < 140; i++) {
        const ang = Math.random() * Math.PI * 2;
        const v = 2 + Math.random() * 6.5;
        sparks.push({ x: cx, y: cy, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 1.5,
          life: 1, decay: 0.007 + Math.random() * 0.012, r: 1 + Math.random() * 2.4,
          c: COLORS[i % COLORS.length], star: i % 7 === 0 });
      }
      for (let k = 0; k < 2; k++) {
        shooters.push({ at: t + 500 + k * 1300, x: W * (0.15 + 0.5 * Math.random()), y: H * (0.05 + 0.2 * Math.random()),
          vx: 9 + Math.random() * 4, vy: 4 + Math.random() * 2, life: 1 });
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vx *= 0.985; s.vy = s.vy * 0.985 + 0.07;
      s.life -= s.decay;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.c;
      if (s.star) drawTwinkle(ctx, s.x, s.y, s.r * 2.2);
      else { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }
    }
    for (let i = shooters.length - 1; i >= 0; i--) {
      const s = shooters[i];
      if (t < s.at) continue;
      s.x += s.vx; s.y += s.vy; s.life -= 0.016;
      if (s.life <= 0) { shooters.splice(i, 1); continue; }
      const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 12, s.y - s.vy * 12);
      g.addColorStop(0, 'rgba(255,255,255,' + s.life + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 12, s.y - s.vy * 12); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (t > 10000 && burst && !sparks.length && !shooters.length) { stop(); return; }
    raf = requestAnimationFrame(frame);
  };
  function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', size);
  }
  raf = requestAnimationFrame(frame);
  return stop;
}
function drawTwinkle(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, rr = i % 2 ? r * 0.3 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}
