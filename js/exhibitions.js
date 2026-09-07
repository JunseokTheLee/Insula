// All Exhibitions directory page (/{lang}/exhibitions) — every published,
// public, not-(yet-)expired collection ("mini-exhibition"), most recently
// published first. Needs js/common.js (exhibitionCardEl, fetchExhibitionOwners,
// fetchPublishedExhibitions) already loaded.
"use strict";

let allExhibitions = [];
let allExhibitionOwners = {};
// "Featured"/"Popular" have no backing data yet (no popularity metric is
// fetched) — only Recent (the query's own published_at sort) and Mine
// (client-filtered by owner) are real tabs.
let exhibitionsTab = 'recent';

function renderExhibitions() {
  const list = exhibitionsTab === 'mine'
    ? allExhibitions.filter(c => me.id && c.owner_id === me.id)
    : allExhibitions;
  const grid = document.getElementById('exhibitionsGrid');
  grid.innerHTML = '';
  list.forEach((c, i) => grid.appendChild(exhibitionCardEl(c, allExhibitionOwners[c.owner_id], i)));
  document.getElementById('exhibitionsEmpty').style.display = list.length ? 'none' : 'block';
}
function setExhibitionsTab(tab) {
  exhibitionsTab = tab;
  document.getElementById('exTabRecent').classList.toggle('active', tab === 'recent');
  document.getElementById('exTabMine').classList.toggle('active', tab === 'mine');
  renderExhibitions();
}
document.getElementById('exTabRecent').onclick = () => setExhibitionsTab('recent');
document.getElementById('exTabMine').onclick = () => {
  if (!me.id) { openAuthModal(); return; }
  setExhibitionsTab('mine');
};
document.getElementById('exhibitionsCtaBtn').onclick = () => {
  if (me.id) location.href = `${profileUrl(me.id)}#new-collection`;
  else openAuthModal();
};

async function loadExhibitions() {
  allExhibitions = await fetchPublishedExhibitions();
  allExhibitionOwners = await fetchExhibitionOwners(allExhibitions);
  renderExhibitions();
}

authReady.then(() => loadExhibitions());
