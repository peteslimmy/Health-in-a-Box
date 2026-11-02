# User Journey & Workflow Specification

> **Build status:** the backend supports the data side of Journeys A (partly: no bulk setup or readiness checks), B (CSV/XLSX, validation, duplicate blocking, commit by a different user, charge run, approval and posting) and the audit part of F. Journey C (receipt approval, allocation, reversal) is built in the API; Journey D is available through the receivables list, detail and ageing endpoints; E (historical migration), G (statements) are not built. The web app covers Journeys A to D and the audit view of F. See `21_IMPLEMENTATION_STATUS.md`.

**Purpose:** Describe the end-to-end paths users follow. The journeys are the behavioral baseline for UI/UX, APIs, user stories and acceptance testing.

## 1. Roles used in these journeys

- **Super Admin:** business owner, access administrator, centre/commercial-rule owner and high-risk approver.
- **Finance Manager/Reviewer:** reviews financial imports, charge calculations, adjustments and migration batches.
- **Accountant:** configures routine import mappings where permitted, uploads reports, records receipts, allocates payments and prepares statements.
- **Read-only Management:** sees dashboards and permitted reports without changing financial records.
- **System Operator:** maintains infrastructure and support access; production financial changes are not performed through database edits.

These are personas. Enforceable access comes from the role templates and permission keys in `19_RBAC_ROLE_PERMISSION_MODEL.md` (e.g. the Accountant persona is typically a combination of Report Uploader, Payment Recorder and/or Payment Allocator; the Auditor persona is the read-only Auditor template).

A user can have more than one role only if approved by the business and not blocked by role-conflict rules (e.g. Auditor plus a write role). Sensitive actions always enforce maker-checker separation: a user cannot approve their own submission even when holding several roles.

## 2. Journey A — Create and activate a centre

### Trigger
A new hospital/centre begins operating under an agreement with the operator.

### Steps
1. Super Admin opens **Centres → New Centre**.
2. Enters centre name, unique code, location/contact metadata (only what is needed), currency, status and effective start date.
3. Saves the centre as Draft. The application creates a stable internal ID that never depends on the display name.
4. Opens **Departments & Services**.
   - Add rows manually, paste a list from a spreadsheet, upload the department template, select entries from the standard catalogue, or reuse the approved configuration of another centre.
   - Provide a centre-specific code/name, optional canonical department, source aliases, active dates and service-charge configuration reference.
   - Preview new records, reused records, duplicates and invalid rows.
   - Confirm bulk creation. The operation must be atomic or clearly report partial success; default recommendation is all-or-nothing per configuration batch.
5. Opens **Payment Channels** and repeats the flow for Cash, POS, EFT, eWALLET, or the relevant channels in that centre's reports.
6. Configures the commercial agreement and effective-dated charge rules. A centre-wide default may be used with optional department/payment-channel overrides; rule precedence remains a business decision until confirmed.
7. Configures report frequency, import template expectations, payment terms and due-date method.
8. Reviews the configuration summary and warnings, including missing rates, duplicate aliases, overlapping rule dates and channels not used by any template.
9. Activates the centre after all mandatory configuration passes. Activation is logged.

### Success outcome
Centre is active and ready for revenue-report import. Its department and channel catalogues are reusable by imports, calculation and reports.

### Exceptions
- Duplicate centre code: block save and link to existing centre if the user has access.
- Unknown or duplicate department/channel: show row-level error and offer selection of existing entry.
- Commercial rule overlap/conflict: block activation until resolved, unless an explicitly approved configuration design permits it.
- Centre is activated without all historic rates: future imports can work, but historical periods with missing rules must be blocked or quarantined rather than use the current rate silently.

## 3. Journey B — Upload a routine revenue report

### Trigger
An accountant receives the centre's daily or periodic revenue report.

