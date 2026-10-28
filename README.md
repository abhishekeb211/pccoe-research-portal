# PCCOE Pune - Computer Engineering Research Portal & Scopus/SJR Audit (2025–Present)

[![GitHub Pages Deployment](https://img.shields.io/badge/Deployment-GitHub%20Pages-success?style=for-the-badge&logo=github)](https://abhishekeb211.github.io/pccoe-research-portal/)
[![Total Publications](https://img.shields.io/badge/Verified%20Publications-425-blue?style=for-the-badge)](https://abhishekeb211.github.io/pccoe-research-portal/)
[![Profile-Linked Faculty](https://img.shields.io/badge/Active%20Researchers-45%20Faculty-purple?style=for-the-badge)](https://abhishekeb211.github.io/pccoe-research-portal/)
[![Photos Verified](https://img.shields.io/badge/Photo%20Coverage-100%25%20Verified-brightgreen?style=for-the-badge)](https://abhishekeb211.github.io/pccoe-research-portal/)
[![Scopus Q1/Q2](https://img.shields.io/badge/Elite%20Q1%2FQ2-27%20Papers-gold?style=for-the-badge)](https://abhishekeb211.github.io/pccoe-research-portal/)
[![Website Verification](https://img.shields.io/badge/Source-computer.pccoepune.com-emerald?style=for-the-badge)](https://computer.pccoepune.com/faculty-profile)

An executive institutional web portal, visual analytics dashboard, and academic indexing audit suite for the **Department of Computer Engineering, Pimpri Chinchwad College of Engineering (PCCOE Pune)**.

🌐 **Live Production Web Portal**: **[https://abhishekeb211.github.io/pccoe-research-portal/](https://abhishekeb211.github.io/pccoe-research-portal/)**  
📊 **Master Audit Excel Workbook**: Downloadable directly from the portal header or at [`data/PCCOE_Comp_Research_Master_Audit_2025_2026.xlsx`](data/PCCOE_Comp_Research_Master_Audit_2025_2026.xlsx).

---

## 🌟 Key Highlights & Engineering Features

### 1. Strict Departmental Website Profile Ingestion
- Research publications are extracted **ONLY** for faculty members who have an active, official research profile (Google Scholar and/or Scopus Profile URL) linked directly on the official PCCOE portal: [https://computer.pccoepune.com/faculty-profile](https://computer.pccoepune.com/faculty-profile).
- **45 Active Research Faculty Members** have verified research profiles on the departmental portal.
- **6 Faculty Members / Teaching Assistant** without profile links on the site are preserved in the Departmental Roster Directory, but have 0 publications extracted.
- **100% Photo Coverage**: All 51 members have verified official portraits in standard 240×240 WebP/JPEG format (`images/faculty/`).

### 2. Multi-Cycle Academic Period Stratification (425 Publications)
- **AY 2025–2026** (`July 2025 – June 2026`): **255 Publications (60.0%)** — the core institutional accreditation window for NIRF, NBA, and NAAC.
- **Post-June 2026 Momentum** (`July – October 2026`): **56 Publications (13.2%)** — recent publication momentum and early Q1 output for AY 2026–2027.
- **Early 2025** (`January – June 2025`): **114 Publications (26.8%)** — previous academic cycle rollover.

### 3. Empirical Indexing Standard (100% Scopus & Google Scholar Only)
All 425 publications are verified against international indexing databases:
- **Scopus Sources Coverage** (`scopus.com/sources`): **369 Papers (86.8%)** across active Scopus journals, IEEE conference proceedings, and Springer/CRC book chapters.
- **SCImago Journal Rank (SJR) Quartiles**:
  - **Q1 Elite**: 20 papers (Top 25% worldwide prestige).
  - **Q2 High Impact**: 7 papers (Top 25%–50%).
  - **Q3 / Q4 Recognized**: 30 papers.
  - **Book Chapters**: 110 chapters published with CRC Press, Springer Nature, and Wiley.
  - **Conference Proceedings**: 118 papers in Scopus-indexed IEEE and Springer series.
- **Google Scholar Academic Outlets**: **56 Papers (13.2%)** across peer-reviewed preprints and institutional open repositories.
- **Zero Predatory Outlets**: All unindexed/predatory outlets completely excluded.

### 4. Five (5) Dynamic Visual Analytics (Chart.js)
The portal features 5 interactive charts with responsive pastel styling that dynamically recalculate whenever filters change:
1. **SJR Quartile & Medium Spread**: Doughnut chart illustrating distribution across Q1, Q2, Q3, Q4, Book Chapters, and IEEE Proceedings.
2. **Monthly Publication Velocity**: Grouped bar chart comparing publication velocity across all 12 months for 2025 vs 2026.
3. **Research by Faculty Designation**: Bar chart tracking research volume across academic ranks (`Professor & HOD`, `Professor`, `Associate Professor`, `Assistant Professor`, `Teaching Assistant`).
4. **Subject Domain Classification**: Doughnut chart categorizing papers into core domains (`AI & ML`, `Cybersecurity`, `Cloud & IoT`, `Healthcare Informatics`, `Data Science`, `Software Engineering`).
5. **Top 10 Faculty Publishing Leaderboard**: Horizontal bar chart identifying the department's top publishing faculty members.

### 5. Dedicated Faculty Directory View (51 Profiles)
- Switch to the directory view via the **"👥 Faculty Directory (51)"** button in the controls toolbar.
- Each profile card presents:
  - Verified portrait headshot.
  - Faculty Full Name and Canonical Designation badge.
  - Live metric counters: **Total Papers**, **AY 25–26 Output**, and **Elite Q1/Q2 Output**.
  - Listed Areas of Interest / Research Specializations.
  - **"View All Publications &rarr;"** button: 1-click filter that switches to cards view filtered to that individual.

### 6. Ten (10) Multi-Dimensional Filter Dimensions
1. **Academic Period**: `All`, `AY 2025–26`, `Post-June 2026`, `Early 2025`.
2. **Faculty Member Dropdown**: All 51 faculty members sorted alphabetically with live paper counts.
3. **Designation**: `Professor & HOD`, `Professor`, `Associate Professor`, `Assistant Professor`, `Teaching Assistant`.
4. **SJR Quartile**: `Q1 Elite`, `Q2 Impact`, `Q3 Recognized`, `Q4 Standard`, `Book Chapter`, `Conference Proceeding`.
5. **Author Position**: `1st Author`, `2nd Author`, `Senior / Last Author`, `Corresponding Author`.
6. **Subject Domain**: `AI & Machine Learning`, `Cybersecurity`, `Cloud / IoT`, `Healthcare`, `Data Science`, `Software Engineering`.
7. **Medium Category**: `Journal Article`, `Conference Proceeding`, `Book Chapter`, `Preprint / Open Repository`.
8. **Scopus Status**: `Scopus Active Indexed`, `IEEE Conference Proceeding`, `Preprint`, `Discontinued`.
9. **Beall's Threat Flag**: `Clean / Verified Outlets`, `Flagged Predatory (Beall's List)`.
10. **Sort Order**: `Date (Newest First)`, `Date (Oldest First)`, `Citations (Highest)`, `Faculty Name (A-Z)`.

---

## 📁 Repository Structure

```
pccoe-research-portal/
├── index.html                 # Executive Web Portal layout, KPI grid, 5 charts & controls
├── styles.css                 # Responsive CSS design system (pure white canvas, pastel palette)
├── app.js                     # Client-side engine: 10 filters, 5 Chart.js instances, directory & export
├── data/
│   ├── publications.json      # 478 verified publications with photo_url, SJR, DOI & timestamps
│   ├── faculty.json           # 51 official faculty profiles with headshots, designations & AOI
│   └── PCCOE_Comp_Research_Master_Audit_2025_2026.xlsx  # Re-audited master Excel workbook (202 KB)
├── images/
│   └── faculty/               # 51 optimized 240x240 WebP/JPEG portrait headshots
├── docs/
│   └── INDEXING_AUDIT_METHODOLOGY.md  # Comprehensive Scopus, SJR & Beall's list audit protocol
└── README.md                  # Institutional documentation and overview
```

---

## 🚀 Running Locally

1. Clone this repository:
   ```bash
   git clone https://github.com/abhishekeb211/pccoe-research-portal.git
   cd pccoe-research-portal
   ```

2. Start any local static HTTP server (e.g., Python):
   ```bash
   python -m http.server 8080
   ```

3. Open in your browser:
   ```
   http://localhost:8080/index.html
   ```

---

## 🏛️ Academic Institution

**Pimpri Chinchwad College of Engineering (PCCOE Pune)**  
*Autonomous Institute Affiliated to Savitribai Phule Pune University (SPPU)*  
*NBA & NAAC 'A++' Accredited Grade*  
Sector 26, Pradhikaran, Nigdi, Pune, Maharashtra 411044, India.  
Web: [https://computer.pccoepune.com/](https://computer.pccoepune.com/)
