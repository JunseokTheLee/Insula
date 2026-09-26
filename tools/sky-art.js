// Turns a painted constellation animal (an AI image, transparent or on a
// black background) into the transparent WebP the sky page lays over its
// photograph.
//
//   node tools/sky-art.js sky/src/leo.png                → sky/con-leo.webp
//   node tools/sky-art.js sky/src                        → every picture in it
//   node tools/sky-art.js sky/src/leo.png sky/con-leo.webp --size 560 --black 16
//   node tools/sky-art.js sky/ConstellationNightSkyBackground.png sky/night-loop.webp --loop 160 --quality 82
//
// --loop is for the background photograph instead (2026-09-26, the sky page
// scrolls round without end): its last --loop pixels are cross-faded into
// its first ones, so its right edge runs on into its left edge with no seam,
// and the result is stretched back to the original width — a few per cent,
// invisible in a starry sky — so every position in js/sky-figures.js stays
// where it was. Nothing is keyed or trimmed in this mode.
//
// What it does, in a headless Chrome (no npm packages needed):
//   1. a transparent picture keeps its own alpha; one on an opaque black
//      ground is keyed — a pixel's alpha is its brightest channel above the
//      --black threshold, and its colour is scaled back up so the animal
//      looks the same laid over the night sky as it did on black;
//   2. the empty margin is trimmed (plus --pad percent);
//   3. the longer side is scaled to --size pixels and saved as WebP.
// It prints the new size and where the animal sat in the source, which is
// what js/sky-figures.js `img.box` is worked out from.
//
// Chrome is looked for in the usual places; set CHROME=... to point at it.
// This folder is not served (functions/tools/[[path]].js answers 404).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

function usage(msg) {
  if (msg) console.error('sky-art: ' + msg);
  console.error('usage: node tools/sky-art.js <input image | folder> [output.webp] [--size 560] [--black 16] [--pad 3] [--quality 80] [--dust 6] [--astep 4] [--loop px]');
  process.exit(2);
}
const args = process.argv.slice(2);
const opt = { size: 560, black: 16, pad: 3, quality: 80, dust: 6, astep: 4, loop: 0 };
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const k = a.slice(2), v = Number(args[++i]);
    if (!(k in opt) || !Number.isFinite(v)) usage('bad option ' + a);
    opt[k] = v;
  } else files.push(a);
}
if (!files.length || files.length > 2) usage();
const input = path.resolve(files[0]);
if (!fs.existsSync(input)) usage('no such file: ' + input);
// A folder converts every picture in it: sky/src/leo.png → sky/con-leo.webp.
const target = name => path.join(__dirname, '..', 'sky', `con-${name.replace(/\.[^.]+$/, '')}.webp`);
const jobs = [];
if (opt.loop && (fs.statSync(input).isDirectory() || !files[1])) usage('--loop takes one photograph and an output file, e.g. sky/night-loop.webp');
if (fs.statSync(input).isDirectory()) {
  if (files[1]) usage('give a folder on its own: each picture becomes sky/con-<name>.webp');
  for (const f of fs.readdirSync(input).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort()) jobs.push([path.join(input, f), target(f)]);
  if (!jobs.length) usage('no pictures in ' + input);
} else jobs.push([input, path.resolve(files[1] || target(path.basename(input)))]);

function findChrome() {
  const list = [process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const p of list) if (p && fs.existsSync(p)) return p;
  usage('Chrome not found — set CHROME to its path');
}

