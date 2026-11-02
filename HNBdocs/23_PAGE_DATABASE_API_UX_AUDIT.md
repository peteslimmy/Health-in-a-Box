# Page, Database, API, UX and Operations Audit (read-only)

**Date:** 2026-10-27 · Builds on `22_CODE_REVIEW_AND_SECURITY_FINDINGS.md` (security items already fixed there are not repeated). The audit itself changed no code. Afterwards F-01, F-02 and F-03 were fixed (see §1); the other findings remain open.

## 0. What was actually done

| Area | Status | Evidence |
|---|---|---|
| Endpoint inventory | Done from source | 58 routes in 9 controllers; 55 permission declarations plus 7 public/self routes (see §3) |
| Unauthenticated API probes (live) | Done | 8 protected routes returned 401; unknown route 404; health 200; foreign `Origin` got no CORS allow header; security headers present |
| Authenticated role-by-role API testing | Covered by existing suites only, not re-run live | `centre-scope.integration.spec.ts` (15-check matrix) needs a scratch DB; not re-run in this audit |
| Test suites | Run | Backend 161 passed, 40 skipped (3 DB suites need `TEST_DATABASE_URL`); frontend 58 passed |
| Frontend build and audit | Run | Build OK, 358 kB JS (107 kB gzip), 20 kB CSS; `npm audit` 0 vulnerabilities |
| Database integrity (dev DB, read-only SQL) | Done | 0 receivables whose balance differs from their ledger, 0 negative balances, 0 orphan allocations, 0 users without a role assignment |
| Query plans / performance | **Not meaningful** | Dev DB has 60 receivables; a plan on 27 rows shows a sequential scan and says nothing about scale. No load test was run. |
| Interactive UI walk-through of every control | **Not done in this audit** (done earlier for sign-in, dashboard, payments, receivables, audit). Findings in §2 come from source review plus one reproduced test. |
| Accessibility | Source review only. No automated scanner, no screen-reader test, no contrast measurement. |
| Backups, monitoring, CI, deployment | None exist in the repository (see §6) |
| Row-level security | Not used. Isolation is enforced in the application, not by the database. |

## 1. Defects found

