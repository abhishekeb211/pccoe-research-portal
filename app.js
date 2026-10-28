/* ==========================================================================
   PCCOE COMPUTER ENGINEERING - RESEARCH & INDEXING INTELLIGENCE PORTAL
   Vanilla JavaScript Client-Side Engine: Filtering, Search, 5 Charts & Directory
   ========================================================================== */

let allPublications = [];
let facultyList = [];
let facultyMap = {};
let filteredPublications = [];

// Application State
const state = {
  activePeriod: 'ay2526', // default: AY 2025-2026 ('all', 'ay2526', 'postjune26', 'prejuly25')
  searchQuery: '',
  faculty: 'all',
  designation: 'all',
  quartile: 'all',
  position: 'all',
  domain: 'all',
  medium: 'all',
  scopusStatus: 'all',
  beallFlag: 'all',
  sortBy: 'date-desc',
  viewMode: 'cards', // 'cards', 'table', 'directory'
  currentPage: 1,
  pageSize: 24
};

// Chart instances for dynamic disposal and redraw
let quartileChartInstance = null;
let monthlyChartInstance = null;
let designationChartInstance = null;
let domainChartInstance = null;
let leaderboardChartInstance = null;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  try {
    // 1. Fetch Datasets
    const [pubsRes, facRes] = await Promise.all([
      fetch('data/publications.json'),
      fetch('data/faculty.json').catch(() => null)
    ]);

    allPublications = await pubsRes.json();

    if (facRes && facRes.ok) {
      facultyList = await facRes.json();
      facultyList.forEach(f => {
        const name = f.Name || f.name;
        if (name) {
          facultyMap[normalizeName(name)] = f;
          facultyMap[name] = f;
        }
      });
    }

    // 2. Populate Faculty Filter Dropdown with paper counts
    populateFacultyDropdown();

    // 3. Pre-calculate global period counts
    updatePeriodPillCounts();

    // 4. Setup Event Listeners
    setupEventListeners();

    // 5. Initial Filter & Render
    applyFilters();

  } catch (error) {
    console.error('Failed to initialize application:', error);
    const container = document.getElementById('cardsContainer');
    if (container) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: #FFF5F5; border: 1px solid #FED7D7; border-radius: 12px; color: #C53030;">
          <h3 style="margin-bottom: 0.5rem; font-weight: 700;">Error Loading Research Data</h3>
          <p>Please ensure data/publications.json and data/faculty.json are accessible.</p>
        </div>
      `;
    }
  }
}

function normalizeName(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/^(dr\.|prof\.|mr\.|mrs\.|ms\.)\s+/i, '').replace(/[^a-z0-9]/g, '');
}

function populateFacultyDropdown() {
  const select = document.getElementById('filterFaculty');
  if (!select) return;

  // Calculate paper count per faculty member across the dataset
  const countMap = {};
  allPublications.forEach(p => {
    const fName = p['Faculty Name'];
    if (fName) {
      countMap[fName] = (countMap[fName] || 0) + 1;
    }
  });

  // Unique list of faculty names from facultyList or publications
  const names = facultyList.length > 0 
    ? facultyList.map(f => f.Name || f.name)
    : Object.keys(countMap);

  // Sort names alphabetically
  names.sort((a, b) => a.localeCompare(b));

  select.innerHTML = '<option value="all">Faculty Member: All 51</option>';
  names.forEach(name => {
    const cnt = countMap[name] || 0;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} (${cnt})`;
    select.appendChild(opt);
  });
}

function updatePeriodPillCounts() {
  const counts = {
    all: allPublications.length,
    ay2526: allPublications.filter(p => p['Academic Period Tag'] === 'July 2025 - June 2026 (AY 2025-26)').length,
    postjune26: allPublications.filter(p => p['Academic Period Tag'] === 'July 2026 - October 2026 (Post-June 2026)').length,
    prejuly25: allPublications.filter(p => p['Academic Period Tag'] === 'Jan 2025 - June 2025 (H2 Prev AY)').length
  };

  const countAllEl = document.getElementById('countAll');
  if (countAllEl) countAllEl.textContent = counts.all;
  const countAY2526El = document.getElementById('countAY2526');
  if (countAY2526El) countAY2526El.textContent = counts.ay2526;
  const countPostJune26El = document.getElementById('countPostJune26');
  if (countPostJune26El) countPostJune26El.textContent = counts.postjune26;
  const countPreJuly25El = document.getElementById('countPreJuly25');
  if (countPreJuly25El) countPreJuly25El.textContent = counts.prejuly25;
}

