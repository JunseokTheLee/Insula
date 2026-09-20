// Portfolios directory (/{lang}/portfolios) — every public portfolio that
// holds at least one artwork, newest first; "Mine" lists the signed-in
// artist's own ones whatever their visibility, badged. Needs js/common.js
// (fetchPublicPortfolios, fetchUserPortfolios, fetchExhibitionOwners,
// portfolioCardEl) and auth.js already loaded.
"use strict";

let dirPortfolios = [];
let dirOwners = {};
let dirTab = 'recent';
let dirToken = 0;

async function loadDirectory() {
  const token = ++dirToken;
  const grid = document.getElementById('portfoliosGrid');
  const empty = document.getElementById('portfoliosEmpty');
  grid.innerHTML = '';
  empty.style.display = 'none';
  let rows;
  if (dirTab === 'mine') {
    rows = me.id ? await fetchUserPortfolios(me.id) : [];
  } else {
    rows = (await fetchPublicPortfolios()).filter(c => (c.mosaic_collection_items || []).length > 0);
  }
  if (token !== dirToken) return;
  dirPortfolios = rows;
  dirOwners = await fetchExhibitionOwners(rows);
  if (token !== dirToken) return;
  rows.forEach((c, i) => grid.appendChild(portfolioCardEl(c, dirOwners[c.owner_id], i, dirTab === 'mine')));
  empty.textContent = tr(dirTab === 'mine' ? 'pfDirEmptyMine' : 'pfDirEmpty');
  empty.style.display = rows.length ? 'none' : 'block';
}
function setDirTab(tab) {
  dirTab = tab;
  document.getElementById('pfTabRecent').classList.toggle('active', tab === 'recent');
  document.getElementById('pfTabMine').classList.toggle('active', tab === 'mine');
  loadDirectory();
}
document.getElementById('pfTabRecent').onclick = () => setDirTab('recent');
document.getElementById('pfTabMine').onclick = () => {
  if (!me.id) { openAuthModal(); return; }
  setDirTab('mine');
};
document.getElementById('portfoliosCtaBtn').onclick = () => {
  if (me.id) location.href = `${profileUrl(me.username || me.id)}#new-portfolio`;
  else openAuthModal();
};
document.addEventListener('weavo:authchange', () => { if (dirTab === 'mine' && !me.id) setDirTab('recent'); });

authReady.then(() => loadDirectory());
