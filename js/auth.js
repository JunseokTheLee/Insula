// Shared identity chrome + edit-profile modal — present on every page,
// since sign-in/onboarding can happen from anywhere. Depends on
// supabase-client.js, js/i18n/{en,ko}.js and common.js having loaded first.
// A page that needs to do something once the initial session/profile load
// finishes should `await authReady` (see below) before doing it.
"use strict";

let me = { id: '', name: '', avatar: '', isAdmin: false, username: '', bio: '', links: {}, countryId: null };

async function signIn() { await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }); }
async function signOut() { await sb.auth.signOut(); }
function meFromUser(u) {
  return {
    id: u.id, name: u.user_metadata.full_name || u.email.split('@')[0], avatar: u.user_metadata.avatar_url || '',
    isAdmin: false, username: '', bio: '', links: {}, countryId: null
  };
}
async function loadMyProfile() {
  if (!me.id) return;
  const { data } = await sb.from('profiles').select('is_admin,username,bio,links,avatar_url,country_id').eq('id', me.id).maybeSingle();
  me.isAdmin = !!(data && data.is_admin);
  me.username = (data && data.username) || '';
  me.bio = (data && data.bio) || '';
  me.links = (data && data.links) || {};
  me.countryId = (data && data.country_id) || null;
  // A custom uploaded avatar (if any) takes priority over the Google avatar
  // meFromUser() set — otherwise upsertBaseProfile() below would clobber it
  // back to the Google photo on every sign-in.
  if (data && data.avatar_url) me.avatar = data.avatar_url;
}
// First sign-in (or any later sign-in before every mandatory field has
// been set — username and country) forces the edit-profile modal open in
// onboarding mode until they finish.
function maybeRequireProfileSetup() {
  if (me.id && (!me.username || !me.countryId)) {
    openEditProfileModal({ username: me.username, bio: me.bio, links: me.links, avatar_url: me.avatar, country_id: me.countryId }, true);
  }
}
async function upsertBaseProfile() {
  if (!me.id) return;
  const { error } = await sb.from('profiles').upsert({ id: me.id, name: me.name, avatar_url: me.avatar || null });
  if (error) console.error('upsertBaseProfile error:', error);
}
function updateIdentityUI() {
  const nameEl = document.getElementById('myName');
  nameEl.textContent = me.id ? me.name : tr('guest');
  nameEl.classList.toggle('guest', !me.id);
  const av = document.getElementById('myAvatar');
  if (me.avatar) { av.src = me.avatar; av.alt = tr('artistAvatarAlt', { name: me.name }); av.style.display = 'inline-block'; } else { av.style.display = 'none'; }
  document.getElementById('loginBtn').style.display = me.id ? 'none' : '';
  document.getElementById('logoutBtn').style.display = me.id ? '' : 'none';
  const newProjectBtn = document.getElementById('newProjectBtn');
  if (newProjectBtn) newProjectBtn.style.display = me.isAdmin ? '' : 'none';
  const heroProfileBtn = document.getElementById('heroProfileBtn');
  if (heroProfileBtn) heroProfileBtn.textContent = me.id ? tr('myProfile') : tr('signIn');
}
document.getElementById('loginBtn').onclick = signIn;
document.getElementById('logoutBtn').onclick = signOut;