function setupEventListeners() {
  // Period Switcher Pills
  document.querySelectorAll('.period-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.period-tab-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      state.activePeriod = target.getAttribute('data-period');
      state.currentPage = 1;
      applyFilters();
    });
  });

  // Search Input with Debounce
  let searchTimeout = null;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = e.target.value.trim().toLowerCase();
        state.currentPage = 1;
        applyFilters();
      }, 250);
    });
  }

  // Dropdown Filters
  const bindSelect = (id, prop) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        state[prop] = e.target.value;
        state.currentPage = 1;
        applyFilters();
      });
    }
  };

  bindSelect('filterFaculty', 'faculty');
  bindSelect('filterDesignation', 'designation');
  bindSelect('filterQuartile', 'quartile');
  bindSelect('filterPosition', 'position');
  bindSelect('filterDomain', 'domain');
  bindSelect('filterMedium', 'medium');
  bindSelect('filterScopus', 'scopusStatus');
  bindSelect('filterBeall', 'beallFlag');
  bindSelect('filterSort', 'sortBy');

  // Reset Filters
  const resetBtn = document.getElementById('resetFiltersBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.faculty = 'all';
      state.designation = 'all';
      state.quartile = 'all';
      state.position = 'all';
      state.domain = 'all';
      state.medium = 'all';
      state.scopusStatus = 'all';
      state.beallFlag = 'all';
      state.sortBy = 'date-desc';
      state.currentPage = 1;

      if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
      if (document.getElementById('filterFaculty')) document.getElementById('filterFaculty').value = 'all';
      if (document.getElementById('filterDesignation')) document.getElementById('filterDesignation').value = 'all';
      if (document.getElementById('filterQuartile')) document.getElementById('filterQuartile').value = 'all';
      if (document.getElementById('filterPosition')) document.getElementById('filterPosition').value = 'all';
      if (document.getElementById('filterDomain')) document.getElementById('filterDomain').value = 'all';
      if (document.getElementById('filterMedium')) document.getElementById('filterMedium').value = 'all';
      if (document.getElementById('filterScopus')) document.getElementById('filterScopus').value = 'all';
      if (document.getElementById('filterBeall')) document.getElementById('filterBeall').value = 'all';
      if (document.getElementById('filterSort')) document.getElementById('filterSort').value = 'date-desc';

      applyFilters();
    });
  }

  // View Toggles (Cards vs Table vs Directory)
  const cardsBtn = document.getElementById('viewCardsBtn');
  const tableBtn = document.getElementById('viewTableBtn');
  const dirBtn = document.getElementById('viewDirectoryBtn');

  if (cardsBtn) {
    cardsBtn.addEventListener('click', () => {
      setViewMode('cards');
    });
  }

  if (tableBtn) {
    tableBtn.addEventListener('click', () => {
      setViewMode('table');
    });
  }

  if (dirBtn) {
    dirBtn.addEventListener('click', () => {
      setViewMode('directory');
    });
  }

  // CSV Export Button
  const exportBtn = document.getElementById('exportCsvBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportFilteredToCsv();
    });
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  const cardsBtn = document.getElementById('viewCardsBtn');
  const tableBtn = document.getElementById('viewTableBtn');
  const dirBtn = document.getElementById('viewDirectoryBtn');

  const cardsContainer = document.getElementById('cardsContainer');
  const tableContainer = document.getElementById('tableContainer');
  const dirContainer = document.getElementById('facultyDirectoryContainer');
  const paginationNav = document.getElementById('paginationNav');

  if (cardsBtn) cardsBtn.classList.toggle('active', mode === 'cards');
  if (tableBtn) tableBtn.classList.toggle('active', mode === 'table');
  if (dirBtn) dirBtn.classList.toggle('active', mode === 'directory');

  if (mode === 'cards') {
    if (cardsContainer) cardsContainer.style.display = 'grid';
    if (tableContainer) tableContainer.style.display = 'none';
    if (dirContainer) dirContainer.style.display = 'none';
    if (paginationNav) paginationNav.style.display = 'flex';
    renderPublications();
  } else if (mode === 'table') {
    if (cardsContainer) cardsContainer.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';
    if (dirContainer) dirContainer.style.display = 'none';
    if (paginationNav) paginationNav.style.display = 'flex';
    renderPublications();
  } else if (mode === 'directory') {
    if (cardsContainer) cardsContainer.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'none';
    if (dirContainer) dirContainer.style.display = 'grid';
    if (paginationNav) paginationNav.style.display = 'none';
    renderFacultyDirectory();
  }
}

