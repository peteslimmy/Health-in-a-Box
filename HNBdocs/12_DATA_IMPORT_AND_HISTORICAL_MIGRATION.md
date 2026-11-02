# Data Import, Bulk Configuration & Historical Migration Specification

## 1. Goals

Build one governed import subsystem for routine revenue reports, centre configuration bulk setup and legacy financial migration. Different import types can have different field schemas and workflows, but share file safety, staging, validation, deduplication, mapping, job visibility, audit and idempotent commit infrastructure.

## 2. Supported import categories

| Import type | Typical source | Output | Notes |
|---|---|---|---|
| Revenue report | Centre daily/periodic Excel, CSV or digital PDF | Report header, department rows and payment-channel amounts | Primary operational import. |
| Centre departments | New-centre setup CSV/XLSX or pasted grid | Centre department records, aliases and optional canonical mappings | Must support bulk create and reuse. |
| Centre payment channels | New-centre setup CSV/XLSX or pasted grid | Centre channel records and source aliases | Do not confuse with operator receipts. |
| Historical revenue | Legacy revenue workbooks/CSVs | Historical revenue reports/facts | Should preserve source references and periods. |
| Historical service charges | Verified legacy charge register | Charge/receivable records or imported historic charge evidence | Must avoid double calculation from the same revenue. |
| Historical payments received | Legacy bank/payment register | Payment receipts recorded as paid to operator | Does not automatically allocate without mapping evidence or review. |
| Historical allocations | Legacy remittance/settlement allocation data | Payment-to-obligation allocations | Must pass conservation checks. |
| Historical adjustments | Approved debit/credit history | Ledger adjustments | Require type, reason/source and approval evidence. |
| Opening balances | Signed-off reconciliation schedule | Explicit opening receivable entry as at cutoff | Cannot overlap the same obligations with full transaction migration. |

## 3. Standard import lifecycle

`Created → File Uploaded → Parsing → Parsed → Mapping → Validating → Validation Failed / Ready for Review → Approved → Committing → Committed` with `Cancelled` only before commit and `Failed` for technical failures. Maintain a separate business outcome from technical job status so users can distinguish a parsing failure from a financial rejection.

For a routine revenue-report batch, `Committed` means the validated revenue report is posted; it does not mean receivables exist. Charge calculation, approval and ledger posting are a separate charge-run step (two-step posting, P-013).

**Built:** the implemented status values are `DRAFT, UPLOADED, QUEUED, PROCESSING, NEEDS_REVIEW, READY_TO_COMMIT, FAILED, COMMITTED` (a simplified set; upload parses and validates in the same request, so `QUEUED`/`PROCESSING` are not used by a worker yet). Only CSV and XLSX revenue reports are supported; PDF is rejected with a clear message. Limits: 15 MB, 20,000 rows, 100 columns, 20 sheets. Workbooks containing macros, embedded objects or external links are rejected, formulas are not evaluated, a row or grand total that differs from its computed sum by more than 0.01 is a blocking error, and the person who uploaded a batch cannot commit it (`imports.commit`).

Every batch must record: batch ID, type, centre scope, source file name and SHA-256, uploader, time, mapping/template version, row counts, rejection/duplicate counts, input/control totals, output totals, status, approval history and commit reference.

## 4. Revenue report parsing contract

### 4.1 Normalized record shape

A report header should capture:
- centre ID;
- reporting date or period start/end;
- source report reference/report type if available;
- source filename, file hash and imported-by metadata;
- currency;
- reported grand total if present;
- detected template and version;
- validation/posting status.

Each department line should capture:
- source row number and raw source label;
- normalized centre department ID;
- amount for each mapped centre payment channel;
- source-reported department total if present;
- computed channel sum;
- variance and validation status;
- original row payload for source tracing where policy permits.

### 4.2 Fields suggested by the supplied screenshot

Example department columns: `S/N`, `Revenue Department`, `Cash`, `Cheque`, `POS`, `EFT`, `Mobile Money`, `eWALLET`, `oWallet`, `BANK3D`, `Total Amount`. Actual templates must be configured against source files; screenshot labels are not a universal fixed schema.

### 4.3 Arithmetic checks

For each department row:

`computed_channel_total = sum(all mapped channel amounts)`

`row_variance = reported_department_total - computed_channel_total`

For the report:

`computed_grand_total = sum(department totals used as the authoritative row totals, according to the approved source policy)`

The template must define whether row totals or channel sums are the authoritative reported figure when a mismatch exists. The system should display both and block posting on unapproved discrepancies. Do not add `Total Amount` as an extra channel.

Negative values, refunds, reversals, blank values, text-formatted amounts, thousands separators, decimal separators and formula cells need explicit parser policy. Do not infer a negative number or currency solely from display formatting when the stored cell is ambiguous. The schema stores channel amounts as signed values (no non-negative CHECK), so an explicitly configured negative-value policy can be honoured; with no such policy, a negative amount is a validation error.

## 5. File mapping and template versioning

- Allow manual mapping from source column/header to normalized field.
- Allow aliases for department/channel values and retain the raw source label.
- Save mapping per centre and template version; do not mutate a version already used for posted imports.
- Detect header drift using required columns, sheet names and header fingerprints; warn and require confirmation if a template no longer fits.
- Exclude heading/footer/blank rows only under explicit, testable detection rules. Report which rows were ignored and why.
- If multiple worksheets are present, user selects or confirms eligible sheet(s) before parsing.
- Record date format, locale, number format, title/header rows and known footer patterns where needed.
- If a source label maps to more than one canonical entry, block and ask the user to disambiguate.

## 6. Validation levels

