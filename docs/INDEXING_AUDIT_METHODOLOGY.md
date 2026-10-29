# PCCOE Pune — Computer Engineering Department
## Research indexing audit (2025–present), identity-checked

> **Scope.** 425 candidate records were checked. **180** remain and **245** were removed because they could not be tied to the named faculty member. The tables below describe the 180 records still in the dataset, across 34 faculty names.
>
> **What counts as evidence.** A record is kept only when at least one of these is true: the title is on that faculty member's own Google Scholar profile (the `user=` id published on [the departmental faculty page](https://computer.pccoepune.com/faculty-profile)), the title is on their ORCID record, or the publisher metadata for the DOI names that author with an affiliation containing Pimpri, Chinchwad, or PCCOE. A shared surname, a topic overlap, or a blank affiliation filled in as "Dept. of Computer Engineering, PCCOE Pune" is not evidence.
>
> **Where each field comes from.** Identity comes from the departmental roster. Self-claimed works come from the linked Google Scholar profiles and from the public ORCID API. Publisher metadata (author and affiliation) comes from OpenAlex, with Crossref used when OpenAlex has no record or no affiliation string. On the original 180 rows, quartile, SJR, H-index, ISSN, and Scopus source id come from the local SCImago master file. A recorded Scopus source-list result replaces only the displayed quartile for that journal. The faculty claim is kept beside it. Predatory screening uses Beall's journal, publisher, and hijacked-title lists plus a short list of known pay-to-publish titles. A proceeding is not labeled Scopus-indexed unless that source or its ISSN is in the SCImago file.

## Published set

The file the portal serves is `web/data/publications.json`. ScholarWatch is the only writer. The root scripts that used to copy the detailed JSON into the portal are historical and must not be run to publish.

The published file has **187** rows: the 180 identity-checked rows, plus seven faculty incentive rows that were not already in the set. Two incentive copies of *International Journal of Computational Vision and Robotics* papers were merged into the identity-checked rows of the same titles. The edited book *Modern Digital Approaches to Care Technologies for Individuals With Disabilities* stays a book chapter and **Not Ranked**.

The portal period control is a year plus two semesters, July–December and January–June. December stays in July–December.

Two rank authorities stay separate:

- `scimago_2021` is the 2021 SCImago CSV. It remains the displayed quartile only where no source-list result has been recorded. The tables below are that snapshot.
- `scopus_source_list` is a quartile already checked on Scopus Sources by applying Q1, Q2, Q3, and Q4 one at a time. The displayed quartile is the single filter that still listed the journal. `Claimed Quartile` is the faculty form and is not overwritten. A later SCImago pass does not replace this rank.

Journals with a source-list result: Journal of Theoretical and Applied Information Technology (Q3), International Journal of Computational Vision and Robotics (Q2), Discover Applied Sciences (Q2), Discover Artificial Intelligence (Q1), International Journal of Computing (Q3), and Journal of Ambient Intelligence and Humanized Computing (Q1).

Incentive rows carry `FACULTY_INCENTIVE_CLAIM`. Where the same paper was already identity-checked, that evidence is kept as well. The 15-day job does not log into Scopus. An Elsevier API key, if one is added later, stays in the environment or the OS keyring.

The tables below are the identity-pass snapshot of the original 180 rows. They are not a recount of the 187-row published file.

## PCCOE authors on one paper

`PCCOE Authors` lists every departmental faculty member on the paper, in author order, as `position. Name (Main)` or `position. Name (Co-Author)`. `PCCOE Author Count` is how many of those names there are. `scholarwatch/scripts/tag_pccoe_authors.py` writes both fields. It does not add rows.

A name counts as PCCOE only when its first and last significant tokens match one person on the 51-name roster. Titles such as Dr. and Prof. are ignored. A match that fits two people is skipped. The row's own `Faculty Name` is always included. Rows with an empty author list keep that one owner. No affiliation string is filled in.

