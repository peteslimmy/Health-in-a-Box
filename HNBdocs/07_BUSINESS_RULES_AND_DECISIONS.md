# Business Rules, Assumptions, Decisions and Gaps Register

**Purpose:** Maintain a single source of truth for known business rules and prevent the implementation team from guessing.  
**Status values:** Confirmed / Proposed baseline / Open decision / Deferred.  
**Update:** On the business owner's instruction, all defaults in `20_DECISION_SHEET.md` were accepted. They are recorded in §2b as **Confirmed (accepted default)**. Items marked ⚠ must still be verified against each centre's actual agreement before live posting; if a contract differs, a versioned rule change overrides the default for that centre only.

## 1. Confirmed by the business owner

| ID | Rule / fact | Status | Implementation implication |
|---|---|---|---|
| C-001 | Multiple centres are managed by the operator. | Confirmed | All principal financial records are centre-scoped. |
| C-002 | Source reports may have different layouts by centre. | Confirmed | Centre-specific templates and reusable mapping versions are required. |
| C-003 | Revenue reports can be supplied as Excel, CSV and PDF. | Confirmed | Excel/CSV first-class; digital PDF support; scanned OCR ability to be evaluated. |
| C-004 | Reports include services/departments, payment-channel amounts and amounts collected. | Confirmed | Normalize department × channel figures and validate reported totals. |
| C-005 | Service-charge arrangements can be mixed/different. | Confirmed | Calculation engine is configurable; don't hard-code one universal rate. |
| C-006 | Amounts the accountant records as actual payment are service-charge funds paid to the operator by a centre. | Confirmed | Receipt entity is separate from source report payment-channel data. |
| C-007 | The “cost items” in the screenshot are actually revenue departments/services. | Confirmed | Use department/service terminology; do not deduct these as expenses. |
| C-008 | Payment cadence varies and can be irregular. | Confirmed | Terms and due-date rules are centre-specific; receipts can cover multiple periods. |
| C-009 | The initial application is used by the operator's internal team only. | Confirmed | No centre-facing portal in MVP; internal RBAC and centre scoping still required. |
| C-010 | Historical records must support bulk upload. | Confirmed | Historical migration module is MVP scope. |
| C-011 | Bulk departments and payment channels must be possible during new-centre creation. | Confirmed | Centre onboarding includes bulk setup, catalogue reuse and alias mapping. |

## 2. Proposed baseline rules

These are recommended defaults to implement as configurable capabilities, but they should be approved before use for live financial postings.

| ID | Proposal | Rationale | Approval needed |
|---|---|---|---|
| P-001 | Centre default rate with optional department and payment-channel overrides. | Covers mixed agreements while keeping setup maintainable. | Confirm whether all contracts use this hierarchy. |
| P-002 | Rule precedence: exact centre+department+channel > centre+department > centre+channel (if allowed) > centre default, with conflict checks. | Deterministic selection avoids ambiguity. | Confirm whether channel overrides can operate without department specificity and which wins if both exist. |
| P-003 | Commercial rules are effective-dated and versioned. | Rate changes should not silently affect old periods. | Confirm the contract-effective date used for revenue generated across a rate-change boundary. |
| P-004 | Reports are staged and validated before posting. | Prevents bad imports from creating receivables. | Confirm which user/roles may post without a second approver. |
| P-005 | Financial ledger entries are append-only after posting; corrections use compensating entries. | Preserves history and auditability. | Approve correction/approval policy and whether any narrow exception exists. |
| P-006 | Default import deduplication uses file hash plus centre/period/reference and content fingerprints. | Duplicate daily reports may be re-sent under different filenames. | Confirm whether a centre can legitimately submit multiple reports for one date/shift. |
| P-007 | Default amounts use NGN and two decimal places. | Context indicates Nigerian Naira; practical display convention. | Confirm if multi-currency will be required. |
| P-008 | Reports distinguish received cash from amounts allocated to receivables. | A receipt can be unapplied or cover future obligations. | Confirm whether unallocated advances should be carried forward and how formally accounted for. |
| P-009 | Bulk configuration imports default to all-or-nothing commit per batch. | Avoids confusing partial setup. | Confirm if partial success is preferred for departments/channels. |
| P-010 | Digital PDF is supported in MVP; scanned PDFs may require manual review or a separately approved OCR feature. | OCR accuracy is uncertain and affects financial risk. | Confirm expected proportion/quality of scanned reports. |
| P-011 | Statement generation is in MVP; invoice generation is conditional. | A statement and an invoice serve different purposes. | Confirm contract and accounting requirement. |
| P-012 | Opening-balance migration is allowed only with a cutoff and source evidence. | Prevents missing or double-counting prior obligations. | Finance owner to sign off migration strategy. |

