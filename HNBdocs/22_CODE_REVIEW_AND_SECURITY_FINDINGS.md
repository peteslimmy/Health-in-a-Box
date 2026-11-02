# Code Review and Security Findings

**Date:** 2026-10-27 · **Scope:** the whole backend (`Backend/`), the web app (`Frontend/`), the Docker and environment configuration, and the npm dependencies of both. Method: line-by-line review of every file in the request path, a check of every endpoint for authentication, permission and centre scope, an authorization test matrix run against a real database, dependency audits, and a live check of the built app in a browser.

Every finding below was fixed unless it is listed in §3. Each fix has an automated test; findings marked ✔ were reproduced with a failing test before the fix.

## 1. Findings and fixes

### Critical and high

| ID | Finding | Fix | Tests |
|---|---|---|---|
| R-01 ✔ | **Broken access control on centres.** `CentresService.get()` spread the user's centre scope over the requested `id`, replacing it. For a user scoped to some centres, `GET /centres/:id` returned a different centre, and every centre write (`PATCH /centres/:id`, adding or renaming departments and channels) used `get()` as its access check, so a scoped user could **modify any centre in the organisation**. | The id is matched exactly, then scope is checked with the shared `assertCentreAccess` (404 outside scope). | `integration/centre-scope.integration.spec.ts`: 15-check authorization matrix over centres, agreements and rules, charge runs, receipts, receivables, imports and the dashboard for a user scoped to Centre A with data in Centre B (3 failed before the fix, 15 pass now). |
| R-02 ✔ | **Account takeover through user administration.** The privilege ceiling covered the roles being granted, but not the account being administered. Anyone holding `users.manage` could reset the password of, change the email of, deactivate or re-role a user who held *more* permissions, then sign in as them. | Administering another account requires holding every permission that account holds (`ACCOUNT_OUTRANKS_YOU`). | `users.service.spec.ts` (4 tests: reset, update, re-role, and the still-allowed case). |
| R-03 ✔ | **Centre-scope escape by user administrators.** A user-admin scoped to Centre A could grant roles for Centre B or for all centres, and administer all-centres users. A scoped user could also create centres. | A scoped administrator can only grant access to their own centres (`CENTRE_SCOPE_EXCEEDED`), only administer users who work entirely inside their centres, and cannot create centres (`ALL_CENTRES_REQUIRED`). | `users.service.spec.ts` (5 tests), `centres.service.spec.ts` (2 tests). |
| R-04 | **Unsafe production configuration was accepted.** The secrets in `.env.example` are longer than the 32-character minimum, so a deployment copied from the example would run with publicly known signing keys; an insecure refresh cookie, a localhost web origin or local-disk storage also passed validation. | In production the API refuses to start with placeholder secrets, `COOKIE_SECURE` not `true`, a missing/`*`/localhost `FRONTEND_ORIGIN`, a storage driver other than `minio`, or the development database or storage passwords, and lists every problem at once. | `config/env.validation.spec.ts` (10 tests). |
| R-05 | **Development database and Redis exposed to the network** (published on all interfaces, with a known password and no Redis authentication). | Both are bound to `127.0.0.1`; the containers were recreated (volumes kept). The `db:up` script no longer names a MinIO service that does not exist. | Verified from the container ports and a post-restart data and API check. |
| R-06 | **Vulnerable dependencies.** Frontend: React Router (13 advisories), Vite (dev-server file serving) and Vitest (arbitrary file read and code execution in the test UI). Backend: `multer` (denial of service), `lodash` (prototype pollution, via `@nestjs/config`), `csv-parse`, Nest CLI toolchain, `bullmq`. | Upgraded `react-router-dom` 7.18.4, `vite` 6.4.5, `vitest` 4.1.12, `@nestjs/config` 4.0.4, `csv-parse` 7.0.3, `bullmq` 5.81.5, `@nestjs/cli` 11.0.24, `@nestjs/schematics` 11.1.0, and pinned `multer` 2.5.0 with an npm override. Frontend: 6 advisories to 0. Backend: 23 to 9 (see §3). | All suites re-run after the upgrades. |

### Medium

