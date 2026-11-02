# Functional Requirements Document (FRD)

**Version:** Draft 0.1  
**Requirement IDs:** Stable identifiers; additions should not renumber existing requirements.  
**Priority values:** Must / Should / Could / Later.

## 1. Access, identity and permissions

| ID | Functional requirement | Priority | Acceptance / control |
|---|---|---|---|
| FR-AUTH-001 | Authenticate internal users through a supported secure identity mechanism. | Must | Unauthenticated requests cannot access protected pages or APIs. |
| FR-AUTH-002 | Assign role-based permissions to users through roles composed from the controlled permission catalogue in `19_RBAC_ROLE_PERMISSION_MODEL.md`. | Must | Backend authorizes each action; hiding a button is not authorization. No direct per-user permission grants. |
| FR-AUTH-003 | Restrict users to permitted centres where scope is configured. | Must | List, detail, export and API queries enforce centre scope. |
| FR-AUTH-004 | Support user activation, deactivation and session revocation. | Must | Deactivated users cannot begin new sessions and active sessions and permissions are revoked within 5 minutes (D-015: access token ≤ 15 min, permission cache ≤ 60 s). |
| FR-AUTH-005 | Enforce maker-checker separation for sensitive actions (charge-run approval/posting, receipt approval/posting, allocation reversal, adjustments, opening balances, historical-migration approval/commit, and privileged role/permission changes). | Must | A requester cannot approve their own action, even when holding multiple roles. Any documented compensating control for small teams is explicit, visible in audit reports and never coded as a silent bypass. |
| FR-AUTH-006 | Allow an authorized administrator to create, clone, activate, deactivate and retire custom roles and to add/remove catalogue permissions (Role Builder). | Must | Draft roles cannot be assigned; a role assigned to users or referenced by audit history is retired, not deleted; every change is audited with reason and before/after state. |
| FR-AUTH-007 | Assign roles to users with a scope (all centres or selected centres), optional start/end dates and a grantor reason. | Must | Scope is evaluated per assignment against that assignment's own role permissions; scopes of different assignments are never merged across permissions. |
| FR-AUTH-008 | Prevent privilege escalation by role administrators. | Must | An administrator cannot grant permissions beyond their delegated ceiling or assign themselves a role/permission outside it. |
| FR-AUTH-009 | Keep the Auditor role read-only and prohibit combining Auditor with write-capable roles unless a business-owner exception is recorded. | Must | Role-conflict check blocks or flags the assignment; exports and source-file downloads are separate permissions. |
| FR-AUTH-010 | Provide periodic access review (effective access per user, privileged accounts, conflicting combinations, unused roles). | Should | Review completion is recorded and audited. |

## 2. Centre onboarding and configuration

| ID | Functional requirement | Priority | Acceptance / control |
|---|---|---|---|
| FR-CEN-001 | Create, edit, view, suspend and archive a centre without deleting its financial history. | Must | Referenced/posted centre cannot be hard-deleted. |
| FR-CEN-002 | Enforce unique centre code within the operator's organisation. | Must | Duplicate code is blocked with an actionable message. |
| FR-CEN-003 | Support bulk creation of departments during centre onboarding via editable grid, paste, Excel or CSV. | Must | Preview records, show duplicates/errors, allow correction and commit valid configuration as one controlled operation. |
| FR-CEN-004 | Allow selecting/reusing departments from a catalogue and mapping centre-specific names/codes. | Must | Reuse is distinct from creating a duplicate department. |
| FR-CEN-005 | Support bulk creation/import/reuse of payment channels during onboarding. | Must | Duplicate code/name and invalid rows are shown before commit. |
| FR-CEN-006 | Maintain centre-specific department aliases and payment-channel aliases. | Must | Future report mapping can resolve recognized aliases without creating duplicate financial categories. |
| FR-CEN-007 | Configure effective-dated commercial agreements and rate rules. | Must | Overlapping/conflicting rules are detected according to the agreed rule model. |
| FR-CEN-008 | Configure reporting period/frequency and payment terms/due-date rule. | Must | Terms are versioned; historical due dates remain stable unless explicitly adjusted. Default due date = charge-run posting date + N days (N per centre, default 30; D-006). |
| FR-CEN-009 | Save a centre as Draft and activate it only after mandatory setup checks pass. | Must | Draft centres cannot receive posted financial records unless a privileged, audited exception is defined. **Built:** importing a revenue report, creating a charge run and posting a charge run are refused unless the centre is `ACTIVE` (`CENTRE_NOT_ACTIVE`); the activation readiness checks themselves (mandatory configuration complete) are not built yet. |

## 3. Report templates and imports

