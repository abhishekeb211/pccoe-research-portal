/* ==========================================================================
   PCCOE COMPUTER ENGINEERING - RESEARCH & INDEXING INTELLIGENCE PORTAL
   Vanilla JavaScript Client-Side Engine: Filtering, Search, Charts & CSV Export
   ========================================================================== */

let allPublications = [];
let facultyMap = {};
let filteredPublications = [];

// Application State
const state = {
  activePeriod: 'ay2526', // default: AY 2025-2026
  searchQuery: '',
  designation: 'all',
  quartile: 'all',
  position: 'all',
  scopusStatus: 'all',
  beallFlag: 'all',
  viewMode: 'cards', // 'cards' or 'table'
  currentPage: 1,
  pageSize: 24
};

// Chart instances
let quartileChartInstance = null;
let monthlyChartInstance = null;

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
      const facultyList = await facRes.json();
      facultyList.forEach(f => {
        if (f.name) {
          facultyMap[normalizeName(f.name)] = f;
        }
      });
    }

    // 2. Pre-calculate global period counts
    updatePeriodPillCounts();

    // 3. Setup Event Listeners
    setupEventListeners();

    // 4. Initial Filter & Render
    applyFilters();

  } catch (error) {
    console.error('Failed to initialize application:', error);
    document.getElementById('cardsContainer').innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: #FFF5F5; border: 1px solid #FED7D7; border-radius: 12px; color: #C53030;">
        <h3 style="margin-bottom: 0.5rem; font-weight: 700;">Error Loading Research Data</h3>
        <p>Please ensure data/publications.json is accessible.</p>
      </div>
    `;
  }
}

function normalizeName(str) {
  return str.toLowerCase().replace(/^(dr\.|prof\.|mr\.|mrs\.|ms\.)\s+/i, '').replace(/[^a-z0-9]/g, '');
}

function updatePeriodPillCounts() {
  const counts = {
    all: allPublications.length,
    ay2526: allPublications.filter(p => p['Academic Period Tag'] === 'July 2025 - June 2026 (AY 2025-26)').length,
    postjune26: allPublications.filter(p => p['Academic Period Tag'] === 'July 2026 - October 2026 (Post-June 2026)').length,
    prejuly25: allPublications.filter(p => p['Academic Period Tag'] === 'Jan 2025 - June 2025 (H2 Prev AY)').length
  };

  document.getElementById('countAll').textContent = counts.all;
  document.getElementById('countAY2526').textContent = counts.ay2526;
  document.getElementById('countPostJune26').textContent = counts.postjune26;
  document.getElementById('countPreJuly25').textContent = counts.prejuly25;
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
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      state.currentPage = 1;
      applyFilters();
    }, 250);
  });

  // Dropdown Filters
  document.getElementById('filterDesignation').addEventListener('change', (e) => {
    state.designation = e.target.value;
    state.currentPage = 1;
    applyFilters();
  });

  document.getElementById('filterQuartile').addEventListener('change', (e) => {
    state.quartile = e.target.value;
    state.currentPage = 1;
    applyFilters();
  });

  document.getElementById('filterPosition').addEventListener('change', (e) => {
    state.position = e.target.value;
    state.currentPage = 1;
    applyFilters();
  });

  document.getElementById('filterScopus').addEventListener('change', (e) => {
    state.scopusStatus = e.target.value;
    state.currentPage = 1;
    applyFilters();
  });

  document.getElementById('filterBeall').addEventListener('change', (e) => {
    state.beallFlag = e.target.value;
    state.currentPage = 1;
    applyFilters();
  });

  // Reset Filters
  document.getElementById('resetFiltersBtn').addEventListener('click', () => {
    state.searchQuery = '';
    state.designation = 'all';
    state.quartile = 'all';
    state.position = 'all';
    state.scopusStatus = 'all';
    state.beallFlag = 'all';
    state.currentPage = 1;

    document.getElementById('searchInput').value = '';
    document.getElementById('filterDesignation').value = 'all';
    document.getElementById('filterQuartile').value = 'all';
    document.getElementById('filterPosition').value = 'all';
    document.getElementById('filterScopus').value = 'all';
    document.getElementById('filterBeall').value = 'all';

    applyFilters();
  });

  // View Toggles (Cards vs Table)
  document.getElementById('viewCardsBtn').addEventListener('click', () => {
    state.viewMode = 'cards';
    document.getElementById('viewCardsBtn').classList.add('active');
    document.getElementById('viewTableBtn').classList.remove('active');
    document.getElementById('cardsContainer').style.display = 'grid';
    document.getElementById('tableContainer').style.display = 'none';
    renderPagination();
  });

  document.getElementById('viewTableBtn').addEventListener('click', () => {
    state.viewMode = 'table';
    document.getElementById('viewTableBtn').classList.add('active');
    document.getElementById('viewCardsBtn').classList.remove('active');
    document.getElementById('cardsContainer').style.display = 'none';
    document.getElementById('tableContainer').style.display = 'block';
    renderPagination();
  });

  // CSV Export Button
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    exportFilteredToCsv();
  });
}

function applyFilters() {
  filteredPublications = allPublications.filter(p => {
    // 1. Period Filter
    if (state.activePeriod === 'ay2526' && p['Academic Period Tag'] !== 'July 2025 - June 2026 (AY 2025-26)') return false;
    if (state.activePeriod === 'postjune26' && p['Academic Period Tag'] !== 'July 2026 - October 2026 (Post-June 2026)') return false;
    if (state.activePeriod === 'prejuly25' && p['Academic Period Tag'] !== 'Jan 2025 - June 2025 (H2 Prev AY)') return false;

    // 2. Search Query (Title, Faculty, Venue, Publisher, DOI)
    if (state.searchQuery) {
      const q = state.searchQuery;
      const title = (p['Paper Title'] || '').toLowerCase();
      const fac = (p['Faculty Name'] || '').toLowerCase();
      const venue = (p['Venue / Source'] || '').toLowerCase();
      const pub = (p['Publisher'] || '').toLowerCase();
      const doi = (p['DOI'] || '').toLowerCase();
      if (!title.includes(q) && !fac.includes(q) && !venue.includes(q) && !pub.includes(q) && !doi.includes(q)) {
        return false;
      }
    }

    // 3. Designation
    if (state.designation !== 'all') {
      const des = (p['Faculty Designation'] || '');
      if (!des.toLowerCase().includes(state.designation.toLowerCase())) return false;
    }

    // 4. Quartile
    if (state.quartile !== 'all') {
      const q = (p['SJR Quartile'] || '');
      if (state.quartile === 'Q1' && q !== 'Q1') return false;
      if (state.quartile === 'Q2' && q !== 'Q2') return false;
      if (state.quartile === 'Q3' && q !== 'Q3') return false;
      if (state.quartile === 'Q4' && q !== 'Q4') return false;
      if (state.quartile === 'Book Chapter' && q !== 'Book Chapter') return false;
      if (state.quartile === 'Conference Proceeding' && q !== 'Conference Proceeding') return false;
    }

    // 5. Position
    if (state.position !== 'all') {
      const pos = (p['Author Position'] || '').toLowerCase();
      if (!pos.includes(state.position.toLowerCase())) return false;
    }

    // 6. Scopus Status
    if (state.scopusStatus !== 'all') {
      const sc = (p['Scopus Indexing Status'] || '').toLowerCase();
      if (state.scopusStatus === 'Scopus Indexed' && !sc.includes('active') && !sc.includes('indexed')) return false;
      if (state.scopusStatus === 'IEEE' && !sc.includes('ieee')) return false;
      if (state.scopusStatus === 'Preprint' && !sc.includes('preprint')) return false;
      if (state.scopusStatus === 'Discontinued' && !sc.includes('discontinued')) return false;
    }

    // 7. Beall's Risk
    if (state.beallFlag !== 'all') {
      const b = (p["Beall's List Flag"] || '');
      if (state.beallFlag === 'Clean' && (b.includes('CRITICAL') || b.includes('ALERT'))) return false;
      if (state.beallFlag === 'CRITICAL' && !b.includes('CRITICAL') && !b.includes('ALERT')) return false;
    }

    return true;
  });

  // Update Dynamic KPIs
  updateDashboardKpis();

  // Update Interactive Charts
  renderCharts();

  // Render Publications
  renderPublications();
}

function updateDashboardKpis() {
  document.getElementById('kpiFilteredTotal').textContent = filteredPublications.length;
  
  // Scope label
  const labels = {
    all: 'All Verified Publications',
    ay2526: 'Papers in AY 2025–2026',
    postjune26: 'Post-June 2026 Momentum',
    prejuly25: 'Pre-July 2025 Output'
  };
  document.getElementById('kpiScopeSubtitle').textContent = labels[state.activePeriod] || 'Matching Active Filters';

  const q1q2Count = filteredPublications.filter(p => p['SJR Quartile'] === 'Q1' || p['SJR Quartile'] === 'Q2').length;
  document.getElementById('kpiQ1Q2').textContent = q1q2Count;

  const predCount = filteredPublications.filter(p => (p["Beall's List Flag"] || '').includes('CRITICAL') || (p["Beall's List Flag"] || '').includes('ALERT')).length;
  document.getElementById('kpiPredatory').textContent = predCount;

  // Audit Warning Banner visibility
  const alertBanner = document.getElementById('auditAlertBanner');
  if (predCount > 0 && state.beallFlag !== 'Clean') {
    alertBanner.style.display = 'flex';
  } else {
    alertBanner.style.display = 'none';
  }

  document.getElementById('showingCount').textContent = Math.min(filteredPublications.length, state.pageSize);
  document.getElementById('totalCount').textContent = filteredPublications.length;
}

function renderPublications() {
  const startIndex = (state.currentPage - 1) * state.pageSize;
  const pageItems = filteredPublications.slice(startIndex, startIndex + state.pageSize);

  document.getElementById('showingCount').textContent = pageItems.length;

  if (state.viewMode === 'cards') {
    renderCardView(pageItems);
  } else {
    renderTableView(pageItems);
  }

  renderPagination();
}

function renderCardView(items) {
  const container = document.getElementById('cardsContainer');
  if (items.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
        <p style="font-size: 1.2rem; font-weight: 600; margin-bottom: 0.5rem;">No publications match the selected criteria.</p>
        <p style="font-size: 0.9rem;">Try adjusting your period switcher, keywords, or dropdown filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((p, idx) => {
    const facName = p['Faculty Name'] || 'PCCOE Faculty';
    const facDesig = p['Faculty Designation'] || 'Faculty';
    const norm = normalizeName(facName);
    const facProfile = facultyMap[norm];

    let avatarImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="%23CBD5E1"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
    if (facProfile && facProfile.image_path) {
      const bname = facProfile.image_path.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '');
      avatarImg = `images/faculty/${bname}.jpg`;
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

    const beall = p["Beall's List Flag"] || '';
    let beallBadge = '';
    if (beall.includes('CRITICAL') || beall.includes('ALERT')) {
      beallBadge = `<span class="badge badge-predatory" title="${beall}">⚠️ Predatory / Flagged</span>`;
    }

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
          ${periodBadge}
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

function renderPagination() {
  const totalPages = Math.ceil(filteredPublications.length / state.pageSize);
  const nav = document.getElementById('paginationNav');

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
  // Chart 1: Quartile & Medium Spread
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

  const ctxQ = document.getElementById('quartileChart').getContext('2d');
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
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 } } }
      }
    }
  });

  // Chart 2: Monthly Spread
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

  const ctxM = document.getElementById('monthlyChart').getContext('2d');
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
        legend: { position: 'top', labels: { boxWidth: 12, font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 } } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#F1F5F9' } }
      }
    }
  });
}

function exportFilteredToCsv() {
  if (filteredPublications.length === 0) {
    alert('No publications to export.');
    return;
  }

  const headers = [
    'Faculty Name', 'Faculty Designation', 'Paper Title', 'Author Position', 'Author Index',
    'Total Authors', 'Published Month', 'Published Year', 'Academic Period Tag',
    'Publication Medium Category', 'Venue / Source', 'Publisher', 'Scopus Indexing Status',
    'SJR Quartile', 'Academic Audit Tier', "Beall's List Flag", 'DOI', 'Paper URL'
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
