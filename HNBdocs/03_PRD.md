# Product Requirements Document (PRD)

**Version:** Draft 0.1  
**Product:** HNB-Receivables Management Platform  
**Build status:** see `21_IMPLEMENTATION_STATUS.md`. The backend covers authentication, centres, charge rules, revenue import, charge runs, receipts, allocation, receivables, a dashboard summary and the audit trail, and a web app covers all of those; adjustments, disputes, opening balances, statements, historical migration, exports and PDF import are not built.

## 1. Product goal

Deliver a secure internal platform that converts differently formatted centre revenue reports into validated, traceable service-charge calculations and a reconciled receivables position, with bulk historical migration and management analytics.

## 2. Target users

- **Super Admin / Business Owner:** manages centres, commercial configurations, users and high-risk approvals.
- **Finance Manager / Reviewer:** reviews report imports, calculations, disputed balances, adjustments and reports.
- **Accountant:** uploads reports, resolves mapping errors, records payments, allocates receipts, creates statements and follows up on balances.
- **Read-only Management User:** views dashboards and reports within permitted centre scope.

Role assignments and permissions must be configurable through a permission matrix, not embedded only in UI components.

The four profiles above are **user personas**, not the permission model. The authoritative role and permission model is `19_RBAC_ROLE_PERMISSION_MODEL.md`, which defines granular permissions and 15 seed role templates. Persona mapping:

| Persona (this document) | Seed role templates in doc 19 (may be combined per user, subject to role-conflict rules) |
|---|---|
| Super Admin / Business Owner | Platform Super Admin / Business Owner; optionally Access Administrator |
| Finance Manager / Reviewer | Finance Manager / Approver; Import Reviewer / Revenue Poster |
| Accountant | Report Uploader; Service-Charge Analyst; Payment Recorder; Payment Allocator; Receivables Officer (a given accountant receives only the templates their duties require) |
| Read-only Management User | Executive / Management Viewer; Reporting Analyst |
| Auditor (reviewer of controls) | Auditor (Read Only) |
| Migration staff | Historical Migration Specialist |
| Infrastructure support | System Operator / Technical Support |

Where other documents use "Accountant", "Reviewer" or "Finance Manager", read them as the persona; the enforceable rights come from the role templates and permission keys in doc 19.

## 3. Product principles

- The UI must make the source and formula behind every amount inspectable.
- Financial entities have explicit lifecycle states.
- Different centre layouts are supported by reusable template/mapping configuration.
- Large imports run as asynchronous jobs with visible progress.
- An operator should be able to correct a rejected file without restarting unrelated work.
- Data-entry errors should be caught near the point of entry.
- Finance controls must be enforced by the backend/database boundary, not only by frontend validation.

## 4. MVP capabilities

### P0 — Required for first production release

1. Authentication, internal user management and role-based access control, including custom role creation, permission assignment, centre-scoped role assignment, access review and **segregation-of-duties (maker-checker) enforcement** for sensitive actions, as specified in `19_RBAC_ROLE_PERMISSION_MODEL.md`.
2. Centre onboarding and edit/inactivation controls.
3. Bulk creation/import/reuse of departments and payment channels in onboarding.
4. Effective-dated centre agreements and charge rules.
5. Report template creation and centre-specific source-column mapping.
6. Excel/CSV import, supported digital PDF extraction, import preview and validation.
7. Revenue data normalization and channel/department mapping.
8. Deterministic expected service-charge calculation with explanation.
9. Controlled review and posting to receivables.
10. Receipt entry for payments the operator receives from centres, with a record → submit → approve → post lifecycle where maker-checker applies.
11. Payment allocation to one or multiple outstanding obligations, partial allocation and unallocated receipt handling.
12. Receivables ledger, due dates, ageing, statements and reconciliation statuses.
13. Historical bulk import, batch-level validation, duplicate handling and reconciliation checks.
14. Approval/audit history, adjustments and reversals.
15. Executive dashboard, centre drill-down and standard exports.
16. Backups, monitoring, automated tests and deployment controls.

### P1 — Valuable after core workflow is stable

