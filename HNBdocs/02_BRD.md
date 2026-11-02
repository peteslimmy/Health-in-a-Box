# Business Requirements Document (BRD)

**Document status:** Draft 0.1  
**Business owner:** To be assigned by the operator  
**Primary process:** Centre reported revenue → service-charge entitlement → payment received → receivables reconciliation

## 1. Executive summary

The operator manages service arrangements with multiple healthcare centres. Each centre reports revenue through files whose formats may differ. The operator calculates service charges under centre-specific commercial arrangements and records payments the operator receives from each centre. The business needs a controlled system to consolidate this information, explain expected charges, track partial or irregular remittances, identify outstanding receivables and retain a reliable audit trail.

## 2. Business problem

The current process, as described, depends on importing and interpreting financial reports, applying varying commercial rules, and comparing calculations with actual remittances. If the information is maintained separately or manually, the business is exposed to duplicate imports, inconsistent department mapping, incorrect rate application, weak linkage between expected charges and payments, incomplete historical balances, and lack of clear overdue or disputed status.

## 3. Business objectives

- Centralize all managed centres and their commercial configurations.
- Standardize different source-report layouts into a consistent internal data model.
- Calculate expected service charges transparently and repeatably.
- Record the actual service-charge money received by the operator.
- Accurately allocate receipts to outstanding obligations.
- Show current, not-yet-due, overdue, disputed, partially paid, settled and unallocated amounts.
- Import historical records without double-counting balances.
- Give management consolidated and centre-level visibility.
- Preserve financial history, supporting evidence and accountability for changes.
- Reduce manual spreadsheet consolidation and make exceptions easier to resolve.

## 4. Stakeholders

| Stakeholder | Need / responsibility |
|---|---|
| Business owner / Super Admin | Owns centre configuration, commercial terms, access policy and high-risk approvals. |
| Finance Manager / Reviewer | Reviews imported reports, charge calculations, adjustments, reconciliations and exception reports. |
| Accountant | Uploads reports, reviews validation outcomes, records service-charge receipts, allocates payments and prepares statements. |
| Management / Read-only Analyst | Views consolidated performance, outstanding balances, revenue trends and downloadable reports. |
| System administrator / developer | Operates deployment, configures integrations, maintains backups and resolves technical issues without bypassing financial controls. |
| Access Administrator / Auditor | Manage users, roles and scopes without gaining finance posting rights; inspect records read-only. The stakeholder rows above are personas; enforceable roles are the templates in `19_RBAC_ROLE_PERMISSION_MODEL.md`. |
| External hospital/centre representatives | Not first-release users; their obligations and statements are represented by internal records. |

## 5. Business scope

### Included

1. Centre onboarding, agreement metadata, service-charge rules and payment terms.
2. Bulk department and payment-channel creation, import and reuse.
3. Revenue report import from Excel, CSV and supported digital PDFs.
4. Centre-specific field mappings and standardization of departments/channels.
5. Validation and exception handling for row totals, grand totals, dates, amounts and duplicates.
6. Service-charge calculations and review/posting controls.
7. Actual service-charge payment recording and payment allocation.
8. Receivable balances, due dates, ageing, statements and reporting.
9. Historical data bulk import and opening-balance migration.
10. Audit, roles, approvals, adjustments and reversal workflows.

### Excluded unless approved

Patient-level payment reconciliation, direct bank feed integrations, external centre portal, full accounting/ERP general ledger, accounts payable, operating expense tracking, public SaaS subscription management, automatic OCR of every scanned document, automatic financial posting from AI suggestions.

## 6. Business capabilities and requirements