function applyFilters() {
  filteredPublications = allPublications.filter(p => {
    // 1. Period Filter
    if (state.activePeriod === 'ay2526' && p['Academic Period Tag'] !== 'July 2025 - June 2026 (AY 2025-26)') return false;
    if (state.activePeriod === 'postjune26' && p['Academic Period Tag'] !== 'July 2026 - October 2026 (Post-June 2026)') return false;
    if (state.activePeriod === 'prejuly25' && p['Academic Period Tag'] !== 'Jan 2025 - June 2025 (H2 Prev AY)') return false;

    // 2. Faculty Member
    if (state.faculty !== 'all') {
      const pFac = p['Faculty Name'] || '';
      if (pFac !== state.faculty && normalizeName(pFac) !== normalizeName(state.faculty)) {
        return false;
      }
    }

    // 3. Search Query
    if (state.searchQuery) {
      const q = state.searchQuery;
      const title = (p['Paper Title'] || '').toLowerCase();
      const fac = (p['Faculty Name'] || '').toLowerCase();
      const venue = (p['Venue / Source'] || '').toLowerCase();
      const pub = (p['Publisher'] || '').toLowerCase();
      const doi = (p['DOI'] || '').toLowerCase();
      const domain = (p['Subject Domain Category'] || '').toLowerCase();
      const allAuth = (p['All Authors'] || '').toLowerCase();
      if (!title.includes(q) && !fac.includes(q) && !venue.includes(q) && !pub.includes(q) && !doi.includes(q) && !domain.includes(q) && !allAuth.includes(q)) {
        return false;
      }
    }

    // 4. Designation
    if (state.designation !== 'all') {
      const des = (p['Faculty Designation'] || '');
      if (!des.toLowerCase().includes(state.designation.toLowerCase())) return false;
    }

    // 5. Quartile
    if (state.quartile !== 'all') {
      const q = (p['SJR Quartile'] || '');
      if (state.quartile === 'Q1' && q !== 'Q1') return false;
      if (state.quartile === 'Q2' && q !== 'Q2') return false;
      if (state.quartile === 'Q3' && q !== 'Q3') return false;
      if (state.quartile === 'Q4' && q !== 'Q4') return false;
      if (state.quartile === 'Book Chapter' && q !== 'Book Chapter') return false;
      if (state.quartile === 'Conference Proceeding' && q !== 'Conference Proceeding') return false;
    }

    // 6. Position
    if (state.position !== 'all') {
      const pos = (p['Author Position'] || '').toLowerCase();
      if (!pos.includes(state.position.toLowerCase())) return false;
    }

    // 7. Subject Domain
    if (state.domain !== 'all') {
      const d = (p['Subject Domain Category'] || '');
      if (!d.toLowerCase().includes(state.domain.toLowerCase())) return false;
    }

    // 8. Medium Category
    if (state.medium !== 'all') {
      const m = (p['Publication Medium Category'] || '');
      if (!m.toLowerCase().includes(state.medium.toLowerCase())) return false;
    }

    // 9. Scopus Status
    if (state.scopusStatus !== 'all') {
      const sc = (p['Scopus Indexing Status'] || '').toLowerCase();
      if (state.scopusStatus === 'Scopus Indexed' && !sc.includes('active') && !sc.includes('indexed')) return false;
      if (state.scopusStatus === 'IEEE' && !sc.includes('ieee')) return false;
      if (state.scopusStatus === 'Preprint' && !sc.includes('preprint')) return false;
      if (state.scopusStatus === 'Discontinued' && !sc.includes('discontinued')) return false;
    }

    // 10. Beall's Threat Flag
    if (state.beallFlag !== 'all') {
      const b = (p["Beall's List Flag"] || '');
      if (state.beallFlag === 'Clean' && (b.includes('CRITICAL') || b.includes('ALERT'))) return false;
      if (state.beallFlag === 'CRITICAL' && !b.includes('CRITICAL') && !b.includes('ALERT')) return false;
    }

    return true;
  });

  // Sorting
  filteredPublications.sort((a, b) => {
    if (state.sortBy === 'date-desc') {
      const dateA = a['Published Date'] || `${a['Published Year'] || '2025'}-01-01`;
      const dateB = b['Published Date'] || `${b['Published Year'] || '2025'}-01-01`;
      return dateB.localeCompare(dateA);
    } else if (state.sortBy === 'date-asc') {
      const dateA = a['Published Date'] || `${a['Published Year'] || '2025'}-01-01`;
      const dateB = b['Published Date'] || `${b['Published Year'] || '2025'}-01-01`;
      return dateA.localeCompare(dateB);
    } else if (state.sortBy === 'citations-desc') {
      const cA = parseInt(a['Citations']) || 0;
      const cB = parseInt(b['Citations']) || 0;
      return cB - cA;
    } else if (state.sortBy === 'faculty-asc') {
      const nA = a['Faculty Name'] || '';
      const nB = b['Faculty Name'] || '';
      return nA.localeCompare(nB);
    }
    return 0;
  });

  // Update Dynamic KPIs
  updateDashboardKpis();

  // Update 5 Interactive Charts
  renderCharts();

  // Render view
  if (state.viewMode === 'directory') {
    renderFacultyDirectory();
  } else {
    renderPublications();
  }
}