| ID | Functional requirement | Priority | Acceptance / control |
|---|---|---|---|
| FR-IMP-001 | Upload `.xlsx`, `.csv` and supported digital/text `.pdf` revenue reports. | Must | Unsupported, corrupt or unsafe files are rejected with a reason. |
| FR-IMP-002 | Select centre and reporting date/period before or during import. | Must | The same source cannot be ambiguously assigned to multiple centres. |
| FR-IMP-003 | Create and version centre-specific field-mapping templates. | Must | Template changes are versioned and applied explicitly to an import job. |
| FR-IMP-004 | Map source department labels and payment-channel headings to normalized records. | Must | Unknown values are held as exceptions, not silently dropped. |
| FR-IMP-005 | Show a preview of parsed and normalized records before financial posting. | Must | Preview shows source row, mapped department/channel, amount, totals and warnings. |
| FR-IMP-006 | Validate required columns, dates, numeric amounts, row totals and report grand totals. | Must | Differences are shown with row/column context and configured tolerance. **Built:** tolerance is fixed at 0.01; a larger row-total or grand-total difference is a blocking error (`ROW_TOTAL_MISMATCH`, `GRAND_TOTAL_MISMATCH`), and commit and charge-run creation re-check it. |
| FR-IMP-007 | Detect likely exact and near duplicates. | Must | Exact duplicate submissions are blocked or skipped according to batch policy; ambiguous matches require review. **Built:** identical file bytes and identical figures (content fingerprint of centre + period + normalised department × channel amounts, independent of file name) are blocked with `DUPLICATE_REPORT`, backed by a database unique index; a different report overlapping a committed period is allowed with an `OVERLAPPING_REPORT` warning. |
| FR-IMP-008 | Preserve source file, file hash, row numbers and raw-row data for traceability. | Must | User can navigate from normalized record to its source import evidence. |
| FR-IMP-009 | Support retryable asynchronous import jobs for large files. | Must | Retries are idempotent; job state and errors are visible. |
| FR-IMP-010 | Permit a corrected report to supersede or adjust an earlier report through controlled workflow. | Must | Original report, previous calculations and replacement reason remain auditable. |
| FR-IMP-011 | Committing a revenue-report import batch posts the validated **revenue report only**. Service-charge calculation and receivable posting are a separate charge-run step with its own approval (two-step posting). | Must | Committing a batch never creates ledger entries; a ledger debit exists only after a charge run is posted. Each step has its own permission (`revenue_reports.post`, `charge_runs.post`), idempotency key and audit event. **Built:** the revenue step uses `imports.commit` (the uploader cannot commit their own import); the charge step uses `charge_runs.approve` then `charge_runs.post` (the creator can do neither); repeating a commit or post returns the original result. |

## 4. Revenue and service-charge calculation

| ID | Functional requirement | Priority | Acceptance / control |
|---|---|---|---|
| FR-REV-001 | Store reported revenue by centre, reporting date/period, department, payment channel and source report line. | Must | Row totals and channel amounts are represented without double-counting the reported total. |
| FR-REV-002 | Support centre default charge rules with optional department and payment-channel overrides. | Must | Precedence is confirmed (D-002): department+channel > department > channel > centre default; same-specificity overlaps are blocked. Actual rule applied is displayed and persisted on each calculation. |
| FR-REV-003 | Support explicit exclusions/exemptions and 0% rules. | Must | Exempt differs from missing rule; missing rule cannot silently mean zero. |
| FR-REV-004 | Use effective-dated rule versions. | Must | Historical calculations refer to the rule effective for the relevant revenue date/period, subject to agreement policy. **Built:** a rule is usable for a report only if it is effective for the report's whole period (both boundaries inclusive); a rate change inside a report fails with a "split the report by period" error, and a caller-supplied "as-of" date is ignored (stored as the period end). |
| FR-REV-005 | Calculate expected service charge deterministically with decimal arithmetic. | Must | Recalculated expected values match the stored rule inputs and the confirmed rounding method (D-004): round half-up to 2 dp once per charge line (report line × channel), run total = sum of rounded lines. |
| FR-REV-006 | Provide a preview with base revenue, exclusions, rate, calculation method, calculated charge and total. | Must | Reviewer can inspect department/channel contributors and rule source. |
| FR-REV-007 | Prevent posting when required charge rule is missing, ambiguous or conflicting. | Must | Exception must be resolved or handled under an explicit approved historical migration exception. |
| FR-REV-008 | Record calculation-run version, source revenue IDs, rule IDs, rounding mode and execution metadata. | Must | Posted calculations are reproducible and inspectable. |
| FR-REV-009 | Support recalculation of Draft runs; changes to posted runs require controlled replacement/adjustment. | Must | Posted history is never silently overwritten. |

## 5. Receivables and payments

