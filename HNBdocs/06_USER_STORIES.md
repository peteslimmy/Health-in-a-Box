# User Stories & Acceptance Criteria

> **Build status:** acceptance criteria are met or partly met, in the API and the web app, for US-001, US-002 (without the activation readiness checks), US-005, US-006, US-009 to US-011, US-012 to US-016 (receipts, partial and multi-receivable allocation, unallocated worklist, ageing), US-024, US-031 (simplified), US-032 (simplified), US-033, US-035 (allocation and receipt reversal) and US-039; other stories are not built. In particular there is no approval step for agreements or charge rules (US-038), no retry of failed imports (US-027), and no bulk department/channel setup (US-003, US-004). See `21_IMPLEMENTATION_STATUS.md` for the endpoint list and deviations.

**Format:** As a `<role>`, I want `<capability>` so that `<benefit>`.  
**Priority:** P0 = MVP blocker, P1 = important follow-up, P2 = later.

## Epic E1 — Access and centre administration

### US-001 — Sign in securely (P0)
As an internal user, I want to authenticate securely so that only authorized staff can access financial data.

**Acceptance criteria**
- Given a valid active user, when authentication succeeds, the user sees only permitted application features and data.
- Given an inactive user, when they attempt to sign in or use an existing session, access is denied/revoked according to session policy.
- Authorization is checked on the backend for every sensitive API action.

### US-002 — Create a centre (P0)
As a Super Admin, I want to create a centre so that reports and service-charge obligations can be organized by centre.

**Acceptance criteria**
- Centre has a unique stable code and display name.
- Duplicate codes are rejected with a useful error.
- A new centre can be saved as Draft before all configuration is complete.
- Financial history is preserved if the centre is later suspended or archived.

### US-003 — Bulk-create departments (P0)
As a Super Admin, I want to paste, upload or select many departments during centre creation so that onboarding is fast and consistent.

**Acceptance criteria**
- User can add rows in a grid and import the documented CSV/XLSX template.
- Preview identifies new entries, existing matches, duplicates and invalid rows.
- User can map aliases to a canonical department instead of creating duplicates.
- No invalid row is silently dropped; committed rows and failures are reported.

### US-004 — Bulk-create payment channels (P0)
As a Super Admin, I want to bulk configure the source report's payment channels so that imports can map each column consistently.

**Acceptance criteria**
- The process supports manual entry, paste, template upload and reuse of existing channels.
- Each channel has a stable internal ID/code and centre-specific aliases.
- Duplicate names/codes and invalid records are flagged before commit.
- Payment channels are distinguishable from actual service-charge payments received by the operator.

### US-005 — Configure commercial rules (P0)
As a Super Admin, I want to configure effective-dated charge rules so that each centre's agreement is represented accurately.

**Acceptance criteria**
- Rule identifies centre, scope, rate/eligibility, effective dates and author.
- The system detects overlapping or ambiguous rules.
- Historical rule versions are retained.
- A missing rate is not silently interpreted as zero or replaced by the current rate.

## Epic E2 — Import revenue reports

### US-006 — Upload a daily report (P0)
As an Accountant, I want to upload a report for a specific centre and date so that its reported revenue can be processed.

**Acceptance criteria**
- Centre, reporting date/period and file are captured.
- Unsupported or corrupt files are rejected before processing.
- Import status and unique batch/report ID are visible.

### US-007 — Reuse a report template (P0)
As an Accountant, I want the application to apply a saved mapping so that repeated reports require minimal setup.

**Acceptance criteria**
- Template is scoped to a centre or explicitly reusable set and is versioned.
- User sees the mapping version used for the current import.
- If columns change, validation warns and does not blindly map values.

### US-008 — Map unknown labels (P0)
As an Accountant, I want to map unfamiliar department or payment-channel labels so that a changed report can be processed safely.

**Acceptance criteria**
- Unknown labels appear as actionable exceptions.
- User can match to an existing centre department/channel or request creation if permitted.
- Approved aliases are saved for later imports with audit history.

### US-009 — Validate report arithmetic (P0)
As a Finance Reviewer, I want to see differences between channel sums and reported totals so that source errors are investigated before posting.

**Acceptance criteria**
- Each row's channel sum is compared with its reported total.
- Department totals are compared with any report grand total.
- Tolerances are explicit and configurable; no hidden balancing adjustment occurs.
- Exception report contains source row, computed value, reported value, variance and resolution state.

### US-010 — Prevent duplicate reports (P0)
As a Finance Reviewer, I want repeated uploads to be detected so that revenue and charges are not counted twice.

**Acceptance criteria**
- Exact file/hash or identical report signature is detected.
- System shows the earlier batch's status and posting references.
- A corrected report can be submitted through a separate version/replacement flow.

### US-011 — Preview charges before posting (P0)
As an Accountant/Reviewer, I want to see charge calculations before posting so that errors are caught before receivables are created.

**Acceptance criteria**
- Preview displays eligible base amount, rule, rate, formula, rounding mode and charge amount.
- Missing/ambiguous rule blocks posting.
- Preview can be recalculated while Draft; posted calculations cannot be silently edited.

