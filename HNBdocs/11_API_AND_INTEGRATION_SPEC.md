# API & Integration Specification

**Baseline:** Versioned REST API under `/api/v1`; OpenAPI contract generated from DTOs/controllers. Route names may be adjusted to the framework conventions, but semantics and authorization must remain consistent.

> **Implementation status:** the routes actually implemented, with their permissions, are listed in `21_IMPLEMENTATION_STATUS.md` §3. Names differ in places (`/imports` instead of `/import-batches`, `/centres/:id/channels` instead of `/payment-channels`, `GET /audit-events` is built, `POST /imports/:id/commit` requires `imports.commit` and a user other than the uploader). Payments (receipt lifecycle, allocation, allocation and receipt reversal) receivables (list, detail with ledger cross-check, ageing summary) and dashboard summary endpoints are built (see doc 21 §3); adjustments, disputes, statements, migrations, dashboard and reports endpoints are not built. Decision I-002: the built commit and post endpoints are idempotent by state (a repeat returns the original result); client-supplied `Idempotency-Key` headers are introduced with the payment and allocation endpoints.

## 1. API conventions

- Use JSON request/response bodies except file-upload/multipart and file-download endpoints.
- Use UUID IDs; do not expose internal database sequence assumptions.
- Money values should be sent as decimal strings (for example `"12345.67"`) to avoid JSON number precision ambiguity. API docs must state currency and scale.
- Dates use ISO `YYYY-MM-DD` for business dates and ISO 8601 timestamps for events.
- All list endpoints support pagination, sorting from allowlisted fields, and filters scoped by permission.
- Use consistent errors:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The report contains rows that require correction.",
    "correlationId": "...",
    "details": [{ "field": "rows[12].total", "code": "ROW_TOTAL_MISMATCH", "message": "Channel sum differs from reported total." }]
  }
}
```

- Use HTTP status codes consistently: 400 malformed request, 401 unauthenticated, 403 forbidden, 404 resource not found **or outside the caller's centre scope** (so existence is not leaked), 403 caller lacks the required permission, 409 business conflict/duplicate, 422 semantic validation failure, 429 rate limit, 5xx server failure.
- For operations that can be retried and may create finance records, require `Idempotency-Key` or a named batch idempotency key.
- Never return storage object keys or permanent public URLs for private files. **Built:** import and receipt responses omit storage keys. Rate limits: 300 requests per minute per address on every route, and 8 sign-in attempts per minute per account; behind a reverse proxy set `TRUST_PROXY` so limits apply per real client. Use short-lived, authorized download URLs or proxy downloads.

## 2. Authentication and authorization

Authentication is delegated to the selected identity provider. Backend middleware verifies identity/token/session, then authorization guards verify permission and centre scope. Client-supplied `organizationId`, `centreId`, role or actor identity must not be trusted without server-side checks. Audit actor comes from authenticated context, not request body.

## 3. Endpoint inventory

### Identity and access

- `GET /api/v1/me` — current user, roles and permitted centre scopes.
- `GET /api/v1/users` — list users (`users.view`).
- `POST /api/v1/users` — invite/create internal user (`users.create`).
- `PATCH /api/v1/users/:id/status` — activate/deactivate (`users.activate` / `users.deactivate`).
- `POST /api/v1/users/:id/revoke-sessions` — `users.revoke_sessions`.
- Roles, permission catalogue, role assignments (`POST /users/:id/role-assignments`, `PATCH /role-assignments/:id/revoke`), effective access and access reviews are specified in `19_RBAC_ROLE_PERMISSION_MODEL.md` §12, which is authoritative. The earlier `PUT /users/:id/roles` and `GET /roles` shapes are superseded.
- `GET /api/v1/approvals` (inbox, `approvals.inbox_view`) and `POST /api/v1/approvals/:id/decide` (`approvals.decide`, plus the domain-specific approve permission) — shared maker-checker workflow; the server rejects a decision by the requester.

### Centres and configuration

- `GET /api/v1/centres` / `POST /api/v1/centres`.
- `GET /api/v1/centres/:centreId` / `PATCH /api/v1/centres/:centreId`.
- `POST /api/v1/centres/:centreId/activate` — validates readiness (`centres.activate`).
- `POST /api/v1/centres/:centreId/suspend` / `archive` — `centres.suspend` / `centres.archive`; never deletes financial history.
- `GET /api/v1/centres/:centreId/departments` / `POST /api/v1/centres/:centreId/departments/bulk-preview` / `POST .../departments/bulk-commit`.
- `GET /api/v1/centres/:centreId/payment-channels` / bulk preview and commit endpoints analogous to departments.
- `POST /api/v1/centres/:centreId/department-aliases` and `/payment-channel-aliases`.
- `GET/POST /api/v1/centres/:centreId/agreements`.
- `GET/POST /api/v1/agreements/:agreementId/charge-rules`.
- `POST /api/v1/agreements/:id/submit` / `approve` / `close` and `POST /api/v1/charge-rules/:id/submit` / `approve` — `agreements.*` and `charge_rules.*` workflow; approver cannot be the author.
- `GET/POST /api/v1/centres/:centreId/payment-terms`.
- `GET/POST /api/v1/centres/:centreId/import-templates`; `POST /api/v1/import-templates/:id/versions`.
- `POST /api/v1/import-templates/:id/activate` — `import_templates.activate`.

### Import and revenue reports

- `POST /api/v1/import-batches` — create batch metadata, include batch type and selected centre/scope.
- `POST /api/v1/import-batches/:id/files` — upload file to controlled storage/staging.
- `POST /api/v1/import-batches/:id/parse` — enqueue parse job.
- `GET /api/v1/import-batches/:id` — status, counts, job progress and errors.
- `GET /api/v1/import-batches/:id/preview` — paginated normalized staging rows.
- `POST /api/v1/import-batches/:id/mappings` — save/confirm field mappings.
- `POST /api/v1/import-batches/:id/validate` — run validation.
- `GET /api/v1/import-batches/:id/errors` — list/download validation results.
- `POST /api/v1/import-batches/:id/submit-review` — request approval.
- `POST /api/v1/import-batches/:id/approve` / `reject` — reviewer actions where required.
- `POST /api/v1/import-batches/:id/commit` — idempotent commit. For a revenue-report batch it **posts the validated revenue report only** (two-step posting); it never creates ledger entries. Ledger debits are created only by `POST /charge-runs/:id/post`. For configuration batches it commits the bulk configuration.
- `GET /api/v1/source-files/:id/download-url` — short-lived authorized URL; `source_files.download` plus centre scope.
- `GET /api/v1/revenue-reports` / `GET /api/v1/revenue-reports/:id`.
- `POST /api/v1/revenue-reports/:id/request-correction`.

### Charge calculation and receivables

- `POST /api/v1/charge-runs/preview` — calculate non-posted preview from validated report IDs and effective rules.
- `POST /api/v1/charge-runs` — create draft run.
- `GET /api/v1/charge-runs/:id` — details and calculation trace.
- `POST /api/v1/charge-runs/:id/recalculate` — Draft only.
- `POST /api/v1/charge-runs/:id/submit-review`, `/approve`, `/post` — applicable workflow; `/post` creates the ledger debits and is idempotent.
- `POST /api/v1/charge-runs/:id/cancel` — Draft only (`charge_runs.cancel_draft`).
- `GET /api/v1/receivables` — filtered by centre, period, due date, status and ageing.
- `GET /api/v1/receivables/:id` — `:id` is the **receivable item** (a posted DEBIT ledger entry); returns source, ledger events, allocations and balance.
- `POST /api/v1/receivables/:id/adjustment-requests` — request approved debit/credit adjustment; credit adjustments reference this item.
- `POST /api/v1/adjustments/:id/submit`, `/approve`, `/post`, `/reverse` — `adjustments.*` workflow.
- `POST /api/v1/receivables/:id/reversal-requests` — controlled correction workflow.
- `POST /api/v1/receivables/:id/disputes` (`receivables.dispute_flag`), `PATCH /api/v1/disputes/:id` (`receivables.resolve_dispute`), `POST /api/v1/receivables/:id/follow-ups` — dispute and follow-up records; none alters the ledger.
- `POST /api/v1/opening-balances`, `/:id/submit`, `/approve`, `/post` — `opening_balances.*`; a migration-mode opening balance is created only through the migration workflow.

### Payments and allocation

- `GET /api/v1/payments` / `POST /api/v1/payments` (creates a Draft; `payments.record`).
- `GET /api/v1/payments/unallocated` — unallocated receipt worklist. Declared before `/payments/:id` (or `:id` constrained to UUID) so it is not captured as an ID.
- `GET /api/v1/payments/:id`; `PATCH /api/v1/payments/:id` (Draft only, `payments.update_draft`).
- `POST /api/v1/payments/:id/submit` (`payments.submit`), `/approve` (`payments.approve`), `/reject`, `/post` (`payments.post`) — receipt lifecycle; approver and poster cannot be the recorder when maker-checker applies.
- `POST /api/v1/payments/:id/reversal-requests` — receipt reversal/return (`payments.reverse`), with independent approval.
- `POST /api/v1/payments/:id/allocation-preview` — show candidate obligations; preview does not commit. Posted receipts only.
- `POST /api/v1/payments/:id/allocations` — create one or more validated allocations in one transaction; if review is required the allocations are created `PENDING_APPROVAL` and `POST /api/v1/payment-allocations/:id/submit` / `approve` completes them.
- `POST /api/v1/payment-allocations/:id/reversal-requests`.

### Historical migration

- `POST /api/v1/migrations` — create migration project with mode/cutoff.
- `POST /api/v1/migrations/:id/import-batches` — attach typed batches.
- `POST /api/v1/migrations/:id/dry-run`.
- `GET /api/v1/migrations/:id/reconciliation` — source vs staged/imported control totals.
- `POST /api/v1/migrations/:id/submit-review`, `/approve`, `/commit`.
- `GET /api/v1/migrations/:id/sign-off-report`.

### Reporting and documents

- `GET /api/v1/dashboard/summary`.
- `GET /api/v1/dashboard/trends` — monthly series for the dashboard charts (**built**).
- `GET /api/v1/reports/centre-performance`.
- `GET /api/v1/reports/department-revenue`.
- `GET /api/v1/reports/receivables-ageing`.
- `GET /api/v1/reports/unallocated-payments`.
- `GET /api/v1/reports/import-exceptions`.
- `POST /api/v1/exports` — enqueue large export; `GET /api/v1/exports/:id` status/download.
- `POST /api/v1/statements/preview` / `POST /api/v1/statements`.
- Invoice endpoints only after invoice policy is approved.

### Audit and system health

- `GET /api/v1/audit-events` — restricted permission and filtering.
- `GET /api/v1/health/live` and `/health/ready` — non-sensitive operational checks.

## 4. Posting and allocation transaction contracts

### Commit an import batch

The commit endpoint must:
1. Check authenticated user, centre scope and required permission.
2. Verify batch state and idempotency key.
3. Revalidate required data and template/rule versions.
4. Confirm approval state where required.
5. In one DB transaction, create the normalized/posted revenue report (or committed configuration), audit records and an outbox event. Charge/receivable entries are **not** created here; they are created by the separate, separately approved charge-run post.
6. Return a stable outcome. Repeating the same request returns the prior result instead of duplicating financial rows.

### Allocate a payment

The allocation endpoint receives an array of `{receivableId, amount}` and an idempotency key. Backend must lock or version-check the payment and receivables, calculate available balances using posted entries, verify same centre/currency, verify allocation totals, then post all allocations/credit entries atomically. If any allocation fails, the whole allocation request fails; it must not commit only an unexplained subset.

## 5. Example API payloads

### Record a payment receipt

```json
{
  "centreId": "uuid",
  "receiptDate": "2026-10-26",
  "amount": "250000.00",
  "currency": "NGN",
  "paymentMethod": "BANK_TRANSFER",
  "paymentReference": "BANK-REF-123",
  "receivingAccountLabel": "Operating Account",
  "evidenceUploadId": "uuid"
}
```

### Calculate a preview

```json
{
  "centreId": "uuid",
  "revenueReportIds": ["uuid"],
  "calculationAsOfDate": "2026-10-26",
  "mode": "PREVIEW"
}
```

### Allocate a payment

```json
{
  "allocations": [
    { "receivableId": "uuid-1", "amount": "150000.00" },
    { "receivableId": "uuid-2", "amount": "100000.00" }
  ],
  "reason": "Centre remittance advice specifies two periods"
}
```

## 6. Integration patterns

- Use object-storage presigned upload/download URLs with short expiry and constrained object paths, or stream through API if simpler and safe at anticipated file size.
- Use queue/outbox pattern for import, export and notifications; do not rely on in-memory background promises in the API process.
- If identity provider offers webhooks, validate signatures and process idempotently.
- Future bank/HIMS integrations should use separate connector modules and keep imported data staged until validation; credentials must never be stored in centre configuration JSON as plain text.

## 7. API release gates

- OpenAPI generated and reviewed for every endpoint.
- Authorization tests for each role and centre scope.
- Idempotency tests for all financial commit endpoints.
- Integration tests for rollback on partial failure.
- Pagination/filter/export limits.
- No unvalidated dynamic sort columns or raw SQL concatenation from client input.
- Sensitive errors must not expose stack traces, SQL, credentials, object keys or private source content.
