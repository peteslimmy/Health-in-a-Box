# Decision Sheet — Proposed Defaults for Confirmation

**Status:** **Accepted in full by the business owner (all defaults, no overrides)** and recorded as confirmed in `07_BUSINESS_RULES_AND_DECISIONS.md` §2b. Items marked ⚠ still require verification against each centre's actual agreement before live posting; the finance-owner signature below is still outstanding.

Original instruction for this sheet: each row was to be accepted or overridden. Items marked ⚠ depend on the real contracts and must be checked against them before live posting.

On approval, the chosen answer is copied into `07_BUSINESS_RULES_AND_DECISIONS.md` (status → Confirmed) and the affected specs are updated.

Legend: ☐ Accept ☐ Override → (write answer)

---

## A. Charge calculation (P0, ⚠ contract-dependent)

| ID | Question | Proposed default | Rationale |
|---|---|---|---|
| D-001 ⚠ | Which revenue is eligible for the service charge? | Eligible revenue = reported revenue per department × channel line, **net of voids and refunds**, excluding departments/channels explicitly marked exempt in the active charge rule. Nothing is exempt unless a rule says so. | Net basis avoids charging on cancelled sales; explicit exemptions keep the exempt/missing distinction. |
| D-002 / P-002 | Rule precedence | Most specific rule wins: department+channel > department > channel > centre default. Two active rules at the same specificity and overlapping dates are blocked. A channel-only rule applies only where no department rule covers the line. | Deterministic, auditable, no double rates. |
| D-003 ⚠ | Calculated per department, channel, or period total? | Calculate per **report line × channel amount** (the smallest traceable unit), then sum into the charge run. | Maximum traceability; rate overrides at any level work naturally. |
| D-004 ⚠ | Rounding | Decimal arithmetic, **round half-up to 2 dp once per charge line**; run total = sum of rounded lines; never round the aggregate. Stored as `rounding_method = LINE`. | Totals always equal the sum of what the user can see; no hidden residuals. |
| D-005 | When is a charge earned vs posted? | **Earned** in the period of the revenue date. **Posted** (becomes a receivable) when the charge run is approved and posted. **Due** is a separate date (D-006). | Matches the two-step posting and keeps the three dates distinct. |
| D-006 ⚠ | Due date for irregular payers | Due date = charge-run posting date + **N days**, N configurable per centre (default 30), versioned. Items with no due date go to a separate "No due date" bucket and raise an exception. | Overdue is never inferred from age alone. |
| D-011 ⚠ | Are report totals gross or net of voids/refunds? | Treat source totals as **gross** unless the centre template states otherwise. Refunds/voids are used only when shown as explicit signed lines under the template's negative-value policy. | Avoids guessing; template makes it explicit. |
| D-012 | Invoice first or receivable from calculation? | Receivable is created from the **approved, posted charge run**. A **statement** is generated for the centre. Invoices are optional and later (Phase 6). | Matches P-011 and the MVP scope. |

## B. Receipts, allocation, history

| ID | Question | Proposed default | Rationale |
|---|---|---|---|
| D-007 | Advances / excess receipts | Excess stays as an **unallocated receipt**. No negative receivable. A formal customer-credit (advance) balance is created only by explicit finance approval. | Safest, already the documented stance. |
| D-008 | Historical charge when old rate unknown | Priority: (1) recalculate from archived agreement; (2) import a trusted, independently verified historical charge flagged "historical-source"; (3) hold/quarantine. Never today's rate. | Matches existing rule. |
| D-009 / P-006 | Multiple reports per date? | **Allowed.** Uniqueness = centre + report type + period + external reference (if any) + content fingerprint. Exact file hash is blocked; near duplicates warn for human decision. | Date alone is never a key. |
| D-010 | Migration mode and cutoff | **Opening balance at the last fully reconciled month-end** for older history; **full transaction import** only for periods after the cutoff. Pilot on one centre first. Never both for the same obligations. | Lowest risk, best reconcilability. |
| P-016 | What is one receivable item? | One DEBIT ledger entry per **charge run × centre × earning period** (plus opening balances and debit adjustments). | Gives clear per-obligation balance and ageing. |

## C. Process and policy

| ID | Question | Proposed default |
|---|---|---|
| P-013 | Posting steps | Two-step: batch commit posts the revenue report; charge run posts the ledger debit. |
| P-014 | Segregation of duties | P0, enforced in backend for charge runs, receipts, allocations (reversal/reallocation), adjustments, opening balances, migrations, privileged access changes. |
| P-015 | Receipt lifecycle | Draft → Submitted → Approved → Posted; only Posted receipts count and can be allocated; no self-approval. |
| P-007 / D-104 | Currency | NGN only, 2 dp. Multi-currency deferred; `currency` stays on all records. |
| P-009 | Bulk configuration | All-or-nothing per batch. |
| P-010 / D-013 | Acceptable digital PDF | Accepted only if text is selectable, all rows extract, and row and grand totals reconcile under the same validation. Otherwise manual capture. **No OCR in MVP.** |
| D-014 | Overdue and ageing | Overdue when as-at date is **after** the due date (due on the due date = not overdue). Buckets: Not Yet Due, 1–30, 31–60, 61–90, 91–120, >120, plus "No due date". |
| D-015 | Revocation time | Access token ≤ 15 minutes; permissions re-checked server-side on every request with cache ≤ 60 seconds; deactivation/role revocation effective within **5 minutes**. |
| D-016 | Timezone | Africa/Lagos, calendar-day cutoff (00:00–23:59). |