### Steps
1. Open **Revenue Reports → New Import**.
2. Select the centre and reporting date or start/end period. The date should not be inferred only from upload timestamp.
3. Upload `.xlsx`, `.csv`, or a supported digital/text PDF. The application validates file type, size, basic content and security constraints.
4. Select a saved template or start a new mapping. Parser suggests columns; user confirms the source department field, each payment-channel field, total column and any report header/date/period fields.
5. System parses the file into a staging preview and shows the original source row, source labels, normalized department/channel, parsed amounts and row number.
6. Validate required fields, numeric values, duplicate report fingerprints, channel totals vs department total and department totals vs report grand total.
7. Resolve exceptions: map aliases, correct the input file, exclude non-financial header/footer rows with explicit reason, or hold the batch.
8. Review the financial summary and calculated service-charge preview. The summary shows reported revenue, eligible revenue, rule(s) used, expected service charge and differences.
9. Submit for review if policy requires. Reviewer can approve or return with reason. The same user cannot approve their own submission when maker-checker is enabled.
10. Commit the batch to **post the validated revenue report** (permission `revenue_reports.post`). Committing the report does not create receivables.
11. Create/calculate a charge run from the posted report, submit it for review, and have an independent approver approve; then **post the charge run** (`charge_runs.post`). Receivable (ledger debit) posting and due-date creation are explicit and idempotent at this step only.
12. Display posting confirmation with report ID, charge-run ID, financial-entry references and a link to the centre statement/ledger.

### Success outcome
The report is traceable to its source, revenue totals are validated, charge results are reproducible and the financial records are posted once.

### Exceptions
- Duplicate submission: show original import and current status; do not post again.
- Layout changed: use template version mismatch warning, remap and save as a new template version.
- Row/grand total variance: allow configured tolerance only if approved; otherwise hold for resolution. Never auto-correct financial amounts silently.
- Unknown department/channel: keep the record in staging and require mapping or explicit exception resolution.
- Parser cannot read scanned PDF: explain limitation and provide manual data template/assisted capture path; any OCR output must be visually verified before posting.

## 4. Journey C — Record actual service-charge payment

### Trigger
The operator receives a transfer, cheque, cash deposit, or other payment from a centre toward service-charge obligations.

### Steps
1. Accountant opens **Payments → Record Receipt**.
2. Selects the centre, receipt date, amount, currency, payment method, receiving account/reference, payer/remitter information if needed, and uploads or links evidence.
3. The system checks for an exact duplicate reference and likely duplicates by centre/date/amount. Potential matches are shown before saving.
4. Payment Recorder saves the receipt as a Draft, then submits it. A different authorized user approves and posts it as received funds (maker-checker; the recorder cannot approve or post their own receipt). A receipt is not automatically treated as allocating to a specific obligation solely because its amount matches, and only a Posted receipt can be allocated.
5. Open **Allocate Payment**. The system shows open receivables and optional suggested allocations based on centre, oldest due date, stated remittance period and reference. Suggestions are not committed automatically unless an approved deterministic policy is later adopted.
6. User selects one or multiple obligations and enters allocation amounts. One obligation can receive multiple payments over time.
7. Validate allocations do not exceed the remaining available receipt or obligation balance, unless a separate approved customer-credit/advance model permits it.
8. Confirm allocation. The transaction updates payment's unallocated amount and receivable balances atomically, creates audit events and links the allocation to both receipt and obligation.
9. Show receipt amount, allocated amount, unallocated balance and obligations affected.

### Success outcome
Cash received is recorded once and amounts are explicitly allocated to the relevant obligations. Any unapplied amount is visible as an unallocated receipt, not hidden as a balance reduction.

### Exceptions
- No clear obligation: save as unallocated and assign for later resolution.
- Payment reference duplicate: block or require reviewer resolution with reason.
- Payment exceeds remaining open obligations: keep excess unallocated or use an approved advance/credit process; do not silently create a negative receivable.
- Payment later returned: create linked reversal/return events and reverse affected allocations under approval; retain full history.

