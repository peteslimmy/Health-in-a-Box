# Implementation Status and Specification Deviations

**As of:** 2026-10-27 · **Scope:** what exists in `Backend/` compared with documents 01–20. This document is the authority on *what is built*; documents 01–19 remain the authority on *what is required*. Where they differ, the difference is listed in §6 and must be closed by either changing the code or changing the requirement.

## 1. Snapshot

| Item | State |
|---|---|
| Backend | NestJS 11, TypeScript, Prisma 6, PostgreSQL 17 (Docker compose: Postgres, Redis, MinIO bucket config). Builds, typechecks and lints clean. |
| Frontend | **Built** (§10): React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router. Runs on port 5173 and proxies `/api` to the API. |
| Background jobs | BullMQ and Redis are installed/configured but **not used**. Uploaded files are read in a separate, confined child process (`file-extractor.ts`, `extract-worker.ts`) while the upload request waits for the answer; validation of the extracted rows still runs in the API. |
| Authentication | Built in-house (argon2 passwords, JWT access token 15 min, rotating refresh sessions 7 days) with authenticator-app two-step sign-in (section 5f). This deviates from the managed-OIDC recommendation in doc 10. |
| Automated tests | Backend: 371 tests in 37 suites (317 run by default, 54 need a throw-away database). Frontend: 100 tests in 13 files (see §7). A code review and security pass is recorded in `22_CODE_REVIEW_AND_SECURITY_FINDINGS.md`. |
| Demo data | `prisma/seed.ts` creates clearly marked demo users, centres, reports, charges and payments. Skipped when `NODE_ENV=production`. |

## 2. Coverage by area

| Area (spec) | Status |
|---|---|
| Auth, sessions, rate limiting, security headers (FR-AUTH-001/004) | Built. Permissions are rebuilt from the database on every request, so deactivation and role changes take effect immediately (stricter than the 5-minute limit in D-015). |
| Roles, assignments, centre scope (FR-AUTH-002/003/007/008/009) | Built in simplified form (§4). |
| Centre, department, payment-channel setup and aliases (FR-CEN) | Partly built: create/update and aliases, and a **set-up wizard that creates a whole centre from a report file (section 5g, super admin only)**. No suspend/archive workflow. |
| Agreements and charge rules (FR-CEN-007, FR-REV-002/003/004) | Built: percentage rules, effective dating, overlap blocking. **No exempt flag, no fixed-amount rules.** |
| Revenue import PDF, CSV and XLSX (FR-IMP) | Built (§5, §5a). **No versioned templates/mappings, no corrected-report workflow, no async worker.** |
| Charge runs: preview, create, recalculate, submit, approve, post (FR-REV, FR-AR-001) | Built. |
| Receivables and ledger | Built: one receivable per posted charge run (P-016); list, detail with ledger cross-check, and ageing summary. |
| Receipts, allocation and reversals (FR-AR-003 to 007) | Built: approval lifecycle, duplicate checks, locked all-or-nothing allocation, reversals. **Evidence upload is not built.** Adjustments, disputes and opening balances are built (section 5d). |
| Statements (FR-AR-011) | Built as a report: "Statement of account by centre" (opening balance, every entry, running balance, closing balance; printable). **Invoices and PDF statements are not built.** |
| Historical migration (FR-HIS) | Not built. |
| Dashboard (FR-RPT-007) | Built: headline measures, monthly trends, ageing, ranking by centre. |
| Reports and exports (FR-RPT) | Partly built: a shared report engine with 9 reports, paging, totals, CSV and Excel export, each export audited (section 5b). PDF export and the remaining reports are not built. |
| Audit trail (FR-AUD) | Events written for all built actions; `GET /audit-events` built. No approval inbox. |

## 3. Implemented API surface (prefix `/api/v1`)

