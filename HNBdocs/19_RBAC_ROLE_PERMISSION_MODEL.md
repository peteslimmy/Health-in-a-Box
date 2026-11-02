# HNB-Receivables Management Platform — RBAC & Role/Permission Administration Specification

**Document ID:** IAM-RBAC-001  
**Version:** Draft 0.3 (aligned with the documentation pack baseline)  
**Status:** Proposed baseline for business-owner review  
**Applies to:** Internal users, all centres, reports, revenue calculations, receivables, payments, imports, configuration, reports and audit records.

## 1. Purpose

Define a comprehensive role-based access control (RBAC) model that lets an authorized administrator create custom roles, assign permissions from a controlled permission catalogue, assign users to roles, and constrain those assignments to all centres or selected centres. It must support clear separation between staff who upload reports, staff who calculate/review charges, staff who record payments received from centres, finance approvers, and read-only auditors.

The product name is **HNB-Receivables Management Platform**. RBAC is a first-release capability, not a later enhancement.

> **Implementation status (see `21_IMPLEMENTATION_STATUS.md` §4):** the backend currently implements a simplified Phase 1 subset of this model — 32 coarse permissions (for example `imports.manage`, `imports.commit`, `charge_runs.approve`) and four system roles (`ADMIN`, `FINANCE_MANAGER`, `FINANCE_OFFICER`, `AUDITOR`), with one role plus all-centres or one-centre scope per assignment. Already enforced in code: per-assignment scope evaluation (§3.2, §10), privilege ceiling and no self-assignment (§4.3), immutable built-in roles (§4.2), the Auditor-plus-write-role conflict (§9), and audit of permission changes with before/after lists. Not yet built: the full permission catalogue, role lifecycle states, assignment dates and reasons, `restrict_to_own`, access reviews, and approval of privileged access changes.
>
> **Decision I-001:** the 32-permission, 4-role set is the **Phase 1 baseline**. The fuller catalogue in §5 and the extra templates in §7 are the target for later phases and are added together with the features they protect (payments, adjustments, migration, reports, access reviews). Permission keys keep the `resource.action` form so they can be split later without redesigning assignments.

## 2. Non-negotiable security principles

1. **Default deny:** a user has no access unless an active role assignment explicitly grants the permission and scope required.
2. **Backend enforcement:** the API and domain services authorize every read and mutation. Hiding buttons or navigation is only a UX measure.
3. **Scope is separate from role:** a role defines what a person may do; an assignment defines which centres and organization the role applies to.
4. **Least privilege:** start with the minimum permissions necessary for each job. Do not assign everyone Super Admin.
5. **Separation of duties:** a person who prepares a sensitive transaction must not approve that same transaction when maker-checker is required.
6. **Read-only means read-only:** the Auditor template grants no create, update, import, post, approve, allocate, adjust, reverse, configure, user-admin or role-admin permissions. Export is a separate permission.
7. **Auditable administration:** user status, role creation/change, permission changes, assignments, scope changes and privileged session revocation are audited.
8. **No hidden privilege escalation:** a role administrator cannot grant permissions that they are not authorized to administer, assign a higher privilege than policy permits, or grant themselves additional privileges through a custom role.
9. **Permission catalogue is controlled:** administrators create roles and assign existing permission keys. Introducing an entirely new backend capability/permission key requires a code-reviewed release and migration; administrators cannot invent arbitrary strings and expect them to authorize operations.
10. **Financial data remains immutable after posting:** RBAC never permits silent edits/deletion of posted ledger events or audit events.

## 3. Authorization model

Authorization is evaluated as:

`ALLOW = authenticated active user AND active role assignment AND required permission AND permitted organization/centre scope AND policy checks satisfied`.

If any condition fails, deny the request and log security-relevant events without exposing sensitive data. The server obtains actor identity from the authenticated session/token, never from a client-supplied `userId` field.

### 3.1 Roles and assignments

- A **permission** is a stable catalogue key such as `revenue_reports.upload` or `payments.record`.
- A **role** is a named bundle of permissions, such as `Report Uploader` or `Auditor (Read Only)`.
- A **role assignment** connects one user to one role and defines its effective scope, start/end date if used, active state and grantor.
- A user may have multiple roles only if permitted by policy. Effective permissions are normally the union of active grants across assignments, constrained by centre scope and segregation-of-duties rules.
- There should be no ordinary direct user-permission grants. Use roles so access can be reviewed consistently.
- Centre scope values are `ALL_CENTRES` (all centres in the organization), `SELECTED_CENTRES` and `NO_CENTRE_SCOPE` (see §10). Scope belongs to the **assignment**, never to the role. Global administrative permissions such as role catalogue management must not be made centre-scoped unless the capability is explicitly designed for that.
- The current product is internal to one operating organization. Keep `organization_id` in the authorization and data model to preserve a future isolation boundary without implying that public multi-organization SaaS is already in scope.