| ID | Functional requirement | Priority | Acceptance / control |
|---|---|---|---|
| FR-AR-001 | Create a receivable/ledger debit only through an approved posting or authorized opening-balance/adjustment process. | Must | Every financial entry has source, date, centre, amount, currency and posting actor. |
| FR-AR-002 | Store calculation/earning period, posting date and due date as distinct fields. | Must | Overdue is based on approved due-date rules, not only age of a report. |
| FR-AR-003 | Record actual service-charge payments received from centres through a Draft → Submitted → (Approved) → Posted lifecycle. | Must | Required fields include centre, receipt date, amount, currency, payment reference where available, method/account and evidence metadata where applicable. Approval is mandatory when maker-checker applies; the recorder cannot approve/post their own receipt. Only a Posted receipt is available for allocation and counted as received cash. **Built:** Draft → Submitted → Approved → Posted (or Rejected); the recorder cannot approve, reject or post, and the database enforces the same; edit and submit are recorder-only; receipts cannot be dated in the future; only an `ACTIVE` centre can have receipts recorded or posted. |
| FR-AR-004 | Detect likely duplicate payment entries. | Must | Duplicate references and same-centre/date/amount patterns trigger prevention or review. **Built:** a repeated reference (case-insensitive, per centre) is blocked, also by a database unique index, and is released if the receipt is rejected or reversed; the same centre, date and amount returns `POSSIBLE_DUPLICATE_PAYMENT` until the user resubmits with `confirmPossibleDuplicate=true`. |
| FR-AR-005 | Allocate one receipt to one or many receivables, and one receivable to many receipts. | Must | Allocation amount cannot exceed unallocated receipt amount or remaining receivable balance without an explicit approved credit/advance mechanism. **Built:** allocation locks the receipt and the targets, is all-or-nothing, rejects any amount above the unallocated cash or a receivable's balance, and supports an `Idempotency-Key`; one receipt can settle many receivables and one receivable can receive many receipts. |
| FR-AR-006 | Retain unallocated receipts until matched/allocated. | Must | Unallocated cash appears separately and does not silently reduce unrelated receivables. |
| FR-AR-007 | Support payment reversals/returns and allocation reversals through auditable transactions. | Must | Original receipt/allocation remains visible and balance is recomputed from posted events. **Built:** an allocation is reversed with a compensating ledger debit by someone other than the allocator; a receipt can be reversed only when it has no active allocations. Receipt returns approved by a second person and adjustments are not built. |
| FR-AR-008 | Track opening balances with cutoff date, source evidence and approval. | Must | Duplicate opening balances are blocked and migration reconciliation is required. |
| FR-AR-009 | Provide not-yet-due, overdue, partly paid, settled and disputed statuses. | Must | Status definitions are consistent across detail pages, dashboard and exports. |
| FR-AR-010 | Support approved debit/credit adjustments with reason and supporting evidence. | Must | Adjustments are separate ledger events; they do not rewrite original charges. |
| FR-AR-011 | Support statement generation (MVP, Must) and optional invoice generation (Should, conditional on finance policy). | Must (statements) / Should (invoices) | Generated documents show period, opening balance, charges, payments/allocations, adjustments and closing balance. |
| FR-AR-012 | Define a **receivable item** as a posted DEBIT ledger entry (posted charge, opening balance or debit adjustment). Allocations and credit adjustments reference a specific receivable item (`applies_to_entry_id`); the open balance of an item is its amount minus linked CREDIT entries plus linked reversals. | Must | Per-item balance, ageing and due status are derivable from ledger entries alone; a credit that references no item is reported as an unapplied credit, not netted silently. |
| FR-AR-013 | Support recording a dispute on a receivable item (reason, raised by/date, status, outcome) and follow-up notes. | Must | A dispute is a flag/record alongside the financial status; resolving it does not change the balance — any financial change requires an approved adjustment or reversal. |

## 6. Historical bulk import

| ID | Functional requirement | Priority | Acceptance / control |
|---|---|---|---|
| FR-HIS-001 | Support separate historical import types for revenue, prior charges, payments, allocations, adjustments and opening balances. | Must | Each import type validates its own required fields and relationships. |
| FR-HIS-002 | Provide downloadable templates and saved mappings. | Must | Templates have a version and required-field specification. |
| FR-HIS-003 | Provide dry-run validation without posting financial entries. | Must | Dry-run leaves the financial ledger unchanged. |
| FR-HIS-004 | Show counts and values for valid, rejected, duplicate, warning and unmatched records. | Must | Summary equals detailed rows and control totals. |
| FR-HIS-005 | Support all-history migration or opening-balance migration with a documented cutoff—not both for the same obligations. | Must | Reconciliation controls detect overlap/double-counting. |
| FR-HIS-006 | Import historical rate/source data where available; require explicit resolution for missing history. | Must | The current rate is never silently substituted for a historical unknown. |
| FR-HIS-007 | Support resumable, idempotent import jobs and controlled cancellation before commit. | Must | Retrying a completed batch cannot duplicate posted records. |
| FR-HIS-008 | Produce a migration sign-off report with source totals, imported totals, exclusions and variances. | Must | Authorized approver records a migration sign-off before the batch is treated as complete. |