| ID | Requirement | Priority |
|---|---|---|
| BR-001 | Maintain a configurable record for each centre and its commercial relationship. | Must |
| BR-002 | Support different revenue report formats for different centres. | Must |
| BR-003 | Import and validate daily/periodic reported revenue. | Must |
| BR-004 | Calculate expected service charges based on the agreed eligible revenue and applicable rule. | Must |
| BR-005 | Keep revenue departments distinct from operating expenses. | Must |
| BR-006 | Record actual service-charge receipts paid to the operator by a centre. | Must |
| BR-007 | Support partial, multiple-period, advance and unallocated payments, subject to approved accounting treatment. | Must |
| BR-008 | Track outstanding receivables and centre-specific payment due dates. | Must |
| BR-009 | Support historical bulk imports, migration and verified opening balances. | Must |
| BR-010 | Allow bulk setup of departments and payment channels during centre onboarding. | Must |
| BR-011 | Preserve posted financial records and audit sensitive changes. | Must |
| BR-012 | Provide consolidated and centre-level analytics and exports. | Must |
| BR-013 | Support statement generation (MVP) and conditional invoice generation. | Must (statements) / Should (invoices) |
| BR-016 | Provide configurable roles, a controlled permission catalogue, centre-scoped role assignment, segregation of duties and periodic access review (see `19_RBAC_ROLE_PERMISSION_MODEL.md`). | Must |
| BR-014 | Provide notifications/reminders for overdue balances and unresolved exceptions. | Should |
| BR-015 | Provide advanced anomaly detection and forecasting. | Could / later |

## 7. Business rules and policies

- A centre's contract/agreement defines the service-charge calculation basis. A centre-wide default with optional department and payment-channel overrides is the proposed configurable model, subject to business confirmation.
- A report's `Total Amount` column is a control total; it must not be added to the payment-channel figures as additional revenue.
- An uploaded report is not considered financially posted until validation and the required approval/posting step are complete.
- Expected service charges are calculated from validated reported revenue and historical applicable rules.
- Actual payments are service-charge payments received by the operator—not patient receipts in the source report.
- Payment date, revenue date, charge period, posting date and due date are separate concepts.
- Costs are not in scope as a deduction module. The items initially described as costs were clarified as revenue departments.
- Missing historical rate information must not be silently replaced with today's rate. Import the trusted historical charge where authorized or hold the record for resolution.
- Duplicate imports/retries must not post duplicate financial records.
- Posted financial entries are corrected with approved adjustment/reversal entries, retaining the original history.

## 8. Expected business benefits

- More reliable visibility into expected service-charge revenue and collections.
- Faster identification of underpayments and overdue balances.
- A consistent source for management reporting across different centres.
- Less dependence on manual spreadsheets and individual staff knowledge.
- Improved evidence for collection follow-up and contractual discussions.
- Safer onboarding of centres and migration of legacy information.

## 9. Measures of success

Measure baseline performance before setting final targets. Recommended measures are:

- Percentage of source reports processed without manual re-keying.
- Percentage of reports that pass validation on first submission.
- Duplicate submissions blocked before posting.
- Value of unallocated receipts and time to allocate them.
- Total overdue receivables and ageing by centre.
- Time from report upload to approved posting.
- Percentage of posted charge entries with complete source/rule lineage.
- Count and value of unresolved reconciliation exceptions.
- Difference between application ledger balances and independently verified finance balances.

## 10. Dependencies and constraints

- Sample source files from each distinct report format are required to finalize mapping and parser rules.
- Actual agreements/rates and their effective dates are required to validate charge calculations.
- Historical data quality and payment references determine the degree of automated matching possible.
- Accounting owner must approve the treatment of revenue recognition, due dates, rounding, advances, credits and opening balances.
- A representative migration dataset is required to test volume, duplicate detection and reconciliation.

## 11. Risks

| Risk | Business impact | Mitigation |
|---|---|---|
| Incorrect rule or rate | Wrong expected service charge and receivable | Effective-dated rule versions, preview, approval, tests and calculation traceability |
| Bad source report | Incorrect revenue base | Row/grand-total checks and exception review |
| Duplicate upload | Revenue/charges counted more than once | Fingerprints, duplicate checks, idempotent posting and audit |
| Historical rates missing | Wrong back-calculation | Do not infer current rate; quarantine or import approved historic amounts |
| Payments not allocated | Inflated outstanding or unclear balances | Explicit allocation workflow and unallocated receipt report |
| Uncontrolled edits | Lost financial history | Append-only financial ledger and compensating entries |
| Report layout changes | Failed or mis-mapped import | Template versions, validation, mapping preview and regression fixtures |

## 12. Assumptions requiring approval

- NGN is the default display currency; multi-currency is not required in MVP unless confirmed.
- The operator is the single tenant/organisation in MVP, with multiple centre scopes.
- The system is not a replacement for a full statutory general ledger.
- Statements are required; invoice behavior depends on the actual agreements and finance policy.
- A default centre rate and lower-level overrides are supported by the engine, but which rule applies to a specific centre must come from its agreement.