### 3.2 Decision sequence

1. Verify active identity and session.
2. Resolve active role assignments and the requested action's permission key.
3. Check the resource's organization and centre identifiers against the scope of **each assignment whose role contains the required permission**. The action is allowed only if at least one such assignment's own scope covers the resource. Permissions and scopes are paired per assignment and are never pooled: a write role on Centre A plus a read role on Centre B does not grant write on Centre B.
4. Apply policy checks: record state, permitted transitions, amount/approval thresholds, maker-checker, and role-conflict rules.
5. Perform the action in a transaction and write the required audit event.

Frontend route guards and permission-aware navigation improve UX but must never replace these server checks. Download URLs for files and evidence must also enforce the same scope and permission checks.

## 4. Administration capability: create roles and assign permissions

Provide **Administration → Access Control** with these subpages:

- **Users:** search, invite/create, view profile, activate/deactivate, revoke sessions, assign roles, review effective permissions and centre scope.
- **Roles:** list system templates and custom roles; create, clone, edit description, activate/deactivate and view assigned users.
- **Permission Catalogue:** searchable, read-only reference of permission key, plain-language description, resource, action, sensitivity and whether approval/extra policy is required.
- **Role Builder:** create a role and select permissions by module/action; filter by View, Create, Update, Import, Validate, Commit/Post, Approve, Allocate, Adjust, Reverse, Export and Administer. Show a plain-language impact preview before save.
- **Assignments & Scope:** assign one or more roles to a user and scope each assignment to all centres or selected centres. Display assignment dates, grantor and reason.
- **Access Review:** show users, roles, effective permission summary, inactive/unused roles, privileged accounts, conflicting role combinations, and last review date.
- **Administration Audit:** view changes to users, roles, permissions and scopes (subject to the viewer's audit permissions).

### 4.1 Role lifecycle

`Draft → Active → Inactive/Retired`.

A draft role cannot be assigned. A role cannot be deleted if it is assigned or referenced by audit history; retire it instead. When a permission is removed from an active role, warn about affected users and require confirmation. High-privilege changes require a reason and audit record; policy may require an independent approver. Role changes take effect promptly and invalidate effective-permission caches/sessions according to the security policy.

### 4.2 System role templates vs custom roles

Seed the standard role templates in Section 7. Protect critical system identifiers from deletion. An access administrator may clone a template to create a custom role. Editing a built-in role's permissions should require explicit elevated permission, preview of affected users, reason, and audit trail; the safer default is to leave built-in templates protected and customize cloned roles.

### 4.3 Guarding role administration

- Only users with `roles.create`, `roles.update`, `roles.manage_permissions`, and/or `users.assign_roles` may perform the corresponding action.
- A role administrator may grant only permissions within their delegated administration ceiling, unless they have the explicitly controlled highest privilege.
- The actor may not use role administration to grant themselves a role or permission that violates the ceiling.
- Changes to Super Admin/platform-owner access require an independent second privileged administrator where operationally possible. Do not allow self-approval.
- If the organization has only one privileged administrator, document a controlled break-glass path with alerting and post-event review rather than silently bypassing controls.
- Never let a custom role modify the permission catalogue or bypass server authorization.

## 5. Permission naming and catalogue

Use stable lowercase keys in `resource.action` format. Names are examples of the initial catalogue and should be seeded by migrations. Each key must have a display label, description, module, sensitivity tier, whether centre scope applies, and whether the action is financial/privileged.

### 5.1 Identity and access administration

| Permission key | Meaning |
|---|---|
| `users.view` | View user list/profile within allowed scope. |
| `users.create` | Create/invite internal users. |
| `users.update` | Update allowed profile attributes. |
| `users.activate` | Activate an eligible user. |
| `users.deactivate` | Deactivate a user and trigger session revocation. |
| `users.assign_roles` | Create/change user-role assignments and assignment scope. |
| `users.revoke_roles` | Revoke a user-role assignment (dedicated revoke permission; also usable by `users.assign_roles` holders only if explicitly granted). |
| `users.revoke_sessions` | Revoke active sessions. |
| `roles.view` | View roles and assigned permissions. |
| `roles.create` | Create custom role in Draft. |
| `roles.clone` | Clone an existing role/template. |
| `roles.update` | Edit role name, description and lifecycle state. |
| `roles.manage_permissions` | Add/remove permissions from an eligible custom role. |
| `permissions.catalogue_view` | View the controlled permission catalogue. |
| `access_reviews.view` | View effective access and review results. |
| `access_reviews.complete` | Record completion of a periodic access review. |

### 5.2 Centres and configuration

| Permission key | Meaning |
|---|---|
| `centres.view`, `centres.create`, `centres.update` | View/create/edit centre profile. |
| `centres.activate`, `centres.suspend`, `centres.archive` | Control centre lifecycle without deleting financial history. |
| `departments.view`, `departments.create`, `departments.update`, `departments.inactivate` | Manage department configuration. |
| `departments.bulk_create` | Bulk create or import departments during onboarding. |
| `departments.map_aliases` | Manage source department labels and canonical mappings. |
| `payment_channels.view`, `payment_channels.create`, `payment_channels.update`, `payment_channels.inactivate` | Manage collection channels shown in centre revenue reports. |
| `payment_channels.bulk_create` | Bulk-create/import centre payment channels during onboarding. |
| `payment_channels.map_aliases` | Manage source payment-channel aliases. |
| `agreements.view`, `agreements.create`, `agreements.update`, `agreements.submit`, `agreements.approve`, `agreements.close` | Manage commercial agreement lifecycle. |
| `charge_rules.view`, `charge_rules.create`, `charge_rules.update`, `charge_rules.submit`, `charge_rules.approve` | Configure and approve effective-dated service-charge rules. |
| `payment_terms.view`, `payment_terms.manage` | View or manage reporting, statement and due-date terms. |
| `import_templates.view`, `import_templates.create`, `import_templates.update`, `import_templates.activate` | Manage centre-specific report templates and mappings. |
| `system_settings.view`, `system_settings.manage` | View or change global application settings. |

### 5.3 Revenue reports and data imports

| Permission key | Meaning |
|---|---|
| `revenue_reports.view` | View validated/source revenue reports. |
| `revenue_reports.upload` | Upload a routine report and initiate parsing. Does not itself grant posting. |
| `revenue_reports.map_fields` | Edit mappings for an import job/template. |
| `revenue_reports.validate` | Run validation and resolve permitted row-level mapping issues. |
| `revenue_reports.submit_for_review` | Submit a valid report for review/posting. |
| `revenue_reports.post` | Post/accept validated revenue into the financial workflow where policy permits. |
| `revenue_reports.replace` | Initiate a controlled corrected-report workflow. |
| `imports.view` | View import batches and status. |
| `imports.retry` | Retry an eligible failed job idempotently. |
| `imports.cancel_draft` | Cancel a batch before commit/posting. |
| `imports.bulk_setup` | Run the bulk-setup import workflow (upload, preview, commit). A user also needs `departments.bulk_create` and/or `payment_channels.bulk_create` for the corresponding record type; both checks apply. |
| `historical_migrations.create`, `historical_migrations.upload`, `historical_migrations.validate` | Create and validate historical migration batches. |
| `historical_migrations.submit` | Submit a validated migration for sign-off. |
| `historical_migrations.approve` | Approve a migration, subject to separation of duties. |
| `historical_migrations.commit` | Commit an approved migration into the financial model. |
| `historical_migrations.view` | View migration batches and results. |

### 5.4 Service-charge calculation and receivables

| Permission key | Meaning |
|---|---|
| `charge_runs.view` | View charge runs and calculation details. |
| `charge_runs.calculate` | Calculate/recalculate an unposted draft run. |
| `charge_runs.submit_for_review` | Submit a charge run for approval. |
| `charge_runs.approve` | Approve a charge run prepared by another authorized user. |
| `charge_runs.post` | Post approved charges to the receivables ledger. |
| `charge_runs.cancel_draft` | Cancel an unposted draft run. |
| `receivables.view` | View receivable entries and balances in scope. |
| `receivables.view_sensitive_detail` | View designated sensitive supporting documents/details beyond the standard summary. |
| `receivables.export` | Export receivable data within scope. |
| `receivables.dispute_flag` | Flag a receivable as disputed and record a reason. |
| `receivables.resolve_dispute` | Record an authorized dispute outcome; any financial change still requires adjustment/reversal permissions. |
| `statements.view`, `statements.generate`, `statements.export` | View, generate and export statements. |
| `invoices.view`, `invoices.generate`, `invoices.issue`, `invoices.void` | Optional invoice actions if invoice workflow is approved. Issued-document correction follows finance policy. |

### 5.5 Payments and financial adjustments

| Permission key | Meaning |
|---|---|
| `payments.view` | View receipts received by the operator from centres. |
| `payments.record` | Create a draft receipt with amount, received date and references. |
| `payments.update_draft` | Edit an unposted receipt draft. |
| `payments.submit` | Submit a recorded receipt for posting/approval. |
| `payments.approve` | Independently approve a payment receipt for posting where maker-checker is required. |
| `payments.post` | Post an approved receipt as received funds. |
| `payments.reverse` | **Initiate** a receipt reversal or return. Approval requires `payments.approve` held by a different user. |
| `payment_allocations.view` | View allocations and unallocated balance. |
| `payment_allocations.create` | Allocate a posted receipt to one or more receivables. |
| `payment_allocations.submit` | Submit sensitive allocation changes for review where required. |
| `payment_allocations.approve` | Independently approve an allocation or reallocation where policy requires. |
| `payment_allocations.reverse` | Reverse an allocation by a compensating event; does not delete its history. |
| `adjustments.view`, `adjustments.create`, `adjustments.submit`, `adjustments.approve`, `adjustments.post`, `adjustments.reverse` | Manage debit/credit adjustments with reasons and supporting evidence. `adjustments.reverse` initiates a reversal; approval needs `adjustments.approve` by a different user. |
| `evidence.upload` | Attach evidence files (receipts, remittance advice, agreements) to payments, adjustments and agreements within scope. |
| `opening_balances.create`, `opening_balances.submit`, `opening_balances.approve`, `opening_balances.post` | Enter and control migration opening balances. |
| `approvals.inbox_view` | View actions awaiting the user's approval. |
| `approvals.decide` | Generic gate to use the approval decision endpoint. It is **necessary but not sufficient**: the user must also hold the domain-specific approve permission for the request type (e.g. `charge_runs.approve`, `payments.approve`, `payment_allocations.approve`, `adjustments.approve`, `historical_migrations.approve`), be in scope, and not be the requester. |

### 5.6 Reports, exports and audit

| Permission key | Meaning |
|---|---|
| `dashboard.view` | View headline dashboard metrics within scope. |
| `analytics.view` | View approved analytics and trends. |
| `reports.view` | View standard reports. |
| `reports.export` | Export standard reports. Exporting is separate from viewing. |
| `source_files.view_metadata` | View source-file metadata. |
| `source_files.download` | Download source reports/evidence, subject to centre scope and data sensitivity. |
| `audit_events.view` | Read audit logs within authorized scope. |
| `audit_events.export` | Export audit history. |
| `notifications.view`, `notifications.manage` | View or configure supported application notifications. |

### 5.7 Actions that remain protected irrespective of role

No application role grants a capability to hard-delete audit events or posted financial ledger entries. `Super Admin` is not a general-purpose bypass of financial invariants, maker-checker rules or auditability. Emergency recovery must use a documented, logged break-glass process and compensating entries.

## 6. Recommended permission groups in the Role Builder

For a less overwhelming UI, group permissions by module and action. Each module should offer granular selection; a group-level checkbox must only select the visible catalogue items, not create hidden wildcard privileges.

- View: `*.view`, with export/download separately selectable.
- Create/input: create draft entities or records.
- Update: edit permitted non-posted drafts/configuration.
- Import: upload or bulk-create staging records.
- Validate/map: inspect and resolve import issues.
- Submit: send an item for review.
- Approve: independent review decision.
- Post/commit/issue: commit an item to an authoritative financial state.
- Allocate: connect a payment receipt to a receivable.
- Adjust/reverse: create compensating financial events.
- Export/download: copy information out of the platform.
- Administer: user, role, system configuration and access review.

Never interpret `View` as permission to export or download raw source files. Never interpret `Create` or `Import` as permission to post.

## 7. Seed role templates

These are templates to accelerate setup; the owner can clone them to create custom roles. Permissions remain configurable, but the auditor and maker-checker restrictions must be enforced by policy, not only by convention.

### 7.1 Suggested roles and intended duties

| Role template | Purpose | Recommended scope | Key restrictions |
|---|---|---|---|
| **Platform Super Admin / Business Owner** | Overall business/application administration; all centres and critical configuration. | All centres | Not allowed to bypass immutable ledger/audit controls or self-approve maker-checker actions. Privileged changes are audited. |
| **Access Administrator** | Manage internal users, role templates, role assignments and periodic access reviews. | Organization-wide identity administration | Does not automatically receive finance posting permissions. May only grant permissions within delegated administration ceiling. |
| **Centre Configuration Manager** | Maintain centres, departments, payment channels, agreements, rates, terms and import templates. | All or selected centres | Agreement/rule approval may be independent from creation; no payment posting by default. |
| **Report Uploader** | Upload daily/periodic reports, view their own batches, resolve permitted basic mapping issues and view validation feedback. | Assigned centres | Cannot post revenue/charges, approve their own work, record or allocate payments, change charge rules, or manage roles. |
| **Import Reviewer / Revenue Poster** | Review mappings/totals, resolve exceptions, approve valid report and post revenue where that is a defined state transition. | Assigned/all centres | Cannot approve own upload/post request when separation is required; does not gain payment permissions by default. |
| **Service-Charge Analyst** | Calculate draft service charges, inspect rule basis, prepare runs and submit for review. | Assigned/all centres | Cannot modify approved commercial rules or approve/post own calculation where maker-checker is required. |
| **Finance Manager / Approver** | Review/post charges, approve receipts, adjustments, historical migrations and other designated high-risk actions; oversee receivables. | All centres or delegated scope | Must not approve own request; permissions can be separated by policy for stronger segregation. |
| **Payment Recorder** | Input service-charge payments received from centres, enter references/evidence and submit receipts. | Assigned centres | Can record/update draft receipts; posting/approval is a separate permission. No rate/configuration or role administration. |
| **Payment Allocator** | Allocate posted receipts to open receivables, investigate unallocated receipts and request reallocation. | Assigned centres | Cannot change receipt amount or post an allocation reversal without separately granted permissions. Sensitive reallocations may require approval. |
| **Receivables Officer / Collector** | View balances, due dates and centre statements; record follow-up/dispute notes if enabled. | Assigned centres | No charge-rule editing, payment posting, receipt allocation or ledger adjustment by default. |
| **Auditor (Read Only)** | Inspect reports, charge calculations, receivables, payment history, approvals and audit trail. | All centres or audit assignment scope | No create/update/import/post/approve/allocate/adjust/reverse/configuration/role management. Export and raw-source downloads are separately granted. |
| **Executive / Management Viewer** | View headline metrics, centre comparisons and management reports. | All or selected centres | Read-only; cannot view restricted evidence unless separately granted. Export is separate. |
| **Reporting Analyst** | Build and export approved financial reports and analytics. | Assigned/all centres | No financial mutation or configuration. No raw-file download by default. |
| **Historical Migration Specialist** | Upload legacy datasets, map fields, run dry-run validation and prepare migration batches. | Explicit migration scope | Cannot approve or commit their own migration; cannot edit existing posted entries. |
| **System Operator / Technical Support** | Maintain application infrastructure and technical operations. | Technical scope only | No finance permission by default; production access is least-privilege and audited. |

### 7.2 Minimum permission profiles for the requested cases

**Who can upload reports?** Assign `Report Uploader` with `revenue_reports.upload`, `imports.view`, `centres.view`, `import_templates.view`, `source_files.view_metadata`, `revenue_reports.view` (to see validation feedback), and optionally `revenue_reports.map_fields` / `revenue_reports.validate` for assigned centres. Where the template restricts the role to its own batches, the grant carries `restrict_to_own` (see §11). Uploading does not permit posting.

**Who can input service-charge payments received?** Assign `Payment Recorder` with `centres.view`, `payments.view`, `payments.record`, `payments.update_draft`, `evidence.upload`, and `payments.submit`, scoped to the relevant centres. If business policy allows direct posting for low-risk receipts, grant `payments.post` only through a documented threshold/control; otherwise a separate approver posts it.

**Who can allocate a receipt to an outstanding balance?** Assign `Payment Allocator` with `centres.view`, `payments.view`, `receivables.view` (required to see the open receivables to allocate against), `payment_allocations.view`, and `payment_allocations.create`. Give `payment_allocations.reverse` and approval permissions only to the separate authorized reviewer where appropriate.

**Who can audit without changing anything?** Assign `Auditor (Read Only)` with relevant `*.view` permissions and `audit_events.view`. Add `reports.export`, `receivables.export`, `audit_events.export`, or `source_files.download` only after a documented need is approved. Audit role has no mutation permissions.

## 8. Summary access matrix

Legend: **V** = view; **C** = create/input; **I** = import/upload; **CALC** = calculate; **POST** = post/commit; **APP** = approve; **ALLOC** = allocate; **CFG** = configure; **ADM** = administer access; **EXP** = export; **AUD** = audit-read. This is a recommended template matrix; exact permissions are assigned using the granular keys above.

| Capability | Super Admin | Access Admin | Config Manager | Report Uploader | Import Reviewer | Charge Analyst | Finance Approver | Payment Recorder | Payment Allocator | Auditor | Executive Viewer | Migration Specialist |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| View centres/financial summaries | V | — | V | V (scope) | V (scope) | V (scope) | V | V (scope) | V (scope) | V (scope) | V (scope) | V (migration scope) |
| User/role administration | ADM | ADM (delegated) | — | — | — | — | — | — | — | — | — | — |
| Centre/department/channel configuration | CFG | — | CFG | — | — | — | V | — | — | V (scope) | V (scope) | — |
| Upload revenue reports | I | — | Optional | I | V | V | V | — | — | V | V (summary) | Optional only in migration scope |
| Validate/map imports | Limited | — | Template config | Limited | I/validate | V | V | — | — | V | Summary only | I/validate legacy data |
| Post revenue report | POST (policy) | — | — | — | POST | — | APP/POST | — | — | — | — | — |
| Calculate service charges | CALC/POST (policy) | — | — | — | — | CALC | APP/POST | — | — | V | V (summary) | Legacy batch only |
| Record service-charge receipt | C/POST subject to policy | — | — | — | — | — | APP/POST | C/submit | — | V | V (summary) | Legacy batch only |
| Allocate receipt | ALLOC subject to policy | — | — | — | — | — | APP/reverse | — | ALLOC | V | Summary only | Legacy allocation staging |
| Adjustment/reversal | Initiate/APP subject to policy | — | — | — | — | — | APP/POST | — | Request only | V | — | — |
| Historical migration commit | APP/commit subject to policy | — | — | — | — | — | APP/commit | — | — | V | Summary only | Create/validate only |
| Reports/export | EXP | — | V | Own batch view | V/EXP if granted | V/EXP if granted | V/EXP | Own receipts | Allocations | V; EXP separate | V; EXP separate | Import report only |
| Audit trail | AUD | Access audit only | Scoped if granted | Own activities only | Scoped if granted | Scoped if granted | AUD | Own activities only | Own activities only | AUD | — | Own batch history |

Do not interpret this summary as wildcard grants. Each row is implemented through the exact permission catalogue keys, policy checks and centre scope. Super Admin's action permissions remain subject to maker-checker and immutable-ledger controls.

## 9. Recommended segregation-of-duties rules

At minimum, enforce these rules as backend policy and test them:

1. A user cannot approve their own charge run, adjustment, opening balance, migration batch or payment receipt when the item requires independent approval.
2. A user who creates a role/changes its permissions cannot approve their own privileged access change if approval is required.
3. The Auditor role cannot be combined with a write-capable role unless an explicit business-owner exception is recorded. Preferred practice is to prohibit that combination to preserve audit independence.
4. A user cannot grant roles/permissions beyond their administration ceiling or scope.
5. A user with selected-centre access cannot read, export, download or mutate a different centre's records by guessing IDs or changing request parameters.
6. A payment recorder should not also be the sole approver/poster of their own receipt where maker-checker applies.
7. The migration specialist who prepares a historical migration cannot be its final approver/committer where segregation is required.
8. No role can hard-delete a posted ledger event or audit record.

For smaller teams, the business may choose a documented compensating control (for example, next-day independent review) for some actions. That decision must be explicit, visible in audit reports and not silently coded as a bypass.

## 10. Scope model and data filtering

Every permission-bearing query/mutation must constrain by `organization_id` and, when relevant, `centre_id`. Centre scope should be checked in the backend service and in database policy where supported. Do not trust a centre ID in query/body as proof of access.

- `ALL_CENTRES`: all centres in the assigned organization.
- `SELECTED_CENTRES`: only the explicit set of centre IDs included in that assignment.
- `NO_CENTRE_SCOPE`: only for clearly global administration capabilities that do not expose centre financial data.

Where a user has multiple active assignments, a read is allowed for a centre if any assignment whose role holds the read permission covers that centre; the visible centre set for a given permission is the union of scopes of **only those assignments that hold that permission**. Scopes are never unioned across different permissions, so a write permission never extends to a centre covered only by a read-only assignment. SoD and explicit audit-only constraints still apply. An export/download is evaluated independently for the exact data being exported.

**Ownership restriction ("own records only").** Several templates (Report Uploader, Payment Recorder, Payment Allocator, Migration Specialist) are limited to their own batches, receipts, activities or history. This is modelled as `role_permissions.restrict_to_own = TRUE` on the specific permission: the grant then applies only to records whose creator/actor is the requesting user, in addition to centre scope.

**Delegated administration ceiling.** The ceiling of a role administrator is the set of permissions listed for their administering role in `role_admin_ceilings`. They may grant only permissions in that set and only for centres inside their own assignment scope. Only the Platform Super Admin role has an unrestricted ceiling, and even then privileged changes require a second approver where one exists.

## 11. Suggested database support

Use tables equivalent to the following. Match naming to the existing schema conventions before implementation.

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY,
  permission_key TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  requires_centre_scope BOOLEAN NOT NULL DEFAULT TRUE,
  is_financial_mutation BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  role_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system_template BOOLEAN NOT NULL DEFAULT FALSE,
  is_protected BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','RETIRED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID REFERENCES users(id),  -- NULL only for system templates seeded by migration
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (is_system_template OR created_by IS NOT NULL),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, role_key)
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  restrict_to_own BOOLEAN NOT NULL DEFAULT FALSE,  -- grant applies only to records created by the requesting user
  granted_by UUID REFERENCES users(id),            -- NULL for migration-seeded template grants
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

