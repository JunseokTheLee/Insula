// Collection detail page (/{lang}/collections/{id}) — a named board an
// artist curates from artwork they've already collected (mosaic_submission_
// saves, js/lightbox.js's Collect button). Reads the collection id from the
// URL. Needs sb, me, tr, common.js, lightbox.js already loaded.
"use strict";

let currentCollection = null;

function updateCollectionMeta(collection, ownerName) {
  const title = `${collection.title} | Weavo`;
  const description = collection.description
    ? collection.description.slice(0, 300)
    : tr('collectionMetaDescFallback', { name: ownerName });
  updatePageMeta({ title, description, canonical: `${location.origin}${collectionUrl(collection.id)}` });
}
function renderCollectionJsonLd(collection, ownerName) {
  const url = `${location.origin}${collectionUrl(collection.id)}`;
  const data = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: collection.title, url,
    creator: { '@type': 'Person', name: ownerName, url: `${location.origin}${profileUrl(collection.owner_id)}` },
  };
  if (collection.description) data.description = collection.description;
  injectJsonLd([data]);
}

function collectionItemThumbEl(sub, isOwner) {
  const el = document.createElement('a');
  el.className = 'profile-art-thumb';
  el.href = artworkUrl(sub.id);
  el.title = sub.art_title || '';
  const img = document.createElement('img');
  img.src = cdnUrl(sub.thumb_url || sub.image_url);
  img.alt = sub.art_title ? tr('artworkThumbAlt', { title: sub.art_title, name: sub.author_name || tr('anonymous') }) : '';
  el.appendChild(img);
  if (isOwner) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'board-add-btn'; btn.textContent = '×';
    btn.setAttribute('aria-label', tr('removeFromCollection'));
    btn.onclick = async e => {
      e.preventDefault(); e.stopPropagation();
      btn.disabled = true;
      const { error } = await sb.from('mosaic_collection_items').delete()
        .eq('collection_id', currentCollection.id).eq('submission_id', sub.id);
      if (error) { console.error('remove collection item error:', error); toast(tr('couldNotUpdateCollection')); btn.disabled = false; return; }
      el.remove();
      if (!document.getElementById('collectionItemsGrid').children.length) {
        document.getElementById('collectionItemsEmpty').style.display = '';
      }
    };
    el.appendChild(btn);
  }
  interceptClick(el, () => openLightbox(sub));
  return el;
}

async function fetchCollection(id) {
  const { data, error } = await sb.from('mosaic_collections')
    .select('id,owner_id,title,description,is_public,created_at,mosaic_collection_items(submission_id,added_at,mosaic_submissions(id,pixel_id,project_id,image_url,thumb_url,art_title,art_material,art_completed_date,art_description,art_link,author_id,author_name,author_avatar_url,created_at))')
    .eq('id', id).maybeSingle();
  if (error) { console.error('load collection error:', error); return null; }
  return data;
}

async function openCollection(id) {
  const collection = await fetchCollection(id);
  if (!collection) {
    document.getElementById('collectionTitle').textContent = tr('collectionNotFound');
    return;
  }
  currentCollection = collection;
  const isOwner = me.id && me.id === collection.owner_id;

  const { data: owner } = await sb.from('profiles').select('id,name,username,avatar_url').eq('id', collection.owner_id).maybeSingle();
  const ownerName = (owner && (owner.username || owner.name)) || tr('anonymous');

  document.getElementById('collectionTitle').textContent = collection.title;
  updateCollectionMeta(collection, ownerName);
  renderCollectionJsonLd(collection, ownerName);

  const items = (collection.mosaic_collection_items || [])
    .slice()
    .sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
    .map(i => i.mosaic_submissions)
    .filter(Boolean);

  const metaParts = [collectionItemCountText(items.length)];
  if (isOwner && !collection.is_public) metaParts.push(tr('privateBadge'));
  document.getElementById('collectionMeta').textContent = metaParts.join(' · ');

  const descEl = document.getElementById('collectionDesc');
  descEl.textContent = collection.description || '';
  descEl.style.display = collection.description ? '' : 'none';

  const bylineEl = document.getElementById('collectionOwnerByline');
  bylineEl.innerHTML = '';
  bylineEl.appendChild(miniAvatarEl(ownerName, owner && owner.avatar_url, collection.owner_id));

  const grid = document.getElementById('collectionItemsGrid');
  grid.innerHTML = '';
  document.getElementById('collectionItemsEmpty').style.display = items.length ? 'none' : '';
  for (const sub of items) grid.appendChild(collectionItemThumbEl(sub, isOwner));

  const editBtn = document.getElementById('editCollectionBtn');
  const deleteBtn = document.getElementById('deleteCollectionBtn');
  editBtn.style.display = isOwner ? '' : 'none';
  deleteBtn.style.display = isOwner ? '' : 'none';
  editBtn.onclick = () => openEditCollectionModal(collection);
  deleteBtn.onclick = () => deleteCollection(collection);
}

// ---------- edit ----------
function openEditCollectionModal(collection) {
  document.getElementById('ec-title').value = collection.title;
  document.getElementById('ec-desc').value = collection.description || '';
  document.getElementById('ec-public').checked = collection.is_public;
  document.getElementById('ec-error').textContent = '';
  document.getElementById('edit-collection-modal').classList.add('open');
}
document.getElementById('ec-cancel').onclick = () => document.getElementById('edit-collection-modal').classList.remove('open');
document.getElementById('edit-collection-modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });
document.getElementById('ec-submit').onclick = async () => {
  const title = document.getElementById('ec-title').value.trim();
  const errorEl = document.getElementById('ec-error');
  if (!title) { errorEl.textContent = tr('titleRequired'); return; }
  errorEl.textContent = '';
  const btn = document.getElementById('ec-submit');
  btn.disabled = true;
  const { error } = await sb.from('mosaic_collections').update({
    title,
    description: document.getElementById('ec-desc').value.trim() || null,
    is_public: document.getElementById('ec-public').checked,
  }).eq('id', currentCollection.id);
  btn.disabled = false;
  if (error) { console.error('update collection error:', error); errorEl.textContent = tr('couldNotCreateCollectionMsg', { msg: error.message }); return; }
  document.getElementById('edit-collection-modal').classList.remove('open');
  await openCollection(currentCollection.id);
};

// ---------- delete ----------
async function deleteCollection(collection) {
  const proceed = await confirmDialog(
    tr('deleteCollectionMessage'),
    { title: tr('deleteCollectionTitle'), okLabel: tr('deleteLabel') }
  );
  if (!proceed) return;
  const { error } = await sb.from('mosaic_collections').delete().eq('id', collection.id);
  if (error) { console.error('delete collection error:', error); toast(tr('couldNotDeleteCollection')); return; }
  toast(tr('collectionDeletedToast'));
  location.href = profileUrl(collection.owner_id);
}

window.onSubmissionDeleted = () => { if (currentCollection) openCollection(currentCollection.id); };

authReady.then(async () => {
  const id = routeParam('collections');
  if (!id) { document.getElementById('collectionTitle').textContent = tr('collectionNotFound'); return; }
  await openCollection(id);
});