function updateDashboardKpis() {
  const filteredEl = document.getElementById('kpiFilteredTotal');
  if (filteredEl) filteredEl.textContent = filteredPublications.length;

  const scopeSubEl = document.getElementById('kpiScopeSubtitle');
  if (scopeSubEl) {
    const labels = {
      all: 'All Verified Publications',
      ay2526: 'Papers in AY 2025–2026',
      postjune26: 'Post-June 2026 Momentum',
      prejuly25: 'Pre-July 2025 Output'
    };
    scopeSubEl.textContent = labels[state.activePeriod] || 'Matching Active Filters';
  }

  const q1q2Count = filteredPublications.filter(p => p['SJR Quartile'] === 'Q1' || p['SJR Quartile'] === 'Q2').length;
  const kpiQ1Q2El = document.getElementById('kpiQ1Q2');
  if (kpiQ1Q2El) kpiQ1Q2El.textContent = q1q2Count;

  const predCount = filteredPublications.filter(p => (p["Beall's List Flag"] || '').includes('CRITICAL') || (p["Beall's List Flag"] || '').includes('ALERT')).length;
  const kpiPredEl = document.getElementById('kpiPredatory');
  if (kpiPredEl) kpiPredEl.textContent = predCount;

  // Audit Warning Banner visibility
  const alertBanner = document.getElementById('auditAlertBanner');
  if (alertBanner) {
    if (predCount > 0 && state.beallFlag !== 'Clean') {
      alertBanner.style.display = 'flex';
    } else {
      alertBanner.style.display = 'none';
    }
  }

  const showingCountEl = document.getElementById('showingCount');
  if (showingCountEl) showingCountEl.textContent = Math.min(filteredPublications.length, state.pageSize);
  const totalCountEl = document.getElementById('totalCount');
  if (totalCountEl) totalCountEl.textContent = filteredPublications.length;
}

function renderPublications() {
  const startIndex = (state.currentPage - 1) * state.pageSize;
  const pageItems = filteredPublications.slice(startIndex, startIndex + state.pageSize);

  const showingCountEl = document.getElementById('showingCount');
  if (showingCountEl) showingCountEl.textContent = pageItems.length;

  if (state.viewMode === 'cards') {
    renderCardView(pageItems);
  } else if (state.viewMode === 'table') {
    renderTableView(pageItems);
  }

  renderPagination();
}

