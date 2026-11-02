# Technical Requirements & Recommended Stack

**Status:** Recommended baseline for the first release; validate versions and hosting choices before implementation. Pin all production dependencies to tested versions and keep a dependency update process.

## 1. Stack recommendation at a glance

| Layer | Recommendation | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Mature component model, strong type checking and efficient SPA delivery. |
| UI styling/components | Tailwind CSS + shadcn/ui + Radix primitives; Inter or equivalent accessible UI font | Consistent, polished enterprise interfaces with accessible primitives and editable design system. |
| Routing | React Router (or TanStack Router if the team standardizes on it) | Protected routes and nested centre/workflow layouts. Choose one, not both. |
| Server-state | TanStack Query | Cache, invalidation, loading/error states and mutation lifecycle. |
| Forms/validation | React Hook Form + Zod | Typed form validation, complex configuration wizards and import mapping forms. Backend still validates independently. |
| Tables | TanStack Table with a virtualization strategy for large rows | Filtering/sorting/column visibility/pagination and finance-friendly grids. |
| Charts | Recharts or another React-compatible chart library | Accessible trend/compare charts; keep tables alongside charts for exact values. |
| Backend | NestJS + TypeScript, REST API | Modular domain structure, dependency injection, guards, validation and OpenAPI support. |
| Database | PostgreSQL | Decimal monetary values, relational constraints, transactions and audit relationships. |
| ORM/migrations | Prisma for standard data access; reviewed SQL migrations for database-specific constraints/indexes | Type-safe access with explicit, versioned schema change. Avoid ORM-only thinking for financial integrity. |
| Queue/worker | Redis + BullMQ (or equivalent durable queue) for file parsing, exports and notifications | Background processing with retries and progress. Queue is not a system of record. |
| File storage | Private S3-compatible object storage or equivalent managed private bucket | Secure upload retention and generated documents without storing large files in database rows. |
| Authentication | Managed OIDC-compatible identity provider; Supabase Auth is an acceptable option if chosen deliberately | Avoid building password and session security from scratch. Backend verifies identity and applies RBAC. **Built:** in-house authentication (argon2 hashes, 15-minute JWT access tokens, rotating 7-day refresh sessions stored hashed, no MFA yet); acceptable for MVP development but revisit before production (see `21_IMPLEMENTATION_STATUS.md` §6). |
| API documentation | OpenAPI/Swagger generated from DTOs and controllers | Keep the API contract reviewable and testable. |
| Frontend tests | Vitest + React Testing Library; Playwright for end-to-end | Component and realistic browser workflows. |
| Backend tests | Jest or Vitest supported by NestJS setup; Supertest for API tests | Domain unit tests and integration tests. Use one standard test runner per layer. |
| Static quality | ESLint, Prettier, TypeScript strict mode, dependency scanning and secret scanning | Prevent drift and catch defects early. |
| CI/CD | GitHub Actions or an equivalent pipeline | Repeatable checks, migrations and deployment gates. |
| Runtime | Docker containers; managed application/container hosting | Consistent environments and operational simplicity. |
| Monitoring | Structured application logs, error monitoring, metrics, uptime and queue alerts | Detect broken imports and financial-operation failures early. |

> **Built:** the frontend (`Frontend/`) uses React 19, TypeScript (strict), Vite, Tailwind CSS 4, TanStack Query and React Router, with custom accessible components and Vitest/Testing Library. It does not yet use shadcn/Radix, React Hook Form with Zod, TanStack Table, Recharts or a generated OpenAPI client (see `21_IMPLEMENTATION_STATUS.md` §6, items 14 and 15). In development the browser calls only its own origin and Vite proxies `/api` to the API, so the refresh cookie is same-origin.

## 2. Frontend architecture

- Use TypeScript strict mode; avoid `any` except in isolated parser boundaries with immediate validation.
- Feature folders should mirror business domains: `auth`, `centres`, `configuration`, `imports`, `revenue`, `service-charges`, `receivables`, `payments`, `reports`, `audit`, `shared`.
- Keep UI display components separate from data access and financial policy. The browser must not be the authority for service-charge formulas.
- Define typed API clients from OpenAPI where practical. Avoid hand-coded copies of server types that drift.
- Use query keys that include centre scope, filters, period, and relevant status. Invalidate affected queries after posting/allocations.
- Use form validation for fast user feedback but rely on API/database validation as the authoritative control.
- For financial amounts, transport decimal values in a safe string format where precision matters, and use a decimal library for any client-side preview. Server calculation remains authoritative.
- Use route-level permission checks to improve UX, but all operations still require backend authorization.
- Use accessible dialogs, focus management, keyboard-operable data grids and non-colour status labels.

**Prisma boundary note:** Prisma's schema cannot express CHECK constraints, exclusion constraints, partial indexes, row-level security, triggers or `REVOKE` grants. These integrity controls (see `09_DATABASE_DESIGN_SCHEMA.md` and `19_RBAC_ROLE_PERMISSION_MODEL.md` §11) must live in reviewed raw-SQL migrations, and CI must include a schema-drift check so they are never lost when the Prisma schema is regenerated.

## 3. Backend architecture

Suggested NestJS modules:

```text
src/
  main.ts
  app.module.ts
  common/                 # errors, guards, logging, validation, money/date utilities
  identity-access/        # auth integration, roles, permissions, centre scope
  centres/                # centre profile lifecycle
  configuration/          # catalogues, aliases, agreements, rules, terms, templates
  imports/                # upload orchestration, staging, mapping, validation, jobs
  revenue/                # normalized revenue reports and control totals
  service-charges/        # deterministic rule selection and calculation runs
  receivables/            # ledger postings, balances, adjustments, reversals
  payments/               # receipts, allocations, returns/reversals
  statements/              # statement/invoice rendering
  reports/                 # aggregates, exports and metric definitions
  audit/                   # append-only audit events
  approvals/               # shared maker-checker approval workflow (self-approval prohibition)
  notifications/           # optional follow-up delivery
  infrastructure/          # database, storage, queue, outbox, observability
```

Within each domain, separate controller/DTOs, application services, domain rules, repositories/data access, and tests. Do not let controllers contain financial calculations. Do not let frontend pages call ORM/database directly.

## 4. API and database technical rules

- REST base path `/api/v1`; JSON for ordinary requests/responses.
- Use DTO validation and deny unknown fields on sensitive update APIs where practical.
- Use `NUMERIC` in PostgreSQL; convert monetary strings into a decimal arithmetic library such as `decimal.js` or a compatible domain money utility.
- A service-charge engine must have deterministic, pure calculation functions where possible, taking normalized values and an explicit ruleset as inputs.
- Database transactions are required for posting charge runs, recording allocations, reversing postings and committing migration batches.
- Use idempotency keys for posting/commit endpoints and background job consumers.
- Paginate list endpoints by default; exports must be asynchronous above documented size thresholds.
- Enforce timeouts, file size/row limits and rate limits at the application and/or gateway layer.
- Use database constraints for uniqueness, FK integrity and valid values; service-level validation covers rules requiring cross-row checks.

## 5. File processing requirements

- Allow `.xlsx`, `.csv`, and validated digital `.pdf` in the MVP. Accept `.xls` only if a library and representative samples are tested; prefer `.xlsx`.
- Validate content/magic bytes and MIME type, not extension alone.
- Set maximum file size, row count, sheet count, parser time, PDF page count and decompression limits based on tested workload.
- Reject macro-enabled workbooks unless explicitly supported and securely sandboxed.
- Never execute formulas, macros, embedded links or external workbook connections from uploaded files.
- Treat uploaded files and cell content as untrusted input, including formulas that could trigger spreadsheet-injection attacks on export.
- Store raw file outside the DB; store hash, size, type, uploader, timestamp, object key and processing outcome in DB.
- Parse and stage in a worker; only validated/approved data can be posted.
- Use timeouts and memory controls; large exports stream or run as jobs.
- For PDF, use text extraction only when the text/table structure is sufficiently reliable. OCR is a separate capability and must return confidence/exceptions for human validation.

## 6. Security and configuration requirements

- Use HTTPS only; secure cookies/token handling according to chosen identity architecture.
- Store secrets in a secret manager/environment injected by deployment, never in source code or frontend bundles.
- Separate development, test, staging and production identities, buckets, queues and DBs.
- Do not use production data in lower environments unless sanitized and approved.
- Implement least privilege for app roles, database roles, storage access and support access.
- Restrict export/download of financial reports and source files by role and centre scope.
- Encrypt storage and backups at rest and all network paths in transit, according to hosting capabilities.
- Define audit log access and retention before go-live.

## 7. Initial non-functional targets (validate through testing)

These are starting goals, not guarantees. Tune after testing real sample reports and anticipated history size.

| ID | Requirement | Initial target |
|---|---|---|
| NFR-001 | Standard dashboard/list API response | p95 ≤ 2 seconds for typical filtered queries at agreed test data volume, excluding long export generation. |
| NFR-002 | Import responsiveness | Upload acknowledgement quickly returns a job ID; parsing runs asynchronously. |
| NFR-003 | Bulk import size | Design for at least 50,000 normalized rows per batch as a first test target; adjust once actual history sizes are known. |
| NFR-004 | Financial integrity | No known discrepancy between ledger-derived balance and reported balance in automated invariants; exact equality to currency precision. |
| NFR-005 | Availability | Initial target 99.5% monthly, excluding planned maintenance; confirm business expectation. |
| NFR-006 | Recovery | Define RPO/RTO with business owner; initial planning suggestion RTO ≤ 8 hours and an RPO of minutes (point-in-time recovery) because this is a financial ledger; a 24-hour RPO is the absolute fallback if PITR is unavailable and must be accepted in writing by the business owner. |
| NFR-007 | Auditability | All posting, allocation, adjustment, approval, reversal and configuration-change actions produce traceable audit events. |
| NFR-008 | Accessibility | Aim for WCAG 2.2 AA for core user workflows. |
| NFR-009 | Supported browser | Current stable Chrome/Edge and current evergreen browser agreed by operations. |
| NFR-010 | Scalability | Support increasing centres, report history and rows without schema redesign; measure before adding microservices/partitioning. |

## 8. Engineering workflow

1. Inspect existing repository before adding files/modules; reuse established patterns and avoid duplicate utilities.
2. Agree architecture and data model before schema migration.
3. Implement one vertical slice at a time: centre config → import → calculation → receivable → payment allocation → reporting.
4. Add domain tests before integrating UI behavior.
5. Run format, lint, typecheck, unit, integration, authorization and end-to-end checks in CI.
6. Use database migrations with rollback/forward-repair plan; never hand-edit production schema.
7. Deploy to staging and run sample imports/migration rehearsals before production.
8. Release behind feature flags where helpful; monitor import failures and financial invariants.
