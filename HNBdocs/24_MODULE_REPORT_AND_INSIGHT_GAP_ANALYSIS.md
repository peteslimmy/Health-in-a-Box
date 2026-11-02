# Module, Report and Insight Catalogue: Gap Analysis and Build Plan

**Date:** 2026-10-27 · Reviews the 21-module, 41-report, KPI and insight proposal against documents 01-23 and the code as built (`21_IMPLEMENTATION_STATUS.md`). Status words: **Built** (works end to end), **Partial** (some of it works), **Not built**. Nothing in this document changes the code.

## 1. Verdict

The proposal is sound and fits the existing architecture: one modular application, one ledger, one audit service, one import engine. Most of it is already specified in doc 16 (14 reports, KPI definitions, dashboard, a later AI phase). What it adds is mainly breadth in reporting and a clearer insight model. Four points need a decision or a correction before building (section 5); the largest is that **the report your centres actually send is a period total, not a daily one**, which changes what the daily and trend reports can honestly show.

## 2. The 21 modules against what exists

| # | Module | Status | What is missing |
|---|---|---|---|
| 1 | Executive dashboard | Partial | Built: 8 headline measures, monthly trend charts, ageing bar, ranking by centre. Missing: day/week/quarter/year switch, linked filtering (select a centre or period and every chart follows), drill-down from a figure to its records, department and channel composition charts, concentration view. |
| 2 | Centre management | Partial | Create, edit, status, departments, channels, time zone. Missing: bulk setup grid, suspend/archive workflow, reporting obligations (expected frequency), per-centre settings. |
| 3 | Agreements and charge rules | Partial | Percentage rules, effective dates, overlap blocking, version history by date. Missing: exempt flag, fixed-amount rules, rule-change impact report. |
| 4 | Department and channel configuration | Partial | Create, edit, aliases; PDF upload can add missing ones. Missing: bulk upload grid, deactivation workflow, cross-centre reuse. |
| 5 | Revenue report management | Built | PDF, CSV and XLSX; register, detail with checks. Missing: download of the original file, corrected-report workflow. |
| 6 | Import templates and mapping | Not built | Only a CSV template download and name aliases. No saved per-centre column mapping. |
| 7 | Validation and exception management | Partial | Tally, duplicate, unknown name, gap and overlap checks all run. Missing: a cross-import exception register with owner and status. |
| 8 | Service-charge engine | Built | Rule precedence, half-up rounding, rule version kept, explainable lines. |
| 9 | Reconciliation workspace | Not built | Only the ledger cross-check on one receivable. No side-by-side revenue, charge, receivable, payment, balance view. |
| 10 | Receivables and settlement | Built | Receivables, ageing, due dates, opening balances. |
| 11 | Payments received | Built | Lifecycle, approval, duplicates. Missing: evidence upload screen. |
| 12 | Payment allocation | Built | Locked, all-or-nothing, reversible, unallocated receipts kept. |
| 13 | Statements and billing | Partial | Statement of account (report, printable). Missing: invoices and PDF statements. |
| 14 | Adjustments, disputes, reversals | Mostly built | Credit and debit adjustments, disputes and reversals, all with approval. Missing: corrected-report workflow. |
| 15 | Historical migration | Not built | Can reuse the import engine (same checks) once opening balances exist. |
| 16 | Users, roles, permissions | Built | Custom roles, centre scope, privilege ceiling, maker-checker. |
| 17 | Reports and analytics | Mostly built | Report engine and 25 reports, CSV/Excel export with audit, print. Missing: PDF export, scheduled reports, the remaining reports that need new data (exemptions, daily revenue). |
| 18 | Notifications and work queue | Partial | Per-user "My work" queue with a count. Missing: email or scheduled alerts and reminders. |
| 19 | Audit trail | Built | Events for every built action; page with filters. |
| 20 | System configuration and documents | Not built | No financial-period close, retention settings, export preferences. |
| 21 | Insights and forecasting | Partial | Rule-based insights with evidence. Forecasting not built. |