function openAuthModal() { document.getElementById('auth-modal').classList.add('open'); }
function closeAuthModal() { document.getElementById('auth-modal').classList.remove('open'); }
document.getElementById('google-signin-btn').onclick = signIn;
document.getElementById('auth-close').onclick = closeAuthModal;
document.getElementById('auth-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAuthModal(); });

function goToMyProfile() { me.id ? (location.href = profileUrl(me.id)) : openAuthModal(); }
document.getElementById('myAvatar').onclick = goToMyProfile;
document.getElementById('myName').onclick = goToMyProfile;
const heroProfileBtnEl = document.getElementById('heroProfileBtn');
if (heroProfileBtnEl) heroProfileBtnEl.onclick = goToMyProfile;

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
  }));
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
  document.getElementById('ep-country').value = profile.country_id ? String(profile.country_id) : '';
  epAvatarPicker.setExisting(profile.avatar_url || me.avatar || '');
  document.getElementById('ep-username').value = profile.username || '';
  document.getElementById('ep-bio').value = profile.bio || '';
  for (const { key } of LINK_PLATFORMS) {
    document.getElementById(`ep-link-${key}`).value = (profile.links && profile.links[key]) || '';
  }
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
    } catch (e) { console.error('restore edit-profile draft error:', e); }
  }
  document.getElementById('ep-error').textContent = '';
  document.getElementById('ep-dialog-title').textContent = forced ? (profile.username ? tr('completeYourProfile') : tr('welcomeToWeavo')) : tr('editProfile');
  const requiredNote = document.getElementById('ep-required-note');
  requiredNote.style.display = forced ? '' : 'none';
  requiredNote.textContent = profile.username
    ? tr('requiredNoteCountryOnly')
    : tr('requiredNoteFull');
  document.getElementById('ep-username-hint').style.display = 'none';
  document.getElementById('ep-cancel').style.display = forced ? 'none' : '';
  document.getElementById('ep-danger-zone').style.display = forced ? 'none' : '';
  document.getElementById('edit-profile-modal').classList.add('open');
}
function closeEditProfileModal() {
  if (profileEditRequired) return;
  document.getElementById('edit-profile-modal').classList.remove('open');
}
const epAvatarPicker = setupPicker('ep-avatar-picker');
document.getElementById('ep-cancel').onclick = closeEditProfileModal;
document.getElementById('edit-profile-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditProfileModal(); });
document.getElementById('ep-submit').onclick = async () => {
  const errorEl = document.getElementById('ep-error');
  const username = document.getElementById('ep-username').value.trim();
  const bio = document.getElementById('ep-bio').value.trim();
  const countryId = document.getElementById('ep-country').value ? parseInt(document.getElementById('ep-country').value, 10) : null;
  if (!username) { errorEl.textContent = tr('usernameRequired'); return; }
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
  const payload = { id: me.id, username, bio: bio || null, links, country_id: countryId };
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
  if (avatarUrl !== undefined) { me.avatar = avatarUrl || ''; updateIdentityUI(); }
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
// profiles, submissions, comments, and saves.
document.getElementById('ep-delete-account').onclick = async () => {
  const proceed = await confirmDialog(
    tr('deleteAccountMessage', { username: me.username }),
    { title: tr('deleteAccountTitle'), okLabel: tr('deleteAccountConfirmLabel'), confirmText: me.username }
  );
  if (!proceed) return;
  const btn = document.getElementById('ep-delete-account');
  btn.disabled = true;
  await deleteMyStorageFiles();
  const { error } = await sb.rpc('delete_own_account');
  if (error) {
    console.error('delete account error:', error);
    btn.disabled = false;
    document.getElementById('ep-error').textContent = tr('couldNotDeleteAccount');
    return;
  }
  closeEditProfileModal();
  await signOut();
  toast(tr('accountDeleted'));
  location.href = `/${CURRENT_LANG}/projects`;
};

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
  const editModal = document.getElementById('edit-profile-modal');
  if (editModal.classList.contains('open')) { closeEditProfileModal(); return; }
  const anyOpen = document.querySelector('.modal-overlay.open');
  if (anyOpen) anyOpen.classList.remove('open');
});

// ---------- boot ----------
sb.auth.onAuthStateChange(async (_event, session) => {
  me = session ? meFromUser(session.user) : { id: '', name: '', avatar: '', isAdmin: false, username: '', bio: '', links: {}, countryId: null };
  if (me.id) { await loadMyProfile(); upsertBaseProfile(); }
  updateIdentityUI();
  maybeRequireProfileSetup();
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
  updateIdentityUI();
  maybeRequireProfileSetup();
})();