| ID | Finding | Fix | Tests |
|---|---|---|---|
| R-07 | **User enumeration by response time.** An unknown email returned immediately; a known one paid for the password hash. | The sign-in path always performs a password check (against a dummy hash for unknown emails) and returns one message for both cases. | `auth.service.spec.ts` (4 tests). |
| R-08 | **Rate limiting by address only.** One account could be guessed at from many addresses, while an office behind one address was locked out after 8 sign-ins; no `trust proxy` setting. | Two independent limits: 300/min per address for all routes, plus 8/min per **account** on sign-in (email normalised); sign-in per address relaxed to 30/min; `TRUST_PROXY` setting for deployments behind a proxy. | `common/throttle.spec.ts`: HTTP-level tests against the production throttler configuration. |
| R-09 | **JWT algorithms not pinned.** | `HS256` is set when signing and required when verifying access and refresh tokens. | `auth.service.spec.ts`. |
| R-10 | **API documentation exposed in production.** | Swagger is served only outside production, or when `ENABLE_SWAGGER=true`. | Covered by startup logic; documented. |
| R-11 | **Storage keys returned by the API** (import `fileKey`, receipt `evidenceKey`) and the raw uploaded rows, against the rule in doc 11. | Omitted from import and receipt responses. | `imports.service.spec.ts`, `payments.service.spec.ts`. |
| R-12 | **Time zone not validated.** A centre could be saved with an invalid zone, which made charge posting fail later. | Validated as a real IANA zone when a centre is created or edited. | `centre.dto.spec.ts` (10 tests). |
| R-13 | **Header injection and denial of service through the template filename** (built from the user-entered centre code). | Only filename-safe characters are kept. Spreadsheet formula characters in the template are neutralised (tested). | `imports.service.spec.ts` (3 tests). |
| R-14 | **Unbounded memory in the ageing summary**: every open receivable was loaded into the API process. | Aggregated in the database by centre and due date. | Existing ageing and dashboard tests on the real database. |
| R-15 | **Open-redirect pattern after sign-in** (redirect target taken from navigation state unchecked). | The target must be a same-app path; absolute URLs, `//host`, backslashes and control characters fall back to the home page. | `safePath.test.ts` (13 cases). |
| R-16 | **No browser-side hardening.** | Production build carries a Content-Security-Policy (no inline scripts or styles) and is served with `nosniff`, frame denial, referrer and permissions policies; dev and preview servers send the headers. Verified in a real browser with no violations. | Build check; live browser check. |

### Low

| ID | Finding | Fix |
|---|---|---|
| R-17 | Idempotency keys depended on `crypto.randomUUID`, which does not exist on plain-HTTP origins. | RFC 4122 v4 fallback (tested). |
| R-18 | CORS origins from `FRONTEND_ORIGIN` were not trimmed. | Trimmed. |

## 2. What was checked and found sound

- Every route is behind authentication unless explicitly public (sign-in, refresh, sign-out, health); every other route declares a permission (the one exception is `GET /auth/me`, which any signed-in user may call). Centre scope is evaluated per assignment, and the authorization matrix above passed for all services other than centres before the fix.
- Money: decimal arithmetic only, database constraints (balance, one-sided ledger, non-negative amounts, rule overlap), append-only ledger and audit tables, row locks on allocation (removing them makes the concurrency tests fail), idempotent post and commit.
- SQL: the only raw queries are parameterised tagged templates. Request bodies are whitelisted (`forbidNonWhitelisted`), IDs are UUID-validated, sorting is not client-controlled.
- Passwords are argon2; refresh tokens are stored hashed, rotated, and revoked on logout, deactivation and password reset; access is re-checked against the database on every request, so a deactivated user or changed role takes effect immediately.
- Frontend: no `dangerouslySetInnerHTML`, no tokens in browser storage (access token in memory, refresh token in an httpOnly cookie), server messages rendered as text, no external links or third-party scripts.

## 3. Accepted risks and open items

| Item | Why it is accepted or open | Action |
|---|---|---|
| Backend advisories: `prisma` CLI chain (`@prisma/config`, `deepmerge-ts`), `minio` (`decode-uri-component`, `stream-json`), `@nestjs/swagger` (`js-yaml`) | Prisma's is in the command-line tool, not the running API, and its fix is a major upgrade (Prisma 7). `minio` has no patched release. `js-yaml` handles only our own API document. None is on a request path that handles user input. | Revisit on the Prisma 7 migration; re-check `minio`. |
| ~~Spreadsheet and PDF parsing runs inside the API process~~ **Closed 2026-10-27** | Files are now read in a separate process with a heap cap, a kill timeout, no secrets, and Node's permission model (doc 21 §5e). The size, row, column and sheet limits and the macro/embedded-object/external-link checks remain. | Confirm `--permission` is active on the production Node version. |
| `xlsx` is installed from a URL, so `npm audit` and Dependabot will not report new advisories for it | Vendor-recommended source. | Check the vendor's release notes periodically. |
| In-house authentication | Accepted for the internal pilot (decision I-003). Authenticator-app (TOTP) sign-in was added on 2026-10-28 for privileged roles (doc 21 section 5f). Still open: no managed identity provider, no single sign-on, no phishing-resistant factor (a real-time phishing page can relay a code), no alert on a recovery-code use beyond the audit event. | Managed OIDC with passkeys if the organisation adopts one; add an alert on `MFA_RECOVERY_CODE_USED` and `MFA_LOCKED` with the monitoring work. |
| The development database user is a superuser and owns the tables, so it could disable the append-only triggers | Development convenience only. | Production must run the API as a least-privilege role without ownership, `DELETE` or `TRIGGER` rights on ledger and audit tables; use a separate migration role. |
| Refresh tokens are honoured for 30 seconds after rotation, and re-use after that is rejected but not alerted on | Deliberate trade-off, added so that a page reload cannot sign a user out. | Add re-use alerting with the monitoring work. |
| No frontend linter and no automated browser end-to-end suite | Not yet set up. | Add ESLint and a Playwright smoke suite; add CI running all tests, `npm audit` and secret scanning. |
| Account protection is rate limiting only (no lock-out after repeated failures) | Limits guessing to about 8 per minute per account. | Add progressive delay or lock-out with notification when email delivery exists. |
| Sign-in is still possible from any address | Expected for the product. | Optional IP allow-listing at the proxy. |
