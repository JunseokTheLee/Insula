// Top-nav notification bell + activity feed. Loaded on every page right
// after js/auth.js, so it can lean on `me`, `window.authReady` and the
// `weavo:authchange` event from there, plus cdnUrl/profileUrl/artworkUrl/
// toast from common.js and tr/fmtShortDate/CURRENT_LANG from the i18n file.
//
// Rows are produced server-side by the triggers in supabase_notifications.sql
// — this file only ever reads them (RLS-scoped select), stamps read_at, and
// subscribes to Realtime INSERTs so the badge updates live.
"use strict";

(function () {
  const identity = document.getElementById('identity');
  if (!identity) return; // pages without the standard top-nav chrome

  // ---------- build the bell + panel (once) ----------
  const wrap = document.createElement('div');
  wrap.className = 'notif-wrap';
  wrap.style.display = 'none';
  wrap.innerHTML = `
    <button type="button" id="notifBell" class="notif-bell" aria-haspopup="true" aria-expanded="false">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
          d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>
      </svg>
      <span id="notifBadge" class="notif-badge"></span>
    </button>
    <div id="notifPanel" class="notif-panel" role="dialog">
      <div class="notif-panel-head">
        <span class="notif-panel-title"></span>
        <button type="button" id="notifMarkAll" class="notif-mark-all"></button>
      </div>
      <div id="notifList" class="notif-list"></div>
      <div id="notifEmpty" class="notif-empty"></div>
    </div>`;
  const myAvatar = document.getElementById('myAvatar');
  identity.insertBefore(wrap, myAvatar || identity.firstChild);

  const bell = wrap.querySelector('#notifBell');
  const badge = wrap.querySelector('#notifBadge');
  const panel = wrap.querySelector('#notifPanel');
  const listEl = wrap.querySelector('#notifList');
  const emptyEl = wrap.querySelector('#notifEmpty');
  const markAllBtn = wrap.querySelector('#notifMarkAll');

  bell.setAttribute('aria-label', tr('notifBellLabel'));
  wrap.querySelector('.notif-panel-title').textContent = tr('notificationsTitle');
  markAllBtn.textContent = tr('notifMarkAllRead');
  emptyEl.textContent = tr('notifEmpty');

  // ---------- state ----------
  let currentUid = '';
  let channel = null;
  let unread = 0;

  function setBadge(n) {
    unread = Math.max(0, n);
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('show', unread > 0);
  }

  // ---------- data ----------
  async function loadUnreadCount() {
    if (!me.id) return;
    const { count, error } = await sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', me.id).is('read_at', null);
    if (error) { console.error('notif unread count error:', error); return; }
    setBadge(count || 0);
  }

  async function loadFeed() {
    if (!me.id) return;
    const { data, error } = await sb.from('notifications')
      .select('id,actor_id,type,submission_id,comment_id,preview,created_at,read_at')
      .eq('recipient_id', me.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) { console.error('notif feed error:', error); return; }
    const rows = data || [];

    // actor_id is an FK to auth.users, not profiles — resolve names/avatars
    // with one batched lookup and merge, same as fetchExhibitionOwners().
    const actorIds = [...new Set(rows.map(r => r.actor_id).filter(Boolean))];
    const actors = {};
    if (actorIds.length) {
      const { data: profiles, error: pErr } = await sb.from('profiles')
        .select('id,username,name,avatar_url').in('id', actorIds);
      if (pErr) console.error('notif actor lookup error:', pErr);
      else for (const p of profiles || []) actors[p.id] = p;
    }

    listEl.innerHTML = '';
    for (const row of rows) listEl.appendChild(rowEl(row, actors[row.actor_id]));
    emptyEl.classList.toggle('show', rows.length === 0);
  }

  async function markAllRead() {
    if (!me.id || unread === 0) return;
    setBadge(0);
    listEl.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
    const { error } = await sb.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', me.id).is('read_at', null);
    if (error) { console.error('notif mark-read error:', error); loadUnreadCount(); }
  }

  // ---------- rendering ----------
  function avatarNode(name, avatarUrl) {
    if (avatarUrl) {
      const img = document.createElement('img');
      img.className = 'notif-avatar';
      img.src = cdnUrl(avatarUrl);
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    const fb = document.createElement('div');
    fb.className = 'notif-avatar notif-avatar-fallback';
    fb.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return fb;
  }

  function actionText(row) {
    switch (row.type) {
      case 'submission_like': return tr('notifLikedYourArtwork');
      case 'submission_comment': return row.preview
        ? tr('notifCommented', { preview: row.preview }) : tr('notifCommentedOnArtwork');
      case 'submission_reply': return row.preview
        ? tr('notifReplied', { preview: row.preview }) : tr('notifRepliedToComment');
      case 'follow': return tr('notifFollowedYou');
      default: return '';
    }
  }

  function rowHref(row) {
    if (row.type === 'follow') return row.actor_id ? profileUrl(row.actor_id) : '#';
    return row.submission_id ? artworkUrl(row.submission_id) : '#';
  }

  function rowEl(row, actor) {
    const name = (actor && (actor.username || actor.name)) || tr('anonymous');
    const a = document.createElement('a');
    a.className = 'notif-item' + (row.read_at ? '' : ' unread');
    a.href = rowHref(row);

    a.appendChild(avatarNode(name, actor && actor.avatar_url));

    const body = document.createElement('div');
    body.className = 'notif-item-body';
    const text = document.createElement('div');
    text.className = 'notif-item-text';
    const strong = document.createElement('strong');
    strong.textContent = name;
    text.appendChild(strong);
    // Korean reads "이름님이 …" with no separating space; English needs one.
    text.appendChild(document.createTextNode((CURRENT_LANG === 'ko' ? '' : ' ') + actionText(row)));
    const time = document.createElement('div');
    time.className = 'notif-item-time';
    time.textContent = fmtShortDate(row.created_at);
    body.append(text, time);
    a.appendChild(body);

    if (!row.read_at) {
      const dot = document.createElement('span');
      dot.className = 'notif-item-dot';
      a.appendChild(dot);
    }
    return a;
  }

  async function prependLive(row) {
    let actor = null;
    if (row.actor_id) {
      const { data } = await sb.from('profiles')
        .select('id,username,name,avatar_url').eq('id', row.actor_id).maybeSingle();
      actor = data || null;
    }
    emptyEl.classList.remove('show');
    listEl.insertBefore(rowEl(row, actor), listEl.firstChild);
  }

  // ---------- panel open/close ----------
  function openPanel() {
    panel.classList.add('open');
    bell.setAttribute('aria-expanded', 'true');
    loadFeed();
    markAllRead();
  }
  function closePanel() {
    panel.classList.remove('open');
    bell.setAttribute('aria-expanded', 'false');
  }
  bell.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.contains('open') ? closePanel() : openPanel();
  });
  document.addEventListener('click', e => {
    if (panel.classList.contains('open') && !wrap.contains(e.target)) closePanel();
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
  });
  markAllBtn.addEventListener('click', markAllRead);

  // ---------- realtime ----------
  function teardown() {
    if (channel) { sb.removeChannel(channel); channel = null; }
  }
  function subscribe() {
    teardown();
    if (!me.id) return;
    channel = sb.channel('notif-' + me.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: 'recipient_id=eq.' + me.id,
      }, payload => {
        setBadge(unread + 1);
        if (panel.classList.contains('open')) {
          prependLive(payload.new).then(() => markAllRead());
        }
      })
      .subscribe();
  }

  // ---------- wiring to auth ----------
  function refresh() {
    if (currentUid === me.id) return;
    currentUid = me.id;
    listEl.innerHTML = '';
    setBadge(0);
    teardown();
    if (me.id) {
      wrap.style.display = '';
      loadUnreadCount();
      subscribe();
    } else {
      wrap.style.display = 'none';
      closePanel();
    }
  }

  document.addEventListener('weavo:authchange', refresh);
  (window.authReady || Promise.resolve()).then(refresh);

  // Realtime can silently miss events (dropped socket, sleeping tab) — re-sync
  // the count whenever the tab comes back to the foreground.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && me.id) loadUnreadCount();
  });
  addEventListener('focus', () => { if (me.id) loadUnreadCount(); });
})();
