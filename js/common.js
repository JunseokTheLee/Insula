// Shared helpers used across every page. Loaded after supabase-client.js
// and the page's js/i18n/{en,ko}.js (which define tr()/T/CURRENT_LANG).
"use strict";

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

// Submissions/profile links are user-supplied — only ever wire up http(s)
// links as an href so a submission can't sneak in a javascript: URI.
function safeHref(url) {
  try {
    const u = new URL(url, location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Every profile link (in the topnav, an artwork byline, a comment author, a
// graph node) points here — a real page in this same language directory.
function profileUrl(userId) {
  return `profile.html?user=${encodeURIComponent(userId)}`;
}

async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${me.id}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('artwork').upload(path, file, { cacheControl: '3600' });
  if (error) { console.error('uploadImage error:', error); toast(tr('imageUploadFailed', { msg: error.message })); return null; }
  return sb.storage.from('artwork').getPublicUrl(path).data.publicUrl;
}

// ---------- confirm dialog ----------
// `confirmText`, when given, gates the OK button behind an input field
// that must match it exactly — used for the highest-stakes destructive
// actions (e.g. deleting an account) where a plain OK/Cancel click is too
// easy to hit by accident.
function confirmDialog(message, { title = tr('areYouSure'), okLabel = tr('continueLabel'), confirmText = null } = {}) {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-ok').textContent = okLabel;
    const modal = document.getElementById('confirm-modal');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    const inputWrap = document.getElementById('confirm-input-wrap');
    const input = document.getElementById('confirm-input');
    const finish = result => { modal.classList.remove('open'); input.oninput = null; resolve(result); };
    if (confirmText) {
      inputWrap.style.display = '';
      input.value = '';
      input.placeholder = confirmText;
      okBtn.disabled = true;
      input.oninput = () => { okBtn.disabled = input.value !== confirmText; };
    } else {
      inputWrap.style.display = 'none';
      input.oninput = null;
      okBtn.disabled = false;
    }
    okBtn.onclick = () => { if (!okBtn.disabled) finish(true); };
    cancelBtn.onclick = () => finish(false);
    modal.onclick = e => { if (e.target === e.currentTarget) finish(false); };
    modal.classList.add('open');
    if (confirmText) setTimeout(() => input.focus(), 30);
  });
}

// ---------- reusable drag/drop image picker ----------
const MAX_IMG_BYTES = 8 * 1024 * 1024;
function setupPicker(containerId) {
  const el = document.getElementById(containerId);
  const input = el.querySelector('.img-input');
  const preview = el.querySelector('.img-preview');
  const placeholder = el.querySelector('.img-placeholder');
  function show(src) {
    preview.src = src;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    el.classList.add('has-img');
  }
  function loadFile(file) {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_IMG_BYTES) { toast(tr('imageTooLarge')); return; }
    el._file = file;
    el._removed = false;
    const reader = new FileReader();
    reader.onload = ev => show(ev.target.result);
    reader.readAsDataURL(file);
  }
  function reset(removed) {
    el._file = null;
    el._removed = !!removed;
    input.value = '';
    preview.style.display = 'none';
    preview.src = '';
    placeholder.style.display = '';
    el.classList.remove('has-img');
  }
  input.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); });
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('drag');
    const f = e.dataTransfer.files[0]; if (f) loadFile(f);
  });
  el.querySelector('.img-remove').addEventListener('click', e => { e.stopPropagation(); reset(true); });
  return {
    getFile: () => el._file,
    wasRemoved: () => !!el._removed,
    getPreviewEl: () => preview,
    // Shows a pre-existing (already-uploaded) image without marking it as a pending file to upload.
    setExisting: url => { el._file = null; el._removed = false; url ? show(url) : reset(false); },
    reset: () => reset(false)
  };
}

// Every avatar (artwork byline, comment author, artist card) links to that
// user's profile page. `sizeClass` adds a modifier (e.g. 'lb-artist-avatar')
// for larger variants.
function miniAvatarEl(name, avatarUrl, userId, sizeClass) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = sizeClass ? `mini-avatar ${sizeClass}` : 'mini-avatar';
  btn.title = name || '';
  btn.onclick = () => { location.href = profileUrl(userId); };
  if (avatarUrl) {
    const img = document.createElement('img'); img.src = avatarUrl; img.alt = '';
    btn.appendChild(img);
  } else {
    btn.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
  }
  return btn;
}

// Keys must match what the profile editor already writes into
// profiles.links (jsonb). Labels are the same in both languages.
const LINK_PLATFORMS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'twitter',   label: 'Twitter / X' },
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'website',   label: 'Website' },
];

// Points the lang-toggle buttons at the sibling page under the other
// language directory (same path + query), and marks the current one active.
function wireLangToggle() {
  const other = CURRENT_LANG === 'ko' ? 'en' : 'ko';
  document.querySelectorAll('.lang-btn').forEach(btn => {
    const isActive = btn.dataset.lang === CURRENT_LANG;
    btn.classList.toggle('active', isActive);
    if (!isActive) {
      btn.onclick = () => {
        localStorage.setItem('weavoLang', btn.dataset.lang);
        location.href = location.pathname.replace(`/${CURRENT_LANG}/`, `/${btn.dataset.lang}/`) + location.search;
      };
    }
  });
}