### Baseline decisions added in documentation review (to be confirmed by business owner)

| ID | Proposal | Rationale | Approval needed |
|---|---|---|---|
| P-013 | **Two-step posting:** committing a revenue-report batch posts the revenue report only; a charge run is then calculated, approved and posted separately to create ledger debits. | Keeps report validation and financial recognition separately controlled; matches separate permissions `revenue_reports.post` and `charge_runs.post`. | Confirm that revenue and charge posting need separate approvals (or documented single combined approval). |
| P-014 | **Segregation of duties is P0:** maker-checker is enforced as backend policy for charge runs, receipts, adjustments, opening balances, migrations and privileged access changes. Only monetary thresholds are P1. | Matches `19_RBAC_ROLE_PERMISSION_MODEL.md` §9. | Confirm any small-team compensating controls (RBAC-OD-02). |
| P-015 | **Receipt lifecycle:** Draft → Submitted → (Approved) → Posted; only Posted receipts count as received cash and can be allocated. | Independent verification of cash records. | Confirm whether any low-value receipts may be self-posted (RBAC-OD-02). |
| P-016 | **Receivable item** = a posted DEBIT ledger entry (charge, opening balance, debit adjustment); allocations and credit adjustments reference a specific item. | Enables per-obligation balance and ageing. | Finance owner to confirm obligation granularity (per charge run, per period, per department). |

## 2b. Confirmed decisions (accepted defaults from `20_DECISION_SHEET.md`)

| ID | Confirmed decision | Contract check |
|---|---|---|
| D-001 | Eligible revenue = reported revenue per department × channel line, net of voids and refunds, excluding only departments/channels explicitly exempt in the active charge rule. | ⚠ |
| D-002 / P-002 | Most specific rule wins: department+channel > department > channel > centre default; same-specificity overlaps are blocked; a channel-only rule applies only where no department rule covers the line. | |
| D-003 | Charges are calculated per report line × channel amount, then summed into the charge run. | ⚠ |
| D-004 | Decimal arithmetic, round half-up to 2 dp once per charge line; run total = sum of rounded lines (`rounding_method = LINE`). | ⚠ |
| D-005 | Earned in the revenue period; posted as a receivable when the charge run is approved and posted; due date is separate. | |
| D-006 | Due date = charge-run posting date + N days, N per centre (default 30), versioned; no due date → separate bucket and exception. | ⚠ |
| D-007 | Excess/unallocated receipts stay unallocated; no negative receivable; advance credit only by explicit finance approval. | |
| D-008 | Historical charge: recalculate from archived agreement, else import trusted historical-source charge, else hold; never today's rate. | |
| D-009 / P-006 | Multiple reports per date allowed; uniqueness = centre + report type + period + external reference + content fingerprint; exact file hash blocked; near duplicates warn. | |
| D-010 | Opening balance at the last fully reconciled month-end for older history; full transaction import only after the cutoff; pilot one centre first; never both for the same obligations. | |
| D-011 | Source totals are gross unless the template states otherwise; refunds/voids used only as explicit signed lines under the template's negative-value policy. | ⚠ |
| D-012 | Receivable created from the approved, posted charge run; statements in MVP; invoices optional later. | |
| D-013 | Digital PDF accepted only if text is selectable, all rows extract and totals reconcile; otherwise manual capture. No OCR in MVP. | |
| D-014 | Overdue only when as-at date is after the due date; buckets Not Yet Due, 1–30, 31–60, 61–90, 91–120, >120, plus "No due date". | |
| D-015 | Access token ≤ 15 min; permission cache ≤ 60 s; deactivation/role revocation effective within 5 minutes. | |
| D-016 | Africa/Lagos, calendar-day cutoff. | |
| P-013 to P-016 | Two-step posting; segregation of duties is P0; receipt lifecycle Draft → Submitted → Approved → Posted; receivable item = one DEBIT entry per charge run × centre × earning period (plus opening balances and debit adjustments). | |
| P-007 / D-104 | NGN only, 2 dp; multi-currency deferred. | |
| P-009 | Bulk configuration commits all-or-nothing per batch. | |
| P-010 | Digital PDF in MVP; scanned PDFs manual (see D-013). | |
| P-011 | Statements in MVP; invoices conditional/later. | |
| D-101, D-102, D-103, D-105 | Bank import, email delivery and OCR are not MVP (Phase 6); no third-party tenants, `organization_id` retained. | |
| D-106 | Retain financial records, ledger, audit and source files ≥ 7 years after the period; staging rows 90 days after commit; exports 30 days. | ⚠ confirm with accountant/legal |
| D-107 | In-app reminders: 7 days before due, then 1, 14 and 30 days after (30-day escalates to Finance Manager). | |
| RBAC-OD-01 to 06 | Roles combinable with conflict rules (Auditor + write blocked); no self-posting of receipts; Auditor exports/downloads granted separately; roles managed by Access Administrator/Super Admin within ceilings with second approver for Super Admin changes; action-based segregation only (thresholds later); quarterly access review. | |

