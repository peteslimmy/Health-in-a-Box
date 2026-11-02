# HNB-Receivables Management Platform — Documentation Pack

**Version:** 0.8 — Product discovery and access-control baseline; default decisions accepted (see §8 and `07` §2b); implementation status (`21`) covers the backend and the web app  
**Status:** Draft for business-owner review; not yet an approved implementation specification  
**Primary currency assumption:** NGN (configurable)  
**Product model:** Internal finance application for managing multiple centres under one operating organisation, with a future path to stronger organisation-level SaaS isolation if needed.

## 1. Purpose

This pack describes a proposed product for ingesting reported hospital/centre revenue, calculating expected service charges under centre-specific commercial arrangements, recording actual service-charge payments received by the operator, and reconciling outstanding receivables. It also defines centre onboarding, bulk department/payment-channel setup, historical migration, controls, reporting, architecture, database design, APIs, UX, and testing.

The documents are designed to be used as a coordinated baseline. They intentionally separate confirmed facts from proposed defaults and unresolved decisions so that an implementation agent or development team does not silently convert assumptions into business rules.

## 2. Confirmed business understanding

- The application initially serves the operator's **internal team only**. Hospital/centre user portals are not in the first-release scope.
- The operator manages multiple centres, and source reports can have different layouts.
- Centre reports can be uploaded from Excel, CSV, and PDF. Digital/text PDFs are the preferred initial PDF scope; scanned PDF OCR needs explicit evaluation and human verification.
- The reports show revenue by department/service and by underlying collection channel, with row totals and possibly a grand total.
- **The department names in the supplied screenshot are revenue departments/services, not operating-cost items.**
- The financial chain is: **reported revenue → expected service charge → actual service-charge payment received from the centre → outstanding/settled receivable**.
- “Actual payment” means the service-charge money paid to the operator by a centre, not the centre's patient receipts or settlement of its Cash/POS/EFT channels.
- Commercial arrangements can differ by centre and may involve mixed rules.
- Costs are not to be automatically deducted from service charges. No operating-cost module is required unless later confirmed.
- Centre payment timing is variable or irregular.
- The application must support historical financial bulk import.
- During centre creation, users need to bulk-create, import, or reuse departments and payment channels.

## 3. Important proposed defaults—not yet confirmed contractual facts

1. A centre-level default service-charge rule with optional department and payment-channel overrides.
2. Effective-dated commercial rules so historical calculations retain the applicable rule version.
3. Import preview, validation and controlled posting; upload is not equal to financial posting.
4. An immutable/append-only audit trail for posted finance records, with correction through approved adjustments/reversals.
5. Centre-specific report templates mapped to a common normalized data model.
6. Centre-specific payment terms and due-date rules; overdue must not be inferred solely from an unpaid amount.
7. Statements should be supported; invoice generation is conditional on the actual contract/accounting process.
8. A modular monolith is preferred for the first release over microservices.

See `07_BUSINESS_RULES_AND_DECISIONS.md` for the full decision register.

## 4. Document index

| File | Purpose |
|---|---|
| `01_PRODUCT_OVERVIEW.md` | Product vision, context, scope and value proposition |
| `02_BRD.md` | Business requirements, objectives, stakeholders, scope and measures |
| `03_PRD.md` | Product requirements, MVP boundaries, capabilities and release priorities |
| `04_FRD.md` | Functional requirements with IDs, rules, states and workflows |
| `05_USER_JOURNEY.md` | End-to-end journeys for centre setup, imports, calculation, receipts and migration |
| `06_USER_STORIES.md` | Epics, user stories and acceptance criteria |
| `07_BUSINESS_RULES_AND_DECISIONS.md` | Confirmed rules, proposals, unresolved decisions and risk register |
| `08_ARCHITECTURE.md` | Logical architecture, components, flows, deployment and architecture decisions |
| `09_DATABASE_DESIGN_SCHEMA.md` | Entity model, relationships, constraints, indexes and PostgreSQL schema blueprint |
| `10_TECHNICAL_REQUIREMENTS_AND_STACK.md` | Recommended frontend/backend stack, infrastructure, quality and non-functional requirements |
| `11_API_AND_INTEGRATION_SPEC.md` | REST API conventions, key endpoints, authorization, errors and idempotency |
| `12_DATA_IMPORT_AND_HISTORICAL_MIGRATION.md` | File ingestion, mapping, validation, bulk setup, historical migration and recovery |
| `13_UI_UX_SPECIFICATION.md` | Navigation, page-level UX, interaction patterns, visual design and accessibility |
| `14_SECURITY_PRIVACY_AUDIT_GUARDRAILS.md` | Security controls, financial guardrails, developer/AI coding guardrails and non-negotiables |
| `15_TEST_STRATEGY_ACCEPTANCE_CRITERIA.md` | Testing strategy, financial invariants, release gates and acceptance criteria |
| `16_REPORTING_ANALYTICS_SPEC.md` | Dashboard measures, reports, definitions, filters and exports |
| `17_ROADMAP_RELEASE_PLAN.md` | Phased delivery plan, dependencies and exit criteria |
| `18_GLOSSARY.md` | Shared financial and technical terminology |
| `20_DECISION_SHEET.md` | Proposed best-practice defaults for every open decision, for business/finance owner to accept or override |
| `24_MODULE_REPORT_AND_INSIGHT_GAP_ANALYSIS.md` | The 21-module, 41-report, KPI and insight proposal compared with what is built, open decisions, and a build order |
| `22_CODE_REVIEW_AND_SECURITY_FINDINGS.md` | Full code review and security pass: findings with severity, fixes and tests, what was verified sound, and accepted risks |
| `21_IMPLEMENTATION_STATUS.md` | What is actually built in `Backend/`, implemented endpoints and permissions, controls enforced in code, deviations from the specs, test coverage and setup steps |
| `19_RBAC_ROLE_PERMISSION_MODEL.md` | Comprehensive role catalogue, granular permissions, scopes, role administration, segregation of duties and RBAC acceptance criteria |