-- Delegated administration ceiling: permissions a role administrator may grant.
CREATE TABLE role_admin_ceilings (
  admin_role_id UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (admin_role_id, permission_id)
);

-- Role-conflict rules (e.g. Auditor + any write-capable role).
CREATE TABLE role_conflict_rules (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  role_a_id UUID NOT NULL REFERENCES roles(id),
  role_b_id UUID REFERENCES roles(id),            -- NULL = conflicts with any role flagged write-capable
  rule_type TEXT NOT NULL CHECK (rule_type IN ('BLOCK','REQUIRES_EXCEPTION')),
  description TEXT NOT NULL,
  CHECK (role_b_id IS NULL OR role_a_id <> role_b_id)
);

-- Periodic access reviews.
CREATE TABLE access_reviews (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  period_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETED')),
  started_by UUID NOT NULL REFERENCES users(id),
  completed_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_role_assignments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('ALL_CENTRES','SELECTED_CENTRES','NO_CENTRE_SCOPE')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  reason TEXT,
  granted_by UUID NOT NULL REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- Prevent duplicate active assignments of the same role to the same user with the same scope type.
CREATE UNIQUE INDEX uq_active_assignment
  ON user_role_assignments (user_id, role_id, scope_type) WHERE status = 'ACTIVE';

CREATE TABLE user_role_assignment_centres (
  assignment_id UUID NOT NULL REFERENCES user_role_assignments(id),
  centre_id UUID NOT NULL REFERENCES centres(id),
  PRIMARY KEY (assignment_id, centre_id)
);

```

Privileged access changes (create/update role, change permissions, assign/revoke role) use the shared `approval_requests` workflow defined in `09_DATABASE_DESIGN_SCHEMA.md` (with `target_type` of `ROLE`, `ROLE_PERMISSIONS` or `ROLE_ASSIGNMENT` and the proposed change in its before/after summary), not a separate approval table. This keeps one maker-checker mechanism and one self-approval rule.

Additional implementation requirements:

- Ensure system-template role keys and protected permissions cannot be deleted through ordinary application APIs.
- Ensure `SELECTED_CENTRES` assignments have at least one corresponding centre row and that assigned centres belong to the same organization. Use transaction/service validation and database constraints/triggers as appropriate.
- Enforce assignment scope for each request; do not try to encode all scope logic into the role itself.
- Seed the permission catalogue via versioned migrations and additive seeds. Permission keys are stable API/security contracts.
- Add indexes for active assignments by user/organization, role-permission lookups, and assignment-centre lookups.
- Record the before/after state of role/permission/assignment changes in the append-only audit log.
- Independent approval of high-risk access changes uses the shared `approval_requests` workflow when enabled (see above).
- Seeded system templates and their grants have NULL `created_by` / `granted_by` (migration-seeded); every later change records the acting user.
- Decide whether `roles` are global templates or organization-owned. In this product, organization-owned custom roles plus protected system templates are recommended.

## 12. API requirements for RBAC

All endpoints require authentication. Every mutation requires the specific permission, is scope-checked, validated, audited and tested.

- `GET /api/v1/permissions` — list the controlled catalogue; requires `permissions.catalogue_view`.
- `GET /api/v1/roles` / `GET /api/v1/roles/:id` — list/detail within administrative scope; requires `roles.view`.
- `POST /api/v1/roles` — create draft custom role; requires `roles.create`.
- `POST /api/v1/roles/:id/clone` — clone template/role; requires `roles.clone`.
- `PATCH /api/v1/roles/:id` — update custom role metadata/status; requires `roles.update`.
- `PUT /api/v1/roles/:id/permissions` — replace/update permission grants in a validated transaction; requires `roles.manage_permissions` and passes permission-ceiling checks.
- `GET /api/v1/users/:id/effective-access` — show effective roles/permissions/scopes to authorized access administrator and, where suitable, the user themselves in a limited self-view.
- `POST /api/v1/users/:id/role-assignments` — assign a role with scope; requires `users.assign_roles`.
- `PATCH /api/v1/role-assignments/:id/revoke` — revoke an assignment; requires `users.revoke_roles`, and audit.
- `GET /api/v1/access-reviews` / `POST /api/v1/access-reviews` / `POST /api/v1/access-reviews/:id/complete` — access review workflows (`access_reviews.view` / `access_reviews.complete`).
- Privileged role/permission/assignment changes that require independent approval are decided through `GET /api/v1/approvals` and `POST /api/v1/approvals/:id/decide` (see `11_API_AND_INTEGRATION_SPEC.md`).
- `GET /api/v1/audit-events` — requires `audit_events.view` with audit scope.

Use pagination, allowlisted filtering, optimistic concurrency/version checks for role edits, idempotency keys for assignment operations where retries are possible, and consistent status behavior: `403 Forbidden` when the caller lacks the required permission, and `404 Not Found` for a resource that does not exist or lies outside the caller's centre scope, so the existence of an inaccessible centre/resource is not leaked.

## 13. UX requirements for the Role Builder

- Search/filter the permission catalogue by module, action, sensitivity, centre scope and financial impact.
- Use clear labels such as **Upload Revenue Reports**, **Record Service-Charge Payments**, **Approve Payments**, **Allocate Receipts**, **Post Charges**, **View Audit Trail**, and **Export Reports**; show the underlying permission key in advanced details.
- Show “what this role can do” and “what this role cannot do” summaries.
- Display the selected permission count and identify high-risk grants visibly but neutrally.
- Warn if a role combines report preparation with posting/approval or combines auditor access with mutations.
- Show impact preview: users assigned to the role, centres exposed, and permissions added/removed.
- Require a reason for privileged permission changes and role deactivation.
- Allow clone-and-edit of templates and support draft roles that cannot be assigned prematurely.
- Provide an effective-access preview for a selected user, including inherited permissions and centre scope.
- Show confirmation before saving and a success result only after the server confirms the transaction.
- Ensure role/permission data grids are keyboard accessible; colour alone must not signify privileged actions.

## 14. Acceptance criteria

1. An authorized administrator can create a custom role, select granular catalogue permissions, save it as Draft, review its impact, activate it and assign it to users.
2. A Report Uploader can upload within scope but cannot post charges, record payments or change permissions.
3. A Payment Recorder can create/update draft service-charge receipts and submit them but cannot approve/post them unless explicitly granted an approved policy path.
4. A Payment Allocator can allocate within authorized scope but cannot over-allocate receipts or receivables.
5. An Auditor can inspect permitted finance records and audit history but cannot mutate records. Export/download remains independently controlled.
6. An Executive Viewer can see dashboard aggregates within scope but cannot change financial records.
7. A user with a selected-centre assignment cannot access another centre by changing the URL, request body, API filter or storage object key.
8. An administrator cannot grant permissions outside their delegated ceiling or use role assignment to elevate themselves.
9. Required maker-checker rules prevent self-approval even when a user has multiple roles.
10. Revoking a role assignment, deactivating a user or removing a role permission takes effect within 5 minutes (D-015: access token ≤ 15 minutes, server-side permission cache ≤ 60 seconds) and invalidates cached permissions/session access.
11. Role creation, permission changes, assignment/scope changes, deactivation and access-review completion are audited with actor, timestamp, target, reason and before/after state.
12. Protected financial ledger entries and audit events cannot be hard-deleted via the application.
13. Automated tests cover every permission key's positive and negative paths, role combinations, centre scope, disabled users and stale sessions.

## 15. Decisions for the business owner (all recommended defaults below were accepted — see `07_BUSINESS_RULES_AND_DECISIONS.md` §2b)

| ID | Decision | Recommended default |
|---|---|---|
| RBAC-OD-01 | Can all active roles be combined on one user? | Yes by default, but enforce explicit role-conflict rules; prohibit Auditor plus write role unless formally excepted. |
| RBAC-OD-02 | Can accountants post their own receipt entries? | Record and submit by default; a different user approves/posts when maker-checker applies. A controlled low-value exception can be configured later. |
| RBAC-OD-03 | Can auditors export/download source evidence? | No by default. Grant export and file-download permissions separately after approval. |
| RBAC-OD-04 | Who can manage user roles and permissions? | Dedicated Access Administrator and/or Super Admin with permission ceilings; high-privilege changes audited and optionally independently approved. |
| RBAC-OD-05 | Should permission thresholds be monetary? | Support a policy extension; start with action-based segregation, then add amount thresholds if business policy defines values. |
| RBAC-OD-06 | How often is access reviewed? | Quarterly review for privileged/financial roles; cadence remains configurable and subject to business approval. |

## 16. Related documents

- `03_PRD.md` — product scope and user profiles.
- `04_FRD.md` — functional requirements and stable requirement IDs.
- `05_USER_JOURNEY.md` and `06_USER_STORIES.md` — workflows and acceptance stories.
- `09_DATABASE_DESIGN_SCHEMA.md` — relational entities and constraints.
- `11_API_AND_INTEGRATION_SPEC.md` — endpoint semantics and authorization middleware.
- `13_UI_UX_SPECIFICATION.md` — administration and Role Builder interaction design.
- `14_SECURITY_PRIVACY_AUDIT_GUARDRAILS.md` — enforcement and coding guardrails.
- `15_TEST_STRATEGY_ACCEPTANCE_CRITERIA.md` — automated authorization and SoD testing.