## 5. Journey D — Review centre reconciliation and overdue balances

1. Accountant/Finance Manager opens **Centres** or **Receivables** and selects a centre or consolidated view.
2. Selects an as-at date, reporting/earning period and optional status filters.
3. Reviews opening balance, charges, debit/credit adjustments, receipts, allocation, closing balance, not-yet-due and overdue amounts.
4. Opens a receivable to inspect its source report, departments, rule version, charge calculation, due-date basis, payments allocated and approved adjustments.
5. For overdue entries, reviews ageing bucket, previous contact/follow-up notes, dispute state (a dispute record on the receivable item) and next action.
6. Generates a statement for a selected period or as-at date. The generated document states its scope and includes a clear movement/closing balance.
7. Exports data in permitted formats. All filters and definitions are preserved or clearly printed in the report header.

### Success outcome
Staff can explain both the current outstanding amount and the events that produced it, without reconstructing the result manually from unrelated files.

## 6. Journey E — Historical bulk migration

1. Super Admin/Finance Manager opens **Data Management → Historical Import**.
2. Selects import mode: full historical transactions, historic charge/receipt ledger, or verified opening balances as at a cutoff. The UI warns against importing opening balances for periods whose obligations are already fully represented by transaction history.
3. Selects the record type and centre(s), uploads data files and selects a template.
4. Maps centre IDs/codes, department/channel aliases, dates, source references, amounts, historical rates/rules and receipt allocations.
5. Runs dry-run validation. The job reports rows accepted, rejected, duplicate candidates, unmatched references, missing historical rules and control-total variances.
6. Resolves issues, downloads the error file, uploads corrected data or approves defined exceptions.
7. Runs reconciliation checks by source file, centre, period and data type. If complete history is imported, source closing balance must match imported ledger-derived closing balance; if only opening balances are loaded, the cutoff and independently verified balance must be approved.
8. Finance Manager signs off on the migration report. If maker-checker applies, importer cannot self-approve.
9. Commit the batch using idempotent processing. Record batch and source hashes, user, approver, mapping version and import outcomes.
10. Compare post-migration balances and dashboard totals with the signed-off control totals. If a defect is found after posting, use a controlled compensating batch/reversal, not database deletion.

### Success outcome
Historical financial state is brought into the platform without double-counting or losing lineage.

## 7. Journey F — Correct a previously posted report or rate

1. Authorized user opens posted report, charge run or agreement and selects **Request Correction** or **Create New Rule Version**.
2. Records correction reason, evidence, affected period and expected financial impact.
3. System shows a before/after preview and downstream affected receivables/payments.
4. Required reviewer approves or rejects.
5. Approved correction creates a new version or compensating entries. It does not overwrite or delete the original posted records.
6. Recompute only the permitted affected items and record a correction batch. Existing payment allocations must be explicitly preserved, reallocated or reversed as necessary.
7. Dashboard/statement is updated with version history and audit references.

## 8. Journey G — Create a statement/invoice

1. User selects centre and period or an as-at date.
2. Application gathers posted receivable movements, allocated receipts, credits/debits and remaining balance.
3. For a statement, display opening balance + charges/adjustments − payments/credits = closing balance.
4. For an invoice, apply only the document rules approved for that commercial agreement; do not assume a statement itself creates a receivable if charges are already posted.
5. Preview, generate and retain a document record with unique number/version, creation actor and source entries.
6. If sent externally by email in a future phase, record recipient, send status and retry history.

## 9. Cross-journey UX requirements

- Display a stable ID for centres, imports, reports, charge runs, payments and batches.
- Provide breadcrumbs and clear links between report → charge → receivable → payment/allocation.
- Explain every error with source row/field and next action.
- Use confirmation modals only for consequential events (post, approve, reverse, activate, commit migration), not every routine click.
- Show the financial consequence before confirming a correction, reversal or allocation.
- Keep draft/preview data separate from posted ledger data.