## 5. Recommended reading order

1. Read the product overview and BRD.
2. Review the business-rule decision register and resolve P0 items before real-money posting.
3. Read the PRD and FRD together.
4. Review user journeys, user stories and `19_RBAC_ROLE_PERMISSION_MODEL.md`.
5. Approve the financial data model, role/permission model and database design before creating production migrations.
6. Finalize stack, security controls, API, import and UX specifications.
7. Use the test strategy and guardrails as mandatory development/release gates.

## 6. Baseline implementation posture

- Build a **modular monolith** with explicit domain boundaries.
- Use a relational database as the system of record for normalized and posted financial records.
- Keep raw uploaded files private and retain source lineage.
- Use decimal arithmetic in the backend; never use binary floating-point arithmetic for monetary calculations.
- Keep every financial calculation traceable to source revenue rows, commercial rule versions, and approvals.
- Do not allow silent mutation/deletion of posted financial records.
- Use the same import validation, domain services and audit logic for online uploads and historical migrations.
- Use configurable roles composed from a controlled granular permission catalogue; enforce permissions and centre scope on the backend for every request.
- Keep the Auditor role read-only by default; grant exports and evidence downloads separately.
- Do not introduce AI-driven financial posting. AI may assist with field mapping or exception explanation only if a human confirms the result and deterministic validation still passes.

## 7. Document set notes

`00_README_INDEX.md` is a pointer to this file. This file is the single authoritative index.

## 8. Review changes in v0.3 (proposed decisions awaiting business-owner confirmation)

- Product name unified as HNB-Receivables Management Platform.
- Segregation of duties (maker-checker) is a P0 requirement (P-014); only monetary approval thresholds remain P1.
- Two-step posting: committing a revenue-report batch posts the report only; a charge run posts ledger debits separately (P-013).
- Receipt lifecycle is Draft → Submitted → (Approved) → Posted (P-015); allocation requires a Posted receipt.
- A receivable item is a posted DEBIT ledger entry; credits and allocations reference it via `applies_to_entry_id` (P-016).
- Disputes and follow-ups, centre-scoped audit events, shared approval workflow, signed channel amounts and fixed-amount charge rules were added to the schema.
- Role administration is specified in FRD (FR-AUTH-006 to 010), user stories (US-031 to 036), UI (§4.10, §4.11) and API; doc 19 is the authority for roles, permissions and role endpoints.
- `21_IMPLEMENTATION_STATUS.md` (v0.6) records what is built: the backend (including receipts, allocation, receivables and a dashboard summary) and a web app covering sign-in, dashboard, centres, imports, charge runs, receivables, payments, audit and administration; adjustments, disputes, opening balances, statements, historical migration, exports and PDF import are not built yet; the built permission set is a simplified Phase 1 subset of doc 19; and the integrity fixes (per-assignment scope, privilege ceiling, maker-checker on import commit and charge-run post, duplicate-report fingerprint, blocking row-total variance, period-based rate selection, half-up per-line rounding, atomic audit, database constraints and append-only ledger) are enforced in code and tested.

## 9. Approval note

These documents are a detailed starting baseline based on the business information supplied so far. They are not proof of legal, tax, accounting-standard, or contract compliance. Financial recognition, invoice requirements, retention periods, exact rate precedence, rounding and payment-term rules must be confirmed with the business owner/accountant before production posting.