Main and Co-Author depend on position in `All Authors`:

- A journal or book chapter: positions 1 and 2 are Main. Position 3 onward is Co-Author.
- A conference: positions 1 to 3 are Main. Position 4 onward is Co-Author.
- A conference of at most five authors, all of them PCCOE, marks every author Main.

The department counts a paper once, and only when a PCCOE faculty member is a main author. That is **162** papers. **24** other unique papers have only PCCOE co-authors; they stay on those faculty members' co-author counts and are not a second department entry. One title stored for two faculty members with no DOI is still a single paper.

## 1. Why the previous total changed

Earlier extracts accepted an OpenAlex name search when the faculty member's area of interest shared words with the paper, and they wrote a PCCOE affiliation whenever the source had none. That attached papers by other people who share a name, including clinical and unrelated journal articles, to this department. Those records are in `purged_unverified_records.json` and are not in the website, the workbook, or the tables below.

The identity pass removed 245 of 425 candidate records (236 with no identity evidence, 9 with no DOI and no profile match). The deletion log was rebuilt from the pre-purge workbook and holds 244 distinct faculty-and-title rows; one duplicate title was collapsed.

| Removal reason | Records |
| :--- | ---: |
| NO_IDENTITY_EVIDENCE | 236 |
| NO_DOI_AND_NOT_ON_PROFILE | 9 |

| Evidence on the records that remain | Records |
| :--- | ---: |
| SCHOLAR_PROFILE; AFFILIATION | 50 |
| SCHOLAR_PROFILE | 78 |
| AFFILIATION | 52 |

## 2. Audit tier

Tiers are labels on top of the SCImago match. They are not a separate index.

| Academic audit tier | Papers | Share |
| :--- | ---: | ---: |
| Tier 3 (Publisher-Verified Proceeding, Scopus unconfirmed) | 81 | 45.0% |
| Tier 3 (Non-Scopus / Unindexed) | 25 | 13.9% |
| Tier 2A (Scopus Q4) | 25 | 13.9% |
| Tier 3 (Conference Unverified) | 17 | 9.4% |
| Tier 2A (Scopus Q3) | 9 | 5.0% |
| Tier 3 (Open Repository / Preprint) | 9 | 5.0% |
| Tier 1B (Scopus Q2) | 7 | 3.9% |
| Tier 1A (Scopus Q1) | 3 | 1.7% |
| Tier 3 (Academic Book, Scopus unconfirmed) | 2 | 1.1% |
| Tier 2A (Scopus Indexed) | 2 | 1.1% |

## 3. SCImago quartile

Quartile values are copied from the SCImago master. "Not Ranked" means the source had no quartile there, not that the paper was judged by hand.

| SJR quartile | Papers | Share |
| :--- | ---: | ---: |
| Not Ranked | 136 | 75.6% |
| Q4 | 25 | 13.9% |
| Q3 | 9 | 5.0% |
| Q2 | 7 | 3.9% |
| Q1 | 3 | 1.7% |

## 4. Indexing status

| Status | Papers | Share |
| :--- | ---: | ---: |
| Publisher-Verified Proceeding (Scopus status unconfirmed) | 81 | 45.0% |
| Scopus Indexed (Active) | 46 | 25.6% |
| Not Indexed in Scopus | 25 | 13.9% |
| Conference Proceeding (Indexing Unconfirmed) | 17 | 9.4% |
| Preprint / Open Repository | 9 | 5.0% |
| Academic Book (Scopus status unconfirmed) | 2 | 1.1% |

"Scopus Indexed (Active)" is used only when the venue title, its series title, or its ISSN matched a row in the SCImago file, and that row's source id is stored on the record. "Publisher-Verified Proceeding (Scopus status unconfirmed)" means the publisher is IEEE, Springer, Elsevier, or ACM, and the source was not in the SCImago file used for this audit.

## 5. Academic period

