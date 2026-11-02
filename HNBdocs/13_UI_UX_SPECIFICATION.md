# UI/UX Specification

> **Build status:** the web app exists (`Frontend/`, see `21_IMPLEMENTATION_STATUS.md` §10): sign-in, dashboard, centres (profile, departments, channels, agreements and rules), revenue imports with validation preview, charge runs with preview and approval, receivables, payments with approval and allocation, audit trail, users and roles. Not built: the bulk-setup grids and new-centre wizard, import mapping UI, statements, adjustments, disputes, historical migration workspace, exports, saved filters, dark mode, and the role-conflict and impact previews of the Role Builder.

**Design objective:** A polished, high-trust finance workspace optimized for dense financial data, exception handling and traceability. It should feel like a modern enterprise SaaS application, not a collection of generic admin cards.

## 1. UX principles

1. **Context before action:** always show centre, reporting period, status and currency when relevant.
2. **Clarity of money:** reported revenue, expected charge, received cash, allocated amount and outstanding balance have distinct labels and visual treatments.
3. **Exception-first workflow:** errors and warnings show exactly what failed, where it failed and how to resolve it.
4. **Progressive disclosure:** summary first, detailed source/rule/ledger lineage one click away.
5. **Safe financial actions:** post, approve, reverse, commit migration and allocate payment have preview/confirmation steps.
6. **Accessible, keyboard-usable grids:** finance staff should work efficiently without mouse-only interactions.
7. **Consistent hierarchy:** centre-level, department-level, report-level and transaction-level views reuse the same layout and terminology.
8. **No decorative-only data:** charts supplement, never replace, exact-value tables.

## 2. Application shell

### Main navigation

- Overview
- Centres
- Revenue Reports
- Imports & Data Migration
- Service Charges
- Receivables
- Payments
- Statements & Documents
- Reports & Analytics
- Approvals & Exceptions
- Audit Trail
- Administration
  - Access Control: Users, Roles, Permission Catalogue, Role Builder, Assignments & Scope, Access Review, Administration Audit (see §4.10)
  - Settings

Navigation items are permission-aware. A page hidden from the navigation must still be protected at API level.

### Top bar

- Global search for centre code/name, report reference, payment reference and batch ID (within permission scope).
- Centre filter / centre context where applicable.
- Period/date filter where the page uses one.
- Import/job status notifications.
- Current user menu, role visibility and sign-out.

### Layout

Desktop-first responsive shell with a collapsible left sidebar, page title and concise description, primary action, filter row, content area and optional contextual detail panel. Use sticky table headers and preserve filters when navigating to detail and back.

## 3. Design system

- Typography: Inter or a comparable modern sans-serif; clear numeric alignment and tabular figures for financial values.
- UI components: Tailwind CSS plus shadcn/ui/Radix-style accessible primitives; shared tokens rather than arbitrary page-specific CSS.
- Visual tone: restrained neutral surfaces, clear borders, generous spacing for forms, compact table density for finance screens, one restrained brand accent and semantic status colors.
- Status must not rely on color alone: pair color with text/icon, e.g. `Overdue`, `Needs review`, `Posted`, `Draft`.
- Number display: consistent thousands separators, two-decimal currency display by policy, right-aligned amounts and tabular numerals.
- Charts: concise legends, accessible labels, tooltips that include exact amount/period, no misleading truncated axes.
- Motion: subtle transitions for navigation/feedback only; avoid decorative animation that delays finance tasks.
- Dark mode is optional; if supported, contrast and financial status remain readable in both modes.

## 4. Key screens

### 4.1 Executive dashboard

Purpose: answer the financial position quickly.

KPI measures:
- Reported revenue for the selected period.
- Expected service charge for the selected period (posted/approved charge runs by default; Draft previews are excluded or shown separately and labelled as previews).
- Charges posted (ledger debits by posting date).
- Payments received during the selected period.
- Payments allocated during the selected period.
- Outstanding receivables as at selected date.
- Overdue receivables as at selected date.
- Unallocated receipts.
- Reports/import batches awaiting action.

Below KPIs:
- Expected charges vs payments received over time (clearly labelled as different timelines).
- Outstanding balance and ageing by centre.
- Centre ranking by reported revenue/expected charge/overdue balance, with metric selector.
- Department contribution chart.
- Import and reconciliation exceptions needing attention.

Each card/chart/row should open a filtered source view. The page must state the date basis: period metric or as-at balance. Do not mix one-month flow measures with all-time balances without clear labels.

### 4.2 Centre list/detail

List columns: centre code, centre name, status, reported revenue (period), expected charges (period), received payments (period), outstanding as at date, overdue amount, last report date, open exceptions.

Centre detail tabs:
- Overview
- Revenue & Reports
- Departments
- Payment Channels
- Commercial Agreement & Rules
- Receivables & Statements
- Payments
- Import Templates
- Audit History

Centre header shows active/draft/suspended state and links to configuration with permission control.

### 4.3 New-centre wizard

Steps:
1. Identity and metadata.
2. Departments & Services — manual rows, paste, import template, catalogue selection, copy/reuse from another centre.
3. Payment Channels — same bulk methods.
4. Commercial Rules — default/overrides, effective dates, eligibility and calculation method.
5. Report Template & Payment Terms.
6. Review & Activate.

