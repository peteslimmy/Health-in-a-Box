# Security, Privacy, Audit & Development Guardrails

This document contains non-negotiable controls for product implementation, AI-assisted coding and production operations.

> **Review status (2026-10-27):** a full code review and security pass of the backend, web app, configuration and dependencies is recorded in `22_CODE_REVIEW_AND_SECURITY_FINDINGS.md`: 1 critical, 5 high, 10 medium and 2 low findings, all fixed with tests, plus the accepted risks and open items (notably parsing in a worker, MFA and managed sign-in before production, and least-privilege database roles).

## 1. Security principles

- Least privilege, deny by default, separation of duties for sensitive workflows.
- Enforce authorization in the backend and database scope, not only in the UI.
- Treat user input, uploaded files, extracted text, imported rows, filenames and external content as untrusted data.
- Keep source reports, statements, receipts and evidence private; use time-limited authorized downloads.
- Separate environments and credentials; never copy production secrets into source control or AI prompts.
- Use secure defaults and document every exception.
- Do not make claims of compliance with a standard unless a scoped assessment has confirmed it.

## 2. Identity and access control

- Integrate with a managed OIDC-compatible identity provider where possible.
- MFA should be enabled for privileged roles if supported by the chosen identity provider.
- RBAC permissions should separate view, create, import, validate, post, approve, allocate, adjust, reverse, export, administer and audit access.
- Add centre scope to relevant permissions/assignments. Query APIs must constrain records by authorized organization and centre scope.
- Use maker-checker on sensitive actions where required; requester cannot approve the same action when the policy requires independent approval.
- Privileged access changes are audited. Deactivated users must lose access according to the documented session-revocation policy.
- No shared staff accounts. Service accounts must be non-human, narrowly scoped and rotated.

## 3. Database and application controls

- Use parameterized SQL/ORM APIs. No string-concatenated SQL from request values.
- Use strict DTO validation and allowlisted sort/filter fields.
- Apply database FKs, uniqueness, check constraints and transaction-safe services for financial invariants.
- Runtime DB role must not have schema-owner privileges or arbitrary DELETE access to posted ledger/audit tables.
- Separate migration, runtime, read-only reporting and emergency-access DB roles where hosting permits.
- Never allow a generic admin API to alter posted money, role/permission or historical rules without the specific controlled workflow.
- Store monetary amounts in decimal columns and use decimal arithmetic on the server.
- Prevent mass assignment: accept only explicitly allowed input fields.
- Use CSRF protection if cookie-based sessions are used; define CORS narrowly; apply secure headers and rate limits.

## 4. File and import safety

- Validate file extension, content signature, MIME type, size, page/worksheet/row counts and parsing duration.
- Reject or quarantine corrupt, encrypted, macro-enabled or unsafe files unless support is explicitly designed and tested.
- Never execute macros, formulas, external workbook links or PDF embedded actions.
- Consider antivirus/malware scanning and private quarantine where available.
- Parse files in isolated worker processes with resource limits; do not parse untrusted documents inside the API request transaction.
- Prevent path traversal and object key injection; generate storage keys server-side.
- Protect against CSV/formula injection in exports by escaping/neutralizing untrusted cells.
- OCR output, AI mappings and fuzzy matches are suggestions only. Human confirmation and deterministic validations are required before financial posting.
- Do not log full raw rows/payment evidence unless the log is explicitly designed, access controlled and retention approved.
- **Implementation status:** upload size/row/column/sheet limits, content-signature checks, rejection of macro, embedded-object and external-link workbooks, and non-evaluation of formulas are enforced; CSV template export neutralises formula characters. Parsing still runs inside the API request (not an isolated worker); move it to a worker before production. The spreadsheet library is the vendor's patched `xlsx` 0.20.3 (pinned by tarball URL and integrity hash, so automated dependency scanners will not track it — re-check for new releases). In development the storage service falls back to local disk when object storage is unreachable; in production (`NODE_ENV=production`) it now refuses to start instead. See `21_IMPLEMENTATION_STATUS.md` §5–§6.

## 5. Financial integrity guardrails

### Mandatory
1. Backend domain service is authoritative for service-charge calculation.
2. No financial posting from the frontend alone or directly from an uploaded file parser.
3. Every charge calculation identifies source revenue, rule version, base amount, rate, eligibility and rounding policy.
4. Missing or ambiguous rule blocks posting; never silently default to zero or today's rate.
5. Posted records cannot be silently edited or hard-deleted. Correct using linked adjustments/reversals.
6. Payment receipt and payment allocation are separate concepts. A receipt only reduces a specific receivable by its allocated amount.
7. Aggregate allocation limits are checked transactionally under concurrency control.
8. Idempotency and uniqueness constraints prevent duplicate commit on retry.
9. A migration must be dry-run, reconciled, approved and traceable. Opening balance cannot overlap the same historic transactions.
10. Statement/dashboard values must be reproducible from source data and posted financial events.
11. Audit events are written in the same database transaction as sensitive business changes or via a reliable transactional outbox.
12. No fake or invented finance records in production.