## 3. The 41 reports

Reports marked "now" can be produced from data already in the database. "Needs X" means the data does not exist yet. **No report can be exported today**; export is built once, in the report engine (section 6).

| # | Report | Data available | Today |
|---|---|---|---|
| 1 | Consolidated financial performance | now | Partial (dashboard) |
| 2 | Centre performance comparison | now | Partial (outstanding and overdue by centre) |
| 3 | Centre financial position | needs opening balances and adjustments | Not built |
| 4 | Revenue and service-charge trends | monthly now; daily/weekly only with daily uploads | Partial (monthly) |
| 5 | Collection performance | needs a decided cohort definition (section 5) | Not built |
| 6 | Outstanding receivables summary | now | Partial (list and ageing) |
| 7 | Top and bottom centres | now | Not built |
| 8 | Revenue concentration | now | Not built |
| 9 | Daily revenue report | needs daily uploads | Not built |
| 10 | Periodic revenue summary | now (as uploaded) | Not built |
| 11 | Department revenue analysis | now | Not built |
| 12 | Payment-channel analysis | now | Not built |
| 13 | Department and channel matrix | now | Not built |
| 14 | Report submission register | now | Built (imports list) |
| 15 | Revenue variance and data quality | now | Partial (import detail) |
| 16 | Report completeness | needs expected reporting frequency per centre | Not built |
| 17 | Expected service charge | now | Partial (charge runs) |
| 18 | Calculation detail | now | Built (charge run detail) |
| 19 | Departmental earnings | now | Not built |
| 20 | Effective service-charge yield | now | Not built |
| 21 | Rule history | now; impact on calculations needs a link query | Not built |
| 22 | Unposted and pending charges | now | Partial (charge runs by status) |
| 23 | Exemptions and overrides | needs exempt flag | Not built |
| 24 | Receivables ledger | now | Partial (per receivable) |
| 25 | Receivables ageing | now | Built (dashboard); no export |
| 26 | Overdue receivables | now; follow-up owner needs a field | Partial |
| 27 | Payment receipt register | now | Built (payments list) |
| 28 | Payment allocation report | now | Partial (per payment) |
| 29 | Unallocated and unmatched receipts | now | Partial (filter exists) |
| 30 | Partial payments and settlement history | now | Not built |
| 31 | Statement of account by centre | needs opening balances and adjustments | Not built |
| 32 | Credit, debit and reversal report | needs adjustments | Not built |
| 33 | Collection delay analysis | now once payments accumulate | Not built |
| 34 | Payment terms compliance | now once payments accumulate | Not built |
| 35 | Bulk import batch report | now | Partial |
| 36 | Historical migration reconciliation | needs migration | Not built |
| 37 | Import error report | now | Partial (import detail) |
| 38 | Audit trail report | now (views are not audited, only changes) | Built (audit page) |
| 39 | Approval and pending action report | now | Partial (dashboard list) |
| 40 | User access and permission report | now | Partial (users page) |
| 41 | Commercial configuration report | now | Partial (centre detail) |

Count: about 30 of the 41 can be produced from existing data once a report engine and export exist; 6 wait for adjustments, opening balances or migration; 5 wait for decisions or new fields (daily uploads, reporting frequency, exempt flag, follow-up owner, cohort definition).

## 4. KPIs, insights and the dashboard

**KPIs.** The proposed definitions match doc 16 section 3 with these differences to settle:

| KPI | Issue |
|---|---|
| Overdue / ageing | The proposal groups "more than 90 days". Confirmed decision D-014 uses 91-120 and over 120. Keep D-014; a 90+ view is the sum of the last two buckets. |
| Collection rate | **The dashboard chart named "Collection rate" is cash received divided by charges posted in the same month.** That is exactly what the proposal warns against. It carries an explanatory note but the name misleads. Rename it ("Cash received vs charges posted") and add a true collection rate: of the receivables that fell due in a period, the share settled by a stated cutoff. |
| Payments received vs allocated | Already separate in the dashboard and ledger. |
| Report completeness, average settlement delay | Need expected reporting frequency per centre and a documented delay method (weighted by amount). |
| Revenue growth, yield | Straightforward once the comparison period is selectable. |

