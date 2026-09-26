// What the sky page shows for each constellation in js/constellations.js:
// the painted animal, and where it sits on the panorama.
// No DOM. Loaded by {en,ko}/stars.html and tools/sky-editor.html only.
//
// SKY_W × SKY_H is the photograph's own size (sky/night.webp) and every
// position here is in its pixels, so an animal stays on the same patch of
// sky however large the panorama is shown. `at` is [x, y, size]: the
// constellation's 0–100 box (the same box its stars use) is placed at
// (x, y) and shown `size` pixels wide. `label` (same box) is where the name
// goes; without it the name sits centred just under the box.
//
// The animals are AI paintings (user decision 2026-09-26, from a reference
// the user sent): `img` = { src, box } — a transparent WebP under /sky/,
// laid over the 0–100 box at `box` = [x, y, width, height]. The sources are
// sky/src/<key>.png (not committed); tools/sky-art.js makes the WebP (it
// keeps a transparent picture's own alpha, keys one on a black ground,
// trims the margin). The stars in js/constellations.js were placed on each
// painting — a new painting needs its stars placed again, which is what
// tools/sky-editor.html is for (it prints both lines back out).
//
// Placement: the first four to fill sit in the dark sky on the left, so a
// newcomer sees them without scrolling; Cygnus and Scorpius lie in the
// Milky Way as the real ones do; nothing reaches below y 640, where the
// horizon, the island and the trees start.
//
// /sky/ is cached for a week (_headers): a replaced painting takes a new
// ?v= in its `src`; the photograph, which has none, takes a new file name.
const SKY_IMAGE = '/sky/night.webp';
const SKY_W = 1916, SKY_H = 821;

const SKY_FIGURES = {
  aries: { at: [40, 385, 205], label: [50, 103], img: { src: '/sky/con-aries.webp?v=20260926', box: [0.2, 0, 99.6, 100] } },
  delphinus: { at: [50, 110, 205], label: [50, 94.3], img: { src: '/sky/con-delphinus.webp?v=20260926', box: [0, 8.8, 100, 82.5] } },
  cancer: { at: [265, 385, 215], label: [50, 97.5], img: { src: '/sky/con-cancer.webp?v=20260926', box: [0, 5.5, 100, 88.9] } },
  capricornus: { at: [270, 105, 245], label: [50, 103], img: { src: '/sky/con-capricornus.webp?v=20260926', box: [0.1, 0, 99.8, 100] } },
  phoenix: { at: [790, 80, 255], label: [50, 103], img: { src: '/sky/con-phoenix.webp?v=20260926', box: [0, 0, 100, 100] } },
  leo: { at: [535, 110, 240], label: [50, 95.1], img: { src: '/sky/con-leo.webp?v=20260926', box: [0, 7.9, 100, 84.1] } },
  cygnus: { at: [880, 385, 250], label: [50, 97.9], img: { src: '/sky/con-cygnus.webp?v=20260926', box: [0, 5.1, 100, 89.8] } },
  pavo: { at: [1190, 395, 235], label: [50, 103], img: { src: '/sky/con-pavo.webp?v=20260926', box: [0, 0, 100, 100] } },
  lepus: { at: [1440, 400, 225], label: [50, 95.7], img: { src: '/sky/con-lepus.webp?v=20260926', box: [0, 7.3, 100, 85.4] } },
  taurus: { at: [1450, 110, 235], label: [50, 92], img: { src: '/sky/con-taurus.webp?v=20260926', box: [0, 11, 100, 78] } },
  pegasus: { at: [1690, 95, 220], label: [50, 103], img: { src: '/sky/con-pegasus.webp?v=20260926', box: [0, 0, 100, 100] } },
  pisces: { at: [1680, 375, 230], label: [50, 103], img: { src: '/sky/con-pisces.webp?v=20260926', box: [0, 0, 100, 100] } },
  scorpius: { at: [1175, 95, 255], label: [50, 102.3], img: { src: '/sky/con-scorpius.webp?v=20260926', box: [0, 0.7, 100, 98.6] } },
};