### Implementation decisions (recorded on the owner's instruction to close out open points)

| ID | Decision | Rationale |
|---|---|---|
| I-001 | The built 32-permission, 4-role set is the Phase 1 RBAC baseline; the fuller doc 19 catalogue is added with the features it protects. | Avoids permissions that guard nothing; keys stay `resource.action` so they can be split later. |
| I-002 | Commit and post operations are idempotent by state (a repeat returns the original result). Client-supplied `Idempotency-Key` is introduced with the payment and allocation endpoints. | State-based idempotency already prevents duplicate postings for the built endpoints. |
| I-003 | In-house authentication is accepted for the MVP and internal pilot. Managed OIDC and MFA for privileged roles are a pre-production gate. | Keeps delivery moving; risk is controlled by the gate. |
| I-004 | Only an `ACTIVE` centre can receive an import or have a charge run created or posted. | FR-CEN-009. |

**Implementation status of these decisions** is tracked in `21_IMPLEMENTATION_STATUS.md` §5–§6. Enforced in code today: D-002 (precedence), D-004 (half-up per charge line), D-006 and D-016 (due date = posting date + centre days, counted on the centre's Africa/Lagos business day), D-009 (content fingerprint, several reports per date allowed), P-013 (two-step posting) and P-014 (maker-checker on import commit and charge-run approve/post). Also enforced now: D-007 (excess cash stays an unallocated receipt; no negative receivable), D-014 (overdue only after the due date; confirmed ageing buckets; receivables list and ageing summary), P-015 (receipt lifecycle with maker-checker) and P-016 (one receivable per posted charge run; earlier per-line receivables remain as legacy). Not yet implemented: D-008, D-010, D-013 (no PDF or historical migration), D-015 beyond immediate permission re-check, D-106, D-107.

Still required from the business (not defaultable): per-centre agreements/rates with effective dates and worked examples, sample reports per layout, payment-term wording, fixed/tiered/exempt arrangements, and a reconciled pilot-centre balance workbook (see `20_DECISION_SHEET.md` §F).

## 3. P0 decisions (resolved by accepted defaults in §2b; ⚠ items need contract verification before live posting)

| ID | Question | Why it matters | Required decision / evidence | Owner |
|---|---|---|---|---|
| D-001 | What exact revenue is eligible for a service charge for each agreement? | Determines charge base. | Agreement clauses and a worked example by centre. | Business + Finance |
| D-002 | What rule precedence applies when centre, department and payment-channel rules overlap? | Prevents double rates or conflicting configuration. | Approved precedence matrix. | Business owner |
| D-003 | Is a service charge calculated per department, per channel, on a period total, or by a mixture? | Affects rounding and traceability. | One worked example for each real arrangement type. | Finance |
| D-004 | What rounding method applies: per row/channel, per department, or on the final aggregate? | Small rounding differences can accumulate. | Contract/accounting policy. | Finance |
| D-005 | What event establishes that the charge is earned/recognizable and when does it become a posted receivable? | “Earned”, “posted”, “billed” and “due” may differ. | Agreed operational/accounting policy. | Finance |
| D-006 | How is due date determined for irregular payments? | Needed for overdue/ageing and reminders. | Terms per centre: immediate, N days after statement, fixed date, other. | Business + Finance |
| D-007 | Can centres pay in advance, and how should advances/unallocated cash be represented? | May require a customer credit/advance ledger. | Approved policy for unallocated payments, excess receipts and future charges. | Finance |
| D-008 | What are the permitted sources for historical charge amounts when old rates are unavailable? | Prevents invented historical values. | Recalculate from archived agreement, import trusted historical charge, or hold as unresolved. | Finance |
| D-009 | Can one centre submit multiple separate reports per date? What uniquely identifies a report? | Duplicate prevention cannot assume one report/day. | Source ID, shift, department grouping or report-type key. | Operations |
| D-010 | What is the approved opening-balance cutover date and migration approach for each centre? | Prevents history/balance overlap. | Reconciled migration workbook and sign-off. | Finance |
| D-011 | Are source report totals exclusive of voids/refunds/discounts, or do they include separate adjustments? | Affects eligible revenue and net/gross definitions. | Definitions of gross, net, refunds and voids in source reports. | Business + Finance |
| D-012 | Are charges invoiced and billed before they become due, or is receivable created from the calculation itself? | Determines workflow and document generation. | Agreement and accounting process. | Finance |
| D-013 | What qualifies as an acceptable digital (text) PDF for MVP extraction? | Defines when PDF import is allowed vs routed to manual capture. | Criteria such as selectable text, consistent table structure, tested sample set and row-level validation pass. | Operations + Finance |
| D-014 | What is the overdue boundary (due on the due date vs after), the ageing buckets, and the treatment of items with no due date? | Needed for overdue, ageing, dashboards and reminders. | Approved boundary convention, bucket list (proposed: Not Yet Due, 1–30, 31–60, 61–90, 91–120, >120) and a separate "No due date" bucket policy. | Finance |
| D-015 | What is the session and permission-revocation policy (maximum time before a deactivated user or revoked role loses access)? | "Promptly" is untestable; depends on identity-provider token lifetime. | Numeric limit (e.g. access-token lifetime and forced re-check interval) and who may force revocation. | Business + Security |
| D-016 | What business timezone and day cutoff apply to financial dates? | Reporting cutoffs, due dates and effective-date boundaries. | Confirmed timezone (proposed Africa/Lagos) and end-of-day convention. | Finance |

## 4. P1 / later decisions

| ID | Question | Stage |
|---|---|---|
| D-101 | Do users need bank statement import or bank API integration? | P1 |
| D-102 | Should invoice/statement delivery by email be supported? | P1 |
| D-103 | Are scanned PDFs common enough to justify OCR in first release? | P1 |
| D-104 | Is multi-currency required? | P1 unless confirmed now |
| D-105 | Will independent third-party organizations use the platform in future? | Architecture evolution |
| D-106 | Are there retention, data residency or sector-specific obligations to formalize? | Before production policy sign-off |
| D-107 | What are the exact notification channels and escalation schedule? | P1 |

## 5. Data and financial invariants

1. A report total is a control total, not an additional amount to sum with its channel columns.
2. Revenue report amounts represent source-reported centre revenue, not service-charge payments received by the operator.
3. Actual payment records represent money received by the operator from the centre.
4. Allocated payments reduce only the obligations they are explicitly allocated to.
5. An unallocated receipt is not silently used to reduce every receivable for the centre.
6. Missing rate configuration is not equivalent to a zero rate or an exemption.
7. Exemption must be explicit and traceable.
8. Current rules must not silently reprice posted historical charges.
9. A posted financial event is corrected via controlled compensating events, never silently deleted or rewritten.
10. Full-history migration and opening balance must not include the same obligation twice.
11. Every dashboard metric must use an explicit as-at date/period and financial status definition.
12. All monetary computations use decimal arithmetic and the agreed currency/rounding policy.

## 5a. Evidence note

The supplied report screenshot referenced in C-007 and in `12_DATA_IMPORT_AND_HISTORICAL_MIGRATION.md` §4.2 is not part of this documentation pack. Store it (and one sample file per distinct centre layout) alongside the pack under an `evidence/` folder so confirmed rules remain traceable to their source.

## 6. Decision governance

- Each open decision must have an owner, decision date, chosen option, rationale and affected requirements.
- Changes to an approved business rule require versioning and an impact assessment.
- No implementation agent may make a production financial-rule decision merely to unblock coding. Use a configurable rule or clearly marked temporary mock in development, and block production posting when the rule is unresolved.
- Before go-live, the business owner and finance owner sign off the P0 decisions and representative worked examples.