| ID | Severity | Finding | Evidence | Recommended fix |
|---|---|---|---|---|
| F-01 | **High (usability, blocks data entry) — FIXED** | **Dialogs lose keyboard focus after each typed character** wherever the form state lives in the page that opens the dialog: Add department/channel, Add charge rule, Add agreement (`CentreDetailPage`), New role (`RolesPage`), Add user, Roles, Reset password (`UsersPage`). `Modal` re-runs its focus effect whenever `onClose` changes identity, and those pages pass a new arrow function on every render, so each keystroke re-focuses the dialog box. | Reproduced with a temporary test: typing "abc" left the field containing "a". Payment dialogs are unaffected because their state is inside the dialog component. | In `Modal`, keep `onClose` in a ref and run the focus effect once on mount. Add a regression test typing several characters. |
| F-02 | Medium — FIXED (focus trap added; the discard warning is not done) | **Modal is not a real modal for keyboard users.** `aria-modal="true"` is set but there is no focus trap and the page behind is not inert, so Tab leaves the dialog and screen readers can still reach the background. Clicking the backdrop does nothing (acceptable) and Escape closes even with unsaved input (no discard warning). | `components/ui.tsx` Modal, lines 275-306 | Trap focus (or use the native `<dialog>` with `showModal()`); confirm before discarding a half-filled form. |
| F-03 | Medium — FIXED (`RequirePermission` on every page route) | **No route-level permission guard in the web app.** Any signed-in user can open `/admin/users`, `/admin/roles`, `/audit`, `/charge-runs/new` by URL; the page renders and then shows the server's 403. Data is safe (the API enforces permissions) but users see half-built screens and the navigation hides links inconsistently with the routes. | `App.tsx` only has `RequireAuth` | Wrap routes with a `RequirePermission` that shows a "not allowed" page. |
| F-04 | Low | List endpoints accept unbounded arrays: `reportIds` in the charge-run DTO, and the role/assignment/department arrays in the user and centre DTOs have no `ArrayMaxSize` (payments allocations are capped at 50). Bounded in practice by the request body size limit. | `charge-run.dto.ts:34`, `user.dto.ts`, `centre.dto.ts` | Add `@ArrayMaxSize` and a UUID check per element. |
| F-05 | Low | Health endpoint reports only the database; Redis and object storage are not checked, and process uptime is public. | live `GET /health` | Split into liveness (public, minimal) and readiness (authenticated or internal) that checks every dependency. |
| F-06 | Low | The app ships as one 358 kB script with no route-level code splitting. Fine for an internal tool on a fast network; will matter for centre staff on slow links. | build output | Lazy-load the admin, audit and charge-run routes. |
| F-07 | Low | Several lookups have no `take` (user role lists, permission list, rule lookups for a calculation period, centre list in the ageing summary). All are bounded by business size today (roles, permissions, one centre's rules), not by a limit. | scan of `findMany` calls without `take` | Acceptable now; revisit if a centre can have thousands of rules. |
| F-08 | Info | Unused component: `Spinner` is exported but only used inside `Button`/`Loading`; no page imports it directly. No other unused UI component was found. | usage scan | None needed. |

## 2. Pages and routes

All 21 routes resolve (17 pages plus login, not-found and the index dashboard). Direct URLs, refresh and deep links work because the session is restored from the refresh cookie before rendering (verified live earlier, including rapid reloads). Unknown paths show a not-found page. Loading, error and empty states exist in the shared components (`Loading`, `ErrorNotice`, `EmptyState`) and are used on every list and detail page. Server data is cached for 15 seconds with no refetch on window focus, so two staff looking at the same receivable can see data up to 15 seconds old; money-changing actions invalidate the affected queries.

Not built (documented in doc 21): adjustments, disputes, opening balances, statements, exports and print, bulk setup grids, import mapping UI, receipt editing/evidence upload UI. Nothing in the interface simulates these; they are absent, not faked.

## 3. API surface (58 routes)

| Module | Routes | Notes |
|---|---|---|
| Auth | login, refresh, logout (public); me | Rate limits 30/min per address plus 8/min per account on login |
| Centres | list, get, create, update, departments (add/update), channels (add/update) | Scope checked on every id (fixed in R-01) |
| Agreements and rules | list/create/update agreements; list/create/update charge rules | Overlap prevented by a database constraint |
| Imports | list, template, get, upload, commit | Maker-checker on commit; duplicate reports rejected by fingerprint |
| Charge runs | list, preview, create, get, recalculate, submit-review, approve, post | Maker-checker on post; idempotent post |
| Receivables | list, ageing, get | Read only |
| Payments | list, unallocated, get, create, update, submit, approve, reject, post, reverse, allocation-preview, allocations; reverse allocation | `Idempotency-Key` on allocate, row locks, request-hash check |
| Users and roles | users CRUD-style (6), roles (4) | Ceiling and outranking checks |
| Audit, dashboard, health | one each | Audit read requires its own permission |

No duplicate or orphan endpoints were found; every frontend call maps to an existing route. No route is unexpectedly public. Status codes: 401 unauthenticated, 403 missing permission, 404 out of scope or unknown, 409 for conflicts/duplicates, 422 for business-rule failures; error bodies carry a code, message and correlation id.

**Integrations:** the only external dependencies are PostgreSQL, Redis (declared, not yet used for jobs) and object storage (MinIO in production, local disk in development). There are no webhooks, email or third-party APIs, so request signing, replay prevention and retry policies are not applicable yet. MinIO behaviour was **not** verified against a real MinIO server in this audit (development uses the disk fallback).

## 4. Database

- **Schema:** 26 tables with foreign keys, unique constraints and CHECK constraints for money rules; append-only triggers on ledger and audit tables; decimal columns for all money. Indexes cover the main filters (organisation + centre + status/date).
- **Gaps:** no index on `PaymentAllocation(paymentId, reversedAt)` for the over-allocation sum (only single-column indexes exist; fine at current size); `Payment.reference` is indexed but duplicate detection also uses amount and date, so a composite index would help at scale. Both are scalability risks, not measured defects.
- **Integrity checks:** all clean on the dev DB (see §0). Soft-delete is not used; records are deactivated or reversed, never deleted.
- **Transactions:** posting, allocation, reversal, commit and audit writes are in single transactions; concurrency tests (which fail without the row locks) cover double allocation.
- **Row-level security:** none. The API connects as a single owner role, so a bug in the application layer would not be stopped by the database (accepted risk in doc 22; production needs a least-privilege role).
- **Migrations:** five ordered migrations, rehearsed on a copy of the dev DB. Rollback scripts do not exist (forward-fix only); a restore from backup is the only recovery path, and no backup procedure exists yet.

## 5. Security areas

Inspected and tested: see doc 22 (authentication, authorization matrix, validation, headers, CORS, rate limits, dependencies). In this audit additionally probed live: unauthenticated access to eight routes, CORS with a foreign origin, response headers, malformed JSON. **Left unverified:** active exploitation of file upload (hostile workbooks), load/DoS behaviour, session behaviour under a real reverse proxy, and TLS (no TLS terminator exists in the repository).

## 6. Operations and delivery (verified absent)

- No CI pipeline, no automated quality gates, no secret scanning in the repository.
- No backup or restore procedure, no monitoring or alerting, no log shipping. Logs go to the console with correlation ids.
- No Dockerfile for the API or web app; only the dev `docker-compose.yml` for PostgreSQL and Redis.
- No release versioning or rollback runbook.
- Configuration is validated at start-up in production (see doc 22 R-04).

## 7. Test-suite quality

Strengths: invariant tests on the real database (constraints, concurrency, authorization matrix), pure-function tests for money, ageing, dates and rule selection, mutation-style check that removing row locks fails the concurrency tests. Weaknesses: 40 tests are skipped unless a scratch database is configured, so a plain `npm test` does not exercise the database invariants; no browser end-to-end tests; no accessibility tests; no migration tests on a populated database; no load tests; service unit tests use mocked Prisma, so they prove logic, not queries. F-01 was invisible to the existing suite because no test types more than one character into a page-owned dialog form.

## 8. Recommended order

1. F-01 (small change in one component, plus regression test), then F-03 and F-02.
2. CI with the three DB suites running against a service container, `npm audit` and secret scanning.
3. Backup/restore procedure and a least-privilege database role before any production data.
4. Worker-based import parsing, then MFA/managed sign-in (doc 22 §3).
5. Load test with a realistic dataset (for example 50 centres, 12 months of reports) before judging query performance; add the indexes in §4 only if plans show a need.
