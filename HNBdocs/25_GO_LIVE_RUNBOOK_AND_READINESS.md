# Go-Live Runbook and Readiness

**Date:** 2026-10-28 · How to run the platform for real, and an honest list of what must be true before it holds real financial records. Nothing here is a compliance claim.

## 1. What goes live

| Piece | How it runs |
|---|---|
| Web app | `Frontend/Dockerfile`: static files behind nginx on `127.0.0.1:8080`; nginx forwards `/api` to the API and sets security headers. |
| API | `Backend/Dockerfile` (target `runtime`): non-root, health check on `/api/v1/health`, connects as the least-privilege database role `hnb_app`. |
| Database | PostgreSQL 17, owner role `hnb_owner` (migrations only), application role `hnb_app` (no schema change, no delete or update on ledger and audit tables, enforced by `ops/db-roles.sql`). |
| Files | MinIO private bucket. The API refuses to start in production with local-disk storage. |
| Not included | TLS. Put Caddy, nginx or a cloud load balancer in front of `127.0.0.1:8080`; the API refuses insecure cookies in production. |

`docker-compose.prod.yml` starts them in order: database, migration job, role grants, API, web. Redis is not needed (nothing uses it yet).

## 2. First deployment

1. Install Docker on the server; point a DNS name at it and set up TLS in front of port 8080.
2. `cp .env.production.example .env.production` and fill every value. Secrets: `openssl rand -base64 48`. `FRONTEND_ORIGIN` is the exact public `https://` address.
3. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`. The API will not start if any secret is a placeholder, the JWT secrets are equal, cookies are not secure, the origin is local, or storage is local disk.
4. Create the first administrator (no demo data is ever created here):

   `BOOTSTRAP_ORG_NAME="..." BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_NAME="..." BOOTSTRAP_ADMIN_PASSWORD='...' docker compose -f docker-compose.prod.yml --env-file .env.production --profile setup run --rm bootstrap`

   The password needs 12+ characters; sign in and change it, then create the other accounts and centres from the screens.
5. Check `https://<your address>/api/v1/health` returns `"status":"ok"` with the database up.
6. Keep `MFA_ENCRYPTION_KEY` safe and separate from the database backup (a password manager or the host's secret store): without it every person must set up their authenticator again, and with it a stolen database backup could be used to generate codes.
6a. Schedule `ops/backup.sh` nightly, copy `./backups` off the server, and back up the `hnb_minio_data` volume the same way.
7. Run `ops/restore-check.sh <latest dump>` once now and monthly: the last line of output must show 0 receivables disagreeing with the ledger.

## 3. Updating and rolling back

- Update: pull the new code, take a backup, `docker compose ... up -d --build`. Migrations run before the API starts and only move forward.
- A failed migration leaves the old API running until fixed; do not edit the database by hand. Roll back by restoring the pre-update backup into a fresh database (`pg_restore`) and starting the previous code version. There are no down-migrations; the posted ledger is never rewritten, so corrections are always new entries.
- Never run `prisma migrate reset` or the demo seed against a real database.

## 4. Watching it

- Uptime: point any external monitor at `/api/v1/health` (it also reports the database). Alert on two failures in a row.
- Logs: `docker compose logs api` carries a correlation id on every error; the same id is shown to the user as the support reference and stored in the audit trail.
- Who can sign in: the super admin keeps the **Approved domains** list in **Platform settings**. Gmail is blocked for everyone except registered super admins; after go-live, approve only the domains your people really use, and review the list when staff leave. Outgoing email (SMTP) is set up in the same place; a test email confirms it works.
- Lost phone: an administrator opens **Users**, chooses **Reset 2-step** for that person after confirming who they are, and the person sets up the app again at their next sign-in. The reset is audited (`USER_MFA_RESET`). An administrator cannot reset anyone who holds permissions they lack, and the last administrator who loses their phone and recovery codes needs a database-level reset (set `mfaEnabled=false` and clear the secret for that user, with a second person present, and record why).
- Weekly: the **My work** screen, the late-reporting list, and the dashboard insight "unallocated cash".
- There is no built-in email, SMS or scheduled report yet; alerts reach people only when they open the app.

## 5. Readiness: what is done and what is not

### Done and checked
Access control per centre with a tested authorization matrix; maker-checker on imports, charge runs, receipts, allocations, adjustments and opening balances (also enforced by the database); append-only ledger and audit trail (triggers and, with `ops/db-roles.sql`, privileges); concurrency-safe allocation and adjustment; exact decimal money; PDF, CSV and XLSX import with tally, overlap, gap and new-days controls; production start-up refuses unsafe configuration; Content-Security-Policy and security headers; rate limits per address and per account; 25 reports with audited export; dashboard, insights and work queue; backups with a restore check; CI definition (`.github/workflows/ci.yml`) running every suite including the database ones.

### Must be settled before real records are entered (blockers)
| # | Item | Why it blocks | Owner |
|---|---|---|---|
| 1 | **Verify each centre's charge rules against its signed agreement** (items marked ⚠ in `20_DECISION_SHEET.md`: eligible revenue, calculation level, rounding, due dates, gross vs net) | The platform calculates exactly what is configured; a wrong rule produces wrong receivables | Finance owner |
| 2 | **User acceptance with the accountant on real files**, including the University of Abuja report: resolve the ₦106,500 gap in its totals | Real layouts are the only true test; the sample report currently fails its own tally | Finance owner and the centre |
| 3 | ~~Multi-factor sign-in for administrators and approvers~~ **Built 2026-10-28** | Authenticator-app (TOTP) sign-in, required in production for anyone who can administer users or roles, approve, post, reverse or commit money (doc 21 section 5f). Before the first deployment: set `MFA_ENCRYPTION_KEY` (the API refuses to start without it), apply migration `20261028150000_mfa_totp`, and confirm the first administrator is walked through set-up at first sign-in. Exercised against the development database and in a browser (doc 21 section 5f); not yet tried with a real phone app. Network restriction is still sensible for the pilot | Done; IT to verify on deploy |
| 4 | ~~Isolated parsing of uploaded PDFs and workbooks~~ **Built 2026-10-27** | PDFs, CSV and XLSX are now read in a separate operating-system process (512 MB heap cap, 30-second kill, no application secrets, Node permission model: no file writes, no child processes, read access to the application folder only; two files at a time). A hostile file can only crash or stall that process. Remaining: confirm on the production image that `--permission` is active (Node 22.13 or later), and keep upload permission narrow until the pilot has run | Done; IT to confirm on deploy |
| 5 | **TLS, hosting, DNS, off-site backups and one completed restore drill** | The platform cannot protect data that travels or sits unprotected | IT |
| 6 | **A data cut-over plan**: which opening balances (approved, one per centre, dated before the first platform charge), which months are loaded as reports, and a reconciliation to the accountant's control workbook for sample periods | Prevents double counting and unexplained opening figures | Finance owner |
| 7 | **Load and failure test with realistic volume** | Performance has only been seen on demo-sized data | Build or IT |

### Known gaps that do not block a pilot but should be planned
Import column-mapping templates and bulk historical migration (history can be entered as dated reports and opening balances); fixed-amount charge rules; PDF export and invoices; forecasting; scheduled reports and email alerts; organisation-level settings (collection window, per-centre reporting frequency, period close); ~~an approved-variance exception path for reports whose totals do not tally~~ (built, doc 21 section 5h); receipt evidence upload screen; Prisma command-line advisories and the PDF library version (see `22_CODE_REVIEW_AND_SECURITY_FINDINGS.md`); an independent penetration test.

### Recommended order
Pilot with one centre: settle items 1, 2, 5 and 6, restrict access (item 3) by network, run a month in parallel with the accountant's workbook, then add centres as items 3, 4 and 7 are completed.