function renderCardView(items) {
  const container = document.getElementById('cardsContainer');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
        <p style="font-size: 1.2rem; font-weight: 600; margin-bottom: 0.5rem;">No publications match the selected criteria.</p>
        <p style="font-size: 0.9rem;">Try adjusting your search keywords, period tab, or dropdown filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(p => {
    const facName = p['Faculty Name'] || 'PCCOE Faculty';
    const facDesig = p['Faculty Designation'] || 'Faculty';
    const norm = normalizeName(facName);
    const facProfile = facultyMap[norm] || facultyMap[facName];

    // Verified photo URL resolution: prioritize record photo_url, then profile, then fallback
    let avatarImg = p['photo_url'];
    if (!avatarImg && facProfile && facProfile.photo_url) {
      avatarImg = facProfile.photo_url;
    }
    if (!avatarImg) {
      avatarImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="%23CBD5E1"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
    }

    // Badges
    const quart = p['SJR Quartile'] || 'Not Ranked';
    let qBadgeClass = 'badge-slate';
    if (quart === 'Q1') qBadgeClass = 'badge-q1';
    else if (quart === 'Q2') qBadgeClass = 'badge-q2';
    else if (quart === 'Q3') qBadgeClass = 'badge-q3';
    else if (quart === 'Q4') qBadgeClass = 'badge-q4';
    else if (quart === 'Book Chapter') qBadgeClass = 'badge-book';
    else if (quart === 'Conference Proceeding') qBadgeClass = 'badge-conf';

    const periodTag = p['Academic Period Tag'] || '';
    let periodBadge = '';
    if (periodTag.includes('AY 2025-26')) {
      periodBadge = `<span class="badge badge-ay">AY 2025–26</span>`;
    } else if (periodTag.includes('Post-June 2026')) {
      periodBadge = `<span class="badge badge-recent">Post-June 2026</span>`;
    }

    const domain = p['Subject Domain Category'] || '';
    let domainBadge = domain ? `<span class="badge badge-domain" title="${domain}">🔬 ${domain}</span>` : '';

    const beall = p["Beall's List Flag"] || '';
    let beallBadge = '';
    if (beall.includes('CRITICAL') || beall.includes('ALERT')) {
      beallBadge = `<span class="badge badge-predatory" title="${beall}">⚠️ Predatory / Flagged</span>`;
    }

    const citations = parseInt(p['Citations']) || 0;
    const citeBadge = citations > 0 ? `<span class="badge badge-slate" title="Citations">🌟 ${citations} Cites</span>` : '';

    const doi = p['DOI'] || '';
    const doiLink = doi ? `<a href="https://doi.org/${encodeURIComponent(doi)}" target="_blank" rel="noopener noreferrer" class="pub-link-btn">DOI &rarr;</a>` : '';

    const pubDate = p['Published Date'] || `${p['Published Month'] || ''} ${p['Published Year'] || ''}`;

    return `
      <article class="pub-card">
        <div class="pub-card-top">
          <img src="${avatarImg}" alt="${facName}" class="faculty-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'44\\' height=\\'44\\' viewBox=\\'0 0 24 24\\' fill=\\'%23CBD5E1\\'><path d=\\'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z\\'/></svg>'">
          <div class="faculty-meta">
            <h3 class="faculty-name">${facName}</h3>
            <div class="faculty-desig">${facDesig}</div>
          </div>
        </div>

        <div class="pub-badges-row">
          <span class="badge ${qBadgeClass}">${quart}</span>
          <span class="badge badge-slate">${p['Author Position'] || 'Author'}</span>
          ${citeBadge}
          ${periodBadge}
          ${domainBadge}
          ${beallBadge}
        </div>

        <h4 class="pub-title">${p['Paper Title'] || 'Untitled Research'}</h4>

        <div class="pub-venue-group">
          <div class="pub-venue-name">${p['Venue / Source'] || 'Academic Outlet'}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">
            ${p['Publisher'] || ''} &bull; ${p['Publication Medium Category'] || 'Article'}
          </div>
        </div>

        <div class="pub-details-footer">
          <span>📅 ${pubDate}</span>
          ${doiLink}
        </div>
      </article>
    `;
  }).join('');
}