### Level 1 — File safety
- extension, MIME/magic bytes and file size/page count;
- corruption, encrypted or password-protected file handling;
- reject macros/embedded content unless specifically supported;
- malware scanning where available;
- parser time/memory limits.

### Level 2 — Structure
- expected sheet/table found;
- required headers present;
- reporting date/period is valid;
- department and amount fields located;
- recognized totals/footer patterns.

### Level 3 — Data quality
- numeric amounts parse correctly;
- valid centre/department/channel mappings;
- no forbidden nulls or invalid values;
- duplicates and suspicious near-matches identified;
- row and grand totals compare within explicit policy.

### Level 4 — Commercial calculation
- correct effective agreement/rule available;
- explicit exclusion vs missing rule resolved;
- rate selection unambiguous;
- calculation preview reconciles to rule inputs;
- no duplicate charge run against the same report unless replacement/recalculation flow is explicitly approved.

### Level 5 — Posting
- required approval obtained;
- idempotency key and current batch status checked;
- financial state change succeeds atomically;
- audit/outbox event committed;
- batch control totals stored.

## 7. Duplicate detection strategy

Use layered signals rather than one heuristic:

1. **Exact file duplicate:** same SHA-256 in same relevant scope.
2. **Source-reference duplicate:** same centre and trusted external report ID/reference.
3. **Report signature:** same centre, report type, period/date, normalized department/channel totals and relevant source metadata.
4. **Near duplicate:** similar date and totals, same department mix or renamed source file; present as a warning for human decision.

A centre may legitimately submit multiple reports per date, so date alone must never be the universal uniqueness key. The final deduplication key needs business confirmation about shifts, report type and centre reference conventions.

**Built (confirmed default D-009):** layers 1 and 3 are implemented — identical file hash, and a content fingerprint of centre + period + normalised department × channel amounts (so a renamed or reformatted re-send is caught), both blocking, with a database unique index for simultaneous uploads. A batch awaiting review does not block a corrected re-upload. A different report overlapping a committed period is allowed and shows an `OVERLAPPING_REPORT` warning. Source-reference and near-duplicate detection (layers 2 and 4) are not built.

## 8. Bulk departments and payment channels

Template fields should include code, display name, optional canonical catalogue ID/code, active/inactive status, effective dates where required, and optional source alias list. Department rows can additionally include charge-rule assignments/rate references; rates should not be accepted without clear scope and effective dates.

Workflow:
1. choose bulk-create, reuse or mixed mode;
2. upload file/paste rows;
3. match existing codes/names and canonical catalogue entries;
4. display new entries, reused entries, duplicates and invalid records;
5. resolve conflicts;
6. commit within one transaction by default;
7. save audit and alias mappings.

Default behavior: a batch with validation errors cannot be committed as if fully successful. If partial commit is later approved, UI must clearly separate accepted and rejected rows and provide stable per-row outcomes.

## 9. Historical migration strategy

### Mode A — Full transaction/history migration

Import historic revenue reports, applicable rule versions or trusted historic charge entries, receipts, allocations and adjustments. Verify the ledger-derived closing position at the migration cutoff against the legacy control balance.

### Mode B — Opening balance at cutoff

Import a verified opening receivable balance for each centre/obligation group at a named cutoff date, then import new transactions after the cutoff. Store the source reconciliation schedule and approval.

### Anti-double-counting rule

Do not import both the historic transactions that create a receivable and an opening balance representing the same receivable. The migration plan must name the cutoff and coverage of each dataset. Batches with overlapping periods/obligations require explicit resolution.

### Historical charge rate missing

Possible approved paths:
- locate historical contract/rate and recalculate;
- import a trusted, independently verified historical charge as a historical-source amount without pretending the rule is known;
- hold/quarantine the record until resolved.

The system must not apply today's rate to old revenue just to make the import complete.

### Payment allocation migration

- Map a historic payment to a specific charge/obligation where evidence permits.
- If payment exists but obligation mapping is missing, import as unallocated and create an investigation item.
- Confirm allocations do not exceed payment amount or obligation amount.
- Verify the sum of allocations plus unapplied receipt equals total receipts for the migrated scope.

## 10. Dry-run and reconciliation report

Dry-run must not post financial entries. It should show:
- source file(s), hash and import mode;
- input row count and control totals;
- parsed/valid/rejected/duplicate/unmatched counts;
- totals by centre, period, department/channel and record type where relevant;
- row/grand total discrepancies;
- unrecognized department/channel aliases;
- missing historical rates and unresolved allocations;
- expected charge and receivable effect if committed;
- comparison to legacy closing balance;
- records that will be skipped/created/updated (updates to posted finance are not silently permitted).

Finance approver signs off a migration report before commit. The system should allow export of errors and a machine-readable migration outcome.

## 11. Performance and recovery

- Run parsing and large imports in workers.
- Store row staging in batches; avoid one enormous in-memory payload.
- Make commit idempotent at record and batch level.
- Track per-row outcomes and progress counts.
- Permit retry of failed parse/validation jobs without duplicating data.
- Treat a commit transaction failure as all-or-nothing for its financial unit. For very large migrations, use resumable chunks with explicit commit markers and a final reconciliation gate; do not claim global atomicity where it is not technically provided.
- Provide cancellation only before financial commit; after commit, correction is through approved reversal/compensating batch.

## 12. Export safety

- Neutralize spreadsheet formula injection when exporting untrusted text values to CSV/XLSX (e.g., values beginning with formula-triggering characters).
- Honor user permissions and centre scope in exports.
- Restrict bulk exports, audit sensitive export attempts, expire download links and avoid publicly accessible objects.