**Insights.** The proposed order is right and matches doc 16 section 7: deterministic measures, threshold comparison, a factual sentence with the figures and period, a link to the records. Build the rule-based layer first (about 15 rules from the six areas), store each insight with its inputs so it can be re-checked, and keep any language-model wording optional and only ever describing numbers the system calculated. Forecasting: only scenario arithmetic until there are at least several months of posted history; today there is one.

**Dashboard.** Already covers trends, ageing and centre ranking. Still to add: granularity switch, linked filters, drill-down, composition charts. Daily and weekly views are only meaningful if daily reports are uploaded (section 5).

## 5. Points to correct or decide before building

> **Resolved 2026-10-27** as decisions D-201 to D-206 in `20_DECISION_SHEET.md` section G: both daily and period uploads; weekly or daily reporting with "late" meaning no report ending in the last 7 days; collection rate = settled within 30 days of due date; unexplained variances are held and never adjusted; real reports go to their own centre and demo data is never mixed in. The points below are kept for the reasoning.

1. **Daily or period uploads?** The real report is one total per department for a whole period (25 Sep to 25 Oct), with no per-day figures. Reports 4 (daily trend), 9, 16 and any "day by day" chart need daily reports or a daily export. Until then they can only show the periods as uploaded. The overlap rule built last (take only the new days by subtraction) works for cumulative period files but cannot create daily detail.
2. **Define the true collection rate** (cohort: receivables due in the period; cutoff: 30 days after due date, or end of next month, or configurable).
3. **Reporting obligations.** Completeness and delayed-submission reports need, per centre, how often a report is expected and by when.
4. **The source total includes money no channel column explains.** The sample report's department totals exceed their channel figures by 106,500 in total. Revenue reports can describe reported revenue only; they must not claim patient-level or bank-deposit verification (the proposal states this too). Decide how such variances are resolved at source before report 15 can be trusted.
5. **Exports are a data-leak path.** Every export needs its own permission, a record in the audit trail (user, report, filters, row count), spreadsheet-formula neutralisation (already done for the template), and the same centre scope as the screen.

## 6. Recommended build order

One shared **report engine** first: a typed registry where each report declares its filters, query, columns, drill-down link and permission; one filter bar; one table with paging and sorting; CSV and Excel export with auditing; PDF later. Each new report then costs a query and a column list, not a new screen.

| Slice | Contents | Depends on | Size |
|---|---|---|---|
| A | **Built (2026-10-27).** Report engine, filters, CSV/XLSX export with audit, permission `reports.export`; reports 25, 6, 24, 27, 28, 29, 13, 17 (with 18 as its detail) and 2 | nothing | Large |
| B | **Mostly built (2026-10-27).** Linked filters, drill-down, true collection rate, rename, late-centre flag. Still open: granularity switch and composition charts | A, decision 2 | Medium |
| C | Adjustments, disputes, opening balances (credit/debit with approval and reasons) | nothing | Large |
| D | Statements and invoices; reports 3, 31, 32 | C | Large |
| E | Work queue and alerts: per-user queue, overdue and unallocated alerts, scheduled reports; completeness and obligations | A, decision 3 | Medium |
| F | Import templates and mapping, exception register | nothing | Medium |
| G | Historical migration with reconciliation; reports 35, 36 | C, F | Large |
| H | Rule-based insights with stored evidence | A, B | Medium |
| I | Scenario and forecasting, anomaly scoring | H and months of data | Later |

Slices A and C are independent and could run in parallel; each is its own session-sized piece of work. Sizes are relative, not time estimates.

## 7. What was not verified

This review compares documents and code; it did not interview users, so priorities (for example which 10 reports your accountant needs first) are recommendations. Report availability marked "now" assumes the existing posted data is complete; the dev database holds demo data only.