function renderTableView(items) {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 2rem;">No matching publications found.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((p, idx) => {
    const startNum = (state.currentPage - 1) * state.pageSize + idx + 1;
    const quart = p['SJR Quartile'] || '-';
    let qBadgeClass = 'badge-slate';
    if (quart === 'Q1') qBadgeClass = 'badge-q1';
    else if (quart === 'Q2') qBadgeClass = 'badge-q2';
    else if (quart === 'Q3') qBadgeClass = 'badge-q3';
    else if (quart === 'Q4') qBadgeClass = 'badge-q4';

    const doi = p['DOI'] ? `<a href="https://doi.org/${encodeURIComponent(p['DOI'])}" target="_blank" rel="noopener noreferrer" style="color: var(--pastel-ice-fg); font-weight: 600;">Link</a>` : '-';

    return `
      <tr>
        <td>${startNum}</td>
        <td><strong>${p['Faculty Name'] || '-'}</strong></td>
        <td>${p['Faculty Designation'] || '-'}</td>
        <td>${p['Author Position'] || '-'}</td>
        <td style="max-width: 320px; font-weight: 600;">${p['Paper Title'] || '-'}</td>
        <td style="max-width: 260px;">${p['Venue / Source'] || '-'}</td>
        <td><span class="badge badge-slate">${p['Academic Period Tag'] ? p['Academic Period Tag'].split(' ')[0] : '-'}</span></td>
        <td>${p['Published Month'] || ''} ${p['Published Year'] || ''}</td>
        <td><span class="badge ${qBadgeClass}">${quart}</span></td>
        <td>${p['Scopus Indexing Status'] || '-'}</td>
        <td>${(p["Beall's List Flag"] || '').includes('CRITICAL') ? '<span class="badge badge-predatory">⚠️ Predatory</span>' : 'Clean'}</td>
        <td>${doi}</td>
      </tr>
    `;
  }).join('');
}

function renderFacultyDirectory() {
  const container = document.getElementById('facultyDirectoryContainer');
  if (!container) return;

  // Compute stats per faculty member across the current active period / filter scope
  const facStats = {};
  allPublications.forEach(p => {
    const name = p['Faculty Name'];
    if (!name) return;
    if (!facStats[name]) {
      facStats[name] = { total: 0, ay2526: 0, postJune: 0, q1q2: 0 };
    }
    facStats[name].total++;
    const tag = p['Academic Period Tag'] || '';
    if (tag.includes('AY 2025-26')) facStats[name].ay2526++;
    if (tag.includes('Post-June 2026')) facStats[name].postJune++;
    if (p['SJR Quartile'] === 'Q1' || p['SJR Quartile'] === 'Q2') facStats[name].q1q2++;
  });

  const list = facultyList.length > 0 ? [...facultyList] : Object.keys(facStats).map(n => ({ Name: n }));
  list.sort((a, b) => (a.Name || a.name || '').localeCompare(b.Name || b.name || ''));

  container.innerHTML = list.map(f => {
    const name = f.Name || f.name;
    const desig = f.Designation || f.designation || 'Faculty Member';
    const st = facStats[name] || { total: 0, ay2526: 0, postJune: 0, q1q2: 0 };
    const aoi = f['Area of Interest (AOI)'] || f.qualification || 'Computer Engineering & Applied Computing';
    const photo = f.photo_url || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 24 24" fill="%23CBD5E1"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

    return `
      <div class="faculty-profile-card">
        <img src="${photo}" alt="${name}" class="profile-card-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'90\\' height=\\'90\\' viewBox=\\'0 0 24 24\\' fill=\\'%23CBD5E1\\'><path d=\\'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z\\'/></svg>'">
        <h3 class="profile-card-name">${name}</h3>
        <div class="profile-card-desig">${desig}</div>

        <div class="profile-card-stats">
          <div class="profile-stat-item">
            <span class="profile-stat-number">${st.total}</span>
            <span class="profile-stat-lbl">Total</span>
          </div>
          <div class="profile-stat-item">
            <span class="profile-stat-number" style="color: var(--pastel-ice-fg);">${st.ay2526}</span>
            <span class="profile-stat-lbl">AY 25–26</span>
          </div>
          <div class="profile-stat-item">
            <span class="profile-stat-number" style="color: var(--pastel-mint-fg);">${st.q1q2}</span>
            <span class="profile-stat-lbl">Q1/Q2</span>
          </div>
        </div>

        <p style="font-size: 0.74rem; color: var(--text-muted); line-height: 1.35; max-height: 48px; overflow: hidden; margin-top: 0.25rem;">
          ${aoi}
        </p>

        <button class="btn-filter-faculty" onclick="filterByFaculty('${name.replace(/'/g, "\\'")}')">
          View All ${st.total} Publications &rarr;
        </button>
      </div>
    `;
  }).join('');
}

window.filterByFaculty = function(facultyName) {
  state.faculty = facultyName;
  const select = document.getElementById('filterFaculty');
  if (select) select.value = facultyName;
  setViewMode('cards');
  applyFilters();
  window.scrollTo({ top: document.querySelector('.controls-bar').offsetTop - 80, behavior: 'smooth' });
};