Each bulk setup grid should include row number, code, display name, canonical mapping, status, rule assignment where relevant, validation state and row actions. Show counts for `New`, `Matched`, `Duplicate`, `Invalid`. Provide a downloadable template and an error file.

### 4.4 Import workspace

Use a stepper or stage timeline: Upload → Map → Preview → Validate → Review → Post. Display import batch ID and job progress persistently. For large files, show background job status and allow users to navigate away safely.

Preview grid columns should include source row, raw department label, mapped department, payment-channel amounts, reported total, computed channel sum, variance and status. Allow column selection and pagination; do not attempt to load 50,000 rows into a single browser table.

Validation panel groups issues by severity and type. Clicking an issue filters the affected rows. Provide an error workbook/CSV download that includes original row number and correction instruction.

### 4.5 Service-charge run

Show: reporting period, source reports, applicable agreement/rule versions, eligible revenue, exclusions, rate breakdown, expected charge, rounding policy and validation state. Each calculated row should have “Why this amount?” details with base amount × rate, eligibility, source and rule version. Provide Draft preview, Submit for Review and Post actions only when allowed.

### 4.6 Receivables list/detail

List filters: centre, status, earning period, posting date, due date, ageing bucket and amount range.

Detail panel/timeline:
- charge source and calculation;
- opening balance/adjustments if relevant;
- due-date rule and due date;
- payments and their allocations;
- remaining balance;
- disputes, approvals and corrective events.

Statuses: Not Yet Due, Overdue, Partially Paid, Settled, Disputed (dispute may be a flag alongside financial settlement status, not necessarily an exclusive state).

### 4.7 Payment entry and allocation

Payment form has centre, receipt date, amount/currency, method, reference, receiving-account label and evidence upload. Show potential duplicate warning before save. Allocation screen uses an available receipt balance pane and a list of open receivables, with amount-to-allocate input and totals. Clearly show `Receipt amount`, `Allocated`, `Unallocated` and block over-allocation.

### 4.8 Historical migration centre

Use a distinct migration workspace rather than a generic upload dialog. It must show migration mode/cutoff, record categories, source files, dry-run totals, rejected/duplicate/unmatched records, historic-rate gaps, ledger impact preview, approval/sign-off and commit status. Require extra confirmation with migration ID and centre/period scope before commit.

### 4.9 Reports and audit

Reports have saved filters, visible as-at/period basis, totals row, column customization and safe export. Audit history supports filters by actor, action, target, date and centre; financial users can click an event to see before/after snapshot within their permission scope.

### 4.10 Administration → Access Control

Implements `19_RBAC_ROLE_PERMISSION_MODEL.md` §4 and §13. Subpages: **Users** (search, invite, activate/deactivate, revoke sessions, effective access), **Roles** (templates and custom roles, clone, lifecycle Draft → Active → Inactive/Retired), **Permission Catalogue** (read-only, searchable by module/action/sensitivity), **Role Builder** (permission selection by module and action with plain-language "can / cannot do" summary, impact preview and warnings for conflicting duties), **Assignments & Scope** (role, all/selected centres, dates, reason, grantor), **Access Review** and **Administration Audit**. Role-conflict warnings (for example report preparation plus posting, or Auditor plus any write role) are shown before save. Success is shown only after server confirmation.

### 4.11 Approvals and receipt lifecycle

The Approvals inbox lists items awaiting the user's decision (charge runs, receipts, allocations, adjustments, opening balances, migrations, privileged access changes) and never shows an approve action for the user's own submission. Payment screens show the receipt state (Draft, Submitted, Approved, Posted, Rejected, Reversed/Returned) and offer only the transitions the user is permitted to perform; allocation is enabled only for Posted receipts. Receivable detail shows dispute status and follow-up notes alongside the financial status.

## 5. Form and table behavior

- Use inline validation for easy-to-fix field errors and a summary panel for complex forms.
- Save non-financial drafts where useful; do not auto-post financial data.
- For bulk tables, support paste-from-Excel, keyboard navigation, undo before commit and row-level validation.
- Use server-side pagination and filtering for large records.
- Show loading, empty, partial failure and permission-denied states explicitly.
- Preserve user changes when validation fails; return row/field errors from backend.
- Do not show a success message until the API confirms the transaction.

## 6. Accessibility and responsive behavior

- Target WCAG 2.2 AA for core workflows.
- Keyboard access to navigation, forms, data-grid operations and modal actions.
- Visible focus indicators and logical tab order.
- Semantic heading structure and form labels.
- Text and status contrasts meet accessibility requirements; do not use color alone.
- At narrow widths, prioritize summaries and allow table horizontal scroll or a clearly designed alternate row view; do not silently hide financial columns.

## 7. UX acceptance criteria

- Users can identify the centre and date range for every headline number.
- No metric ambiguously mixes reported revenue, expected charges, receipt cash and outstanding balance.
- A user can navigate from dashboard metric to source report or ledger item without losing context.
- Errors identify the exact row/field and resolution path.
- Dangerous actions show amount/record count and the effect before confirmation.
- Inaccessible actions are not offered; unauthorized API attempts still fail securely.
- All critical journeys can be completed by keyboard and tested in supported browsers.
