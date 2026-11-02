# Product Overview

## 1. Product name

Product name: **HNB-Receivables Management Platform** (descriptive subtitle: centre revenue and service-charge reconciliation). This name is used consistently across the documentation pack; the repository folder name `HNB_ReconcilQ` is only a working directory name.

## 2. Product vision

Provide one reliable internal platform where the operator can understand, calculate, collect, and explain the service-charge amounts owed by every managed centre. Every dashboard figure should be traceable to a source report, an applicable commercial rule, a posted receivable, and any payment or adjustment that changed its balance.

## 3. Problem statement

Revenue reports arrive in different formats and may use different department labels, payment-channel names, layouts and totals. The operator needs to calculate service charges under different centre-level arrangements and compare those expected charges with the actual payments received from each centre. Variable payment cycles, partial remittances, historical data, revised reports and rate changes create a risk of spreadsheets drifting out of sync, duplicate counts, incorrect historical calculations and unexplained balances.

## 4. Product outcome

The application should make it possible to answer, for any centre and reporting period:

- What revenue was reported?
- Which departments and payment channels contributed to that revenue?
- Which report/source supports each number, and did its totals validate?
- What service charge was calculated, using which rate/rule and revenue basis?
- What amount was posted as a receivable, and when is it due?
- What service-charge payments did the operator actually receive?
- Which obligations did those payments settle?
- What remains outstanding, not yet due, overdue, disputed, unallocated, credited, or overpaid?
- What changed, who changed it, and who approved it?

## 5. Users and operating model

The first release is for the operator's internal staff only. Centres are managed as separate financial entities under one operating organisation. User access is internal and role-based, with optional restrictions to assigned centres. No direct login for hospital/centre representatives is in MVP scope.

The data model should avoid hard-coding centre-specific calculations into code. The architecture should permit a future organisation-level tenant boundary, but public multi-organisation SaaS administration is not part of the first release.

## 6. Product principles

1. **Financial correctness before convenience.** Any mismatch is visible and explained; the system must not silently fix financial data.
2. **One source of truth.** A posted receivable ledger is the basis for balances; dashboards derive from the same underlying records.
3. **Traceability by design.** Source file, row, mapping, calculation rule, user and approval history are linked wherever applicable.
4. **Configuration over centre-specific code.** Departments, channels, aliases, reporting templates, rates and payment terms are configurable.
5. **Deterministic calculations.** AI or fuzzy matching may suggest mappings but cannot autonomously post finance records.
6. **Historical integrity.** A new rate must not rewrite prior calculations; posted records are corrected through controlled adjustments or reversals.
7. **Progressive complexity.** Start with a reliable modular monolith; do not split into microservices without evidence that it is needed.
8. **Useful exceptions.** Every rejected row or unbalanced report should explain what failed and what the operator can do next.

## 7. High-level financial chain

`Raw Report → Validated Revenue Report → Service-Charge Calculation → Approved/Postable Receivable → Actual Payment Receipt → Payment Allocation → Updated Receivable Balance → Reports and Analytics`

A report upload, calculation preview, posted receivable, receipt and allocation are different domain events and must not be treated as interchangeable records.

## 8. Scope summary

### In scope for the first release

- Internal user access and role-based permissions.
- Centre onboarding and configuration.
- Bulk setup of departments and payment channels during onboarding.
- Effective-dated commercial rules and service-charge calculation.
- Centre-specific Excel/CSV imports and digital PDF extraction where feasible.
- Import validation, duplicate detection, preview, posting and import history.
- Historical bulk migration for revenue, charges where needed, receipts, allocations, adjustments and opening balances.
- Receivables ledger, payment entry, allocation, due status and receivables ageing.
- Dashboard, centre detail, analytics, filtered reports and exports.
- Approvals, audit trail, corrections and reversals.

### Not in first release unless separately approved

- Patient-level billing or receipt reconciliation.
- Direct integration with hospital information systems, payment processors or bank feeds.
- Automatic bank matching.
- Public multi-customer SaaS signup and billing.
- Centre-facing self-service portal.
- Full general ledger, accounts payable, payroll, tax computation or statutory financial statements.
- AI making financial decisions or posting entries without human review.
- OCR for low-quality scanned PDFs as a guaranteed capability.

## 9. Success indicators (initial targets for validation)

- 100% of posted charges can be traced to source/reporting facts and applicable rule versions, or clearly marked as an approved historical migration.
- No duplicate posting from retries or repeated submission of the same batch.
- All dashboard figures reconcile to underlying posted data under documented definitions.
- Import exceptions are visible and downloadable; no invalid rows are silently lost.
- Users can identify the value, status, age and supporting evidence of a centre's outstanding balance without manually combining separate spreadsheets.
- A historical migration can be rehearsed, reconciled, approved and rolled back through controlled compensating actions if an error is found.

The quantitative performance targets in the technical requirements are proposed initial service objectives and must be tested against representative files and expected scale.
