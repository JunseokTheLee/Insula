// Shared identity chrome + edit-profile modal — present on every page,
// since sign-in/onboarding can happen from anywhere. Depends on
// supabase-client.js, js/i18n/{en,ko}.js and common.js having loaded first.
// A page that needs to do something once the initial session/profile load
// finishes should `await authReady` (see below) before doing it.
"use strict";

let me = { id: '', name: '', avatar: '', isAdmin: false, username: '', bio: '', links: {}, countryId: null, disabilities: [] };

async function signIn(provider = 'google') {
  const options = { redirectTo: location.origin + location.pathname };
  // Always show Google's account chooser: without it Google silently reuses
  // the account of its current browser session, so someone who signed out
  // to switch accounts (or to leave onboarding — see renderSetupExits)
  // landed straight back in the same one (2026-09-10).
  if (provider === 'google') options.queryParams = { prompt: 'select_account' };
  await sb.auth.signInWithOAuth({ provider, options });
}
async function signOut() { await sb.auth.signOut(); }
function meFromUser(u) {
  const name = u.user_metadata.full_name || u.user_metadata.name || (u.email ? u.email.split('@')[0] : tr('anonymous'));
  return {
    id: u.id, name, avatar: u.user_metadata.avatar_url || '',
    isAdmin: false, username: '', bio: '', links: {}, countryId: null, disabilities: []
  };
}
async function loadMyProfile() {
  if (!me.id) return;
  const { data } = await sb.from('profiles').select('is_admin,username,bio,links,avatar_url,country_id,disabilities').eq('id', me.id).maybeSingle();
  me.isAdmin = !!(data && data.is_admin);
  me.username = (data && data.username) || '';
  me.bio = (data && data.bio) || '';
  me.links = (data && data.links) || {};
  me.countryId = (data && data.country_id) || null;
  me.disabilities = (data && data.disabilities) || [];
  // A custom uploaded avatar (if any) takes priority over the Google avatar
  // meFromUser() set — otherwise upsertBaseProfile() below would clobber it
  // back to the Google photo on every sign-in.
  if (data && data.avatar_url) me.avatar = data.avatar_url;
  // Read once per sign-in rather than per-render — see the file banner
  // comment on myBlockedIds in common.js for everywhere this feeds into.
  const { data: blocks, error: blocksErr } = await sb.from('user_blocks').select('blocked_id').eq('blocker_id', me.id);
  if (blocksErr) console.error('load blocked users error:', blocksErr);
  myBlockedIds = new Set((blocks || []).map(b => b.blocked_id));
}
// First sign-in (or any later sign-in before every mandatory field has
// been set — username and country) forces the edit-profile modal open in
// onboarding mode until they finish.
function maybeRequireProfileSetup() {
  if (me.id && (!me.username || !me.countryId)) {
    openEditProfileModal({ username: me.username, bio: me.bio, links: me.links, avatar_url: me.avatar, country_id: me.countryId, disabilities: me.disabilities }, true);
  }
}
// Deliberately does NOT store the OAuth account name (me.name) any more: the
// site identifies people by their chosen username everywhere, and profiles is
// publicly readable, so persisting the Google/Apple real name only ever leaked
// it through the API. Only the avatar is kept in sync here.
async function upsertBaseProfile() {
  if (!me.id) return;
  const { error } = await sb.from('profiles').upsert({ id: me.id, avatar_url: me.avatar || null });
  if (error) console.error('upsertBaseProfile error:', error);
}
function updateIdentityUI() {
  const nameEl = document.getElementById('myName');
  // Same rule as every other place a person is named (artist page, artwork
  // credits): the chosen username, falling back to the account name only
  // during onboarding before one has been set.
  nameEl.textContent = me.id ? (me.username || me.name) : tr('guest');
  nameEl.classList.toggle('guest', !me.id);
  const av = document.getElementById('myAvatar');
  if (me.avatar) { av.src = cdnUrl(me.avatar); av.alt = tr('artistAvatarAlt', { name: me.username || me.name }); av.style.display = 'inline-block'; } else { av.style.display = 'none'; }
  document.getElementById('loginBtn').style.display = me.id ? 'none' : '';
  document.getElementById('logoutBtn').style.display = me.id ? '' : 'none';
  // Admin-only shortcut to /{lang}/admin. Created on demand so none of the
  // page headers need a hidden element for it; hidden again on sign-out.
  let adminLink = document.getElementById('adminLink');
  if (me.isAdmin) {
    if (!adminLink) {
      adminLink = document.createElement('a');
      adminLink.id = 'adminLink'; adminLink.className = 'id-btn admin-link';
      adminLink.href = `/${CURRENT_LANG}/admin`;
      adminLink.textContent = tr('adminLink');
      document.getElementById('identity').insertBefore(adminLink, document.getElementById('logoutBtn'));
    }
    adminLink.style.display = '';
  } else if (adminLink) {
    adminLink.style.display = 'none';
  }
  const newProjectBtn = document.getElementById('newProjectBtn');
  if (newProjectBtn) newProjectBtn.style.display = me.isAdmin ? '' : 'none';
  const deleteAcctCta = document.getElementById('deleteAcctCta');
  if (deleteAcctCta) deleteAcctCta.textContent = me.id ? tr('myProfile') : tr('signIn');
}
document.getElementById('loginBtn').onclick = openAuthModal;
document.getElementById('logoutBtn').onclick = signOut;

