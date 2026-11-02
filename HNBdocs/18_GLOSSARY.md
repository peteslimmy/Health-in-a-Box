# Glossary

| Term | Definition in this product |
|---|---|
| Centre | A hospital, facility or business entity whose revenue reports and service-charge obligations are managed. |
| Department / Service | A revenue-generating category in the source report, such as Pharmacy, Radiology or Oxygen. These are not operating-cost items. |
| Payment channel (source report) | How the centre reports the underlying collection, such as Cash, Cheque, POS, EFT, Mobile Money, eWALLET, oWallet or BANK3D. |
| Service-charge payment / receipt | Money the centre pays to the operator to settle service-charge obligations. This is separate from the centre's patient collection channels. |
| Reported revenue | Revenue total stated by a centre in its source report. It does not by itself verify that the underlying patient receipts were deposited or settled. |
| Eligible revenue | Portion of reported revenue that the centre's commercial agreement says is subject to a service charge. |
| Commercial agreement | Contractual terms governing the service-charge relationship between the operator and a centre. |
| Charge rule | Machine-readable rule for applying rate, eligibility/exemption and calculation basis to a centre/department/channel and effective period. |
| Effective date | Date a commercial/configuration rule begins or ceases to apply. Boundaries must be explicitly defined. |
| Expected service charge | Amount calculated from eligible reported revenue and the applicable rule. It is an application measure; accounting recognition policy must be confirmed. |
| Charge run | A calculation batch that applies rules to selected validated revenue reports/records. |
| Posted charge | A charge calculation committed to the authoritative receivable ledger under the configured workflow. |
| Receivable | An amount the operator records as owed by a centre. Its accounting recognition and due date follow approved policy. |
| Ledger entry | Immutable posted financial movement that increases or decreases a receivable balance. |
| Debit (receivable convention) | In this product's proposed receivable-ledger convention, increases the amount owed. This is a domain convention and should be documented consistently. |
| Credit (receivable convention) | Decreases a receivable balance, for example a valid allocated payment or approved credit adjustment. |
| Payment allocation | Explicit link that applies a service-charge receipt, in whole or part, to a specific obligation/receivable. |
| Unallocated receipt | Money recorded as received but not yet applied to a specific receivable. It does not automatically reduce unrelated balances. |
| Opening balance | Verified receivable amount brought forward at a defined migration cutoff date. |
| Historical migration | Controlled import of prior data and financial state into the application. |
| Dry run | Parse and validate an import without posting financial entries or activating configuration changes. |
| Import batch | A uniquely identified collection of source file(s), rows, mapping version, validation results and commit status. |
| Import template | A saved set of rules mapping a centre's source layout to normalized internal fields. |
| Alias | Alternate source label mapped to a canonical department or payment channel for consistent analysis. |
| Control total | Total stated in a source report or legacy workbook used to validate row/period totals. It is not an additional revenue fact. |
| Variance | Difference between two amounts being compared, such as reported department total and sum of source channel amounts. |
| Outstanding balance | Remaining receivable as at a specified date after posted debit/credit movements and allocations. |
| Not yet due | Open receivable whose due date has not passed, according to the approved boundary policy. |
| Overdue | Open receivable whose due date has passed, according to the approved boundary policy. |
| Ageing | Grouping of open receivables by days past due as at a specified date. |
| Statement | A document summarizing centre account movements and balance for a period or as-at date. It does not automatically create a receivable unless the configured business flow says so. |
| Invoice | A billing document under an agreed billing process; its use and numbering are subject to finance/contract confirmation. |
| Adjustment | A controlled debit/credit entry correcting or supplementing financial records without silently rewriting the original. |
| Reversal | A linked, usually equal-and-opposite compensating entry that negates or reverses a prior posted event while preserving history. |
| Multi-centre | One operator manages multiple centre records within the application. |
| Multi-tenant | Independent organizations use the same software while their data is isolated. Public multi-organization SaaS is not part of MVP scope. |
| RBAC | Role-based access control. |
| Permission | A stable catalogue key in `resource.action` form (e.g. `payments.record`) that authorizes one backend capability. |
| Role | A named bundle of catalogue permissions; system templates are protected and custom roles are organization-owned. |
| Role assignment | Link of one user to one role with its own centre scope, dates, reason and grantor. |
| Scope | The set of centres (all or selected) to which a specific role assignment applies. Evaluated per assignment, never merged across permissions. |
| Segregation of duties (SoD) | Policy that the same person cannot both prepare and approve a sensitive action; implemented as maker-checker and role-conflict rules. |
| Break-glass | Documented, alerted and reviewed emergency access path used only when normal privileged administration is unavailable; never a bypass of the immutable ledger or audit. |
| Receivable item | A posted DEBIT ledger entry (charge, opening balance or debit adjustment) that can be settled by allocations or credit adjustments; the unit of per-obligation balance, ageing and dispute. |
| Dispute | A record against a receivable item recording that the centre contests it; does not change the balance. |
| Maker-checker | Workflow in which the user who initiates a sensitive action cannot also approve it when independent approval is required. |
| Idempotency | A retry-safe operation whose repeat execution does not create duplicate financial effects. |
| Source lineage | Links from displayed financial values to their origin report, row, mapping, applicable rule, calculation and posting/payment records. |