## Epic E3 — Receivables and payments

### US-012 — Record a service-charge payment (P0)
As an Accountant, I want to record money actually received from a centre so that cash collection is represented accurately.

**Acceptance criteria**
- Receipt includes centre, date, amount, currency and available reference/evidence fields.
- Potential duplicate reference/centre/date/amount patterns are shown.
- Recording a receipt does not automatically create a patient revenue entry.

### US-013 — Allocate partial payment (P0)
As an Accountant, I want to allocate a receipt partially against an outstanding charge so that remaining balances are accurate.

**Acceptance criteria**
- Allocation cannot exceed receipt's unallocated amount.
- Allocation cannot exceed the obligation's open balance unless an approved credit/advance path applies.
- Remaining receipt and obligation balances update atomically.
- Allocation has links to both receipt and receivable source.

### US-014 — Allocate one payment to multiple obligations (P0)
As an Accountant, I want one receipt to settle multiple periods so that combined centre remittances can be reconciled.

**Acceptance criteria**
- One receipt can have multiple allocation rows.
- Sum of allocations cannot exceed the receipt amount.
- Each target obligation's remaining balance is recalculated.

### US-015 — Track unallocated receipts (P0)
As a Finance Manager, I want receipts without a confirmed target to remain unallocated so that they do not falsely reduce a receivable.

**Acceptance criteria**
- Unallocated balance appears in a dedicated worklist/report.
- It does not reduce unrelated receivables.
- Later allocation is audited and changes the correct balances.

### US-016 — See overdue receivables (P0)
As an Accountant, I want open balances grouped by due date and ageing bucket so that collection follow-up can be prioritized.

**Acceptance criteria**
- Not-yet-due and overdue balances are distinct.
- Ageing is based on due date and open amount at the selected as-at date.
- Filters work by centre, due period, status and amount.

### US-017 — Generate a centre statement (P0)
As an Accountant, I want to generate a statement for a centre so that the centre's financial position can be explained consistently.

**Acceptance criteria**
- Statement shows date/period, opening balance, charges, adjustments, payments/credits and closing balance.
- Statement totals reconcile with underlying posted records.
- The generated artifact retains its generation date/version and scope.

## Epic E4 — Historical migration

### US-018 — Dry-run a historical import (P0)
As a Finance Manager, I want to validate historical data without posting it so that data problems can be resolved safely.

**Acceptance criteria**
- Dry-run records parsing/validation results but does not alter the receivable ledger.
- Summary reconciles to row-level results.
- Errors can be downloaded, corrected and re-uploaded.

### US-019 — Import historical data by category (P0)
As an Accountant, I want to upload historical revenue, charges, payments and allocations through defined templates so that legacy history can be migrated.

**Acceptance criteria**
- Each dataset has required fields and validation rules.
- References link payments to the correct obligations where available.
- Missing historical rates are highlighted rather than guessed.

### US-020 — Import opening balances (P0)
As a Super Admin/Finance Manager, I want to import approved opening receivables at a cutoff date so that historical periods that will not be migrated still have a verified starting position.

**Acceptance criteria**
- Cutoff date, centre, amount, source evidence and approval are mandatory.
- The app warns against overlap with full transaction history.
- Duplicate opening balance for the same migration key is prevented.

### US-021 — Sign off migration (P0)
As a Finance Manager, I want a migration reconciliation report so that I can confirm legacy and imported totals agree.

**Acceptance criteria**
- Report includes source/imported totals, rejected/skipped rows, duplicates, unmatched links and variances.
- Authorized user signs off and approval is retained.
- Committed batch can be corrected only through controlled compensating actions.

## Epic E5 — Reporting and audit

### US-022 — View consolidated dashboard (P0)
As management, I want a cross-centre view so that I can monitor reported revenue, expected charges, money received and outstanding balances.

**Acceptance criteria**
- Metrics use the same definitions as reports and ledger.
- Selected period/status filters are visible.
- Every important figure can drill down to the underlying records.

### US-023 — Review department contributions (P0)
As a Finance Manager, I want departmental breakdowns so that I can see which services drive reported revenue and expected charges.

**Acceptance criteria**
- Department and channel figures can be filtered by centre and period.
- Unmapped labels remain visible as exceptions and are not silently grouped into unrelated categories.

### US-024 — Audit a financial change (P0)
As an auditor/reviewer, I want a chronological audit trail so that changes can be explained and attributed.

**Acceptance criteria**
- Audit event records actor, timestamp, action, target, reason and relevant before/after values.
- Posted financial rows cannot be hard-deleted by ordinary application users.
- Audit access itself is restricted and audited where appropriate.

### US-025 — Correct a posted calculation (P0)
As a Finance Manager, I want to approve a correction through reversal/replacement so that the balance is fixed without losing the original history.

**Acceptance criteria**
- Correction requires reason and a financial-impact preview.
- Approval policy is enforced.
- Original and compensating entries remain linked.