## 7. Dashboards, reports and exports

| ID | Functional requirement | Priority | Acceptance / control |
|---|---|---|---|
| FR-RPT-001 | Provide a consolidated dashboard across all permitted centres. | Must | Numbers use documented definitions and selected dates/statuses. **Built:** `GET /dashboard/summary` and the dashboard page show reported revenue, expected service charge, charges posted, payments received and payments allocated for a chosen period, and outstanding, overdue and unallocated balances as at today, each labelled with its basis, limited to the caller's centres, plus items awaiting action and an ageing table. Balances for an arbitrary past date are not built. |
| FR-RPT-002 | Provide centre drill-down into revenue, charges, receipts, allocations and balances. | Must | Drill-down rows reconcile to displayed aggregates. |
| FR-RPT-003 | Provide departmental and payment-channel revenue breakdowns. | Must | Centre-specific aliases normalize to comparable categories where mapped. |
| FR-RPT-004 | Provide ageing reports and overdue worklists. | Must | Ageing is based on due date and open balance at the report date. |
| FR-RPT-005 | Provide import/reconciliation exception reports. | Must | Exceptions include actionable issue descriptions and source record links. |
| FR-RPT-006 | Export permitted data to CSV/XLSX and printable PDF. | Must | Export honors permissions and active filters; export activity is audited where sensitive. |
| FR-RPT-007 | Distinguish charges posted in a period, payments received in a period, and collections against obligations due in a period. | Must | Labels and calculation definitions avoid conflating accrual and cash timing. |

## 8. Audit, approval and administration

| ID | Functional requirement | Priority | Acceptance / control |
|---|---|---|---|
| FR-AUD-001 | Record an append-only audit event for sensitive configuration and financial actions. | Must | Audit records include actor, timestamp, action, target, reason where required and correlation ID. **Built:** events are written in the same database transaction as the change, carry the request correlation ID and centre, and cannot be updated or deleted (database triggers); `GET /audit-events` is limited to the caller's centres. |
| FR-AUD-002 | Require reason and evidence metadata for configured corrections, reversals and disputed adjustments. | Must | Cannot commit without mandatory information. |
| FR-AUD-003 | Prevent ordinary users from hard-deleting posted finance records. | Must | API and database permissions prevent deletion bypass. |
| FR-AUD-004 | Provide searchable import and financial change history. | Must | Authorized reviewer can trace current balance to origin and changes. |
| FR-AUD-005 | Support permission review and deactivation of internal users. | Must | Privilege changes are logged. |

## 9. System states (baseline)

### Import batch
The canonical state list is defined in `12_DATA_IMPORT_AND_HISTORICAL_MIGRATION.md` §3 (`Created → File Uploaded → Parsing → Parsed → Mapping → Validating → Validation Failed | Ready for Review → Approved → Committing → Committed`). `Cancelled` is allowed only before commit and `Failed` with recoverable error metadata. Never use a generic “Done” state if it does not indicate whether financial posting happened.

### Revenue report
`Draft → Validated → Pending Review (if policy requires) → Posted`; a later correction creates a replacement/version or compensating adjustment rather than deleting the posted report.

### Service-charge run
`Draft → Calculated → Pending Approval → Posted`; `Superseded`/`Reversed` only through controlled lifecycle actions.

### Payment
`Draft → Submitted → Approved (when maker-checker applies) → Posted`; `Rejected` returns the item to Draft with a reason. A posted payment may later become `Reversed` or `Returned` only through linked reversal events. Only `Posted` payments are available for allocation.

### Payment allocation
`Draft → Pending Approval (when review is required) → Posted`; `Reversed` only through a linked compensating event. Allocation approval is required for reallocation and any allocation configured as sensitive.

### Dispute
`Open → Under Review → Resolved (Upheld / Rejected / Settled by adjustment)`; a dispute never edits ledger entries.

## 10. Global validation principles

- Required identifiers and monetary values must be validated on both frontend and backend.
- Money uses decimal types, not floating-point arithmetic.
- Zero, blank, exempt and missing are distinct values.
- All dates include a defined timezone/date interpretation. A financial date is not inferred from upload time.
- A source report's control totals do not become extra revenue rows.
- Batch retry must be idempotent.
- Exported and dashboard figures must use the same documented source query/domain service.