// The page does the pixel work and leaves a JSON result in <pre id="out">;
// Chrome's --dump-dom hands that back to us.
const page = `<!doctype html><meta charset="utf-8"><pre id="out">pending</pre><script>
const O = ${JSON.stringify(opt)};
const out = document.getElementById('out');
const img = new Image();
img.onerror = () => { out.textContent = JSON.stringify({ error: 'the image did not load' }); };
img.onload = () => {
  try {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const im = cx.getImageData(0, 0, W, H), p = im.data;
    if (O.loop > 0) {
      // The seamless loop: column x < B blends the photo's own column x into
      // the column B before its right edge (smoothstep), so the last column
      // kept (W - B - 1) meets the first one (≈ W - B) without a seam.
      const B = Math.round(O.loop), Pw = W - B;
      if (B < 8 || Pw < W / 2) { out.textContent = JSON.stringify({ error: '--loop must be between 8 and half the width' }); return; }
      const lp = new ImageData(Pw, H), d = lp.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < Pw; x++) {
        const o = (y * Pw + x) * 4, a = (y * W + x) * 4;
        if (x >= B) { d[o] = p[a]; d[o + 1] = p[a + 1]; d[o + 2] = p[a + 2]; d[o + 3] = 255; continue; }
        const u = x / B, t = u * u * (3 - 2 * u), b = (y * W + W - B + x) * 4;
        for (let c = 0; c < 3; c++) d[o + c] = p[a + c] * t + p[b + c] * (1 - t);
        d[o + 3] = 255;
      }
      const lc = document.createElement('canvas'); lc.width = Pw; lc.height = H;
      lc.getContext('2d').putImageData(lp, 0, 0);
      const o = document.createElement('canvas'); o.width = W; o.height = H;
      const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high';
      ox.drawImage(lc, 0, 0, W, H);                      // back to the original width
      const url = o.toDataURL('image/webp', O.quality / 100);
      if (!url.startsWith('data:image/webp')) { out.textContent = JSON.stringify({ error: 'this Chrome cannot write WebP' }); return; }
      out.textContent = JSON.stringify({ source: [W, H], crop: [0, 0, Pw, H], size: [W, H], url, loop: B });
      return;
    }
    // A picture that is already transparent (most AI tools can export one)
    // keeps its own alpha — re-deriving it from brightness would turn its
    // faint glow opaque. Only a picture on an opaque ground is keyed on
    // black. Either way the faintest dust is dropped and alpha is rounded to
    // steps of --astep, which WebP stores far more compactly.
    let clear = 0, probes = 0;
    for (let i = 3; i < p.length; i += 4 * 101) { probes++; if (p[i] < 250) clear++; }
    const keyed = clear < probes * 0.05;
    const t0 = O.black, span = 255 - t0, step = Math.max(1, O.astep);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, m = Math.max(p[i], p[i + 1], p[i + 2]);
      let a;
      if (keyed) {
        a = m <= t0 ? 0 : (m - t0) / span * 255;
        if (a > 0) { const k = 255 / m; p[i] = Math.min(255, p[i] * k); p[i + 1] = Math.min(255, p[i + 1] * k); p[i + 2] = Math.min(255, p[i + 2] * k); }
      } else a = p[i + 3];
      a = a < O.dust ? 0 : Math.min(255, Math.round(a / step) * step);
      p[i + 3] = a;
      if (!a) { p[i] = p[i + 1] = p[i + 2] = 0; continue; }
      if (a > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) { out.textContent = JSON.stringify({ error: 'nothing but black' }); return; }
    cx.putImageData(im, 0, 0);
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * O.pad / 100);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, s = Math.min(1, O.size / Math.max(cw, ch));
    const ow = Math.round(cw * s), oh = Math.round(ch * s);
    const o = document.createElement('canvas'); o.width = ow; o.height = oh;
    const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high';
    ox.drawImage(cv, x0, y0, cw, ch, 0, 0, ow, oh);
    const url = o.toDataURL('image/webp', O.quality / 100);
    if (!url.startsWith('data:image/webp')) { out.textContent = JSON.stringify({ error: 'this Chrome cannot write WebP' }); return; }
    out.textContent = JSON.stringify({ source: [W, H], crop: [x0, y0, cw, ch], size: [ow, oh], url });
  } catch (e) { out.textContent = JSON.stringify({ error: String(e) }); }
};
img.src = new URLSearchParams(location.search).get('src');
</script>`;
const tmp = path.join(os.tmpdir(), `sky-art-${process.pid}.html`);
fs.writeFileSync(tmp, page);
const chrome = findChrome();
const r1 = n => Math.round(n * 10) / 10;
try {
  for (const [src, output] of jobs) {
    const url = pathToFileURL(tmp).href + '?src=' + encodeURIComponent(pathToFileURL(src).href);
    const dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files',
      '--virtual-time-budget=15000', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
    if (!m) usage('Chrome gave nothing back for ' + src);
    const res = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    if (res.error) usage(res.error + ' (' + src + ')');
    fs.writeFileSync(output, Buffer.from(res.url.split(',')[1], 'base64'));
    const kb = (fs.statSync(output).size / 1024).toFixed(0);
    // Where the picture goes in its 0–100 box, centred: the `box` of
    // js/sky-figures.js (tools/sky-editor.html works it out the same way).
    const [w, h] = res.size, bw = w >= h ? 100 : 100 * w / h, bh = w >= h ? 100 * h / w : 100;
    console.log(`${path.relative(process.cwd(), output)}  ${w}x${h}  ${kb} KB  (from ${res.source[0]}x${res.source[1]}, crop ${res.crop.join(',')})`
      + (res.loop ? `  seamless loop, ${res.loop}px cross-fade` : `  box: [${[(100 - bw) / 2, (100 - bh) / 2, bw, bh].map(r1).join(', ')}]`));
  }
} finally { fs.unlinkSync(tmp); }