| Route | Permission |
|---|---|
| `POST /auth/login`, `/auth/refresh`, `/auth/logout` (public); `GET /auth/me` (any signed-in user); `GET /health` (public) | — |
| `GET/POST /centres`, `GET/PATCH /centres/:id` | `centres.read` / `centres.create` / `centres.update` |
| `POST/PATCH /centres/:id/departments[/:departmentId]`, `POST/PATCH /centres/:id/channels[/:channelId]` | `centres.update` |
| `GET/POST /centres/:centreId/agreements`, `PATCH /agreements/:id` | `charge_rules.read` / `charge_rules.manage` |
| `GET/POST /agreements/:agreementId/charge-rules`, `PATCH /charge-rules/:id` | `charge_rules.read` / `charge_rules.manage` |
| `GET /imports`, `GET /imports/:id`, `GET /imports/template?centreId=` | `imports.read` |
| `POST /imports` (multipart upload and validation) | `imports.manage` |
| `POST /imports/:id/commit` | `imports.commit` (and caller must not be the uploader) |
| `POST /imports/:id/commit-with-variance` | `imports.approve_variance` (caller must not be the uploader; written reason of 20+ characters; section 5h) |
| `GET /charge-runs`, `GET /charge-runs/:id` | `charge_runs.read` |
| `POST /charge-runs/preview`, `POST /charge-runs`, `POST /charge-runs/:id/recalculate` | `charge_runs.create` |
| `POST /charge-runs/:id/submit-review` | `charge_runs.submit` |
| `POST /charge-runs/:id/approve` | `charge_runs.approve` (creator excluded) |
| `POST /charge-runs/:id/post` | `charge_runs.post` (creator excluded; repeat call is a no-op) |
| `GET/POST /users`, `GET/PATCH /users/:id`, `PATCH /users/:id/assignments`, `POST /users/:id/reset-password` | `users.read` / `users.manage` |
| `GET /roles`, `GET /roles/permissions`, `POST /roles`, `PATCH /roles/:id` | `roles.read` / `roles.manage` |
| `POST /centre-setup/analyse`, `GET /centre-setup`, `GET /centre-setup/:id`, `POST /centre-setup/:id/commit`, `POST /centre-setup/:id/cancel` | `centres.onboard` (SUPER_ADMIN only) and access to all centres |
| `GET/PUT/DELETE /platform/...` (settings, profile, smtp, smtp/test, branding/:kind, domains, super-admins) | `platform.manage` (SUPER_ADMIN only; section 5i) |
| `GET /branding`, `GET /branding/logo`, `GET /branding/favicon` (public) | — |
| `POST /auth/mfa/verify`, `/auth/mfa/enrol/start`, `/auth/mfa/enrol/confirm` (public; need the short-lived token from sign-in) | — |
| `POST /auth/mfa/begin`, `/auth/mfa/recovery-codes` | any signed-in user |
| `POST /users/:id/reset-mfa` | `users.manage` (and the account must not outrank the caller) |
| `GET /audit-events` | `audit.read` (limited to the caller's centres) |
| `GET /payments`, `GET /payments/unallocated`, `GET /payments/:id` | `payments.read` |
| `POST /payments` (draft receipt), `PATCH /payments/:id`, `POST /payments/:id/submit` | `payments.create` (recorder only for edit and submit) |
| `POST /payments/:id/approve`, `POST /payments/:id/reject` | `payments.approve` (recorder excluded) |
| `POST /payments/:id/post` | `payments.post` (recorder excluded) |
| `POST /payments/:id/reverse` | `payments.reverse` (recorder excluded; no active allocations) |
| `POST /payments/:id/allocation-preview`, `POST /payments/:id/allocations` (optional `Idempotency-Key`) | `payments.allocate` |
| `POST /payment-allocations/:id/reverse` | `payments.reverse` (the person who allocated is excluded) |
| `GET /receivables`, `GET /receivables/ageing`, `GET /receivables/:id` | `receivables.read` |
| `GET /dashboard/summary` (period measures, balances as at today, items awaiting action) | `dashboard.read` (limited to the caller's centres) |
| `GET /dashboard/trends?months=3..24` (monthly charges posted, receipts, reported revenue, month-end receivable balance and collection rate, Lagos time zone, from the ledger) | `dashboard.read` (limited to the caller's centres) |

Route names differ from doc 11 in places (`/channels` not `/payment-channels`, `/imports` not `/import-batches`, no separate `/revenue-reports`). No revenue-report list endpoint exists yet.

## 4. Implemented permission model (differs from doc 19)

Phase 1 uses **32 coarse permissions** and **4 system roles**, not doc 19's ~150 keys and 15 templates.

- **Wired to endpoints:** `centres.read/create/update`, `imports.read/manage/commit`, `charge_rules.read/manage`, `charge_runs.read/create/submit/approve/post`, `users.read/manage`, `roles.read/manage`, `audit.read`, `payments.read/create/approve/post/allocate/reverse`, `receivables.read`, `dashboard.read`.
- **Seeded but not yet used:** `reports.read`, `reports.void`, `receivables.manage`, `approvals.read`, `settings.read/manage`.
- **Roles:** `ADMIN` (all), `FINANCE_MANAGER` (all except `users.manage`, `roles.manage`, `settings.manage`), `FINANCE_OFFICER` (upload and validate imports, create and submit charge runs, record/allocate payments, read), `AUDITOR` (read-only).
- **Assignment scope:** one role plus either all centres or one centre per assignment (no dates, reason, grantor, or lifecycle states).

**Decision I-001 (recorded on the owner's instruction to close out open points):** this 32-permission, 4-role set is the **Phase 1 baseline**. The fuller catalogue in doc 19 §5 and the extra templates in §7 are the target for later phases and are added only together with the features they protect (payments, adjustments, migration, reports, access reviews). Keys keep the `resource.action` form so they can be split later.

Mapping to doc 19 templates: ADMIN ≈ Platform Super Admin + Access Administrator; FINANCE_MANAGER ≈ Finance Manager/Approver + Import Reviewer; FINANCE_OFFICER ≈ Report Uploader + Service-Charge Analyst + Payment Recorder + Payment Allocator; AUDITOR ≈ Auditor (Read Only). Decision to make: either grow the catalogue toward doc 19 or declare this set the Phase 1 baseline and update doc 19 accordingly.

## 5. Controls enforced in code (traceable to the requirements)

| Control | Where | Requirement |
|---|---|---|
| Scope is evaluated per assignment, never pooled across roles | `common/utils/scope.ts`, `PermissionsGuard` | doc 19 §3.2, §10 |
| Privilege ceiling: grant/assign only permissions you hold; no self-assignment or self-deactivation; built-in roles immutable | `users/role-policy.ts`, `users.service.ts` | FR-AUTH-008 |
| Auditor cannot be combined with a role that changes data | `users/role-policy.ts` | FR-AUTH-009 |
| Role changes audited with before/after permission lists | `users.service.ts` | FR-AUTH-006, FR-AUD-001 |
| Maker-checker: uploader cannot commit an import; creator cannot approve or post a charge run | `imports.service.ts`, `charge-runs.service.ts` | FR-AUTH-005 |
| Row total vs channel sum mismatch > 0.01 is an error; grand-total mismatch is an error; commit and charge run re-check | `revenue-parser.service.ts`, services | INV-001, FR-IMP-006 |
| Content-fingerprint duplicate detection (centre + period + figures), with database unique index; overlapping-period warning | `report-fingerprint.ts`, migration | FR-IMP-007, D-009 |
| ₦/NGN/$/€/£ amounts parse correctly; negatives and formulas rejected | `revenue-parser.service.ts` | doc 12 §4.3 |
| Upload safety: size, 20,000 rows, 100 columns, 20 sheets; macro, embedded-object and external-link workbooks rejected; formulas not evaluated; CSV template escapes formula characters | `imports.service.ts`, parser | doc 14 §4 |
| Rule chosen by each report's whole period; a rate change inside a report fails with "split the report"; caller's "as-of" date cannot select a rate | `charges/rule-selection.ts`, `charge-runs.service.ts` | FR-REV-004, INV-005, INV-012 |
| Precedence: department+channel > department > channel > centre default | `rule-selection.ts` | D-002 |
| Missing rule blocks the run (never zero) | `charge-runs.service.ts` | INV-004, FR-REV-007 |
| Half-up, 2 dp, once per charge line; other rounding modes rejected on rules | `charge-runs.service.ts`, `charge-config.service.ts` | D-004 |
| Posting a posted run returns it unchanged; no duplicate receivables | `charge-runs.service.ts` | INV-009 |
| Audit event written in the same transaction as the change; correlation ID stored | `audit.service.ts`, services | doc 14 §5.11 |
| Database CHECKs (amounts, rates, dates, balance = original − paid, one-sided ledger), non-overlapping active rules (exclusion constraint), append-only ledger and audit tables (triggers), restrictive foreign keys on financial tables | migration `20261027090000_integrity_hardening` | doc 09 §6, FR-AUD-003 |
| Demo seed skipped in production | `prisma/seed.ts` | doc 14 §5.12 |
| Only an `ACTIVE` centre can receive an import or have a charge run created or posted | `imports.service.ts`, `charge-runs.service.ts` | FR-CEN-009 |
| Posting day and due date use the centre's time zone (default Africa/Lagos) | `common/utils/dates.ts`, `charge-runs.service.ts` | D-006, D-016 |
| In production the API refuses to start without object storage instead of falling back to local disk | `common/services/storage.service.ts` | doc 14 §4 |
| Receipt lifecycle Draft, Submitted, Approved, Posted (or Rejected, Reversed); the recorder cannot approve, reject, post or reverse; the database also refuses an approver or poster equal to the recorder | `payments.service.ts`, migration `payments_lifecycle` | P-015, FR-AR-003 |
| Repeated receipt reference blocked (case-insensitive, database unique index); same centre, date and amount needs explicit confirmation; no future-dated receipts | `payments.service.ts` | FR-AR-004 |
| Allocation locks the receipt and then the receivables (in id order) before reading balances; all-or-nothing; cannot exceed the unallocated cash or a receivable's balance; cash cannot be allocated before posting (database check) | `payments.service.ts`, migration | FR-AR-005, INV-006, INV-007 |
| Allocation idempotency: the same `Idempotency-Key` returns the original result; reuse with a different body is refused | `payments.service.ts`, `IdempotencyKey` table | INV-009 |
| Reversal of an allocation is a compensating ledger debit; the original credit stays; the allocator cannot reverse their own allocation; a receipt with active allocations cannot be reversed | `payments.service.ts` | FR-AR-007, INV-011 |
| One receivable per posted charge run; `GET /receivables/:id` returns a ledger cross-check (derived vs stored balance); ageing buckets per D-014 | `charge-runs.service.ts`, `receivables.service.ts`, `common/utils/ageing.ts` | P-016, INV-008, D-014 |
| Refresh-token rotation keeps the previous token valid for 30 seconds (`REFRESH_GRACE_MS`), so a page reload or a lost response cannot sign the user out; logout and expiry still end the session immediately | `auth.service.ts`, migration `refresh_rotation_grace` | FR-AUTH-004 |
| Dashboard measures are separate and labelled with their date basis; only posted receipts count as cash received; every query is limited to the caller's centres | `dashboard.service.ts` | FR-RPT-001, FR-RPT-007 |
| Centre access is checked on every centre read and write; a scoped user cannot read or change another centre | `centres.service.ts`, `integration/centre-scope.integration.spec.ts` | FR-AUTH-003, R-01 |
| Administering another account requires holding all of its permissions and, for a centre-scoped administrator, its centres; scoped administrators cannot grant all-centres or out-of-scope access or create centres | `users.service.ts`, `centres.service.ts` | FR-AUTH-008, R-02, R-03 |
| Sign-in does the same work for unknown and known emails; limits of 8 per minute per account and 300 per minute per address; JWTs pinned to HS256 | `auth.service.ts`, `common/throttle.ts` | R-07 to R-09 |
| In production the API refuses to start with placeholder secrets, an insecure cookie, a localhost or wildcard web origin, local-disk storage or the development passwords; Swagger is off in production | `config/env.validation.ts`, `main.ts` | R-04, R-10 |
| Storage keys and raw uploaded rows are never returned; template filenames contain only safe characters; centre time zones are validated | `imports.service.ts`, `payments.service.ts`, `centre.dto.ts` | R-11 to R-13 |
| Production web build has a Content-Security-Policy and security headers; the post-sign-in redirect stays inside the app | `Frontend/vite.config.ts`, `Frontend/src/lib/safePath.ts` | R-15, R-16 |

## 5a. PDF reports and upload controls

Built after the first real report (University of Abuja Teaching Hospital, "Daily Collection Report", 25 Sep to 25 Oct 2026) could not be uploaded.

| Control | Behaviour |
|---|---|
| Table only | The PDF is read by text position. Titles, print date, page headings, repeated headings, page numbers and signature lines are set aside and listed on the import screen; wrapped department names are joined; reading stops at the Grand Total row. The period ("Between ... and ...") comes from the PDF; a different period typed in is rejected (`PERIOD_MISMATCH`). |
| Tally | Every department total must equal the sum of its channels; every channel total must equal the sum of its rows; the grand total must equal the sum of the department totals and of the channel totals; row numbers must run without gaps or repeats. Any failure blocks the commit and names the row. Nothing is auto-corrected. |
| Days already uploaded | Any day in a committed report for the centre blocks the upload (`PERIOD_ALREADY_UPLOADED`, listing the days). Existing reports are never changed. Checked again at commit time. Days only in another pending upload give a warning. |
| Overlapping file (only new days) | A PDF holds period totals, not daily figures, so days cannot be cut out of it directly. When every earlier committed report lies wholly inside the file's period and the remaining days form one stretch, the new days are taken as the file's totals minus the recorded totals, per department and channel, and the batch is stored for those days only (shown on the import screen). Earlier reports are untouched. If a figure would go negative (file shows less than is recorded), or an earlier report reaches outside the file's period, the upload is held with the reason. |
| Omitted days | A gap before or after the new period (for example the last report ends on 11 Oct and the new one starts on 13 Oct) is flagged with the missing days. Commit requires a written reason (10 or more characters), recorded in the audit trail. |
| Other | Future periods, reports printed before the period ended, a title that does not mention the centre, very long periods, exact duplicate files and identical figures for the same period are flagged or blocked. |
| First upload for a centre | "Add missing departments and channels" creates the departments and payment channels found in the file (centre-update permission, audited). |

Known limits: PDFs must be text-based (scanned images are rejected); the layout needs a "Revenue Department" heading row; PDF, CSV and XLSX reading runs in a confined child process (50-page limit, 30-second kill, 512 MB heap cap; see section 5e); the PDF library is the older `pdf-parse` 1.1.1.

## 5b. Report engine and first reports

One typed registry (`Backend/src/reports`) holds every report: its filters, the date it is based on, the permissions its data needs, its columns and its query. A new report is a query and a column list, not a new screen.

| Item | Behaviour |
|---|---|
| Endpoints | `GET /reports` (reports the caller may run), `GET /reports/:id` (paged rows, totals row, notes), `GET /reports/:id/export?format=csv or xlsx`. |
| Permissions | `reports.read` to view; `reports.export` (new, held by Administrator, Finance Manager and Auditor) to download. A report also needs the permissions of the data it reads (for example `payments.read`), and the centre scope is the intersection of all of them. A missing permission gives `REPORT_NOT_PERMITTED`; a centre outside scope gives 404. |
| Audit | Every export writes a `REPORT_EXPORTED` event (who, report, filters, format, row count) before any data is returned; if the audit write fails, no file is returned. |
| Safety | Formula-looking text is prefixed in CSV and Excel; Excel amounts wider than 15 digits stay text; files start with a byte-order mark; responses are not cached; a report over 20,000 rows must be narrowed (`REPORT_TOO_LARGE`). Filters a report does not declare are ignored and not echoed. |
| Honesty | Each report states its date basis; receipt and charge reports default to posted items and say so; the comparison report notes that receipts in a period are not payments against that period's charges; revenue reports state they are not verified against patient records or bank deposits. |
| Reports built | Report submission status (added with slice B), Receivables ageing, Outstanding receivables, Receivables ledger, Payment receipt register, Payment allocation report, Unallocated receipts, Department and channel matrix, Expected service charges, Centre performance comparison. Screens: Reports (catalogue) and a viewer with filters, totals and export buttons. |
| Checked live | Ledger debits less credits equal the outstanding balance on the dashboard; charge and receipt totals equal the dashboard figures; the officer role can view but not export. |

## 5c. Dashboard slice B: collection rate, late centres, drill-down, linked filters

Built on decisions D-201 to D-206 (`20_DECISION_SHEET.md` section G).

| Item | Behaviour |
|---|---|
| Rename | The old "Collection rate" chart is now "Cash received vs charges posted" and its note says it is not a collection rate. |
| True collection rate (D-204) | `GET /dashboard/collection`: of the receivables that fell due in each month, the share settled within N days after the due date (default 30, adjustable 7 to 120 on the chart). Allocations count by their Lagos calendar date; reversed allocations do not. A month shows a final rate only once N days have passed after it ends; "settled so far" is always shown and labelled. The window is a per-view choice; a saved organisation-wide setting waits for the system configuration module. |
| Late centres (D-203) | `GET /dashboard/reporting-status` and the report "Report submission status": an active centre is late when no committed report or upload awaiting commit ends within the last 7 days, or it has never reported. The dashboard lists late centres with days since the last report. |
| Drill-down | Every headline figure links to the report holding its records, carrying the dashboard's centre and period (only when the user may run that report). Clicking a month on a chart offers "Focus the dashboard on this month" and, where one exists, the matching report. Reports open already filtered from the address. |
| Linked filters | Centre, period, trend window and on-time window live in the address, so a view can be shared and refreshed. Clicking a centre in "Outstanding by centre" focuses every figure and chart on it; a "Showing" bar with Clear filters appears when filtered. |
| Not done | Day, week, quarter and year switch for trends (D-202: only single-day reports could fill a daily view); department and channel composition charts; per-centre reporting frequency (one 7-day rule applies to every centre). |

## 5c-1. Dashboard money flow (requested 2026-10-28)

The top of the dashboard is four tiles in order, for the selected centre and period: **1 Reported revenue** (what the centres made), **2 Expected service charge** (what is due to you), **3 Payments received** (what they have paid you) and **4 Still owing = 2 minus 3** (`measures.owedForPeriod`, exact decimals, with `percentPaid`). When more was paid than charged in the period the fourth tile reads "Paid ahead" in green, because receipts in a period can settle earlier periods' charges. A progress bar shows the share of the due amount paid. The ledger-based **Open ledger balance** (open receivables as at today, which also reflects allocations, adjustments and opening balances) is kept in the row below with overdue, unallocated receipts, payments allocated and charges posted, so the two views of "outstanding" can be reconciled. Quick period buttons (This month, Last month, Last 3 months, This year, All time) set the dates. Not built: a per-centre version of the four tiles on one screen (the Centre comparison report lists them side by side).

## 5d. Adjustments, disputes, opening balances, My work, insights, more reports

Built from the gap analysis (`24_MODULE_REPORT_AND_INSIGHT_GAP_ANALYSIS.md`).

| Area | Behaviour |
|---|---|
| Money model | A receivable now owes `originalAmount + adjustmentTotal - amountPaid`; the database enforces it (`Receivable_balance_consistent`, `Receivable_paid_bounds`). Ledger debits less credits still equals the balance. |
| Adjustments | `/adjustments`: a credit (reduces) or debit (increases) with a reason category and written explanation. Maker-checker: another person approves, which posts the ledger entry; the database also forbids approver = proposer. A credit may not exceed the balance (that would be a refund). Two credits approved at once cannot overdraw (row lock, tested). |
| Disputes | `/disputes`: a centre's challenge to part of a balance; the receivable is flagged DISPUTED while one dispute is open (one open per receivable, enforced by an index). Resolving as upheld can propose a credit, which still needs approval. |
| Opening balances | `/opening-balances`: what a centre owed before the platform; approved into one receivable with an OPENING_BALANCE ledger entry. Blocked when the as-at date is on or after the first posted charge period (no double counting) or in the future; one per centre and date. |
| Permissions | `adjustments.read/create/approve`, `disputes.read/manage` (migration grants them to the system roles). |
| My work | `GET /work-queue` (any signed-in user): what that person may act on, most urgent first: commits, approvals, posts, adjustments, disputes, old unallocated cash, late reports, receivables over 90 days overdue. Never offers items the person prepared. Count shown beside "My work". In-app only: no email or scheduled alerts. |
| Insights | `GET /dashboard/insights`: deterministic rules (revenue moves of 20% down or 25% up, yield moves of a point, 50%+ of a centre's debt overdue, one centre above 50% of revenue, late reporting, old unallocated cash, repeated failed uploads, disputes open over 30 days). Each insight names the periods compared, shows its figures and links to the records. No forecasting or language model. Thresholds are constants in `insight-rules.ts`. |
| Reports | 25 reports in total (section 5b). Added: statement of account, overdue receivables, partial payments and settlement history, collection delay and payment-terms compliance, credit/debit/reversal register, approvals and pending actions, department and channel analysis, revenue concentration, committed reports register, submission register, import errors, revenue variance, departmental earnings and yield, commercial configuration and rule history, user access. The report viewer has a Print button. |
| Other | The original uploaded file can be downloaded from an import (audited). The dashboard shows department and channel revenue shares for the selected period. |
| Not built | Exempt flag and fixed-amount charge rules; import column-mapping templates; historical migration batches; PDF export and invoices; forecasting; scheduled reports and email alerts; organisation settings (collection window, reporting frequency per centre, financial-period close); an approved-variance exception path (now built, section 5h); receipt evidence upload screen. |

## 5e. Isolated file reading

| Item | Behaviour |
|---|---|
| What is isolated | The step that opens an untrusted file: the PDF reader, the CSV reader and the XLSX reader. Only plain rows (and, for a PDF, its title, period and set-aside text) come back as JSON. Matching to departments and channels, tally checks and everything that touches the database stay in the API. |
| Confinement | A new Node process per file, started with a 512 MB heap cap and killed after 30 seconds or if it returns more than 64 MB. Node's permission model denies file writes, child processes and workers and allows reading only the application folder. The process gets only `PATH` and system variables, so no database URL or signing secret. At most two files are read at once; others queue. |
| Failure | A crash, timeout or out-of-memory ends only that process; the upload is refused with `IMPORT_PARSE_FAILED` and a readable reason. |
| Tests | `file-extractor.spec.ts` starts real processes: CSV reading, limit messages, bad PDF, parallel reads, and proofs that the confined process cannot write, spawn, read outside the folder or see secrets, and that a runaway allocation ends only the child. The real University of Abuja PDF was read through it (47 rows, 25 Sep to 25 Oct). |
| Limits | If the Node version lacks the permission model, the heap cap, timeout and clean environment still apply, but not the file and process restrictions. Reading is still synchronous with the upload request; a queue and status polling (BullMQ) remain the longer-term design. |

## 5f. Two-step sign-in (TOTP)

| Item | Behaviour |
|---|---|
| Who | `MFA_ENFORCEMENT` = `privileged` (default in production), `all`, or `off` (default in development; refused in production). Privileged means holding any of: `users.manage`, `roles.manage`, `settings.manage`, `charge_rules.manage`, `charge_runs.approve`, `charge_runs.post`, `payments.approve`, `payments.post`, `payments.reverse`, `adjustments.approve`, `imports.commit`, `reports.void` (`mfa-policy.ts`). Anyone who has enrolled is always asked, whatever the setting. |
| Sign-in | A correct password returns no session for these people. It returns a 5-minute challenge token (type `mfa`, useless as an access or refresh token) and the next step: enter a code, or enrol first. The session, refresh cookie and last-sign-in time are created only after the second step succeeds. |
| Enrolment | The person gets a key to type into any authenticator app (also an `otpauth://` link for use on the phone; there is no QR image, to avoid a new dependency). The first correct code activates it and returns 8 single-use recovery codes, shown once, stored only as argon2 hashes. The app is not entered until the person ticks that the codes are saved. Signed-in people can add it voluntarily from **My sign-in security** (password required). |
| Codes | RFC 6238: HMAC-SHA1, 6 digits, 30 seconds, one step of clock drift either side (tested against the RFC vectors). A time step can be used once: it is claimed with a conditional database update, so replaying a code, or two simultaneous requests with one code, fail. |
| Guessing | 5 wrong codes in a row lock the second step of that account for 5 minutes (even for the right code), audited as `MFA_LOCKED`; the normal per-address limits also apply. |
| Secrets | Authenticator secrets are stored encrypted (AES-256-GCM) with `MFA_ENCRYPTION_KEY`; a copy of the database alone cannot produce codes. Production refuses to start without a separate key of 32+ characters, or with enforcement off. In development the key is derived from the refresh secret. |
| Tightening later | If someone gains a privileged role, or the policy is made stricter, their next token refresh (within 15 minutes) is refused and the session revoked until they sign in again and enrol. |
| Lost phone | Recovery codes work once each. **Reset 2-step** on the Users screen (needs `users.manage`; blocked for accounts that hold permissions the administrator lacks) removes the factor and codes and ends all sessions. Events: `MFA_ENROLLED`, `MFA_RECOVERY_CODE_USED`, `MFA_RECOVERY_CODES_REGENERATED`, `MFA_LOCKED`, `USER_MFA_RESET`. |
| Tests | 40 new backend tests (RFC vectors, window and replay, encryption, policy, enrolment, lock-out, recovery codes, concurrent use of one code, token separation, refresh refusal, administrator reset, production configuration) and 5 frontend tests for the sign-in steps. |
| Verified (2026-10-27) | Migration applied to the dev database (schema and migrations agree). All 37 suites, 371 tests, pass against a real database. In a browser and over HTTP: first sign-in of an approver goes to set-up, a wrong first code is refused, the right one shows the recovery codes and the app opens only after they are acknowledged; the next sign-in asks for a code; a recovery code works once (lower case accepted); a replayed code, a used recovery code, a junk token and a challenge token used as an access token are refused; repeated wrong codes lock the account even for the right code; an administrator reset puts the person back to set-up and writes `USER_MFA_RESET`; the audit trail shows every MFA event. Found and fixed: starting set-up twice generated two keys (React runs effects twice in development), so the key on screen could differ from the one checked; starting set-up now shows the stored key. Not tried with a real authenticator app (codes were computed with the same code library, which matches the published test values) or on a phone. |
| Not built | QR image; disabling the factor by the user; per-device trust ("remember this browser"); alerts on lock-out or recovery-code use; phishing-resistant factors. |

## 5g. Centre set-up wizard (super admin only)

Screen: **Centres > Set up from a report** (`/centres/setup`). Backend: `Backend/src/centre-setup`.

| Item | Behaviour |
|---|---|
| Who | New permission `centres.onboard`, held **only by the `SUPER_ADMIN` role** (the migration grants it to that role alone; `ADMIN` and Finance Manager are explicitly excluded in the reference data). The routes also need access to all centres. It is counted as a privileged permission for two-step sign-in. |
| What it reads | PDF, CSV or XLSX, through the same confined reader as imports (nothing is parsed inside the API). From a PDF: the centre name (the report title), a centre number if the heading prints one ("Centre No", "Facility Code" and similar), the period, **the date and time the report was produced at the source** (`printedAt`, new), the departments with their totals, the payment-channel columns with their totals and whether any amounts appear, and the text that was set aside. The University of Abuja report reads as 45 departments, 8 channels (only eWALLET has amounts), period 25 Sep to 25 Oct 2026, printed 26 Oct 2026 6:14 pm, suggested code UATH. The report carries no centre number, so a code is suggested from the initials of the name. |
| Totals | The importer's own tally rules are run on what was read. A report that does not tally can still be used to set the centre up, but the wizard says so, names the rows, and the report cannot be imported until it is corrected. |
| Steps | 1 Upload (or continue an unfinished set-up); 2 What was found; 3 Centre details (code, name, address, time zone, payment terms, grace); 4 Departments (rename, recode, exclude, tidy capitalisation, filter); 5 Payment channels (same, with a note on channels that have no amounts); 6 Service charge (optional: agreement name, one percentage, start date, applied as a centre-default rule); 7 Review, with options to activate the centre and import the report now. Each step blocks on problems (bad or repeated codes, repeated names, a missing rate). |
| Drafts | Reading a file stores it and the findings as an open `CentreSetupDraft`, so a set-up can be resumed or discarded, and the original file can be imported afterwards. Nothing else is created until the final step. |
| Creating | One database transaction creates the centre, departments, channels, the name printed on the report as an alias wherever it differs from the chosen name (so the next report matches), and the agreement and rule. All or nothing (tested with a forced failure part-way). Audited as `CENTRE_SETUP_STARTED`, `CENTRE_CREATED` (with the code lists and rate) and `CENTRE_SETUP_CANCELLED`. A centre with the same code or name is refused. Activation needs terms. Importing needs activation, runs through the normal import path (so it is held for a second person to commit) and a failed import never undoes the centre. |
| Tests | 33 backend tests (profile, time parsing, permission, gate, commit rules), 4 against a real database, 7 frontend tests. Checked live: an Administrator receives 403 on every route; the super admin reads the real report and the wizard shows the findings. |
| Not built | Reading a centre number from a column rather than the heading; copying terms from an existing centre; a per-department rate in the wizard (add exceptions on the centre page); adding departments to an existing centre through the wizard (use the import option "add missing departments and channels"). Uploading a file from the wizard was exercised through the API and the unit tests, not by clicking the file chooser. |

## 5h. Approved variance (committing a held report whose totals do not add up)

Built on 2026-10-28 for reports such as the three first uploads (UATH, OAUTHC, FMC), which were held because their printed totals do not tally. This is the "approved-variance exception path" that earlier listed as not built.

| Item | Behaviour |
|---|---|
| Who | New permission `imports.approve_variance`, held by `ADMIN` and `SUPER_ADMIN` only (Finance Manager does not have it by default; give it through a custom role if wanted). It is a privileged permission for two-step sign-in. The uploader can never approve their own report (maker-checker), so a second account is needed. |
| What can be approved | Only differences between the printed totals and the figures beneath them: row total vs channel sum, column totals, grand total, cross-footing, and missing row numbers. Anything else still blocks and must be fixed by a corrected report: unreadable or negative amounts, unknown or repeated departments, missing channel columns, days already uploaded, a report printed before its period ended. |
| Written reason | At least 20 characters, stored on the report and in the audit trail; if the report also skips days, the existing omitted-days reason is still required. The approver must tick that charges will be calculated on the channel amounts. |
| How the report is stored | The report's figures (`grandTotal`, `channelTotal`) are the **sum of the channel amounts**, i.e. what the department rows evidence. Each line keeps the printed total and the difference. `RevenueReport` records the approver, time, reason and a summary (`varianceJson`: printed total, evidenced total, difference, the rows that differ, finding counts, the messages accepted). The database refuses a half-recorded approval (constraint `RevenueReport_variance_complete`). |
| Charging | A report with approved variance is charged on its channel amounts, never on the printed totals (a charge run on an ordinary report still refuses any line whose totals disagree). For a department charged as one amount, the base is the channel sum. |
| Where it shows | The import page (a warning banner with approver, date, reason and the amounts, and a form to approve for eligible reports), the dashboard (a chip on "What the centres made": n with approved differences), the Committed revenue reports register (new "Approved variance" column), the Revenue variance report (rows that differ), and the audit trail (`IMPORT_COMMITTED_WITH_VARIANCE`). |
| Tests | 11 rules tests, 7 service tests, 3 charge tests, 7 frontend tests, and 5 against a real database (commit, charge on channel amounts, the constraint, a blocking problem, the uploader refused). Checked live: the uploader is refused with a clear message and the page shows who must approve. |
| Not built | Per-row approval or editing of figures; a limit on the size of the difference; an alert when approvals are used often; un-approving a report (corrections are adjustments). |

## 5i. Platform settings and email access rules (super admin only)

Screen: **Control > Platform settings** (`/admin/platform`). Backend: `Backend/src/platform` and `Backend/src/access`.

| Item | Behaviour |
|---|---|
| Who | New permission `platform.manage`, held only by `SUPER_ADMIN` (not `ADMIN`, not Finance Manager). It is a privileged permission for two-step sign-in. |
| Who may sign in, by email | **Gmail (gmail.com, googlemail.com) is blocked for everyone except registered super admins.** A super admin must be registered with a Gmail address. Everyone else needs an email at an **approved domain**. The rule is checked when an account is created or its email or roles change, at sign-in, at every token refresh and on **every request**, so removing or switching off a domain, or any change to the rules, ends access at once (including for people already signed in), not at their next sign-in. The approved list is cached for 15 seconds at most and cleared on the instance that changes it. Exact domains only: sub-domains and look-alikes are not approved. With an empty list, only super admins can sign in. |
| Approved domains window | Add, switch off or on, and remove domains, with a note and the number of active accounts at each. Removing warns how many people lose access. Gmail cannot be added (refused by the API and by a database constraint, as is a non-lower-case name). A card lists accounts the rules currently block, with the reason. Audited: `DOMAIN_APPROVED`, `DOMAIN_ENABLED`, `DOMAIN_DISABLED`, `DOMAIN_REMOVED`. |
| Super admins window | Lists registered super admins and registers another (Gmail only, role applies to all centres). The last active super admin cannot be deactivated. |
| Email (SMTP) window | Provider presets (SendGrid, Mailgun, Brevo, Postmark, Amazon SES, Gmail/Workspace, Microsoft 365) that fill the server and port; host, port, encryption (STARTTLS or SSL/TLS; mail is never sent unencrypted), user, password or API key, from name and address, reply-to. The password is stored encrypted (AES-256-GCM, key derived from `MFA_ENCRYPTION_KEY`, separately from the sign-in secrets), is never returned by the API (only whether one exists) and is never written to the audit trail. Leaving it blank keeps the saved one. The server must be a public address (localhost, private, link-local and IPv6 literal addresses are refused) and the port one of 25, 465, 587, 2525. **Send test email** sends a real message and records whether the server accepted it and why not. Nothing in the application sends email yet; this is the ready, tested channel for alerts and notices. Uses `nodemailer` 10.2.1. |
| Profile and branding window | Product name, tagline, support email; logo (PNG, JPEG or WebP up to 1 MB) and favicon (PNG or ICO up to 256 KB). Files are checked from their first bytes, **SVG is refused** (it can carry script), and images are stored in the database. A public endpoint serves the name and images so the sign-in page can use them (with `nosniff` and a sandboxing policy). The name appears in the sign-in page, the menu and the browser tab; the logo in the sign-in card and the menu; the favicon in the tab. |
| Tests | 11 rule tests for who may sign in, 14 for the domain list and images, 39 for the platform service and rules, 6 for account creation and role changes, 3 for sign-in, 11 frontend tests, and 5 against a real database (the Gmail constraint, the policy following the list, images stored byte for byte, the encrypted password). Checked live: Gmail refused on the list, a Gmail address refused for an Administrator, an unapproved domain refused, an Administrator refused on every platform route, access ended on removing the domain and restored on re-approving it, the password absent from every response, and the public branding served. |
| Not built | Sending any email from the application (alerts, password reset, invitations); a per-user invitation flow; sub-domain wildcards; a dark-mode logo; per-centre branding. In-memory caching means a second API instance sees a domain change within 15 seconds. |

## 6. Deviations from the specification (to be resolved)

| # | Built | Specified | Suggested resolution |
|---|---|---|---|
| 1 | **Resolved.** New postings create one receivable per charge run (P-016). The 60 per-line receivables already in the demo database stay as legacy items and work with allocation | P-016 | Done and tested. |
| 2 | **Partly mitigated.** `Receivable.balance/amountPaid/status` are still stored, but the database enforces balance = original − paid, the ledger is append-only, and `GET /receivables/:id` exposes a derived-vs-stored cross-check (tested after allocation and reversal). The ledger keeps `debit`/`credit` columns and links to a receivable, not to a ledger debit | Balance derived from immutable ledger; `direction` + `amount`; `applies_to_entry_id` | Add a scheduled reconciliation job; revisit the ledger shape when adjustments are built. |
| 3 | **Resolved.** `Payment.status` is now Draft, Submitted, Approved, Posted, Rejected or Reversed; allocation state is derived from `unallocatedAmount`. Existing demo receipts became Posted | P-015 | Done (migration `payments_lifecycle`). |
| 4 | **Resolved.** The unique constraint was removed; re-allocating after a reversal works and is tested | FR-AR-007 | Done. |
| 5 | Import status enum `DRAFT…COMMITTED`, one `ImportBatch` row with JSON rows | Doc 12 state list, staging rows table, mapping/template versions | Introduce staging tables and templates with the async worker. |
| 6 | Import commit creates the `RevenueReport` and marks it committed (single reviewer step) | `revenue_reports.post` permission and optional review | Keep; rename the permission or add `revenue_reports.post` later. |
| 7 | **Resolved.** Posting day and due date use the centre's time zone (default Africa/Lagos); receivable references use the local month | D-016 | Done; covered by `charge-runs.service.spec.ts` and `dates.spec.ts`. |
| 8 | Departments and channels are per-centre rows | Optional catalogues with canonical codes (doc 09) | Add catalogues with bulk setup. |
| 9 | **Decided (I-003); MFA built (5f).** In-house authentication is accepted for the MVP and internal pilot. Authenticator-app two-step sign-in now covers privileged roles; a managed OIDC provider remains optional | Managed OIDC (doc 10) | Add to the Phase 5 production-readiness checklist. |
| 10 | Single `ChargeRule.basis = PERCENTAGE`; no exempt/fixed amount | Exempt vs 0%, `EXPLICIT_AMOUNT` (doc 09) | Add when a contract requires it. |
| 11 | **Resolved.** Uploading a revenue report, creating a charge run and posting a charge run all require the centre to be `ACTIVE` (`CENTRE_NOT_ACTIVE`) | FR-CEN-009 | Done and tested. Note: a centre must now be activated (status `ACTIVE`) before it can be imported to or charged. |
| 12 | **Decided (I-002).** Commit and post are idempotent by state (a repeat returns the original result); the `IdempotencyKey` table stays unused until an endpoint needs client-supplied keys (payments, allocations) | Idempotency keys on commit endpoints (doc 11) | Use `Idempotency-Key` for the payment and allocation endpoints when they are built. |
| 13 | **Library resolved; isolation built (5e).** `xlsx` upgraded from 0.18.5 to the vendor's patched 0.20.3 (installed from cdn.sheetjs.com on the owner's approval; `package.json` and the lockfile pin the tarball URL and integrity hash). Limits, file checks and no formula evaluation remain. | Hardened parsing in isolated worker | Parsing is now in a confined child process; a BullMQ queue can follow with the staging-table work. Because the dependency is a URL, dependency scanners and Dependabot will not track it; re-check the vendor site for new releases. |
| 14 | The frontend uses small custom accessible components and plain controlled forms with server-side validation, and hand-written API types | Doc 10 recommends shadcn/Radix, React Hook Form + Zod, TanStack Table, Recharts and a generated OpenAPI client | Acceptable for MVP; adopt a generated API client first, since it removes the risk of types drifting from the API. |
| 15 | The dashboard shows balances as at today only; period flows use the stated period | Doc 16 allows an arbitrary as-at date for balances | Needs a ledger-based as-at query; ageing already accepts an `asAt` date. |

## 7. Automated tests (`Backend/src/**/*.spec.ts`)

135 tests in 14 suites; 110 run by default. Invariants covered: INV-001, INV-002, INV-003, INV-004, INV-005, INV-006 (receipt = allocated + unallocated), INV-007 (no over-allocation, including parallel requests against one receipt and one receivable on a real database), INV-008 (ledger debits equal the run total, and stored balances equal ledger-derived balances after allocation and reversal), INV-009 (repeat commit, post and allocation), INV-011 (reversal keeps and links the original), INV-012, plus scope pairing, privilege ceiling, role conflicts, maker-checker, receipt lifecycle, duplicate detection, ageing buckets, upload safety and the ₦ parser regression. The two database suites (`integration/db-constraints.spec.ts`, `integration/payments.integration.spec.ts`) need a throw-away database:

```bash
TEST_DATABASE_URL="postgresql://USER:PASS@HOST:PORT/hnb_scratch?schema=public" npm test
```

They must run one suite at a time (`npm test -- --runInBand`): in parallel they share one database and interfere with each other. They are skipped when `TEST_DATABASE_URL` is unset and refuse databases whose name lacks "test" or "scratch". As a check that the concurrency tests are meaningful, removing the row locks from `allocate` makes both parallel-allocation tests fail. Not yet covered: INV-010 (needs historical migration), the HTTP-level authorization matrix, and end-to-end flows.

**Frontend tests (Vitest and Testing Library, `Frontend/src/**/*.test.*`, 72 tests):** money and date formatting (no floating point, including a 16-digit amount), exact decimal arithmetic for allocation checks, the API client (bearer token, one shared token refresh for concurrent 401s, retry once, session-lost signal, no refresh loop on a failed sign-in), the sign-in form, same-app-only redirect targets, idempotency keys on plain-HTTP origins, navigation filtered by permission, and the payment page: approve/reject/post/allocate/reverse buttons appear only for the right user, status and permission, never for the person who recorded the receipt, and the allocation dialog blocks over-allocation of the cash or of a receivable, and sends only filled amounts with an Idempotency-Key. Run with `npm test` in `Frontend`.

## 8. Environment steps

**Already done on the development database (2026-10-27):** migrations `20261027090000_integrity_hardening` and `20261027120000_payments_lifecycle` were each rehearsed on a copy of the dev database (3 centres, 60 receivables, 93 ledger entries) and then applied to it; the seed was re-run, so the new permissions (`imports.commit`, `payments.approve`, `payments.post`, `payments.reverse`) are granted to `ADMIN` and `FINANCE_MANAGER`. The Prisma client was regenerated, the API rebuilt and restarted, and a read-only smoke test of the payments and receivables endpoints passed.

**Also done:** `xlsx` 0.20.3 installed (see deviation 13).

**Running the app:** from the repository root, `npm run dev` starts the API (port 4000) and the web app (port 5173) together; open `http://localhost:5173`. In the desktop app, `.claude/launch.json` defines `api` and `web` entries. The dev database has migrations through `20261027150000_refresh_rotation_grace` and the demo seed. Demo sign-ins (local development only): `admin@`, `manager@`, `officer@` and `auditor@hnb.local`; the password is printed by `npm run seed` (default in `prisma/seed.ts`, overridable with `SEED_DEMO_PASSWORD`). To run the two database test suites, create a throw-away database (name containing "test" or "scratch"), apply the migrations to it, and run `npm test` in `Backend` with `TEST_DATABASE_URL` set.

Note: centres you created yourself in `DRAFT` status can no longer be imported to or charged until you set them to `ACTIVE`.

## 9. Recommended next steps

1. **Remaining money features:** manual adjustments (debit and credit, with approval), disputes and follow-up notes, opening balances, receipt evidence upload, and statements. Then the historical migration slice (INV-010).
2. Frontend gaps (§10): screens for the remaining money features once built, bulk setup grids for departments and channels, import column-mapping templates, CSV/PDF export, receipt edit and evidence upload, and a generated API client.
3. Add staging tables, mapping templates and the BullMQ worker,.
4. Add the shared approval workflow for privileged access changes, and the remaining doc 19 permissions as features arrive.
5. Collect the business inputs listed in `20_DECISION_SHEET.md` §F (agreements and rates, sample reports, payment-term wording, a reconciled legacy balance workbook) and obtain the finance-owner signature before live posting.

## 10. Frontend (`Frontend/`)

| Area | What is there |
|---|---|
| Sign-in and session | Sign-in form; the session is restored on every page load from the httpOnly refresh cookie; the access token is kept only in memory; an expired token is refreshed once and the request retried; a lost session returns to sign-in and then back to the page requested. |
| Navigation | Sidebar filtered by permission; skip-to-content link; centre scope shown in the top bar. Hiding a link is a convenience only; the API enforces every permission and centre. |
| Dashboard | Period measures (reported revenue, expected service charge, charges posted, payments received, payments allocated) and balances as at today (outstanding, overdue, unallocated receipts), each with its stated basis; items awaiting action linking to filtered lists; ageing table per centre. |
| Centres | List with search and status filter; create; detail with activation readiness checklist and activate/suspend, departments and payment channels with report aliases, agreements and charge rules (with the precedence note). |
| Revenue imports | List; upload with client-side file checks and a per-centre template download; detail showing blocking errors and warnings by row, parsed department rows with variance, and commit (hidden from the uploader with an explanation). |
| Service charges | List; new run with preview (rule, rate and amount per line, warnings) before creating a draft; detail with recalculate, submit, approve and post offered only to permitted people other than the creator; link to the receivable created. |
| Receivables | List with centre, status, as-at, open-only and overdue-only filters and ageing badges; detail with ledger, allocations and the ledger cross-check banner. |
| Payments | List and unallocated-cash worklist; record receipt with duplicate-reference and possible-duplicate handling; detail with approval progress, approve/reject/post/reverse, and the allocation dialog (oldest-first suggestion, live over-allocation checks, Idempotency-Key per dialog); reverse an allocation with a reason. |
| Audit trail | Filters by centre, date, action and record type; before/after detail and reference per event. |
| Administration | Users (create, roles per centre, deactivate, reset password) and roles (view, create a custom role from permissions you hold). |

Accessibility basics are in place (labelled fields, status shown by text as well as colour, keyboard-operable dialogs closing on Escape, table captions). Not built: dark mode, saved filters, CSV/PDF export, mobile-optimised tables beyond horizontal scroll, and screens for features that do not exist yet (adjustments, disputes, opening balances, statements, historical migration). No browser end-to-end suite exists yet; the live path was exercised by hand (sign-in, dashboard, payments, receivables, centres, imports, charge runs, audit, and rapid page reloads).