| Period | Papers | Share |
| :--- | ---: | ---: |
| July 2025 - June 2026 (AY 2025-26) | 115 | 63.9% |
| Jan 2025 - June 2025 (H2 Prev AY) | 51 | 28.3% |
| July 2026 - October 2026 (Post-June 2026) | 14 | 7.8% |

## 6. SCImago Q1 records

Every remaining record whose SCImago quartile is Q1.

| # | Faculty | Paper | Venue | SJR | H-index | Year | Evidence |
| :-: | :--- | :--- | :--- | ---: | ---: | :---: | :--- |
| 1 | Dr. Mubin Shoukat Tamboli | A secure data sharing framework with AESMO enabled key generation in consortium blockchain based E-government system | Knowledge-Based Systems | 2,192 | 135 | 2025 | SCHOLAR_PROFILE |
| 2 | Prof. Dr. Swati V. Shinde | An end-to-end multi-modal pipeline for person search in unconstrained CCTV environments | Scientific Reports | 1,005 | 242 | 2026 | AFFILIATION |
| 3 | Prof. Dr. Swati V. Shinde | HybridSwingNet for explainable swing trading using multi-encoder deep learning and confidence-calibrated signal execution | Scientific Reports | 1,005 | 242 | 2026 | AFFILIATION |

## 7. SCImago Q2 records

Every remaining record whose SCImago quartile is Q2.

| # | Faculty | Paper | Venue | SJR | H-index | Year | Evidence |
| :-: | :--- | :--- | :--- | ---: | ---: | :---: | :--- |
| 1 | Prof. Dr. Sudeep D. Thepade | An enhanced light weight face liveness detection method using deep convolutional neural network | MethodsX | 0,394 | 31 | 2025 | SCHOLAR_PROFILE |
| 2 | Prof. Dr. Sudeep D. Thepade | Enhancing semantic segmentation for autonomous vehicle scene understanding in indian context using modified CANet model | MethodsX | 0,394 | 31 | 2025 | SCHOLAR_PROFILE |
| 3 | Dr. Mubin Shoukat Tamboli | Deep learning-driven rainfall prediction leveraging hybrid child drawing development optimization and time series data | Earth Science Informatics | 0,502 | 27 | 2025 | SCHOLAR_PROFILE |
| 4 | Dr. Meghana P. Lokhande | Experimental Protocols for Developing and Validating Explainable AI Models in Secure Healthcare Diagnostics | Journal of Visualized Experiments | 0,504 | 105 | 2026 | SCHOLAR_PROFILE; AFFILIATION |
| 5 | Dr. Aparna Joshi | Softwar-defined vehicle network security using blockchain approach | MethodsX | 0,394 | 31 | 2026 | SCHOLAR_PROFILE; AFFILIATION |
| 6 | Ms. Harsha Vinayak Talele | Evolution of Drying Process Modeling: From Mathematical Foundations to Machine Learning‐Driven Prediction and Control | Journal of Food Process Engineering | 0,524 | 49 | 2025 | AFFILIATION |
| 7 | Ms. Suvarna Patil | Enhancement and Stability of Reactive Oxygen and Nitrogen Species in Water Treatment Processes Using Cold Plasma | Periodica Polytechnica Chemical Engineering | 0,379 | 22 | 2026 | SCHOLAR_PROFILE |

## 8. Predatory and discontinued venues still in the kept set

No remaining record is flagged as predatory or discontinued by the current screen.

## 9. Checks before the next publish

1. Run `validate_dataset.py`. It fails if a row has no `Verification Evidence`, if an affiliation is the old placeholder, or if a row says Scopus-indexed without a SCImago source id or ISSN.
2. Treat publisher-verified proceedings as unconfirmed until the source appears in a current SCImago or Scopus source list.
3. Re-scrape Scholar profiles that `build_identity_index.py` marked incomplete before treating a missing title as a deletion.