- Email notifications/reminders and scheduled overdue reports.
- Invoice generation if approved by finance policy.
- More advanced saved report layouts and reusable bulk column mappings.
- Configurable monetary approval thresholds (action-based segregation of duties is already P0; only amount-based thresholds are P1 — see RBAC-OD-05).
- Bank statement import and semi-automated receipt matching, if the business has reliable source statements.

### P2 — Optional future capability

- External centre portal.
- Direct HIMS/payment gateway integrations.
- OCR for scanned PDFs at scale.
- Predictive collection forecasting or AI-assisted anomaly detection.
- Multi-organisation SaaS subscription, billing and tenant administration.

## 5. Key product workflows

### 5.1 Create a centre

Create centre → add basic metadata → bulk add/import/reuse departments → bulk add/import/reuse payment channels → map aliases → configure commercial rules and effective dates → configure reporting and settlement terms → review validation → save draft or activate. Activation must be blocked when mandatory configuration is missing or contradictory.

### 5.2 Import a revenue report

Select centre and reporting date/period → upload file → identify template → map fields → preview normalized rows → resolve errors/warnings → validate channel totals and report totals → calculate service-charge preview → submit for required review → post. A duplicate or corrected report must follow a distinct controlled path.

### 5.3 Record and allocate receipt

Record actual receipt details → check duplicate reference and amount/date patterns → save receipt as Draft → submit → independent approval where maker-checker applies → post as received → select eligible receivables for allocation → enter allocation amounts → validate allocation sum does not exceed available receipt or receivable balance → approve/commit allocation → refresh balances and audit trail.

### 5.4 Historical migration

Choose migration type and cutoff → load files/templates → map centre/department/channel → run dry-run → review errors/duplicates/control totals → reconcile source totals → approve batch → commit idempotently → compare imported summary to source control totals → save signed-off migration report.

## 6. UX requirements

- Desktop-first responsive layout suitable for finance staff working with grids and wide financial tables.
- Centre switcher and global centre/date filters that remain consistent across dashboard and reports.
- Data grids with sticky headers, totals, column controls, row-level drill-down and keyboard support.
- Clear separation between drafts, validation issues, posted records and read-only history.
- Use explicit labels like “Reported Revenue”, “Expected Service Charge”, “Payments Received”, “Allocated Payments”, “Outstanding”, “Not Yet Due” and “Overdue”. Do not use one ambiguous “Revenue” or “Paid” number for different measures.
- Warnings must state the issue, impacted rows/amount and corrective action.
- Never display fake sample financial values as if they were live values.

## 7. Analytics requirements

The dashboard should provide total reported revenue, expected charges calculated, posted receivables, payments received, payments allocated, outstanding receivables, overdue receivables, unallocated receipts and unresolved import/reconciliation exceptions. Metrics must have a period definition and drill-down path. The dashboard must distinguish charges earned/posted in a period from cash received in a period and amounts collected against obligations due in a period.

## 8. Non-functional product expectations

- Financial calculations are deterministic, testable and auditable.
- Imports are resilient to retry and can recover from transient job failures.
- Source files are private and access-controlled.
- The app gives useful feedback when a file does not match the expected template.
- List views support filtering, sorting, pagination and export within permission scope.
- All API endpoints enforce authorization even if called outside the UI.
- Backups and restore exercises are part of release readiness.

## 9. Product assumptions and open decisions

See `07_BUSINESS_RULES_AND_DECISIONS.md`. The decisions previously open (rate precedence, eligible revenue definition, rounding, earned/posted dates, due-date policy, advance/unallocated receipts, acceptable digital PDF, migration strategy) are resolved by the accepted defaults in `07_BUSINESS_RULES_AND_DECISIONS.md` §2b. Items marked ⚠ there must be verified against each centre's actual agreement, and the business inputs listed in `20_DECISION_SHEET.md` §F are still required before live posting.

## 10. Release success criteria

The MVP is ready when representative centre reports can be uploaded, normalized, validated, calculated, approved and posted; receipts can be allocated across obligations; historical data can be safely migrated; dashboard/report totals match the ledger; permissions prevent unauthorized access; and critical scenarios pass automated acceptance tests.
