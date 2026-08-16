// All Exhibitions directory page (/{lang}/exhibitions) — every published,
// public, not-(yet-)expired collection ("mini-exhibition"), most recently
// published first. Needs js/common.js (exhibitionCardEl, fetchExhibitionOwners,
// fetchPublishedExhibitions) already loaded.
"use strict";

async function loadExhibitions() {
  const collections = await fetchPublishedExhibitions();
  const owners = await fetchExhibitionOwners(collections);
  const grid = document.getElementById('exhibitionsGrid');
  grid.innerHTML = '';
  collections.forEach((c, i) => grid.appendChild(exhibitionCardEl(c, owners[c.owner_id], i)));
  document.getElementById('exhibitionsEmpty').style.display = collections.length ? 'none' : 'block';
}

authReady.then(() => loadExhibitions());
