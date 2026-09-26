// The thirteen constellations of the sky page, plus the helpers a game's
// result screen and the profile strip use.
// No DOM. Needs js/i18n/{en,ko}.js for tr(); the one function that reads
// the database also needs sb and me (js/supabase-client.js, js/auth.js).
// Used by js/stars.js (the sky page), js/game.js and js/coloring.js (the star
// a finished artwork awards) and js/profile-view.js (the strip). The animal
// drawings and where each constellation sits on the panorama live in
// js/sky-figures.js, which only the sky page loads.
//
// Finishing an artwork in either game lights one star. Constellations fill
// IN THE ORDER BELOW, smallest first (user decision 2026-09-26): Aries takes
// 4 stars, Scorpius 17, all thirteen 121 — and then the same thirteen start
// over as the next sky. Nothing about a constellation is stored: the order
// of a player's stars decides everything, so editing this list re-draws
// everyone's sky and needs no SQL.

// key: the i18n names (conName_/conLine_ + key). group: 'zodiac' (birthday
// constellations) or 'animal'. stars/links: the traditional stick figure on
// a 0–100 box, y growing downward, in the order the slots fill — slot k
// holds the k-th star of that constellation, so a half-finished figure is
// always the same half and a player can see what is still missing.
const CONSTELLATIONS = [
  { key: 'aries', group: 'zodiac', accent: '#FFD98E',
    stars: [[21.7, 45.1], [60.5, 7.9], [84, 14], [94.7, 26.4]],
    links: [[0, 1], [1, 2], [2, 3]] },
  { key: 'delphinus', group: 'animal', accent: '#7FE3E0',
    stars: [[21.2, 70.8], [39.2, 44.1], [53, 22.7], [72.8, 16.6], [63.7, 36.5]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] },
  { key: 'cancer', group: 'zodiac', accent: '#FFB38E',
    stars: [[54.5, 12.8], [51, 32.7], [50.7, 51.8], [21, 72], [80, 72]],
    links: [[0, 1], [1, 2], [2, 3], [2, 4]] },
  { key: 'capricornus', group: 'zodiac', accent: '#C6E58C',
    stars: [[71, 8.9], [80.1, 27], [78.5, 57.3], [90.6, 81.1], [48.3, 84.4], [6, 62.5], [20.4, 36.1], [54.4, 40.6]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 1]] },
  { key: 'phoenix', group: 'animal', accent: '#FF9E7A',
    stars: [[65.7, 21.5], [68.7, 35.8], [66.5, 50.9], [52.9, 75.1], [31.7, 31.3], [6, 10.9], [84.6, 35.8], [94.4, 12.4]],
    links: [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [1, 6], [6, 7]] },
  { key: 'leo', group: 'zodiac', accent: '#FFC96B',
    stars: [[78.8, 58], [75.8, 45.8], [71.2, 32.1], [74.2, 19.2], [86.4, 19.2], [93.9, 32.1], [27.3, 43.5], [36.4, 57.9], [14.1, 38.2]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 8], [8, 7], [7, 0], [6, 7]] },
  { key: 'cygnus', group: 'animal', accent: '#E4E8F5',
    stars: [[31.7, 84.1], [63.4, 61.5], [72.5, 43.4], [79.3, 27.5], [46.8, 44.9], [27.2, 31.3], [6, 12.4], [81.6, 56.9], [95.9, 40.3]],
    links: [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [5, 6], [1, 7], [7, 8]] },
  { key: 'pavo', group: 'animal', accent: '#7FD6C4',
    stars: [[88.4, 13.9], [89.9, 25.2], [86.1, 43.4], [69.5, 52.4], [52.9, 47.1], [27.2, 64.5], [7.6, 78.1], [28.7, 90.2], [52.9, 88.7]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [3, 6], [3, 7], [3, 8]] },
  { key: 'lepus', group: 'animal', accent: '#D9C8FF',
    stars: [[52.1, 13.1], [67.2, 12.2], [80.8, 39.9], [75.5, 52.7], [52.9, 54.2], [46.8, 66.3], [92.9, 78.4], [27.2, 70.8], [6, 86],
            [19.6, 51.2]],
    links: [[0, 2], [1, 2], [2, 3], [3, 4], [4, 9], [4, 5], [5, 6], [5, 7], [7, 8]] },
  { key: 'taurus', group: 'zodiac', accent: '#FFB08E',
    stars: [[69.5, 65.5], [69.4, 55.2], [73.2, 46.6], [77, 38.4], [71.8, 25.2], [94.4, 34.9], [55.6, 55.5], [56, 68.5], [65, 83.7],
            [89.9, 79.9], [48.3, 21]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [0, 6], [6, 7], [7, 8], [7, 9], [3, 10]] },
  { key: 'pegasus', group: 'animal', accent: '#9EC7FF',
    stars: [[71.2, 65.3], [63.6, 47.1], [42.4, 54.7], [47, 72.9], [77, 58], [78.2, 47.4], [83, 39.2], [66, 33], [77.6, 25.6],
            [87.9, 57.7], [94.7, 70.6]],
    links: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5], [5, 6], [1, 7], [7, 8], [0, 9], [9, 10]] },
  { key: 'pisces', group: 'zodiac', accent: '#8FD3FF',
    stars: [[12.1, 83.5], [31.8, 85], [53, 88.3], [68.5, 84], [81.5, 72], [88, 58], [79.5, 45], [68, 51.5], [71, 66],
            [9.1, 68.3], [22, 53.9], [27.3, 41.1], [38.8, 26.7], [50, 30.9], [36.4, 42.6]],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 4],
            [0, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 11]] },
  { key: 'scorpius', group: 'zodiac', accent: '#FF8A8A',
    stars: [[27.2, 61.8], [40.8, 64.8], [42.3, 73.9], [48.3, 82.9], [16.6, 70.8], [49.8, 64.8], [61.9, 60.3], [74, 55], [84.6, 51.2],
            [89.9, 42.1], [93.7, 31.6], [92.9, 21], [86.1, 11.9], [77, 7.4], [66.5, 10.4], [63.4, 18.7], [68.3, 28.5]],
    links: [[4, 0], [0, 1], [1, 2], [2, 3], [1, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
            [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16]] },
];
// One sky is all thirteen — 121 stars.
const SKY_SIZE = CONSTELLATIONS.length;