## D. Later / policy (P1)

| ID | Question | Proposed default |
|---|---|---|
| D-101 | Bank import | Not MVP; Phase 6 CSV/MT940 import with match suggestions only. |
| D-102 | Email delivery of statements | Not MVP; Phase 6, with send log. |
| D-103 | OCR | Not MVP; evaluate after reviewing real sample quality. |
| D-105 | Third-party tenants | Not planned; keep `organization_id`. |
| D-106 ⚠ | Retention | Financial records, ledger, audit and source files: **7 years minimum** after the period (confirm with accountant/legal). Staging rows: 90 days after commit. Exports: 30 days. |
| D-107 | Reminders | In-app first: 7 days before due, 1 day after, 14 days, 30 days (escalate to Finance Manager). |

## E. Access control (RBAC-OD)

| ID | Question | Proposed default |
|---|---|---|
| RBAC-OD-01 | Combine roles? | Yes, with role-conflict rules; Auditor + any write role is blocked unless an exception is recorded. |
| RBAC-OD-02 | Self-post own receipts? | No. Recorder submits; a different user approves and posts. No low-value exception at launch. |
| RBAC-OD-03 | Auditor exports / source downloads? | No by default; granted separately after documented need. |
| RBAC-OD-04 | Who manages roles? | Access Administrator and Super Admin within a ceiling; changes to Super Admin need a second approver; break-glass path documented and alerted. |
| RBAC-OD-05 | Monetary thresholds? | Not at launch; action-based segregation only; add thresholds later by policy. |
| RBAC-OD-06 | Access review cadence | Quarterly for privileged and financial roles. |

---

## F. What I still need from you (cannot be defaulted safely)

1. For each centre: **agreement clause or rate sheet**, effective date(s), and **one worked example with real numbers** (revenue → charge).
2. One **sample report per distinct layout** (Excel/CSV/PDF), and the screenshot.
3. Whether any centre's charge is a **fixed amount**, a **tiered rate**, or has **exemptions**.
4. Each centre's **payment-term wording** (days after what event?).
5. A pilot centre's **legacy balance workbook** with a reconciled closing balance.

Sign-off: Business owner ______________ Date ________ Finance owner ______________ Date ________

---

## G. Decisions from the reporting review (2026-10-27)

The business owner answered the open points in `24_MODULE_REPORT_AND_INSIGHT_GAP_ANALYSIS.md` section 5: **both daily and period uploads occur**; **weekly or daily reporting is acceptable and a centre with no report in a week is late**; and the remaining points (collection definition, unexplained variances, demo data) were delegated to best practice. Recorded as confirmed.

| ID | Question | Decision | Rationale |
|---|---|---|---|
| D-201 | Are reports daily or for a period? | **Both are accepted.** A report may cover one day or any period. Reports are stored for the period they state and never split or spread by day. A cumulative period file can follow earlier reports that sit wholly inside it (only the new days are taken); a daily file cannot be loaded into days a period report already covers. Upload daily files first, then the cumulative one. | Matches how centres actually send data; avoids inventing daily detail a period total cannot give. |
| D-202 | Which date do trends use for a multi-day report? | The month of the report's **period end**. Daily and weekly views show only days covered by single-day reports; multi-day reports appear as period bars labelled with their range. | Honest about what the data can show. |
| D-203 | How often must a centre report, and when is it late? | **Daily or weekly** (set per centre). A centre is **late** when no committed report or pending upload for it ends within the last **7 days** (Africa/Lagos). Omitted days between reports are flagged separately (already built) and need a reason to commit. | Owner's rule; simple and testable. |
| D-204 | True collection rate | **Collection rate** = amount of receivables that fell due in the period and was **settled within 30 days after its due date** ÷ amount that fell due in the period. Shown only for periods whose 30-day window has closed; recent periods show "to date" (settled so far ÷ fell due) clearly labelled. The 30 days is a configurable organisation setting. Cash received in a month divided by charges in the same month is renamed "Cash received vs charges posted" and is not called a collection rate. | Measures performance against a defined population, as the review required. |
| D-205 | A report's printed totals do not agree with its channel figures (for example department totals exceeding the channels by 106,500) | **Hold the upload; never adjust.** Ask the centre for a corrected report or the missing channel. If the centre confirms in writing that the difference is a real receipt through a channel the report does not itemise, add that channel to the centre and have the centre re-issue the report with it. A future exception path may accept a stated variance only with a reason, a second approver, an audit event, and exclusion of the variance from the service-charge base until resolved. | Keeps the ledger traceable; money without a channel cannot be charged under channel rules. |
| D-206 | Demo data versus real data | Real reports go to **their own centre** (the sample report belongs to University of Abuja Teaching Hospital, Gwagwalada, not the demo "Abuja Central Centre"). Committed financial records are never deleted, so demo records are not removed from a live database: production runs without the demo seed, and a development database may be reset and re-seeded as a whole. | Immutability of posted records; prevents demo figures mixing into real reports. |