function openAuthModal() { document.getElementById('auth-modal').classList.add('open'); }
function closeAuthModal() { document.getElementById('auth-modal').classList.remove('open'); }
document.getElementById('google-signin-btn').onclick = () => signIn('google');
document.getElementById('apple-signin-btn').onclick = () => signIn('apple');
document.getElementById('auth-close').onclick = closeAuthModal;
document.getElementById('auth-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAuthModal(); });

function goToMyProfile() { me.id ? (location.href = profileUrl(me.id)) : openAuthModal(); }
document.getElementById('myAvatar').onclick = goToMyProfile;
document.getElementById('myName').onclick = goToMyProfile;
const deleteAcctCtaEl = document.getElementById('deleteAcctCta');
if (deleteAcctCtaEl) deleteAcctCtaEl.onclick = goToMyProfile;

// ---------- edit profile modal ----------
// Same normalize-then-validate approach the profile editor has always used:
// accept a bare domain (no scheme) by assuming https, then reject anything
// that still isn't a real http(s) URL.
function normalizeProfileUrl(raw) {
  const v = raw.trim();
  if (!v) return '';
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}
// Built once from LINK_PLATFORMS so the input fields always match the
// profiles.links keys read/written elsewhere.
(function buildEditProfileLinkFields() {
  const wrap = document.getElementById('ep-links-fields');
  for (const { key, label } of LINK_PLATFORMS) {
    const field = document.createElement('div'); field.className = 'field';
    const labelEl = document.createElement('label');
    labelEl.htmlFor = `ep-link-${key}`; labelEl.textContent = label + ' ';
    const hint = document.createElement('span'); hint.className = 'field-hint'; hint.textContent = tr('optionalHint');
    labelEl.appendChild(hint);
    const input = document.createElement('input');
    input.type = 'text'; input.id = `ep-link-${key}`;
    field.append(labelEl, input);
    wrap.appendChild(field);
  }
})();
(function buildEditProfileCountryOptions() {
  const select = document.getElementById('ep-country');
  const countries = Object.entries(COUNTRY_NAMES)
    .sort((a, b) => a[1].localeCompare(b[1], CURRENT_LANG === 'ko' ? 'ko' : 'en'));
  for (const [id, name] of countries) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = name;
    select.appendChild(opt);
  }
})();
// Custom checkbox dropdown (not a native <select multiple>) — every option
// toggles on a plain left click instead of needing ctrl/cmd-click. Mirrors
// the add-to-exhibition dropdown pattern in lightbox.js (button + absolute
// menu of clickable <label> rows, closes on outside click / Escape).
function disabilityRowEl(key) {
  const row = document.createElement('label');
  row.className = 'ep-disabilities-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.id = `ep-disability-${key}`; cb.value = key;
  cb.onchange = () => {
    if (cb.checked) {
      const toClear = DISABILITY_EXCLUSIVE_KEYS.includes(key)
        ? DISABILITY_KEYS.filter(k => k !== key)
        : DISABILITY_EXCLUSIVE_KEYS;
      for (const otherKey of toClear) document.getElementById(`ep-disability-${otherKey}`).checked = false;
    }
    updateEpDisabilitiesSummary();
  };
  const span = document.createElement('span'); span.textContent = disabilityLabel(key);
  row.append(cb, span);
  return row;
}
(function buildEditProfileDisabilityOptions() {
  const menu = document.getElementById('ep-disabilities-menu');
  for (const key of DISABILITY_STANDALONE_KEYS) menu.appendChild(disabilityRowEl(key));
  const divider = document.createElement('div'); divider.className = 'ep-disabilities-divider';
  menu.appendChild(divider);
  for (const group of DISABILITY_GROUPS) {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'ep-disabilities-group-label';
    groupLabel.textContent = disabilityGroupLabel(group.key);
    menu.appendChild(groupLabel);
    for (const key of group.keys) menu.appendChild(disabilityRowEl(key));
  }
})();
function updateEpDisabilitiesSummary() {
  const summary = document.querySelector('#ep-disabilities-btn .ep-disabilities-summary');
  const labels = getCheckedDisabilities().map(disabilityLabel);
  summary.textContent = labels.length ? labels.join(', ') : tr('selectDisabilitiesPlaceholder');
  summary.classList.toggle('has-value', labels.length > 0);
}
function getCheckedDisabilities() {
  return DISABILITY_KEYS.filter(key => document.getElementById(`ep-disability-${key}`).checked);
}
function setCheckedDisabilities(values) {
  const set = new Set(values || []);
  for (const key of DISABILITY_KEYS) document.getElementById(`ep-disability-${key}`).checked = set.has(key);
  updateEpDisabilitiesSummary();
}
function closeEpDisabilitiesMenu() {
  document.getElementById('ep-disabilities-menu').classList.remove('open');
  document.getElementById('ep-disabilities-btn').classList.remove('open');
  document.getElementById('ep-disabilities-btn').setAttribute('aria-expanded', 'false');
}
document.getElementById('ep-disabilities-btn').addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('ep-disabilities-menu');
  const willOpen = !menu.classList.contains('open');
  closeEpDisabilitiesMenu();
  if (!willOpen) return;
  menu.classList.add('open');
  const btn = document.getElementById('ep-disabilities-btn');
  btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
});
document.addEventListener('click', e => {
  if (!document.querySelector('.ep-disabilities-wrap').contains(e.target)) closeEpDisabilitiesMenu();
});
// `forced` = true is the first-sign-in onboarding flow, or any later
// sign-in before every mandatory field (username, country) has been set:
// no Cancel, no backdrop/Escape dismissal, until they're all filled in.
let profileEditRequired = false;
// Switching language navigates to the sibling page (see wireLangToggle in
// common.js), which would silently wipe out anything typed into a
// still-open edit-profile form (this is the only modal a user can be stuck
// behind mid-onboarding) — stash the in-progress field values so they can
// be restored if this same modal reopens right after.
const EP_DRAFT_KEY = 'weavoEpDraft';
function stashEditProfileDraftIfOpen() {
  if (!document.getElementById('edit-profile-modal').classList.contains('open')) return;
  const links = {};
  for (const { key } of LINK_PLATFORMS) links[key] = document.getElementById(`ep-link-${key}`).value;
  sessionStorage.setItem(EP_DRAFT_KEY, JSON.stringify({
    username: document.getElementById('ep-username').value,
    bio: document.getElementById('ep-bio').value,
    countryId: document.getElementById('ep-country').value,
    links,
    disabilities: getCheckedDisabilities(),
  }));
}
// ---------- blocked-users list (edit-profile modal) ----------
// Small, secondary section tucked into the same modal as the danger zone —
// this is the one surface that needs the *names* behind myBlockedIds (every
// other block-related UI only ever needs the id set itself), so it fetches
// those profiles fresh each time the modal opens rather than caching them.
async function renderBlockedUsersSection(forced) {
  const section = document.getElementById('ep-blocked-section');
  const list = document.getElementById('ep-blocked-list');
  if (!section || !list) return;
  document.getElementById('ep-blocked-title').textContent = tr('blockedUsersTitle');
  if (forced || !myBlockedIds.size) { section.style.display = 'none'; list.innerHTML = ''; return; }
  section.style.display = '';
  list.innerHTML = `<div class="ep-blocked-loading">${tr('loading')}</div>`;
  const ids = [...myBlockedIds];
  const { data: profiles, error } = await sb.from('profiles').select('id,username,avatar_url').in('id', ids);
  if (error) { console.error('load blocked users error:', error); list.innerHTML = ''; return; }
  list.innerHTML = '';
  for (const p of (profiles || [])) {
    const row = document.createElement('div'); row.className = 'list-row ep-blocked-row';
    row.appendChild(miniAvatarEl(p.username || tr('anonymous'), p.avatar_url, p.id));
    const name = document.createElement('span'); name.className = 'list-name'; name.textContent = p.username || tr('anonymous');
    row.appendChild(name);
    const unblockBtn = document.createElement('button');
    unblockBtn.type = 'button'; unblockBtn.className = 'ep-blocked-unblock'; unblockBtn.textContent = tr('unblockLabel');
    unblockBtn.onclick = async () => { await toggleUserBlock(p.id, unblockBtn); renderBlockedUsersSection(forced); };
    row.appendChild(unblockBtn);
    list.appendChild(row);
  }
}
// ---------- username rules (shared by first-login onboarding and profile edit) ----------
// Kept in sync with the profiles_username_format CHECK constraint
// (supabase_profiles_username_rules.sql): 2–30 chars, trimmed, no slash or
// backslash (those break the /artists/<handle> route), and a few reserved
// handles. Deliberately still permissive about spaces and non-Latin scripts,
// so names already in use ("Seojin Oh", "박건우", …) stay valid.
const USERNAME_RESERVED = ['me', 'admin', 'null', 'undefined', 'anonymous', 'weavo'];
function usernameFormatError(name) {
  const v = (name || '').trim();
  if (v.length < 2 || v.length > 30) return 'usernameTooShort';
  if (v.indexOf('/') >= 0 || v.indexOf('\\') >= 0) return 'usernameInvalidChars';
  if (USERNAME_RESERVED.includes(v.toLowerCase())) return 'usernameReserved';
  return null; // valid
}
// Case-insensitive existence check, excluding the signed-in user's own row so
// re-saving your current name never reads as "taken". Fetches a few ilike
// candidates and confirms an exact (lowercased) hit in JS, so a literal '_'
// in a name isn't mistaken for the LIKE wildcard.
async function usernameIsTaken(name) {
  const { data, error } = await sb.from('profiles').select('id,username').ilike('username', name).limit(5);
  if (error) { console.error('username availability check error:', error); return false; }
  return (data || []).some(r => (r.username || '').toLowerCase() === name.trim().toLowerCase() && r.id !== me.id);
}
// Live hint shown under the username field so people learn a name is taken or
// malformed while typing, instead of only after submitting.
let epUsernameCheckTimer = null;
let epUsernameCheckSeq = 0;
function setUsernameHint(text, color) {
  const hint = document.getElementById('ep-username-hint');
  if (!hint) return;
  if (!text) { hint.style.display = 'none'; hint.textContent = ''; return; }
  hint.textContent = text;
  hint.style.color = color || '';
  hint.style.display = '';
}
async function refreshUsernameHint() {
  const raw = document.getElementById('ep-username').value.trim();
  if (!raw) { setUsernameHint('', ''); return; }
  const fmtErr = usernameFormatError(raw);
  if (fmtErr) { setUsernameHint(tr(fmtErr), 'var(--accent-warm)'); return; }
  const seq = ++epUsernameCheckSeq;
  setUsernameHint(tr('usernameChecking'), 'var(--muted)');
  const taken = await usernameIsTaken(raw);
  if (seq !== epUsernameCheckSeq) return; // a newer keystroke already superseded this check
  setUsernameHint(taken ? tr('usernameTakenShort') : tr('usernameAvailable'), taken ? 'var(--accent-warm)' : '#3E9B63');
}
// Propose a starter handle from the account name so first-login onboarding
// doesn't open on an empty required field. ASCII-folded for a clean URL; if the
// base is taken, append the smallest free number. Returns '' if nothing fits.
async function suggestUsername() {
  let base = (me.name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '');
  if (base.length < 2) base = 'artist';
  base = base.slice(0, 24);
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}${i + 1}`;
    if (!usernameFormatError(candidate) && !(await usernameIsTaken(candidate))) return candidate;
  }
  return '';
}

function openEditProfileModal(profile, forced) {
  // Supabase's client re-fires onAuthStateChange (e.g. on a token refresh
  // triggered by the tab regaining focus after switching away and back)
  // with the same still-incomplete profile, and that handler calls
  // maybeRequireProfileSetup() -> openEditProfileModal() unconditionally.
  // Without this guard, every one of those redundant re-fires would
  // clobber whatever the user had already typed into the still-open
  // onboarding form back to the stale profile values.
  if (document.getElementById('edit-profile-modal').classList.contains('open')) return;
  profileEditRequired = !!forced;
  closeEpDisabilitiesMenu();
  renderBlockedUsersSection(forced);
  document.getElementById('ep-country').value = profile.country_id ? String(profile.country_id) : '';
  epAvatarPicker.setExisting(cdnUrl(profile.avatar_url || me.avatar || ''));
  document.getElementById('ep-username').value = profile.username || '';
  document.getElementById('ep-bio').value = profile.bio || '';
  for (const { key } of LINK_PLATFORMS) {
    document.getElementById(`ep-link-${key}`).value = (profile.links && profile.links[key]) || '';
  }
  setCheckedDisabilities(profile.disabilities);
  const draftRaw = sessionStorage.getItem(EP_DRAFT_KEY);
  if (draftRaw) {
    sessionStorage.removeItem(EP_DRAFT_KEY);
    try {
      const draft = JSON.parse(draftRaw);
      document.getElementById('ep-username').value = draft.username || '';
      document.getElementById('ep-bio').value = draft.bio || '';
      if (draft.countryId) document.getElementById('ep-country').value = draft.countryId;
      for (const { key } of LINK_PLATFORMS) {
        document.getElementById(`ep-link-${key}`).value = (draft.links && draft.links[key]) || '';
      }
      setCheckedDisabilities(draft.disabilities);
    } catch (e) { console.error('restore edit-profile draft error:', e); }
  }
  document.getElementById('ep-error').textContent = '';
  document.getElementById('ep-dialog-title').textContent = forced ? (profile.username ? tr('completeYourProfile') : tr('welcomeToWeavo')) : tr('editProfile');
  const requiredNote = document.getElementById('ep-required-note');
  requiredNote.style.display = forced ? '' : 'none';
  requiredNote.textContent = profile.username
    ? tr('requiredNoteCountryOnly')
    : tr('requiredNoteFull');
  // Reset the live availability hint, then either validate the value that's
  // already there (edit / country-only re-onboarding) or, on a brand-new
  // first login with an empty required field, propose a starter handle.
  setUsernameHint('', '');
  const unameEl = document.getElementById('ep-username');
  if (forced && !unameEl.value.trim()) {
    suggestUsername().then(s => {
      // Only fill if the person hasn't started typing while we were checking,
      // and the modal is still the same open onboarding session.
      if (s && !unameEl.value.trim() && document.getElementById('edit-profile-modal').classList.contains('open')) {
        unameEl.value = s;
        refreshUsernameHint();
      }
    });
  } else if (unameEl.value.trim()) {
    refreshUsernameHint();
  }
  document.getElementById('ep-cancel').style.display = forced ? 'none' : '';
  document.getElementById('ep-danger-zone').style.display = forced ? 'none' : '';
  renderSetupExits(forced);
  document.getElementById('edit-profile-modal').classList.add('open');
}
function closeEditProfileModal() {
  if (profileEditRequired) return;
  document.getElementById('edit-profile-modal').classList.remove('open');
}
// ---------- onboarding exits ----------
// The forced (first sign-in) modal cannot be dismissed — Esc, the backdrop
// and the Cancel button are all disabled so nobody ends up signed in without
// a username. That left no way out at all: the overlay covers the header's
// sign-out button, the session persists, so every visit reopened the form,
// and Google kept auto-picking the same account (2026-09-10). These two
// links are the way out, built here on demand rather than in the 30 page
// copies of the modal (like the header's admin link):
//   "Not now" — sign out, back to guest. The base profile row stays, so the
//   same account simply resumes onboarding next time.
//   "Cancel sign-up" — delete the account outright; there is nothing of the
//   person's to keep yet.
function renderSetupExits(forced) {
  let box = document.getElementById('ep-setup-exits');
  if (!forced) { if (box) box.style.display = 'none'; return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'ep-setup-exits';
    box.className = 'ep-setup-exits';
    const later = document.createElement('button');
    later.type = 'button'; later.id = 'ep-setup-later'; later.className = 'link-muted';
    later.onclick = leaveOnboardingAsGuest;
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.id = 'ep-setup-cancel'; cancel.className = 'link-danger';
    cancel.onclick = e => deleteMyAccount(e.currentTarget, { signup: true });
    box.append(later, cancel);
    const actions = document.querySelector('#edit-profile-dialog .modal-actions');
    (actions || document.getElementById('ep-required-note')).insertAdjacentElement('afterend', box);
  }
  document.getElementById('ep-setup-later').textContent = tr('setupLater');
  document.getElementById('ep-setup-cancel').textContent = tr('cancelSignup');
  box.style.display = '';
}
async function leaveOnboardingAsGuest() {
  profileEditRequired = false;
  closeEditProfileModal();
  await signOut(); // onAuthStateChange(SIGNED_OUT) resets `me` and the header
  toast(tr('setupLaterDone'));
}
const epAvatarPicker = setupPicker('ep-avatar-picker');
document.getElementById('ep-cancel').onclick = closeEditProfileModal;
document.getElementById('edit-profile-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditProfileModal(); });
// Debounced live username check while typing (see refreshUsernameHint).
document.getElementById('ep-username').addEventListener('input', () => {
  clearTimeout(epUsernameCheckTimer);
  epUsernameCheckTimer = setTimeout(refreshUsernameHint, 400);
});
document.getElementById('ep-submit').onclick = async () => {
  const errorEl = document.getElementById('ep-error');
  const username = document.getElementById('ep-username').value.trim();
  const bio = document.getElementById('ep-bio').value.trim();
  const countryId = document.getElementById('ep-country').value ? parseInt(document.getElementById('ep-country').value, 10) : null;
  if (!username) { errorEl.textContent = tr('usernameRequired'); return; }
  const usernameErr = usernameFormatError(username);
  if (usernameErr) { errorEl.textContent = tr(usernameErr); return; }
  if (!countryId) { errorEl.textContent = tr('pleaseSelectCountry'); return; }
  const links = {};
  for (const { key, label } of LINK_PLATFORMS) {
    const normalized = normalizeProfileUrl(document.getElementById(`ep-link-${key}`).value);
    if (normalized === null) { errorEl.textContent = tr('invalidLinkUrl', { label }); return; }
    if (normalized) links[key] = normalized;
  }
  errorEl.textContent = '';
  const btn = document.getElementById('ep-submit');
  btn.disabled = true;
  const avatarFile = epAvatarPicker.getFile();
  let avatarUrl; // undefined = leave unchanged; null = removed; string = new upload
  if (avatarFile) {
    avatarUrl = await uploadImage(avatarFile);
    if (!avatarUrl) { btn.disabled = false; return; }
  } else if (epAvatarPicker.wasRemoved()) {
    avatarUrl = null;
  }
  const disabilities = getCheckedDisabilities();
  const payload = { id: me.id, username, bio: bio || null, links, country_id: countryId, disabilities };
  if (avatarUrl !== undefined) payload.avatar_url = avatarUrl;
  const { error } = await sb.from('profiles').upsert(payload);
  btn.disabled = false;
  if (error) {
    console.error('profile upsert error:', error);
    errorEl.textContent = error.code === '23505' ? tr('usernameTaken') : tr('couldNotSaveTryAgain');
    return;
  }
  me.username = username || '';
  me.countryId = countryId;
  me.disabilities = disabilities;
  if (avatarUrl !== undefined) me.avatar = avatarUrl || '';
  updateIdentityUI(); // the header shows the username now, so refresh it on every save, not just avatar changes
  const wasRequired = profileEditRequired;
  profileEditRequired = false;
  document.getElementById('ep-cancel').style.display = '';
  closeEditProfileModal();
  toast(wasRequired ? tr('welcomeToast') : tr('profileSavedToast'));
  if (typeof window.onProfileSaved === 'function') window.onProfileSaved();
};

// Removes every file this user has ever uploaded to the `artwork` bucket —
// avatar + artwork originals live under `${uid}/...`, thumbnails under
// `thumb/${uid}/...` (see common.js's uploadImage/uploadArtworkImage). The
// delete_own_account() RPC below only cleans up database rows (Storage
// objects aren't reachable from plain SQL — see supabase_delete_account_storage.sql
// for the RLS policies this needs), and this has to run *before* that RPC:
// once the account is gone, auth.uid() no longer matches anything, and
// those policies stop letting these calls through. Best-effort — a failed
// cleanup here shouldn't block the actual account deletion, so errors are
// logged rather than surfaced.
async function deleteMyStorageFiles() {
  for (const prefix of [me.id, `thumb/${me.id}`]) {
    const { data: entries, error: listErr } = await sb.storage.from('artwork').list(prefix);
    if (listErr) { console.error('list storage files error:', listErr); continue; }
    if (!entries || !entries.length) continue;
    const { error: removeErr } = await sb.storage.from('artwork').remove(entries.map(e => `${prefix}/${e.name}`));
    if (removeErr) console.error('remove storage files error:', removeErr);
  }
}

// Permanently deletes the signed-in user's account. The actual delete
// happens server-side via the delete_own_account() RPC (supabase_delete_account.sql)
// — the client SDK has no self-serve "delete my account" call, only an
// admin API that needs a service-role key that must never reach the
// browser. That function drops the auth.users row, which cascades to
// profiles, submissions, comments, and follows. Shared by the edit-profile
// danger zone and the onboarding "cancel sign-up" exit; during onboarding
// there is no username to type back and nothing of the person's to lose
// yet, so that path asks a plain yes/no instead.
async function deleteMyAccount(btn, { signup = false } = {}) {
  const proceed = await confirmDialog(
    signup ? tr('cancelSignupMessage') : tr('deleteAccountMessage', { username: me.username }),
    signup
      ? { title: tr('cancelSignupTitle'), okLabel: tr('cancelSignupConfirmLabel') }
      : { title: tr('deleteAccountTitle'), okLabel: tr('deleteAccountConfirmLabel'), confirmText: me.username }
  );
  if (!proceed) return;
  btn.disabled = true;
  await deleteMyStorageFiles();
  const { error } = await sb.rpc('delete_own_account');
  if (error) {
    console.error('delete account error:', error);
    btn.disabled = false;
    document.getElementById('ep-error').textContent = tr('couldNotDeleteAccount');
    return;
  }
  profileEditRequired = false; // the forced modal may close now — the account is gone
  closeEditProfileModal();
  await signOut();
  toast(tr(signup ? 'signupCancelled' : 'accountDeleted'));
  location.href = `/${CURRENT_LANG}/campaigns`;
}
document.getElementById('ep-delete-account').onclick = e => deleteMyAccount(e.currentTarget);

wireLangToggle();
document.querySelectorAll('.lang-btn').forEach(btn => {
  const original = btn.onclick;
  if (original) {
    btn.onclick = () => { stashEditProfileDraftIfOpen(); original(); };
  }
});

// ---------- global Escape key: close whatever modal is open ----------
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const confirmModal = document.getElementById('confirm-modal');
  if (confirmModal.classList.contains('open')) { document.getElementById('confirm-cancel').click(); return; }
  if (typeof window.closeLightbox === 'function' && document.getElementById('lightbox-modal')?.classList.contains('open')) { window.closeLightbox(); return; }
  if (document.getElementById('ep-disabilities-menu').classList.contains('open')) { closeEpDisabilitiesMenu(); return; }
  const editModal = document.getElementById('edit-profile-modal');
  if (editModal.classList.contains('open')) { closeEditProfileModal(); return; }
  const anyOpen = document.querySelector('.modal-overlay.open');
  if (anyOpen) anyOpen.classList.remove('open');
});

// ---------- visitor count (admin "Visitors" section) ----------
// One record_visit() call per browser per Asia/Seoul day, per kind —
// "member" when a session is present, "guest" otherwise. The RPC itself
// decides the kind from auth.uid(), so the client cannot pose as a member;
// all it does is not call twice. localStorage remembers what was already
// counted today, an in-memory set stops the two boot paths (authReady and
// onAuthStateChange) from racing before that mark is written, and bots
// that run JavaScript are skipped by user agent. Never throws — a page
// must never break over statistics — and a missing RPC (SQL not applied
// yet) is marked as done for the day too, so it costs one request per
// browser per day rather than one per page view.
const visitKindsTried = new Set();
function visitDayKst() {
  try { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()); }
  catch (e) { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
}
async function recordVisitOnce() {
  try {
    if (navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse/i.test(navigator.userAgent)) return;
    const kind = me.id ? 'member' : 'guest';
    if (visitKindsTried.has(kind)) return;
    visitKindsTried.add(kind);
    const day = visitDayKst();
    let mark = {};
    try { mark = JSON.parse(localStorage.getItem('weavoVisit') || '{}') || {}; } catch (e) { mark = {}; }
    if (mark.day !== day) mark = { day };
    if (mark[kind]) return;
    const { error } = await sb.rpc('record_visit');
    if (error && error.code !== 'PGRST202' && error.code !== '42883') { visitKindsTried.delete(kind); return; } // network etc.: try again on the next page
    mark[kind] = true;
    try { localStorage.setItem('weavoVisit', JSON.stringify(mark)); } catch (e) { /* private mode: at most one call per page instead */ }
  } catch (e) { /* statistics never break a page */ }
}

// ---------- boot ----------
sb.auth.onAuthStateChange(async (_event, session) => {
  me = session ? meFromUser(session.user) : { id: '', name: '', avatar: '', isAdmin: false, username: '', bio: '', links: {}, countryId: null, disabilities: [] };
  if (!me.id) myBlockedIds = new Set();
  if (me.id) { await loadMyProfile(); upsertBaseProfile(); }
  updateIdentityUI();
  maybeRequireProfileSetup();
  if (_event === 'SIGNED_IN') recordVisitOnce(); // a guest who signs in now counts as a member too
  // Lets anything already on screen that keys off `me` (e.g. the lightbox's
  // owner-only Edit/Delete buttons) re-evaluate now that it may have flipped.
  document.dispatchEvent(new CustomEvent('weavo:authchange'));
});
// `authReady` is assigned synchronously (it's a Promise, not a value that
// depends on timing) so any script tag loaded after this one can safely
// do `await authReady` regardless of how long sb.auth.getSession() takes
// to resolve relative to that later script's own network fetch — unlike a
// `window.onAuthBoot` callback, which would race: getSession() can resolve
// before a later <script src> has even finished loading, silently skipping
// the callback it was supposed to invoke.
window.authReady = (async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) me = meFromUser(session.user);
  if (me.id) { await loadMyProfile(); upsertBaseProfile(); }
  else myBlockedIds = new Set();
  updateIdentityUI();
  maybeRequireProfileSetup();
  document.dispatchEvent(new CustomEvent('weavo:authchange'));
  recordVisitOnce(); // after the session is known, so a member is not counted as a guest
})();