function renderPagination() {
  const totalPages = Math.ceil(filteredPublications.length / state.pageSize);
  const nav = document.getElementById('paginationNav');
  if (!nav) return;

  if (totalPages <= 1) {
    nav.innerHTML = '';
    return;
  }

  let html = `
    <button class="page-btn" ${state.currentPage === 1 ? 'disabled' : ''} onclick="changePage(${state.currentPage - 1})">&larr; Previous</button>
  `;

  const maxButtons = 7;
  let startPage = Math.max(1, state.currentPage - 3);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button class="page-btn" onclick="changePage(1)">1</button>`;
    if (startPage > 2) html += `<span style="padding: 0 0.25rem;">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="page-btn ${i === state.currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span style="padding: 0 0.25rem;">...</span>`;
    html += `<button class="page-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
  }

  html += `
    <button class="page-btn" ${state.currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${state.currentPage + 1})">Next &rarr;</button>
  `;

  nav.innerHTML = html;
}

window.changePage = function(page) {
  state.currentPage = page;
  renderPublications();
  window.scrollTo({ top: document.querySelector('.controls-bar').offsetTop - 80, behavior: 'smooth' });
};

function renderCharts() {
  // Chart 1: SJR Quartile & Medium Spread
  const qCounts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, 'Book Chapter': 0, 'Conference Proceeding': 0, 'Unindexed': 0 };
  
  filteredPublications.forEach(p => {
    const q = p['SJR Quartile'];
    if (q === 'Q1') qCounts.Q1++;
    else if (q === 'Q2') qCounts.Q2++;
    else if (q === 'Q3') qCounts.Q3++;
    else if (q === 'Q4') qCounts.Q4++;
    else if (q === 'Book Chapter') qCounts['Book Chapter']++;
    else if (q === 'Conference Proceeding') qCounts['Conference Proceeding']++;
    else qCounts['Unindexed']++;
  });

  const canvasQ = document.getElementById('quartileChart');
  if (canvasQ) {
    const ctxQ = canvasQ.getContext('2d');
    if (quartileChartInstance) quartileChartInstance.destroy();

    quartileChartInstance = new Chart(ctxQ, {
      type: 'doughnut',
      data: {
        labels: ['Q1 Elite', 'Q2 Impact', 'Q3 Recognized', 'Q4 Standard', 'Book Chapters', 'Conferences', 'Unindexed'],
        datasets: [{
          data: [qCounts.Q1, qCounts.Q2, qCounts.Q3, qCounts.Q4, qCounts['Book Chapter'], qCounts['Conference Proceeding'], qCounts['Unindexed']],
          backgroundColor: ['#68D391', '#63B3ED', '#F6E05E', '#CBD5E0', '#FBD38D', '#BEE3F8', '#E2E8F0'],
          borderColor: '#FFFFFF',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: "'Plus Jakarta Sans', sans-serif", size: 10 } } }
        }
      }
    });
  }

  // Chart 2: Monthly Publication Velocity
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthData2025 = new Array(12).fill(0);
  const monthData2026 = new Array(12).fill(0);

  filteredPublications.forEach(p => {
    const mIdx = months.indexOf(p['Published Month']);
    const yr = String(p['Published Year']);
    if (mIdx >= 0) {
      if (yr === '2025') monthData2025[mIdx]++;
      else if (yr === '2026') monthData2026[mIdx]++;
    }
  });

  const canvasM = document.getElementById('monthlyChart');
  if (canvasM) {
    const ctxM = canvasM.getContext('2d');
    if (monthlyChartInstance) monthlyChartInstance.destroy();

    monthlyChartInstance = new Chart(ctxM, {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        datasets: [
          { label: '2025 Output', data: monthData2025, backgroundColor: '#81E6D9' },
          { label: '2026 Output', data: monthData2026, backgroundColor: '#90CDF4' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, font: { family: "'Plus Jakarta Sans', sans-serif", size: 10 } } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: '#F1F5F9' } }
        }
      }
    });
  }

  // Chart 3: Research by Faculty Designation
  const desigCounts = {
    'Prof & HOD': 0,
    'Professor': 0,
    'Assoc. Prof': 0,
    'Asst. Prof': 0,
    'Teaching Asst': 0
  };

  filteredPublications.forEach(p => {
    const d = p['Faculty Designation'] || '';
    if (d.includes('HOD')) desigCounts['Prof & HOD']++;
    else if (d === 'Professor') desigCounts['Professor']++;
    else if (d.includes('Associate')) desigCounts['Assoc. Prof']++;
    else if (d.includes('Assistant')) desigCounts['Asst. Prof']++;
    else if (d.includes('Teaching')) desigCounts['Teaching Asst']++;
    else desigCounts['Asst. Prof']++;
  });

  const canvasDesig = document.getElementById('designationChart');
  if (canvasDesig) {
    const ctxDesig = canvasDesig.getContext('2d');
    if (designationChartInstance) designationChartInstance.destroy();

    designationChartInstance = new Chart(ctxDesig, {
      type: 'bar',
      data: {
        labels: Object.keys(desigCounts),
        datasets: [{
          label: 'Publications',
          data: Object.values(desigCounts),
          backgroundColor: ['#9AE6B4', '#90CDF4', '#FBD38D', '#BEE3F8', '#E2E8F0'],
          borderWidth: 0,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: '#F1F5F9' } }
        }
      }
    });
  }

  // Chart 4: Subject Domain Classification
  const domainCounts = {};
  filteredPublications.forEach(p => {
    const dom = p['Subject Domain Category'] || 'Other / General';
    domainCounts[dom] = (domainCounts[dom] || 0) + 1;
  });

  const domainLabels = Object.keys(domainCounts);
  const domainData = Object.values(domainCounts);
  const pastelDomainPalette = ['#90CDF4', '#81E6D9', '#FBD38D', '#BEE3F8', '#FEB2B2', '#D6BCFA', '#E2E8F0'];

  const canvasDom = document.getElementById('domainChart');
  if (canvasDom) {
    const ctxDom = canvasDom.getContext('2d');
    if (domainChartInstance) domainChartInstance.destroy();

    domainChartInstance = new Chart(ctxDom, {
      type: 'doughnut',
      data: {
        labels: domainLabels,
        datasets: [{
          data: domainData,
          backgroundColor: pastelDomainPalette.slice(0, domainLabels.length),
          borderColor: '#FFFFFF',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: "'Plus Jakarta Sans', sans-serif", size: 10 } } }
        }
      }
    });
  }

  // Chart 5: Top 10 Faculty Publishing Leaderboard
  const facultyCounts = {};
  filteredPublications.forEach(p => {
    const name = p['Faculty Name'] || 'Unknown';
    facultyCounts[name] = (facultyCounts[name] || 0) + 1;
  });

  const sortedFaculty = Object.entries(facultyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const canvasLead = document.getElementById('leaderboardChart');
  if (canvasLead) {
    const ctxLead = canvasLead.getContext('2d');
    if (leaderboardChartInstance) leaderboardChartInstance.destroy();

    leaderboardChartInstance = new Chart(ctxLead, {
      type: 'bar',
      data: {
        labels: sortedFaculty.map(item => item[0]),
        datasets: [{
          label: 'Verified Publications',
          data: sortedFaculty.map(item => item[1]),
          backgroundColor: '#81E6D9',
          borderColor: '#4FD1C5',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: '#F1F5F9' } },
          y: { grid: { display: false }, ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: '600' } } }
        }
      }
    });
  }
}

function exportFilteredToCsv() {
  if (filteredPublications.length === 0) {
    alert('No publications to export.');
    return;
  }

  const headers = [
    'Faculty Name', 'Faculty Designation', 'Paper Title', 'Author Position', 'Author Index',
    'Total Authors', 'Published Month', 'Published Year', 'Academic Period Tag',
    'Subject Domain Category', 'Publication Medium Category', 'Venue / Source', 'Publisher',
    'Scopus Indexing Status', 'SJR Quartile', 'Academic Audit Tier', "Beall's List Flag",
    'DOI', 'Citations', 'photo_url', 'Paper URL'
  ];

  let csvContent = '\uFEFF'; // UTF-8 BOM
  csvContent += headers.map(h => `"${h}"`).join(',') + '\r\n';

  filteredPublications.forEach(p => {
    const row = headers.map(h => {
      let val = p[h] || '';
      return `"${String(val).replace(/"/g, '""')}"`;
    });
    csvContent += row.join(',') + '\r\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `PCCOE_Research_Filtered_${state.activePeriod}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
