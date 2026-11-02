# Roadmap & Release Plan

**Approach:** Deliver in vertical slices with financial correctness and data migration proof before adding advanced analytics. Dates and sprint lengths are intentionally omitted until team size, existing codebase and representative data are known.

**Current status (2026-10-27, see `21_IMPLEMENTATION_STATUS.md`):** Phase 1 is largely built in the backend (authentication, simplified RBAC with centre scope, audit, centres, departments, channels, agreements and charge rules) but bulk setup, centre activation checks and the Role Builder are not. Phase 2 is partly built (CSV/XLSX import, validation, duplicate detection, charge calculation and approval/posting with maker-checker); PDF, mapping templates and the async worker are not. Phase 3 is largely built in the API (receipt approval lifecycle, duplicate checks, allocation, reversals, receivables list and ageing); adjustments, disputes, opening balances and statements are not. Phase 4 (historical migration, dashboard, reports) are not started. A web app covering sign-in, dashboard, centres, imports, charge runs, receivables, payments, audit and administration is built. Backend integrity controls and 319 backend plus 95 frontend automated tests are in place, and a full code review and security pass has been completed (`22_CODE_REVIEW_AND_SECURITY_FINDINGS.md`). Pre-production gates recorded in `21_IMPLEMENTATION_STATUS.md`: managed OIDC and MFA for privileged roles (I-003), patched spreadsheet library with parsing in a worker, and the business inputs in `20_DECISION_SHEET.md` §F.

## Phase 0 — Business discovery and source-data proof

### Work
- Collect sample Excel/CSV/PDF reports from each materially different centre layout.
- Obtain commercial agreements/rates and worked examples.
- Resolve P0 decisions in the business-rule register.
- Identify report date/period conventions, multiple reports per day and historical migration cutoff.
- Obtain a verified opening-balance or historical ledger workbook for at least one centre.
- Define role/approval matrix and operational ownership; RBAC-OD-01 to 06, P-013 to P-016 and D-001 to D-016 are confirmed (accepted defaults); remaining work is to verify the ⚠ items against each centre's agreement and collect the inputs in `20_DECISION_SHEET.md` §F.

### Exit criteria
- Finance owner signs off charge examples and rounding.
- Source layouts are inventoried and mapped to import capabilities.
- Historical migration mode and control totals are agreed for the pilot centre.

## Phase 1 — Foundation and centre setup

### Work
- Repository/project foundation, CI, environments, database migrations and authentication.
- RBAC per `19_RBAC_ROLE_PERMISSION_MODEL.md`: permission catalogue seeding, seed role templates, Role Builder, centre-scoped assignments, role-conflict rules, shared maker-checker approval workflow, access review, audit service and organization/centre model.
- Centre lifecycle wizard.
- Bulk department and payment-channel creation, reuse, aliases and validation.
- Agreements, effective-dated charge rules and payment terms.

### Exit criteria
- Role, centre-scope, maker-checker, privilege-ceiling and role-conflict tests pass.
- Centre can be created, configured and activated without duplicate departments/channels.
- Rate rules can be versioned and ambiguities are blocked.

## Phase 2 — Import and calculation vertical slice

### Work
- Import batch/file storage and background jobs.
- Excel/CSV parser and template mapping.
- PDF text extraction for supported files, with explicit manual-review fallback.
- Staging preview, row/grand-total checks, duplicate detection and exception resolution.
- Deterministic charge calculation preview and calculation lineage.
- Review/posting workflow and financial ledger entries.

### Exit criteria
- Representative sample reports from pilot centre pass expected validation/calculation tests.
- A known mismatch is flagged without auto-correction.
- Posting is atomic, traceable and idempotent.

## Phase 3 — Payments, allocations and receivables

### Work
- Record actual service-charge receipts.
- Duplicate receipt warning/block logic.
- Allocation model for partial and multi-obligation payments.
- Unallocated receipt worklist.
- Due-date and ageing logic.
- Adjustment, dispute, reversal and audit flows.

### Exit criteria
- Partial payments, one payment across periods, unallocated receipt, overpayment and reversal scenarios pass invariant tests.
- Receivable statement reconciles to ledger entries.

## Phase 4 — Historical migration and management reporting

### Work
- Typed historical import templates and dry-run mode.
- Opening balance and full transaction migration controls.
- Legacy/source-to-import reconciliation and approval sign-off.
- Executive dashboard, centre drill-down, ageing, charge details, payment register and exports.

### Exit criteria
- Pilot migration balances reconcile exactly to signed-off control totals within approved monetary tolerance (ideally zero variance).
- Dashboard, statement, receivables list and exports agree for the same scope.

## Phase 5 — Production readiness and rollout

### Work
- Security and authorization review, vulnerability/dependency checks.
- Performance tests with representative maximum import volume.
- Restore drill, monitoring and alerting, incident/runbook documentation.
- UAT, staff training, data migration rehearsal and sign-off.
- Controlled centre-by-centre rollout.

### Exit criteria
- All MVP acceptance criteria in `15_TEST_STRATEGY_ACCEPTANCE_CRITERIA.md` pass.
- No open P0 defects or unresolved P0 business decisions.
- Backup/restore and support ownership have been demonstrated.

## Phase 6 — Enhancements (prioritize from evidence)

- Scheduled notifications and reminders.
- Invoice generation and delivery, subject to finance/contract confirmation.
- Bank statement import and match suggestions.
- More automated PDF/OCR handling after sample-quality assessment.
- Additional integrations, richer analytics and AI insight summaries.
- External centre portal or independent-organization SaaS only if product strategy changes.

## Key dependencies

- Database design depends on final financial rule and allocation semantics.
- Import template configuration depends on real source files.
- Overdue reporting depends on payment-term and due-date decisions.
- Historical migration depends on quality of old report/rate/payment records and a signed-off cutoff.
- Invoice feature depends on finance policy and agreement requirements.

## Delivery guardrails

- Do not implement all modules in one giant branch/change.
- Work in vertical slices with code review and automated tests.
- Every database migration has a reviewed deployment/rollback or forward-repair approach.
- Keep an implementation checklist mapping each FR requirement to code paths and tests.
- Revisit the roadmap based on observed import errors, unresolved exceptions and actual usage—not speculative complexity.
