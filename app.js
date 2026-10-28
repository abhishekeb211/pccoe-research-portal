/* ==========================================================================
   PCCOE COMPUTER ENGINEERING - RESEARCH & INDEXING INTELLIGENCE PORTAL
   Vanilla JavaScript Client-Side Engine: Clean Scopus & Google Scholar Only
   ========================================================================== */

let allPublications = [];
let facultyList = [];
let facultyMap = {};
let filteredPublications = [];

// Application State
const state = {
  activePeriod: latestSemesterId(),
  searchQuery: '',
  faculty: 'all',
  designation: 'all',
  quartile: 'all',
  position: 'all',
  domain: 'all',
  medium: 'all',
  scopusStatus: 'all',
  indexSource: 'all', // 'all', 'scopus', 'scholar'
  sortBy: 'date-desc',
  viewMode: 'cards', // 'cards', 'table', 'directory', 'profile'
  bucket: 'all',
  profileFaculty: null,
  profileSection: 'all',
  analyticsSortKey: 'total',
  analyticsSortDir: 'desc',
  leaderboardLimit: 10,
  currentPage: 1,
  pageSize: 24
};

const BUCKETS = [
  { id: 'q1', label: 'Q1 journals', short: 'Q1' },
  { id: 'q2', label: 'Q2 journals', short: 'Q2' },
  { id: 'q3', label: 'Q3 journals', short: 'Q3' },
  { id: 'q4', label: 'Q4 journals', short: 'Q4' },
  { id: 'non_scopus_journal', label: 'Non-Scopus journals', short: 'Non-Scopus journals' },
  { id: 'scopus_conference', label: 'Scopus conferences', short: 'Scopus conferences' },
  { id: 'non_scopus_conference', label: 'Non-Scopus conferences', short: 'Non-Scopus conferences' },
  { id: 'book_chapter', label: 'Book chapters', short: 'Book chapters' }
];

let periodPublications = [];

// Chart instances for dynamic disposal and redraw
let quartileChartInstance = null;
let monthlyChartInstance = null;
let designationChartInstance = null;
let domainChartInstance = null;
let leaderboardChartInstance = null;