### US-026 — Export reports (P0)
As an authorized user, I want to export filtered data so that finance can analyze or share permitted information.

**Acceptance criteria**
- CSV/XLSX and printable PDF are supported for specified reports.
- Exports honour access permissions and filters.
- Export includes report scope, date range, currency and generation timestamp.

## Epic E6 — Reliability and operations

### US-027 — Resume a failed import job (P0)
As an Accountant, I want transiently failed jobs to be safely retried so that I do not have to repeat work or risk duplicates.

**Acceptance criteria**
- Job status and error summary are preserved.
- Retry is idempotent.
- A committed batch cannot be committed a second time.

### US-028 — Configure report mapping version (P1)
As a Super Admin, I want to version mappings so that changes in a centre's report format do not damage imports using older formats.

### US-029 — Receive overdue reminders (P1)
As an Accountant, I want configurable reminders so that due and overdue balances are followed up on time.

### US-030 — Review anomalies (P2)
As a Finance Manager, I want suggested revenue/payment anomalies so that unusual variances can be investigated; suggestions must never change posted finance data automatically.

## Epic E7 — Access control, approvals and receivable servicing

### US-031 — Create a custom role (P0)
As an Access Administrator, I want to build a role from the permission catalogue so that staff get only the access their duties need.

**Acceptance criteria**
- Role is created as Draft, previewed (users affected, centres exposed, permissions added/removed), activated, then assignable.
- Only existing catalogue permission keys can be selected; high-risk grants are visibly flagged and require a reason.
- A role assigned to users or referenced by audit history can be retired but not deleted.
- Role creation and every permission change are audited with before/after state.

### US-032 — Assign a role with centre scope (P0)
As an Access Administrator, I want to assign a role to a user for all centres or selected centres so that access matches responsibility.

**Acceptance criteria**
- Each assignment has its own scope, dates and reason; a selected-centres assignment has at least one centre.
- An administrator cannot assign a role or permission above their delegated ceiling or elevate themselves.
- Auditor plus a write-capable role is blocked or requires a recorded business-owner exception.
- Revocation takes effect promptly and invalidates cached permissions/sessions.

### US-033 — Approve a payment receipt (P0)
As a Finance Manager, I want to approve and post receipts recorded by another user so that cash records are independently verified.

**Acceptance criteria**
- A receipt moves Draft → Submitted → Approved → Posted; the recorder cannot approve or post their own receipt.
- Rejection returns the receipt to Draft with a reason.
- Only Posted receipts can be allocated or counted as payments received.

### US-034 — Raise a manual adjustment (P0)
As a Finance Manager, I want to request a debit/credit adjustment with reason and evidence so that errors are corrected without altering original entries.

**Acceptance criteria**
- Adjustment is a separate ledger event referencing the receivable item it affects.
- Request, independent approval and posting are separate steps with audit events.
- Reason and supporting evidence are mandatory.

### US-035 — Reverse a payment or allocation (P0)
As a Finance Manager, I want to reverse a returned payment or a wrong allocation so that balances are restored with full history.

**Acceptance criteria**
- Reversal creates linked compensating entries; original records stay visible.
- Affected receivable balances and the unallocated amount are recomputed from posted events.
- Reversal needs independent approval where maker-checker applies.

### US-036 — Record a dispute and follow-up (P0)
As a Receivables Officer, I want to flag a receivable item as disputed and log follow-up notes so that collection efforts are tracked.

**Acceptance criteria**
- Dispute has reason, raiser, date, status and outcome; it does not change the balance.
- Any financial change from a dispute outcome needs an approved adjustment or reversal.
- Disputed items remain visible in ageing with a dispute indicator.

### US-037 — Suspend or archive a centre (P0)
As a Super Admin, I want to suspend or archive a centre so that it stops receiving new financial records without losing history.

**Acceptance criteria**
- Suspend/archive requires `centres.suspend` / `centres.archive` and a reason, and is audited.
- Posted financial records, reports and statements remain viewable; new report imports and postings are blocked while suspended or archived.
- A referenced centre can never be hard-deleted.

### US-038 — Approve a commercial agreement or rule (P0)
As a Finance Manager, I want to approve agreements and charge rules prepared by someone else so that rates are independently verified before use.

**Acceptance criteria**
- Agreement/rule moves Draft → Submitted → Approved; the author cannot approve their own.
- Only approved, effective-dated rules are selectable by the charge engine.
- Overlapping or ambiguous rules block approval.

### US-039 — Deactivate a user (P0)
As an Access Administrator, I want to deactivate a user and revoke their sessions so that departed staff lose access promptly.

**Acceptance criteria**
- Deactivated users cannot start new sessions and existing sessions are revoked within the limit set by decision D-015.
- Their historical audit trail and authored records remain intact.
- Deactivation and session revocation are audited.

## Acceptance testing rule

Every P0 story should have automated tests at unit, integration or end-to-end level as appropriate. Financial calculations, duplicate imports, allocation, reversal, historical rate selection and balance aggregation require backend tests even if similar validation exists in the UI.
