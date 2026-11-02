# Reporting & Analytics Specification

## 1. Reporting principles

- Every metric has a written definition, date basis, status inclusion and source tables/domain services.
- Distinguish period flow metrics from as-at balance metrics.
- Do not add reported row totals on top of channel values.
- Do not equate payment received with payment allocated.
- Reports and dashboard use the same rules and must reconcile to the authoritative posted ledger.
- Centre and role restrictions apply to every view and export.
- Charts should have exact-value tooltips and a table/detail path.

## 2. Standard global filters

- Centre or all permitted centres.
- Reporting/earning period start and end.
- As-at date for balance/ageing views.
- Centre status.
- Import/report status.
- Receivable status (not yet due, overdue, partially paid, settled, disputed).
- Department and payment channel.
- Currency where multi-currency is enabled.
- Date basis selector only where applicable and clearly labelled.

## 3. Core KPIs and definitions

| Metric | Proposed definition | Date basis / notes |
|---|---|---|
| Reported revenue | Sum of validated/posted report revenue facts in selected reporting period, using the approved total source policy. | Reporting period; draft/unvalidated batches excluded by default. |
| Eligible revenue | Sum of revenue facts selected by applied commercial rules. | Same reporting basis and rule-version logic as charge calculation. |
| Expected service charge | Sum of calculated charges for selected reporting/earning period; specify whether Draft preview or posted only. Default dashboard should use posted/approved values and label previews separately. | Charge/earning period, not payment receipt date. |
| Charges posted | Sum of debit receivable entries originating from posted service charges in the selected posting period. | Posting-date basis. |
| Payments received | Sum of Posted receipt cash amounts (Draft, Submitted, Approved-not-posted and Rejected receipts excluded) for receipts in selected date range, with reversed/returned treatment defined. | Receipt-date basis. Do not require allocation. |
| Payments allocated | Sum of valid allocations posted in selected allocation date range. | Allocation-date basis. |
| Unallocated receipt balance | Sum of available recorded receipt amounts not yet allocated, net of relevant returns/reversals under the approved model. | As-at date. Show separately from open receivables. |
| Outstanding receivables | Sum of open receivable debit/credit positions as at selected date. | As-at date and ledger status; do not compare directly to same-period receipts without label. |
| Not-yet-due receivables | Open receivable amount with due date on or after the as-at date. Items with no due date are shown in a separate "No due date" bucket (D-014). | As-at date; no-due-date records may need a separate bucket rather than assuming not due. |
| Overdue receivables | Open receivable amount with due date earlier than the as-at date (due on the as-at date is not overdue; D-014). | As-at date; exact boundary, buckets and no-due-date treatment are decision D-014 in `07_BUSINESS_RULES_AND_DECISIONS.md`. |
| Collection against due obligations | Amount allocated against obligations whose due dates fall in a specified cohort, divided by total amount due for that cohort; use a clear numerator/denominator approach. | Requires cohort definition; not identical to cash received during that period. |
| Import pass rate | Valid rows / attempted rows under a defined batch selection. | Do not interpret duplicates/skipped rows as silently accepted. |
| Import exception value | Sum of report variances or charge impacts for unresolved exceptions, with each amount type distinguished. | Do not aggregate different currencies or unrelated value types. |

## 4. Dashboard layout recommendation

### Top summary row
- Reported Revenue (selected period)
- Expected Service Charge (selected period)
- Payments Received (selected period)
- Outstanding Receivables (as at date)
- Overdue Receivables (as at date)
- Unallocated Receipts (as at date)

Because period and as-at metrics differ, labels must visibly state the applicable date basis. A filter change should update every relevant widget and be shown in the page subtitle.

### Operational insights
- Centres with largest overdue balances.
- Centres with missing/late revenue reports, if report schedule is configured.
- Import batches awaiting resolution.
- Revenue reports with amount/total mismatch.
- Charge runs awaiting approval.
- Unallocated receipts requiring allocation.
- Receivables approaching due date and overdue follow-up queue.

### Performance trends
- Reported revenue by day/week/month.
- Expected service charges by earning period.
- Payments received by receipt date.
- Payments allocated by allocation date.
- Outstanding balance over time.
- Department contribution and comparison by centre.
- Charge rate / effective rule mix, where the business wants to inspect it.

## 5. Required reports

### RPT-001 — Centre reconciliation statement
Opening balance + charges and debit adjustments − payment allocations and credit adjustments = closing balance for selected centre/date range.

### RPT-002 — Revenue by centre
Reported and eligible revenue, by centre and period, with department breakdown.

### RPT-003 — Service-charge calculation detail
For each charge entry: source report, department/channel, base, exclusions, selected rule/rate, formula, rounding method, expected charge and posting reference.

### RPT-004 — Receivables ageing
As-at date, centre, obligation, due date, remaining balance, days past due and ageing bucket. Confirmed buckets (D-014): Not Yet Due, 1–30 days, 31–60, 61–90, 91–120, >120, plus a separate "No due date" bucket.

### RPT-005 — Payment receipt register
Payments by date, centre, reference, amount, method, evidence state, allocated amount, unallocated balance and reversal/return status.

### RPT-006 — Payment allocation register
Payment, target receivable/period, allocation date, amount, actor, remaining balance and reversal linkage.

### RPT-007 — Centre/department comparison
Revenue and expected charges by department across centres with normalized category mapping and unmapped values visible.

### RPT-008 — Import batch/control report
Source filename/hash, centre, period, row counts, source totals, parsed totals, variances, rejected/duplicate rows, approvals and commit outcome.

### RPT-009 — Reconciliation exception register
Unresolved row-total mismatches, unmapped departments/channels, missing rates, duplicate candidates, unmatched payments, balance differences, disputes and owner/status.

### RPT-010 — Rule change impact report
Centre, agreement/rule version, effective date, author/approver, affected future periods and recalculation impact preview. Historical posted entries should not be silently recomputed.

### RPT-011 — Historical migration sign-off
Source dataset, cutoff, totals, accepted/rejected/duplicate rows, opening balances, imported ledger closing balance, legacy closing balance, variance and approval.

### RPT-012 — Audit activity report
Actor, action, target, centre, time, reason, correlation ID and relevant state changes, subject to audit access controls.

### RPT-013 — Effective access and access review
User, active roles, centre scope, effective permission summary, privileged accounts, conflicting role combinations, unused roles and last review date. Restricted to `access_reviews.view`.

### RPT-014 — Dispute and follow-up register
Receivable item, centre, dispute reason, status, owner, outcome, follow-up notes and next action date.

## 6. Export requirements

- CSV/XLSX for analysis; PDF for signed/readable statements and management packs.
- Include generated timestamp, filters, date basis, currency, centre scope and data status.
- Use consistent numeric/negative-value formats and no hidden rows that change totals.
- Neutralize formula-triggering input values when exporting to spreadsheet formats.
- Large exports are asynchronous and expire after a configured retention period.
- Exports are permission checked and logged as configured.

## 7. AI and forecasting (later phase)

If AI is added, limit it initially to narrative summaries, anomaly candidates and forecast suggestions. Every generated insight must identify the data period and metric definition, state its uncertainty, link to supporting rows and be labeled as a suggestion. AI must not adjust rates, approve charges, allocate payments or post ledger entries.