### Strongly prohibited
- Direct database edits to repair balances in production without a formally approved, scripted and audited recovery procedure.
- Updating a posted charge's rate in place to make a number match.
- Treating a report grand total as another revenue channel.
- Automatically assigning every payment to the oldest debt without an approved allocation policy and review path.
- Marking a balance settled merely because a receipt is recorded; settlement requires valid allocation/approved clearing treatment.
- Using current rates to backfill historical periods whose rates are unknown.
- Automatically accepting a PDF/OCR total without row-level validation.
- Swallowing validation errors, skipping rows silently or reporting “success” when only part of a financial batch committed.
- Using JavaScript floating point for authoritative money calculations.

## 6. Audit design

Audit at minimum:
- sign-in/security events where supported;
- role/permission/centre scope changes;
- centre activation/suspension;
- department/channel creation and mapping changes;
- agreement/rule/terms changes, with effective dates and before/after state;
- import uploads, template mapping versions, validation results, approvals and commit;
- charge run calculation, approval, posting and reversal;
- payment creation, duplicate resolution, allocation and reversal;
- opening-balance, debit/credit adjustment and migration sign-off;
- statement/invoice generation and export of sensitive data;
- configuration and retention changes.

Audit events should include actor, UTC timestamp, action, target type/ID, centre/org scope, reason where required, correlation/batch ID, and safe before/after snapshots. Avoid storing passwords, tokens, bank secrets or unnecessary personal data. Audit log permissions and retention must be defined.

## 7. Privacy and retention

- Collect only data needed for centre finance and operations. Avoid patient-level personal/medical data unless the product scope and lawful basis have explicitly expanded to include it.
- Source reports may contain sensitive information even if the app only needs totals. Define file retention, access restrictions and deletion/archival policy before production.
- Encrypt network paths and storage/backups according to hosting capabilities.
- Define retention and deletion policies for source files, staging rows, exports, logs and audit records with the business owner and applicable advisers. Confirmed default (D-106): financial records, ledger, audit events and source files are retained at least 7 years after the period (to be verified with the accountant/legal adviser); staging rows are purged 90 days after commit; generated exports expire after 30 days.
- Support authorized access, correction and export procedures where required by applicable policy/law; do not promise legal compliance without assessment.
- Mask secrets and unnecessary personal identifiers in logs and error reports.

## 8. AI-assisted engineering guardrails

These rules apply to any coding agent or developer using an AI tool.

### Before changing code
1. Inspect the repository structure, package scripts, dependency versions, existing domain model, routes, services, database schema and tests.
2. Produce a concise current-state inventory and identify reusable components before proposing new files.
3. Read this pack and classify each requirement as confirmed, proposed or open.
4. Do not ask the code agent to “build everything” in one uncontrolled pass. Work in vertical slices with explicit acceptance criteria.

### While changing code
- Follow established project conventions and naming; reuse existing utilities and components when fit for purpose.
- Do not create duplicate files, alternative implementations or parallel schema definitions for a capability that already exists.
- Do not refactor unrelated modules as part of a focused change.
- Keep modules bounded; avoid circular imports, god services/controllers and frontend components containing accounting logic.
- Do not add dependencies without explaining why existing packages are insufficient and assessing maintenance/security implications.
- Do not replace configuration or environment files with invented values; never expose secrets.
- Do not create fake financial data or mock success paths that can be enabled in production.
- Every new endpoint must include authorization, validation, error handling, tests and API docs.
- Every financial function must include boundary tests, decimal precision tests and reproducibility checks.
- Every schema change requires a versioned migration, integrity constraints and migration tests.
- Preserve compatibility with existing stored data unless a reviewed migration plan says otherwise.

### After changing code
- Run formatter, linter, typecheck, unit tests, integration tests and relevant end-to-end tests.
- Run the financial invariant suite and authorization matrix.
- Review generated diff for unrelated changes, duplicate components, dead code, unsafe SQL, secrets and bypassed controls.
- Summarize files changed, behavior added, tests run/results, migration impact and known gaps.
- Do not claim tests passed if they were not run; distinguish failures, skipped tests and environmental blockers.

## 9. Definition of “done” for a feature

A feature is not complete unless:
- acceptance criteria are met;
- backend permissions and validation exist;
- loading, empty, error and success states exist in the UI;
- audit events and source lineage are implemented where applicable;
- tests cover happy path, invalid input, unauthorized access, duplicates, retry and rollback;
- documentation/API contract is updated;
- no unresolved P0 business decision was silently guessed;
- no financial invariant is broken.

## 10. Production release guardrails

- No production go-live while P0 business decisions are unresolved for live financial posting.
- Run full backups and a restore exercise before go-live.
- Run a staging migration rehearsal using representative anonymized data.
- Verify centre scope and privilege boundaries using negative tests.
- Reconcile application totals to an independently prepared control workbook for sample periods.
- Confirm error monitoring, job alerts, security contact and incident/recovery runbook.
- Keep rollback/forward-fix plans for application and schema migrations.
- Restrict production access and review all emergency support actions.