function doiHref(doi) {
  const value = String(doi || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return 'https://doi.org/' + value.replace(/^doi:/i, '');
}

function scopusConfirmed(record) {
  const status = String(record['Scopus Indexing Status'] || '').toLowerCase();
  return status.includes('scopus indexed') && !status.includes('unconfirmed');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function paperBucket(record) {
  const medium = record['Publication Medium Category'] || '';
  if (medium === 'Book Chapter') return 'book_chapter';
  if (medium === 'Conference Proceeding') {
    return scopusConfirmed(record) ? 'scopus_conference' : 'non_scopus_conference';
  }
  if (scopusConfirmed(record)) {
    const quartile = record['SJR Quartile'];
    if (quartile === 'Q1' || quartile === 'Q2' || quartile === 'Q3' || quartile === 'Q4') {
      return quartile.toLowerCase();
    }
  }
  return 'non_scopus_journal';
}

function emptyStats() {
  return {
    q1: 0, q2: 0, q3: 0, q4: 0,
    non_scopus_journal: 0,
    scopus_conference: 0,
    non_scopus_conference: 0,
    book_chapter: 0,
    journals: 0,
    conferences: 0,
    total: 0
  };
}

function addTotals(stats) {
  stats.journals = stats.q1 + stats.q2 + stats.q3 + stats.q4 + stats.non_scopus_journal;
  stats.conferences = stats.scopus_conference + stats.non_scopus_conference;
  stats.total = stats.journals + stats.conferences + stats.book_chapter;
  return stats;
}

function tally(papers) {
  const stats = emptyStats();
  papers.forEach((paper) => {
    stats[paperBucket(paper)] += 1;
  });
  return addTotals(stats);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function latestSemesterId(now = new Date()) {
  const year = now.getFullYear();
  return now.getMonth() >= 6 ? `jul-${year}` : `jan-${year}`;
}

function recentSemesterIds(now = new Date()) {
  const current = latestSemesterId(now);
  const [half, yearText] = current.split('-');
  const year = Number(yearText);
  const previous = half === 'jul' ? `jan-${year}` : `jul-${year - 1}`;
  return [current, previous];
}

function semesterLabel(id) {
  if (!id || id === 'all') return 'All publications';
  const [half, year] = id.split('-');
  return half === 'jul' ? `July–December ${year}` : `January–June ${year}`;
}

function paperSemesterId(paper) {
  const month = MONTH_NAMES.indexOf(paper['Published Month']);
  const year = parseInt(paper['Published Year'], 10);
  if (month < 0 || !year) return '';
  return month >= 6 ? `jul-${year}` : `jan-${year}`;
}

function matchesPeriod(paper) {
  if (state.activePeriod === 'all') return true;
  return paperSemesterId(paper) === state.activePeriod;
}

function doiLabel(doi) {
  return String(doi || '').trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '');
}

function profileHref(url) {
  const value = String(url || '').trim().replace(/^https?:\s+/i, '');
  if (!/^https?:\/\//i.test(value)) return '';
  return value;
}

function resolveFacultyName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const names = facultyList.map((faculty) => faculty.Name || faculty.name).filter(Boolean);
  return names.find((item) => item === raw)
    || names.find((item) => normalizeName(item) === normalizeName(raw))
    || raw;
}

function facultyNameFromHash() {
  const match = (location.hash || '').match(/^#faculty\/(.+)$/);
  if (!match) return '';
  try {
    return resolveFacultyName(decodeURIComponent(match[1]));
  } catch (error) {
    return resolveFacultyName(match[1]);
  }
}

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
    syncFromHash();

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

  const countMap = {};
  allPublications.forEach(p => {
    const fName = p['Faculty Name'];
    if (fName) {
      countMap[fName] = (countMap[fName] || 0) + 1;
    }
  });

  const names = facultyList.length > 0 
    ? facultyList.map(f => f.Name || f.name)
    : Object.keys(countMap);

  names.sort((a, b) => a.localeCompare(b));

  select.innerHTML = `<option value="all">Faculty Member: All ${names.length}</option>`;
  names.forEach(name => {
    const cnt = countMap[name] || 0;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} (${cnt})`;
    select.appendChild(opt);
  });
}

function updatePeriodPillCounts() {
  const indexAll = document.querySelector('#filterIndexSource option[value="all"]');
  if (indexAll) indexAll.textContent = `Index Source: All (${allPublications.length})`;
  renderPeriodControls();
}

function renderPeriodControls() {
  const select = document.getElementById('periodYear');
  const years = [...new Set(allPublications.map((paper) => String(paper['Published Year'] || '')).filter((year) => /^\d{4}$/.test(year)))]
    .sort((a, b) => Number(b) - Number(a));
  if (select && select.options.length <= 1) {
    select.innerHTML = `<option value="recent">Recent semesters</option>${years.map((year) => `<option value="${year}">${year}</option>`).join('')}`;
  }
  const chosen = select ? select.value : 'recent';
  const ids = chosen && chosen !== 'recent' ? [`jul-${chosen}`, `jan-${chosen}`] : recentSemesterIds();
  const counts = {};
  allPublications.forEach((paper) => {
    const id = paperSemesterId(paper);
    if (id) counts[id] = (counts[id] || 0) + 1;
  });
  const container = document.getElementById('periodPillsContainer');
  if (!container) return;
  const buttons = [
    { id: 'all', label: 'All publications', count: allPublications.length },
    ...ids.map((id) => ({ id, label: semesterLabel(id), count: counts[id] || 0 }))
  ];
  container.innerHTML = buttons.map((button) => `
    <button type="button" class="period-tab-btn${state.activePeriod === button.id ? ' active' : ''}" data-period="${button.id}">
      <span>${button.label}</span>
      <span class="period-badge-count">${button.count}</span>
    </button>
  `).join('');
}

function setupEventListeners() {
  const periodHost = document.getElementById('periodPillsContainer');
  if (periodHost) {
    periodHost.addEventListener('click', (event) => {
      const target = event.target.closest('[data-period]');
      if (!target) return;
      state.activePeriod = target.getAttribute('data-period');
      state.currentPage = 1;
      applyFilters();
    });
  }
  const yearSelect = document.getElementById('periodYear');
  if (yearSelect) {
    yearSelect.addEventListener('change', () => {
      const year = yearSelect.value;
      state.activePeriod = year === 'recent' ? latestSemesterId() : `jul-${year}`;
      state.currentPage = 1;
      applyFilters();
    });
  }

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
  bindSelect('filterIndexSource', 'indexSource');
  bindSelect('filterSort', 'sortBy');

  const resetBtn = document.getElementById('resetFiltersBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetAll);

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

  document.addEventListener('click', handlePortalClick);
  window.addEventListener('hashchange', syncFromHash);
  window.addEventListener('popstate', syncFromHash);
}

function setViewMode(mode) {
  if (mode !== 'profile' && state.profileFaculty) {
    state.profileFaculty = null;
    const nextUrl = location.pathname + location.search;
    if (location.hash) history.pushState(null, '', nextUrl);
  }
  state.viewMode = mode;
  const cardsBtn = document.getElementById('viewCardsBtn');
  const tableBtn = document.getElementById('viewTableBtn');
  const dirBtn = document.getElementById('viewDirectoryBtn');

  const cardsContainer = document.getElementById('cardsContainer');
  const tableContainer = document.getElementById('tableContainer');
  const dirContainer = document.getElementById('facultyDirectoryContainer');
  const paginationNav = document.getElementById('paginationNav');
  const profile = document.getElementById('facultyProfile');
  const chips = document.getElementById('bucketChips');

  if (cardsBtn) cardsBtn.classList.toggle('active', mode === 'cards');
  if (tableBtn) tableBtn.classList.toggle('active', mode === 'table');
  if (dirBtn) dirBtn.classList.toggle('active', mode === 'directory');

  if (cardsContainer) cardsContainer.style.display = mode === 'cards' ? 'block' : 'none';
  if (tableContainer) tableContainer.style.display = mode === 'table' ? 'block' : 'none';
  if (dirContainer) dirContainer.style.display = mode === 'directory' ? 'grid' : 'none';
  if (paginationNav) paginationNav.style.display = mode === 'table' ? 'flex' : 'none';
  if (profile) profile.hidden = mode !== 'profile';
  if (chips) chips.hidden = mode === 'directory' || mode === 'profile';

  if (mode === 'cards' || mode === 'table') renderPublications();
  else if (mode === 'directory') renderFacultyDirectory();
  else if (mode === 'profile') renderFacultyProfile();
  if (mode === 'cards' || mode === 'table') renderBucketChips();
}

function applyFilters() {
  periodPublications = allPublications.filter(matchesPeriod);
  filteredPublications = periodPublications.filter(p => {
    // 1. Faculty Member
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

    // 4. Designation uses the same buckets as the designation chart.
    if (state.designation !== 'all' && designationBucket(p) !== state.designation) return false;

    // 5. Quartile
    if (state.quartile !== 'all') {
      const q = (p['SJR Quartile'] || '');
      if (state.quartile === 'Q1' && q !== 'Q1') return false;
      if (state.quartile === 'Q2' && q !== 'Q2') return false;
      if (state.quartile === 'Q3' && q !== 'Q3') return false;
      if (state.quartile === 'Q4' && q !== 'Q4') return false;
      if (state.quartile === 'Not Ranked' && (q === 'Q1' || q === 'Q2' || q === 'Q3' || q === 'Q4')) return false;
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
      if (state.scopusStatus === 'Scopus Indexed' && !scopusConfirmed(p)) return false;
      if (state.scopusStatus === 'Proceeding Unconfirmed' && !sc.includes('unconfirmed') && !sc.includes('indexing unconfirmed')) return false;
      if (state.scopusStatus === 'Preprint' && !sc.includes('preprint')) return false;
      if (state.scopusStatus === 'Not Indexed' && (scopusConfirmed(p) || sc.includes('unconfirmed'))) return false;
    }

    // 10. Indexing source: SCImago-confirmed Scopus, or the faculty member's own Scholar profile.
    if (state.indexSource !== 'all') {
      const evidence = p['Verification Evidence'] || '';
      if (state.indexSource === 'scopus' && !scopusConfirmed(p)) return false;
      if (state.indexSource === 'scholar' && !evidence.includes('SCHOLAR_PROFILE')) return false;
    }

    if (state.bucket !== 'all' && paperBucket(p) !== state.bucket) return false;

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
  renderFacultyAnalytics();
  renderActiveFilters();
  renderPeriodControls();

  // Render view
  if (state.viewMode === 'directory') {
    renderFacultyDirectory();
  } else if (state.viewMode === 'profile') {
    renderFacultyProfile();
  } else {
    renderPublications();
    renderBucketChips();
  }
}

function denominatorText() {
  return `of ${allPublications.length} identity-checked`;
}

function updateDashboardKpis() {
  const stats = tally(filteredPublications);
  const confirmed = filteredPublications.filter(scopusConfirmed).length;
  const denom = denominatorText();
  const setNumber = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };
  setNumber('kpiFilteredTotal', filteredPublications.length);
  setNumber('kpiJournals', stats.journals);
  setNumber('kpiConferences', stats.conferences);
  setNumber('kpiQ1Q2', stats.q1 + stats.q2);
  setNumber('kpiIndexingStatus', confirmed);
  ['kpiScopeSubtitle', 'kpiJournalsSubtitle', 'kpiConferencesSubtitle', 'kpiQ1Q2Subtitle', 'kpiIndexingSubtitle'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = denom;
  });

  const showingCountEl = document.getElementById('showingCount');
  if (showingCountEl) showingCountEl.textContent = Math.min(filteredPublications.length, state.pageSize);
  const totalCountEl = document.getElementById('totalCount');
  if (totalCountEl) totalCountEl.textContent = filteredPublications.length;
}

function listedPapers() {
  return filteredPublications;
}

function renderPublications() {
  const source = listedPapers();
  const showingCountEl = document.getElementById('showingCount');
  const totalCountEl = document.getElementById('totalCount');
  if (totalCountEl) totalCountEl.textContent = filteredPublications.length;

  if (state.viewMode === 'cards') {
    if (showingCountEl) showingCountEl.textContent = source.length;
    renderSectionedList(document.getElementById('cardsContainer'), source, false);
    const nav = document.getElementById('paginationNav');
    if (nav) nav.innerHTML = '';
    return;
  }

  const startIndex = (state.currentPage - 1) * state.pageSize;
  const pageItems = source.slice(startIndex, startIndex + state.pageSize);
  if (showingCountEl) showingCountEl.textContent = pageItems.length;
  if (state.viewMode === 'table') renderTableView(pageItems);
  renderPagination(source.length);
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

    const sc = p['Scopus Indexing Status'] || '';
    const indexBadge = scopusConfirmed(p)
      ? `<span class="badge badge-mint">Scopus indexed</span>`
      : `<span class="badge badge-ice">Not SCImago-confirmed</span>`;

    const doiText = doiLabel(p['DOI']);
    const doi = doiText
      ? `<a href="${esc(doiHref(p['DOI']))}" target="_blank" rel="noopener noreferrer" style="color: var(--pastel-ice-fg); font-weight: 600;">${esc(doiText)}</a>`
      : 'No DOI';

    return `
      <tr>
        <td>${startNum}</td>
        <td><button type="button" class="linkish" data-open-faculty="${esc(p['Faculty Name'] || '')}">${esc(p['Faculty Name'] || '-')}</button></td>
        <td>${p['Faculty Designation'] || '-'}</td>
        <td>${p['Author Position'] || '-'}</td>
        <td style="max-width: 320px; font-weight: 600;">${esc(p['Paper Title'] || '-')}</td>
        <td style="max-width: 260px;">${esc(p['Venue / Source'] || '-')}</td>
        <td><span class="badge badge-slate">${p['Academic Period Tag'] ? p['Academic Period Tag'].split(' ')[0] : '-'}</span></td>
        <td>${p['Published Month'] || ''} ${p['Published Year'] || ''}</td>
        <td><span class="badge ${qBadgeClass}">${quart}</span></td>
        <td>${sc || '-'}</td>
        <td>${indexBadge}</td>
        <td>${doi}</td>
      </tr>
    `;
  }).join('');
}

function renderFacultyDirectory() {
  const container = document.getElementById('facultyDirectoryContainer');
  if (!container) return;
  const stats = statsByFaculty(filteredPublications);
  const placeholder = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 24 24" fill="%23CBD5E1"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

  container.innerHTML = sortedFacultyRows(stats).map((row) => {
    const faculty = facultyRecord(row.name);
    const photo = (faculty && faculty.photo_url) || placeholder;
    const desig = (faculty && (faculty.Designation || faculty.designation)) || 'Faculty Member';
    const aoi = (faculty && faculty['Area of Interest (AOI)']) || '';
    return `
      <button type="button" class="faculty-profile-card" data-open-faculty="${esc(row.name)}">
        <img src="${esc(photo)}" alt="" class="profile-card-avatar">
        <h3 class="profile-card-name">${esc(row.name)}</h3>
        <div class="profile-card-desig">${esc(desig)}</div>
        ${miniStats(row.stats)}
        <p class="profile-card-aoi">${esc(aoi)}</p>
        <span class="btn-filter-faculty">View profile</span>
      </button>
    `;
  }).join('');
}

window.filterByFaculty = function(facultyName) {
  openFacultyProfile(facultyName);
};

function renderPagination(totalItems) {
  const total = totalItems == null ? filteredPublications.length : totalItems;
  const totalPages = Math.ceil(total / state.pageSize);
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

const DESIGNATION_BUCKETS = [
  'Professor & HOD',
  'Professor',
  'Associate Professor',
  'Assistant Professor',
  'Teaching Assistant',
  'Other'
];

const SCOPUS_SERIES = [
  { id: 'Scopus Indexed', label: 'SCImago-confirmed', color: '#137333' },
  { id: 'Proceeding Unconfirmed', label: 'Unconfirmed', color: '#B06000' },
  { id: 'Not Indexed', label: 'Not indexed', color: '#64748B' }
];

let cumulativeChartInstance = null;
let scopusChartInstance = null;
let citedChartInstance = null;

const valueLabelPlugin = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const type = chart.config.type;
    ctx.save();
    ctx.fillStyle = '#1E293B';
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      const total = dataset.data.reduce((sum, value) => sum + Number(value || 0), 0);
      meta.data.forEach((element, index) => {
        const value = Number(dataset.data[index] || 0);
        if (!value) return;
        if ((type === 'doughnut' || type === 'pie') && total && value / total < 0.04) return;
        const pos = element.tooltipPosition();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (chart.options.indexAxis === 'y') {
          ctx.textAlign = 'left';
          ctx.fillText(String(value), pos.x + 6, pos.y);
        } else if (type === 'doughnut' || type === 'pie') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(String(value), pos.x, pos.y);
          ctx.fillStyle = '#1E293B';
        } else {
          ctx.fillText(String(value), pos.x, pos.y - 10);
        }
      });
    });
    ctx.restore();
  }
};

function designationBucket(record) {
  const text = record['Faculty Designation'] || '';
  if (/hod/i.test(text)) return 'Professor & HOD';
  if (/associate/i.test(text)) return 'Associate Professor';
  if (/teaching/i.test(text)) return 'Teaching Assistant';
  if (/assistant/i.test(text)) return 'Assistant Professor';
  if (/professor/i.test(text)) return 'Professor';
  return 'Other';
}

function coverageBucket(record) {
  const bucket = paperBucket(record);
  const group = bucket === 'book_chapter'
    ? 'Book chapters'
    : (bucket === 'scopus_conference' || bucket === 'non_scopus_conference' ? 'Conferences' : 'Journals');
  const status = String(record['Scopus Indexing Status'] || '').toLowerCase();
  let series = 'Not Indexed';
  if (scopusConfirmed(record)) series = 'Scopus Indexed';
  else if (status.includes('unconfirmed')) series = 'Proceeding Unconfirmed';
  return { group, series };
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const num = parseInt(value, 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

function fadeColors(colors, activeIndex) {
  if (activeIndex == null || activeIndex < 0) return colors;
  return colors.map((color, index) => (index === activeIndex ? color : hexToRgba(color, 0.35)));
}

function legendWithCounts() {
  return {
    position: 'bottom',
    labels: {
      boxWidth: 12,
      font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 },
      generateLabels(chart) {
        const labels = Chart.defaults.plugins.legend.labels.generateLabels(chart);
        return labels.map((item) => {
          const dataset = chart.data.datasets[item.datasetIndex];
          if (!dataset) return item;
          const count = chart.data.datasets.length === 1
            ? dataset.data[item.index]
            : dataset.data.reduce((sum, value) => sum + Number(value || 0), 0);
          if (count != null && count !== '') item.text = `${item.text} (${count})`;
          return item;
        });
      }
    }
  };
}

function tooltipWithShare(total) {
  return {
    callbacks: {
      label(ctx) {
        const raw = ctx.raw;
        const value = typeof raw === 'number' ? raw : Number(raw?.y ?? raw?.x ?? 0);
        const pct = total ? ((value / total) * 100).toFixed(1) : '0.0';
        const series = ctx.dataset && ctx.chart.data.datasets.length > 1 ? `${ctx.dataset.label} — ` : '';
        return `${series}${ctx.label}: ${value} (${pct}% of ${total})`;
      }
    }
  };
}

function axisTitle(text) {
  return { display: true, text, font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: '600' } };
}

function mountChart(canvasId, config, emptyText) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const holder = canvas.parentElement;
  let empty = holder.parentElement.querySelector('.chart-empty');
  if (!empty) {
    empty = document.createElement('p');
    empty.className = 'chart-empty';
    holder.parentElement.appendChild(empty);
  }
  empty.textContent = emptyText || 'No publications match the current filters.';
  const hasData = config !== null;
  holder.hidden = !hasData;
  empty.hidden = hasData;
  const previous = mountChart.instances[canvasId];
  if (previous) previous.destroy();
  if (!hasData) {
    mountChart.instances[canvasId] = null;
    return null;
  }
  if (!Chart.registry.plugins.get('valueLabels')) Chart.register(valueLabelPlugin);
  mountChart.instances[canvasId] = new Chart(canvas.getContext('2d'), config);
  return mountChart.instances[canvasId];
}
mountChart.instances = {
  quartileChart: null,
  monthlyChart: null,
  designationChart: null,
  domainChart: null,
  leaderboardChart: null,
  cumulativeChart: null,
  scopusChart: null,
  citedChart: null
};

function toggleFilter(prop, value) {
  state[prop] = state[prop] === value ? 'all' : value;
  state.currentPage = 1;
  syncControls();
  applyFilters();
}

function syncControls() {
  const setSelect = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (![...el.options].some((option) => option.value === value)) {
      const extra = document.createElement('option');
      extra.value = value;
      extra.textContent = value;
      el.appendChild(extra);
    }
    el.value = value;
  };
  const search = document.getElementById('searchInput');
  if (search) search.value = state.searchQuery;
  setSelect('filterFaculty', state.faculty);
  setSelect('filterDesignation', state.designation);
  setSelect('filterQuartile', state.quartile);
  setSelect('filterPosition', state.position);
  setSelect('filterDomain', state.domain);
  setSelect('filterMedium', state.medium);
  setSelect('filterScopus', state.scopusStatus);
  setSelect('filterIndexSource', state.indexSource);
  setSelect('filterSort', state.sortBy);
  const yearSelect = document.getElementById('periodYear');
  if (yearSelect) {
    const recent = recentSemesterIds();
    yearSelect.value = state.activePeriod === 'all' || recent.includes(state.activePeriod) ? 'recent' : state.activePeriod.split('-')[1];
  }
  renderPeriodControls();
  document.querySelectorAll('[data-leaderboard]').forEach((button) => {
    button.classList.toggle('active', Number(button.getAttribute('data-leaderboard')) === state.leaderboardLimit);
  });
}

function resetAll() {
  state.searchQuery = '';
  state.faculty = 'all';
  state.designation = 'all';
  state.quartile = 'all';
  state.position = 'all';
  state.domain = 'all';
  state.medium = 'all';
  state.scopusStatus = 'all';
  state.indexSource = 'all';
  state.sortBy = 'date-desc';
  state.bucket = 'all';
  state.activePeriod = latestSemesterId();
  state.analyticsSortKey = 'total';
  state.analyticsSortDir = 'desc';
  state.leaderboardLimit = 10;
  state.profileSection = 'all';
  state.currentPage = 1;
  state.profileFaculty = null;
  if (location.hash) history.pushState(null, '', location.pathname + location.search);
  syncControls();
  setViewMode('cards');
  applyFilters();
}

function clearFilter(key) {
  if (key === 'period') state.activePeriod = 'all';
  else if (key === 'search') state.searchQuery = '';
  else if (key === 'bucket') state.bucket = 'all';
  else state[key] = 'all';
  state.currentPage = 1;
  syncControls();
  applyFilters();
}

function renderActiveFilters() {
  const host = document.getElementById('activeFilters');
  if (!host) return;
  const chips = [];
  const add = (key, label) => {
    chips.push(`<button type="button" class="filter-chip" data-clear-filter="${esc(key)}">${esc(label)} <span aria-hidden="true">&times;</span></button>`);
  };
  if (state.activePeriod !== 'all') add('period', semesterLabel(state.activePeriod));
  if (state.searchQuery) add('search', `Search: ${state.searchQuery}`);
  if (state.faculty !== 'all') add('faculty', `Faculty: ${state.faculty}`);
  if (state.designation !== 'all') add('designation', `Designation: ${state.designation}`);
  if (state.quartile !== 'all') add('quartile', `Quartile: ${state.quartile}`);
  if (state.position !== 'all') add('position', `Position: ${state.position}`);
  if (state.domain !== 'all') add('domain', `Domain: ${state.domain}`);
  if (state.medium !== 'all') add('medium', `Medium: ${state.medium}`);
  if (state.scopusStatus !== 'all') add('scopusStatus', `Scopus: ${state.scopusStatus}`);
  if (state.indexSource !== 'all') add('indexSource', `Index: ${state.indexSource}`);
  if (state.bucket !== 'all') {
    const bucket = BUCKETS.find((item) => item.id === state.bucket);
    add('bucket', bucket ? bucket.label : state.bucket);
  }
  const summary = chips.length
    ? `Showing ${filteredPublications.length} of ${allPublications.length} publications.`
    : `No filters applied. Showing all ${allPublications.length}.`;
  host.innerHTML = `<p class="active-filters-summary">${summary}</p>${chips.length ? `<div class="active-filters-chips">${chips.join('')}</div>` : ''}`;
}

function renderCharts() {
  const papers = filteredPublications;
  const total = papers.length;
  const font = { family: "'Plus Jakarta Sans', sans-serif", size: 11 };
  const baseScales = (xTitle, yTitle, horizontal) => ({
    x: {
      beginAtZero: true,
      title: axisTitle(horizontal ? xTitle : xTitle),
      grid: { color: horizontal ? '#F1F5F9' : 'transparent' },
      ticks: { precision: 0, font }
    },
    y: {
      beginAtZero: !horizontal,
      title: axisTitle(yTitle),
      grid: { display: !horizontal, color: '#F1F5F9' },
      ticks: { font }
    }
  });

  if (!total) {
    ['quartileChart', 'monthlyChart', 'designationChart', 'domainChart', 'leaderboardChart', 'cumulativeChart', 'scopusChart', 'citedChart']
      .forEach((id) => mountChart(id, null));
    return;
  }

  const bucketStats = tally(papers);
  const bucketColors = ['#137333', '#1A73E8', '#B06000', '#7627BB', '#64748B', '#004D40', '#0D47A1', '#D9381E'];
  const bucketActive = BUCKETS.findIndex((bucket) => bucket.id === state.bucket);
  mountChart('quartileChart', {
    type: 'bar',
    data: {
      labels: BUCKETS.map((bucket) => bucket.label),
      datasets: [{
        label: 'Publications',
        data: BUCKETS.map((bucket) => bucketStats[bucket.id]),
        backgroundColor: fadeColors(bucketColors, bucketActive),
        borderWidth: 0,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => { if (elements.length) toggleFilter('bucket', BUCKETS[elements[0].index].id); },
      plugins: { legend: legendWithCounts(), tooltip: tooltipWithShare(total) },
      scales: baseScales('Publications', 'Type', true)
    }
  });

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const years = [...new Set(papers.map((paper) => String(paper['Published Year'] || '')).filter(Boolean))].sort();
  const yearColors = ['#81E6D9', '#90CDF4', '#FBD38D', '#D6BCFA', '#FEB2B2'];
  mountChart('monthlyChart', {
    type: 'bar',
    data: {
      labels: shortMonths,
      datasets: years.map((year, index) => ({
        label: year,
        data: monthNames.map((month) => papers.filter((paper) => paper['Published Month'] === month && String(paper['Published Year']) === year).length),
        backgroundColor: yearColors[index % yearColors.length],
        borderRadius: 4
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: legendWithCounts(), tooltip: tooltipWithShare(total) },
      scales: baseScales('Month', 'Publications', false)
    }
  });

  const designationCounts = DESIGNATION_BUCKETS.map((label) => papers.filter((paper) => designationBucket(paper) === label).length);
  const designationActive = DESIGNATION_BUCKETS.indexOf(state.designation);
  const designationColors = ['#9AE6B4', '#90CDF4', '#FBD38D', '#BEE3F8', '#D6BCFA', '#E2E8F0'];
  mountChart('designationChart', {
    type: 'bar',
    data: {
      labels: DESIGNATION_BUCKETS,
      datasets: [{
        label: 'Publications',
        data: designationCounts,
        backgroundColor: fadeColors(designationColors, designationActive),
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => { if (elements.length) toggleFilter('designation', DESIGNATION_BUCKETS[elements[0].index]); },
      plugins: { legend: legendWithCounts(), tooltip: tooltipWithShare(total) },
      scales: baseScales('Designation', 'Publications', false)
    }
  });

  const domainCounts = {};
  papers.forEach((paper) => {
    const domain = paper['Subject Domain Category'] || 'Other / Applied Computing';
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  });
  const domainLabels = Object.keys(domainCounts);
  const domainPalette = ['#90CDF4', '#81E6D9', '#FBD38D', '#BEE3F8', '#FEB2B2', '#D6BCFA', '#E2E8F0', '#F6E05E'];
  const domainColors = domainLabels.map((_, index) => domainPalette[index % domainPalette.length]);
  const domainActive = domainLabels.indexOf(state.domain);
  mountChart('domainChart', {
    type: 'doughnut',
    data: {
      labels: domainLabels,
      datasets: [{
        label: 'Publications',
        data: domainLabels.map((label) => domainCounts[label]),
        backgroundColor: fadeColors(domainColors, domainActive),
        borderColor: '#FFFFFF',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => { if (elements.length) toggleFilter('domain', domainLabels[elements[0].index]); },
      plugins: { legend: legendWithCounts(), tooltip: tooltipWithShare(total) }
    }
  });

  const facultyCounts = {};
  papers.forEach((paper) => {
    const name = paper['Faculty Name'] || 'Unknown';
    facultyCounts[name] = (facultyCounts[name] || 0) + 1;
  });
  const rankedFaculty = Object.entries(facultyCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const visibleFaculty = state.leaderboardLimit > 0 ? rankedFaculty.slice(0, state.leaderboardLimit) : rankedFaculty;
  const leaderHost = document.getElementById('leaderboardChart');
  if (leaderHost) leaderHost.parentElement.style.height = `${Math.max(250, visibleFaculty.length * 28)}px`;
  const leaderActive = visibleFaculty.findIndex(([name]) => name === state.faculty);
  mountChart('leaderboardChart', {
    type: 'bar',
    data: {
      labels: visibleFaculty.map(([name]) => name),
      datasets: [{
        label: 'Publications',
        data: visibleFaculty.map(([, count]) => count),
        backgroundColor: fadeColors(visibleFaculty.map(() => '#81E6D9'), leaderActive),
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => { if (elements.length) toggleFilter('faculty', visibleFaculty[elements[0].index][0]); },
      plugins: { legend: legendWithCounts(), tooltip: tooltipWithShare(total) },
      scales: baseScales('Publications', 'Faculty', true)
    }
  });

  const timeline = new Map();
  papers.forEach((paper) => {
    const month = monthNames.indexOf(paper['Published Month']);
    const year = parseInt(paper['Published Year'], 10);
    if (month < 0 || !year) return;
    const key = year * 12 + month;
    const current = timeline.get(key) || { label: `${shortMonths[month]} ${year}`, count: 0 };
    current.count += 1;
    timeline.set(key, current);
  });
  const ordered = [...timeline.entries()].sort((a, b) => a[0] - b[0]);
  let running = 0;
  const cumulative = ordered.map(([, point]) => {
    running += point.count;
    return running;
  });
  mountChart('cumulativeChart', ordered.length ? {
    type: 'line',
    data: {
      labels: ordered.map(([, point]) => point.label),
      datasets: [{
        label: 'Running total',
        data: cumulative,
        borderColor: '#1A73E8',
        backgroundColor: 'rgba(26, 115, 232, 0.15)',
        fill: true,
        tension: 0.2,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: legendWithCounts(), tooltip: tooltipWithShare(total) },
      scales: baseScales('Month', 'Running total', false)
    }
  } : null);

  const groups = ['Journals', 'Conferences', 'Book chapters'];
  mountChart('scopusChart', {
    type: 'bar',
    data: {
      labels: groups,
      datasets: SCOPUS_SERIES.map((series) => ({
        label: series.label,
        data: groups.map((group) => papers.filter((paper) => {
          const coverage = coverageBucket(paper);
          return coverage.group === group && coverage.series === series.id;
        }).length),
        backgroundColor: state.scopusStatus !== 'all' && state.scopusStatus !== series.id ? hexToRgba(series.color, 0.35) : series.color,
        borderRadius: 4
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => { if (elements.length) toggleFilter('scopusStatus', SCOPUS_SERIES[elements[0].datasetIndex].id); },
      plugins: { legend: legendWithCounts(), tooltip: tooltipWithShare(total) },
      scales: { ...baseScales('Publication type', 'Publications', false), x: { ...baseScales('Publication type', 'Publications', false).x, stacked: true }, y: { ...baseScales('Publication type', 'Publications', false).y, stacked: true } }
    }
  });

  const cited = [...papers]
    .map((paper) => ({ title: paper['Paper Title'] || 'Untitled', citations: parseInt(paper['Citations'], 10) || 0 }))
    .filter((paper) => paper.citations > 0)
    .sort((a, b) => b.citations - a.citations)
    .slice(0, 10);
  const citedHost = document.getElementById('citedChart');
  if (citedHost) citedHost.parentElement.style.height = `${Math.max(250, cited.length * 32)}px`;
  mountChart('citedChart', cited.length ? {
    type: 'bar',
    data: {
      labels: cited.map((paper) => (paper.title.length > 48 ? `${paper.title.slice(0, 48)}…` : paper.title)),
      datasets: [{
        label: 'Citations',
        data: cited.map((paper) => paper.citations),
        backgroundColor: '#F6AD55',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: legendWithCounts(),
        tooltip: {
          callbacks: {
            title: (items) => cited[items[0].dataIndex].title,
            label: (ctx) => `${ctx.raw} citations`
          }
        }
      },
      scales: baseScales('Citations', 'Paper', true)
    }
  } : null, 'No cited papers in the current filter.');
}

function facultyRecord(name) {
  return facultyMap[name] || facultyMap[normalizeName(name)] || null;
}

function statsByFaculty(papers) {
  const names = [];
  const seen = new Set();
  const addName = (name) => {
    if (!name || seen.has(normalizeName(name))) return;
    seen.add(normalizeName(name));
    names.push(name);
  };
  facultyList.forEach((faculty) => addName(faculty.Name || faculty.name));
  papers.forEach((paper) => addName(paper['Faculty Name']));

  const stats = {};
  names.forEach((name) => { stats[name] = emptyStats(); });
  const keyFor = {};
  names.forEach((name) => { keyFor[normalizeName(name)] = name; });
  papers.forEach((paper) => {
    const key = keyFor[normalizeName(paper['Faculty Name'])];
    if (!key) return;
    stats[key][paperBucket(paper)] += 1;
  });
  Object.values(stats).forEach(addTotals);
  return stats;
}

function sortedFacultyRows(stats) {
  const key = state.analyticsSortKey;
  const dir = state.analyticsSortDir === 'asc' ? 1 : -1;
  return Object.entries(stats).map(([name, row]) => ({ name, stats: row })).sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name);
    const diff = (a.stats[key] || 0) - (b.stats[key] || 0);
    if (diff !== 0) return dir * diff;
    return a.name.localeCompare(b.name);
  });
}

const ANALYTICS_COLUMNS = [
  { key: 'name', label: 'Faculty' },
  { key: 'q1', label: 'Q1' },
  { key: 'q2', label: 'Q2' },
  { key: 'q3', label: 'Q3' },
  { key: 'q4', label: 'Q4' },
  { key: 'non_scopus_journal', label: 'Non-Scopus journals' },
  { key: 'scopus_conference', label: 'Scopus conferences' },
  { key: 'non_scopus_conference', label: 'Non-Scopus conferences' },
  { key: 'journals', label: 'Total journals' },
  { key: 'conferences', label: 'Total conferences' },
  { key: 'book_chapter', label: 'Book chapters' },
  { key: 'total', label: 'Total' }
];

function renderFacultyAnalytics() {
  const host = document.getElementById('facultyAnalytics');
  if (!host) return;
  const rows = sortedFacultyRows(statsByFaculty(filteredPublications));
  const head = ANALYTICS_COLUMNS.map((column) => {
    const active = state.analyticsSortKey === column.key;
    const arrow = active ? (state.analyticsSortDir === 'asc' ? ' ↑' : ' ↓') : '';
    const aria = active ? (state.analyticsSortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th aria-sort="${aria}"><button type="button" class="sort-btn${active ? ' active' : ''}" data-sort-key="${column.key}">${esc(column.label)}${arrow}</button></th>`;
  }).join('');
  const totals = emptyStats();
  rows.forEach((row) => {
    ANALYTICS_COLUMNS.slice(1).forEach((column) => {
      if (column.key in totals && !['journals', 'conferences', 'total'].includes(column.key)) {
        totals[column.key] += row.stats[column.key] || 0;
      }
    });
  });
  addTotals(totals);
  const body = rows.map((row, index) => `
    <tr data-open-faculty="${esc(row.name)}">
      <td class="num">${index + 1}</td>
      <td class="analytics-name">${esc(row.name)}</td>
      ${ANALYTICS_COLUMNS.slice(1).map((column) => `<td class="num">${row.stats[column.key] || 0}</td>`).join('')}
    </tr>
  `).join('');
  const foot = `<td class="num"></td><td>Total</td>${ANALYTICS_COLUMNS.slice(1).map((column) => `<td class="num">${totals[column.key] || 0}</td>`).join('')}`;
  host.innerHTML = `<table class="analytics-table"><thead><tr><th>Rank</th>${head}</tr></thead><tbody>${body}</tbody><tfoot><tr>${foot}</tr></tfoot></table>`;
}

function miniStats(stats) {
  const cells = [
    ['Q1', stats.q1], ['Q2', stats.q2], ['Q3', stats.q3], ['Q4', stats.q4],
    ['Non-Scopus j.', stats.non_scopus_journal],
    ['Scopus conf.', stats.scopus_conference],
    ['Other conf.', stats.non_scopus_conference],
    ['Journals', stats.journals],
    ['Conferences', stats.conferences],
    ['Books', stats.book_chapter],
    ['Total', stats.total]
  ];
  return `<div class="mini-stats">${cells.map(([label, value]) => `
    <div class="mini-stat"><span class="mini-stat-num">${value}</span><span class="mini-stat-lbl">${label}</span></div>
  `).join('')}</div>`;
}

function renderBucketChips() {
  const host = document.getElementById('bucketChips');
  if (!host || host.hidden) return;
  const stats = tally(filteredPublications);
  const chip = (id, label, count) => `
    <button type="button" class="bucket-chip${state.bucket === id ? ' active' : ''}" data-bucket="${id}" data-bucket-scope="list">
      ${esc(label)} <span>${count}</span>
    </button>`;
  host.innerHTML = chip('all', 'All sections', stats.total) + BUCKETS.map((bucket) => chip(bucket.id, bucket.short, stats[bucket.id])).join('');
}

function renderPaperRow(paper) {
  const bucket = paperBucket(paper);
  const doiText = doiLabel(paper['DOI']);
  const articleUrl = paper['Paper URL'] || '';
  const doiHtml = doiText
    ? `<a class="doi-link" href="${esc(doiHref(paper['DOI']))}" target="_blank" rel="noopener noreferrer">${esc(doiText)}</a>`
    : (articleUrl
      ? `<a class="doi-link" href="${esc(articleUrl)}" target="_blank" rel="noopener noreferrer">Article link</a>`
      : `<span class="doi-missing">No DOI</span>`);
  const badges = [];
  if (bucket === 'book_chapter' && ['Q1', 'Q2', 'Q3', 'Q4'].includes(paper['SJR Quartile'])) {
    badges.push(`<span class="badge badge-q4">${esc(paper['SJR Quartile'])} series</span>`);
  }
  if (String(paper['Scopus Indexing Status'] || '').toLowerCase().includes('preprint')) {
    badges.push('<span class="badge badge-slate">Preprint</span>');
  }
  if (bucket === 'non_scopus_conference') badges.push('<span class="badge badge-ice">Scopus unconfirmed</span>');
  if (bucket === 'scopus_conference') badges.push('<span class="badge badge-mint">Scopus indexed</span>');
  const claim = String(paper['Incentive Claim'] || '');
  if (claim) {
    const amount = paper['Incentive Amount'] ? ` ${paper['Incentive Amount']}` : '';
    badges.push(`<span class="badge ${claim.toLowerCase() === 'yes' ? 'badge-mint' : 'badge-slate'}">Incentive ${esc(claim)}${esc(amount)}</span>`);
  }
  if (paper['Claimed Quartile'] && paper['Claimed Quartile'] !== paper['SJR Quartile']) {
    badges.push(`<span class="badge badge-q3">Claimed ${esc(paper['Claimed Quartile'])}</span>`);
  }
  const date = paper['Published Date'] || `${paper['Published Month'] || ''} ${paper['Published Year'] || ''}`.trim();
  const cites = parseInt(paper['Citations'], 10) || 0;
  return `
    <article class="pub-row">
      <div class="pub-row-main">
        <h3 class="pub-row-title">${esc(paper['Paper Title'] || 'Untitled Research')}</h3>
        <div class="pub-row-meta">
          <button type="button" class="linkish" data-open-faculty="${esc(paper['Faculty Name'] || '')}">${esc(paper['Faculty Name'] || 'Faculty')}</button>
          ${paper['Venue / Source'] ? ` · ${esc(paper['Venue / Source'])}` : ''}
          ${date ? ` · ${esc(date)}` : ''}
          ${cites ? ` · ${cites} citations` : ''}
        </div>
        ${badges.length ? `<div class="pub-row-badges">${badges.join('')}</div>` : ''}
      </div>
      <div class="pub-row-doi">${doiHtml}</div>
    </article>`;
}

function renderSectionedList(container, papers, omitEmpty) {
  if (!container) return;
  const groups = {};
  BUCKETS.forEach((bucket) => { groups[bucket.id] = []; });
  papers.forEach((paper) => {
    const id = paperBucket(paper);
    if (groups[id]) groups[id].push(paper);
  });
  const buckets = state.viewMode === 'profile' && state.profileSection !== 'all'
    ? BUCKETS.filter((bucket) => bucket.id === state.profileSection)
    : (state.viewMode === 'cards' && state.bucket !== 'all'
      ? BUCKETS.filter((bucket) => bucket.id === state.bucket)
      : BUCKETS);
  const html = buckets.map((bucket) => {
    const items = groups[bucket.id] || [];
    if (omitEmpty && items.length === 0) return '';
    const rows = items.length
      ? items.map(renderPaperRow).join('')
      : `<p class="section-empty">None in the current filter.</p>`;
    return `
      <section class="pub-section" id="section-${bucket.id}">
        <h2 class="pub-section-title">${esc(bucket.label)} <span class="pub-section-count">${items.length}</span></h2>
        <div class="pub-rows">${rows}</div>
      </section>`;
  }).join('');
  container.innerHTML = html || `<p class="section-empty">No publications match the selected criteria.</p>`;
}

function profilePapers() {
  const name = state.profileFaculty;
  if (!name) return [];
  return filteredPublications.filter((paper) => {
    const faculty = paper['Faculty Name'] || '';
    return faculty === name || normalizeName(faculty) === normalizeName(name);
  });
}

function renderFacultyProfile() {
  const host = document.getElementById('facultyProfile');
  if (!host || !state.profileFaculty) return;
  const name = state.profileFaculty;
  const faculty = facultyRecord(name) || {};
  const papers = profilePapers();
  const stats = tally(papers);
  const photo = faculty.photo_url || '';
  const links = [
    ['Google Scholar', faculty['Google Scholar Profile']],
    ['Scopus', faculty['Scopus Profile']],
    ['ORCID', faculty['ORCID Profile']]
  ].filter(([, url]) => profileHref(url));
  const chips = `<button type="button" class="bucket-chip${state.profileSection === 'all' ? ' active' : ''}" data-bucket="all" data-bucket-scope="profile">All <span>${stats.total}</span></button>`
    + BUCKETS.map((bucket) => `
      <button type="button" class="bucket-chip${state.profileSection === bucket.id ? ' active' : ''}" data-bucket="${bucket.id}" data-bucket-scope="profile">${esc(bucket.short)} <span>${stats[bucket.id]}</span></button>
    `).join('');
  const sectionPapers = state.profileSection === 'all'
    ? papers
    : papers.filter((paper) => paperBucket(paper) === state.profileSection);
  host.innerHTML = `
    <div class="profile-panel-card">
      <button type="button" class="btn-back" data-close-profile>← Back to directory</button>
      <div class="profile-head">
        ${photo ? `<img src="${esc(photo)}" alt="" class="profile-panel-avatar">` : ''}
        <div>
          <h2 class="profile-panel-name">${esc(name)}</h2>
          <div class="profile-card-desig">${esc(faculty.Designation || '')}</div>
          <p class="profile-panel-aoi">${esc(faculty['Area of Interest (AOI)'] || '')}</p>
          <div class="profile-links">
            ${links.map(([label, url]) => `<a href="${esc(profileHref(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`).join('')}
          </div>
        </div>
      </div>
      <div class="profile-stat-strip">
        ${[
          ['Q1 journals', stats.q1], ['Q2 journals', stats.q2], ['Q3 journals', stats.q3], ['Q4 journals', stats.q4],
          ['Non-Scopus journals', stats.non_scopus_journal], ['Scopus conferences', stats.scopus_conference],
          ['Non-Scopus conferences', stats.non_scopus_conference], ['Total journals', stats.journals],
          ['Total conferences', stats.conferences], ['Book chapters', stats.book_chapter], ['Total', stats.total]
        ].map(([label, value]) => `<div class="strip-stat"><span class="strip-num">${value}</span><span class="strip-lbl">${label}</span></div>`).join('')}
      </div>
      <div class="bucket-chips">${chips}</div>
      <div id="profileSections"></div>
    </div>`;
  const previousMode = state.viewMode;
  state.viewMode = 'profile';
  renderSectionedList(document.getElementById('profileSections'), sectionPapers, state.profileSection === 'all');
  state.viewMode = previousMode;
}

function openFacultyProfile(name) {
  const resolved = resolveFacultyName(name);
  if (!resolved) return;
  state.profileFaculty = resolved;
  state.profileSection = 'all';
  const nextHash = '#faculty/' + encodeURIComponent(resolved);
  if (location.hash !== nextHash) history.pushState(null, '', nextHash);
  setViewMode('profile');
  const panel = document.getElementById('facultyProfile');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncFromHash() {
  const name = facultyNameFromHash();
  if (name) {
    if (state.profileFaculty === name && state.viewMode === 'profile') {
      renderFacultyProfile();
      return;
    }
    state.profileFaculty = name;
    state.profileSection = 'all';
    setViewMode('profile');
    return;
  }
  if (state.viewMode === 'profile') {
    state.profileFaculty = null;
    setViewMode('directory');
  }
}

function handlePortalClick(event) {
  const sizeBtn = event.target.closest('[data-leaderboard]');
  if (sizeBtn) {
    state.leaderboardLimit = Number(sizeBtn.getAttribute('data-leaderboard'));
    renderCharts();
    syncControls();
    return;
  }

  const clearBtn = event.target.closest('[data-clear-filter]');
  if (clearBtn) {
    clearFilter(clearBtn.getAttribute('data-clear-filter'));
    return;
  }

  const sortBtn = event.target.closest('[data-sort-key]');
  if (sortBtn) {
    const key = sortBtn.getAttribute('data-sort-key');
    if (state.analyticsSortKey === key) {
      state.analyticsSortDir = state.analyticsSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.analyticsSortKey = key;
      state.analyticsSortDir = key === 'name' ? 'asc' : 'desc';
    }
    renderFacultyAnalytics();
    return;
  }

  const bucketBtn = event.target.closest('[data-bucket]');
  if (bucketBtn) {
    const id = bucketBtn.getAttribute('data-bucket');
    const scope = bucketBtn.getAttribute('data-bucket-scope');
    if (scope === 'profile') {
      state.profileSection = id;
      renderFacultyProfile();
    } else {
      state.bucket = id;
      state.currentPage = 1;
      applyFilters();
    }
    return;
  }

  if (event.target.closest('[data-close-profile]')) {
    state.profileFaculty = null;
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
    setViewMode('directory');
    const directory = document.getElementById('facultyDirectoryContainer');
    if (directory) directory.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const opener = event.target.closest('[data-open-faculty]');
  if (opener && !event.target.closest('a')) {
    openFacultyProfile(opener.getAttribute('data-open-faculty'));
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
    'Scopus Indexing Status', 'SJR Quartile', 'Academic Audit Tier',
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
