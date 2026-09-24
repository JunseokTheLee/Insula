// Constellation shapes, plus the two helpers a game's result screen uses.
// No DOM. Needs js/i18n/{en,ko}.js for tr(); the one function that reads
// the database also needs sb and me (js/supabase-client.js, js/auth.js).
// Used by js/stars.js (the sky page), js/game.js and js/coloring.js (the star
// a finished artwork awards) and js/profile-view.js (the strip).
//
// Finishing an artwork in either game lights one star; STAR_CONSTELLATION_SIZE
// of them make a constellation. Constellations are drawn from the pool below
// IN ORDER and the pool cycles, so the sky keeps growing however many artworks
// the site ends up with: with 22 public artworks a player can reach 7
// constellations, with 100 they can reach 33 (user asked, 2026-09-21). Adding
// more shapes here is the only thing needed to keep them varied — no SQL, no
// migration. Six constellations make a NIGHT, which carries its own name and
// tint so the later ones still feel like new ground even when a shape returns.

// Every shape below has exactly this many slots, and a result screen
// counts down to the next constellation with it.
const STAR_CONSTELLATION_SIZE = 6;
const CONSTELLATIONS_PER_NIGHT = 6;

// Each shape: six star slots on a 0–100 square (y grows downward, like the
// canvas and SVG it is drawn into) and the lines between them. Slot k holds
// the k-th star of that constellation, so a half-finished shape is always the
// same half — a player recognises what is still missing.
const CONSTELLATION_SHAPES = [
  { key: 'firstStep',  stars: [[12, 78], [28, 66], [44, 70], [60, 52], [76, 44], [90, 26]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]] },
  { key: 'hope',       stars: [[18, 42], [34, 32], [42, 54], [24, 64], [58, 26], [80, 18]],
    links: [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [4, 5]] },
  { key: 'growth',     stars: [[50, 88], [50, 62], [50, 36], [28, 50], [72, 46], [50, 14]],
    links: [[0, 1], [1, 2], [2, 5], [1, 3], [2, 4]] },
  { key: 'connection', stars: [[50, 14], [82, 32], [82, 68], [50, 86], [18, 68], [18, 32]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]] },
  { key: 'courage',    stars: [[14, 78], [34, 62], [54, 46], [74, 30], [56, 22], [80, 52]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5]] },
  { key: 'company',    stars: [[12, 26], [34, 36], [56, 50], [80, 50], [12, 74], [34, 64]],
    links: [[0, 1], [1, 2], [4, 5], [5, 2], [2, 3]] },
  { key: 'quietNight', stars: [[10, 30], [26, 68], [44, 34], [62, 70], [80, 32], [94, 58]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]] },
  { key: 'wave',       stars: [[10, 58], [28, 42], [46, 60], [64, 42], [82, 60], [94, 46]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]] },
  { key: 'lantern',    stars: [[50, 12], [34, 34], [66, 34], [38, 64], [62, 64], [50, 86]],
    links: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5]] },
  { key: 'bridge',     stars: [[10, 70], [30, 40], [54, 28], [78, 42], [94, 72], [54, 62]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]] },
  { key: 'flower',     stars: [[50, 50], [50, 18], [80, 38], [70, 78], [30, 78], [20, 38]],
    links: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]] },
  { key: 'compass',    stars: [[50, 50], [50, 12], [88, 50], [50, 88], [12, 50], [74, 26]],
    links: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]] },
];

// A night's name and tint. Cycles like the shapes do.
const CONSTELLATION_NIGHTS = [
  { key: 'firstLight', accent: '#9EC7FF' },
  { key: 'wind',       accent: '#9EFFBF' },
  { key: 'tide',       accent: '#7FE3E0' },
  { key: 'woods',      accent: '#C6E58C' },
  { key: 'snow',       accent: '#E4E8F5' },
  { key: 'dawn',       accent: '#FFC98E' },
];

// ── helpers ──────────────────────────────────────────────────────────────
// Constellation index → its shape, its night, and the night's name. Index 0
// is the first constellation a player completes.
function constellationShape(index) {
  return CONSTELLATION_SHAPES[((index % CONSTELLATION_SHAPES.length) + CONSTELLATION_SHAPES.length) % CONSTELLATION_SHAPES.length];
}
function constellationNight(index) {
  const n = Math.floor(index / CONSTELLATIONS_PER_NIGHT);
  return { index: n, ...CONSTELLATION_NIGHTS[((n % CONSTELLATION_NIGHTS.length) + CONSTELLATION_NIGHTS.length) % CONSTELLATION_NIGHTS.length] };
}
// Names live in the i18n tables so both languages read naturally; a missing
// key falls back to the key itself rather than breaking the page.
function constellationName(index) {
  return tr('conName_' + constellationShape(index).key);
}
function constellationLine(index) {
  return tr('conLine_' + constellationShape(index).key);
}
function nightName(index) {
  const n = constellationNight(index);
  return tr('conNight_' + n.key, { n: n.index + 1 });
}
// How a run of stars splits into constellations: [{ index, stars, full }].
function groupIntoConstellations(stars) {
  const out = [];
  for (let i = 0; i < stars.length; i += STAR_CONSTELLATION_SIZE) {
    const slice = stars.slice(i, i + STAR_CONSTELLATION_SIZE);
    out.push({ index: out.length, stars: slice, full: slice.length === STAR_CONSTELLATION_SIZE });
  }
  if (!out.length) out.push({ index: 0, stars: [], full: false });
  return out;
}

// ── result screens ───────────────────────────────────────────────────
// How many stars the player has now. Null when signed out or when the SQL
// file has not been applied yet — the caller then says nothing about stars
// rather than showing a wrong number.
async function fetchStarCount() {
  if (typeof me === 'undefined' || !me.id) return null;
  try {
    const { data, error } = await sb.rpc('user_star_list', { p_user_id: me.id, p_limit: 400 });
    if (error) { if (error.code !== 'PGRST202' && error.code !== '42883') console.error('stars: count failed:', error); return null; }
    return (data || []).length;
  } catch (e) { console.error('stars: count failed:', e); return null; }
}
// What a result screen says about the sky. `isNew` comes from the game's
// own "first time on this artwork" flag (finish_game.first_record /
// save_pixel_progress.first_completion), which is exactly when a star is
// awarded — so the two can never disagree.
function starAwardLines(total, isNew) {
  const out = [];
  if (!Number.isFinite(total)) return out;
  if (isNew) out.push(tr('starNewFound'));
  if (total > 0 && total % STAR_CONSTELLATION_SIZE === 0) {
    out.push(tr('starConstellationDone', { name: constellationName(total / STAR_CONSTELLATION_SIZE - 1) }));
  } else if (total > 0) {
    out.push(tr('starsNextIn', { n: STAR_CONSTELLATION_SIZE - (total % STAR_CONSTELLATION_SIZE) }));
  }
  return out;
}