// ── helpers ──────────────────────────────────────────────────────────────
// Constellation index → its figure. Index 0 is the first constellation a
// player fills; index 13 is Aries again, in the second sky.
function constellationShape(index) {
  const n = CONSTELLATIONS.length;
  return CONSTELLATIONS[((index % n) + n) % n];
}
function constellationSize(index) {
  return constellationShape(index).stars.length;
}
// Kept under its old name because the profile strip reads `.accent` from it.
// `index` here is the sky the constellation belongs to (0 = the first sky).
function constellationNight(index) {
  return { index: Math.floor(index / SKY_SIZE), accent: constellationShape(index).accent };
}
// Names live in the i18n tables so both languages read naturally; a missing
// key falls back to the key itself rather than breaking the page.
function constellationName(index) {
  return tr('conName_' + constellationShape(index).key);
}
function constellationLine(index) {
  return tr('conLine_' + constellationShape(index).key);
}
function constellationGroup(index) {
  return tr('conGroup_' + constellationShape(index).group);
}
function nightName(index) {
  return tr('conSky', { n: Math.floor(index / SKY_SIZE) + 1 });
}
// How a run of stars splits into constellations:
// [{ index, stars, full, size }]. Always at least one entry.
function groupIntoConstellations(stars) {
  const out = [];
  let at = 0;
  while (at < stars.length) {
    const size = constellationSize(out.length);
    const slice = stars.slice(at, at + size);
    out.push({ index: out.length, stars: slice, full: slice.length === size, size });
    at += size;
  }
  if (!out.length) out.push({ index: 0, stars: [], full: false, size: constellationSize(0) });
  return out;
}
// Where a player with `total` stars stands: the constellation now filling,
// how many of its stars they have, and whether the last star just finished
// the one before it (then `have` is 0 and index - 1 is the finished one).
function constellationProgress(total) {
  let index = 0, start = 0;
  while (start + constellationSize(index) <= total) {
    start += constellationSize(index);
    index++;
  }
  return { index, have: total - start, size: constellationSize(index), finished: total > 0 && start === total };
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
  if (total > 0) {
    const p = constellationProgress(total);
    if (p.finished) out.push(tr('starConstellationDone', { name: constellationName(p.index - 1) }));
    else out.push(tr('starsNextIn', { n: p.size - p.have }));
  }
  return out;
}
