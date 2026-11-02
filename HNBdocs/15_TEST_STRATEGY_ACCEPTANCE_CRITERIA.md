# Test Strategy & Acceptance Criteria

## 1. Quality objective

Prove that the application calculates, posts, allocates and reports financial amounts consistently; prevents unauthorized or duplicate changes; and preserves traceability through normal uploads, bulk configuration and historical migration.

## 2. Test layers

### Unit tests

- Charge-rule selection and precedence.
- Eligible revenue selection, exclusions and exemptions.
- Decimal calculation and rounding methods.
- Effective-date boundary selection.
- Report total validation and normalization.
- Receivable balance formula, ageing bucket assignment and due-date calculation.
- Payment allocation constraints and unallocated amount logic.
- Duplicate signature/fingerprint functions.
- Role/permission helpers and centre-scope decisions.

### Integration tests

- PostgreSQL uniqueness/FK/check constraints.
- Transaction rollback on partial posting failure.
- Concurrent payment allocations against the same receipt/receivable.
- Idempotency for import commit and payment allocation.
- Object-storage authorization and expiring download URLs.
- Queue retry without duplicate staging or financial records.
- Audit/outbox event committed with financial state change.
- Migration cutoff and opening-balance overlap detection.

### End-to-end tests

- Create a centre with bulk departments/channels and activate it.
- Upload an Excel/CSV report, map fields, correct errors, preview charges and post.
- Upload an identical report again and confirm duplicate prevention.
- Record one payment and allocate it across two obligations.
- Show remaining unallocated receipt and open balance correctly.
- Import historical receipts and opening balances, run dry-run and approve/commit a migration.
- Correct a posted calculation using adjustment/reversal; compare before/after audit history.
- Verify dashboard totals and report exports match the underlying ledger.

### Security and permission tests

- Unauthenticated request to every protected route is rejected.
- Report Uploader / Payment Recorder / Payment Allocator templates (the "Accountant" persona) cannot change commercial rules or approve their own high-risk posting.
- Every permission key in the catalogue has a positive and a negative authorization test, per role template and per centre scope.
- Maker-checker: requester cannot approve or post their own charge run, receipt, adjustment, opening balance, migration or privileged access change, even when holding several roles.
- Permission scope pairing: a user with a write role on Centre A and a read role on Centre B cannot write to Centre B.
- Privilege ceiling: a role administrator cannot grant permissions above their ceiling or elevate themselves.
- Role-conflict rules: Auditor plus a write-capable role is blocked unless an exception is recorded.
- Revoking an assignment, deactivating a user or removing a role permission takes effect within the documented session/permission-cache policy; stale sessions are rejected.
- Out-of-scope resource requests return 404 and permission-denied requests return 403 with no data leakage.
- Read-only user cannot post, allocate, adjust or export outside their assigned permissions.
- User scoped to Centre A cannot access Centre B by changing a URL, request body, export filter or ID.
- Upload rejects disallowed formats, oversized files and unsafe content.
- Private source-file download cannot be accessed without authorized, non-expired URL/session.
- Audit access is restricted and audit events cannot be changed by ordinary runtime credentials.

## 3. Financial invariant tests (mandatory)

### INV-001 — Report arithmetic

For each accepted report line where all channels are present and mapped:

`computed_channel_total = sum(channel_amounts)`

`variance = source_reported_total - computed_channel_total`

If a variance is outside approved tolerance, line/report cannot enter a postable state.

### INV-002 — Control total not double-counted

`Total Amount` / report grand total fields are validation controls, not additional revenue facts. A fixture that has a 100 channel sum and 100 reported row total must produce revenue of 100, not 200.

### INV-003 — Charge reproducibility

Given the same normalized revenue inputs, effective rule snapshot and rounding policy version, the charge engine returns the same amount and trace details.

### INV-004 — Missing rules do not become zero

A non-exempt eligible revenue record with no valid applicable rule must fail validation or be held for exception resolution. It must not post as a zero-charge record without explicit policy.

### INV-005 — Rate change does not mutate history

Post a charge with one rate, create a future effective-dated rate change, and verify the historical posted charge and rule snapshot remain unchanged.

### INV-006 — Allocation conservation

For each payment:

`recorded receipt amount = allocated total + unallocated amount + formally reversed/returned amount (according to chosen receipt-state model)`

The implementation must document the precise equation for returned receipts and reversal events.

### INV-007 — No over-allocation

Sum of active allocations cannot exceed the payment's available amount. Active credit allocations cannot exceed the target receivable's remaining open amount unless approved advance/credit accounting explicitly permits it.

### INV-008 — Balance reconciliation

For each centre/currency/as-at date:

`open receivable = opening debit + posted debit charges/adjustments - posted credit adjustments - allocated payments`, adjusted for effective-date and reversal policies; per receivable item, `item balance = item amount - sum(CREDIT entries with applies_to_entry_id = item) + reversals of those credits`.

The dashboard, receivable list, centre statement and exported ageing report must agree for identical filters/as-at basis.

### INV-009 — Duplicate idempotency

Submit the same commit request twice with the same idempotency key. There must be one financial posting, and the second response references the original outcome.

### INV-010 — Historical migration conservation

For a successful migration, reconcile source totals to accepted plus explicitly excluded/rejected/duplicate rows. For migrated receipts, totals of allocations and unallocated amounts must reconcile to receipt totals according to the migration policy.

### INV-011 — Reversal linkage

A reversal must reference the original entry and preserve both. Net balance after reversal should match the specified correction, and audit links must show who approved it.

### INV-012 — Effective-date boundaries

Test a report immediately before, on and after a rule effective date using the agreed boundary convention (recommended: `effective_from` inclusive and `effective_to` inclusive at the business-date layer). The applicable rule must be deterministic. If PostgreSQL range types are used for overlap detection, an inclusive `effective_to` must be stored as the half-open range `[effective_from, effective_to + 1 day)` (or `daterange(..., '[]')`) so that two rules sharing a boundary date are correctly detected as overlapping.

## 4. Representative test data

Create anonymized fixtures covering:
- centre with one uniform default rate;
- centre with department override and exempt department;
- centre with payment-channel-specific rule if approved;
- two different report layouts for different centres;
- one unknown department label and one unknown payment channel;
- a row total mismatch and grand-total mismatch;
- a corrected report re-uploaded with a new filename;
- partial payment, one payment for multiple periods, unallocated amount, overpayment and reversed receipt;
- historic rate change; missing historic rate; an opening balance cutoff;
- duplicate department/channel entries during onboarding;
- a large file with more rows than the interactive preview page size.

All fixture money amounts and rates should be clearly marked as test-only. Do not load test fixtures into production.

## 5. Acceptance criteria for MVP release

Release can proceed only when:

1. P0 business decisions are signed off for actual financial posting.
2. All P0 functional requirements map to tests or documented manual control evidence.
3. Import→validate→calculate→review→post works end to end for representative centres and layouts.
4. Payment receipt and allocation works for partial/multi-obligation cases.
5. Historical migration has been rehearsed with source control totals and approved sign-off report.
6. Financial invariant suite passes with no known unexplained balance discrepancies.
7. RBAC and centre-scope negative tests pass.
8. Backup restoration has been tested and RPO/RTO accepted.
9. Monitoring and alerts exist for failed jobs, posting errors, backup failures and application availability.
10. User acceptance testing is signed off by the business owner and finance owner.

## 6. Defect severity

- **Blocker/P0:** financial data loss/duplication, wrong calculation, unauthorized posting/access, bypassed audit, incorrect balances, destructive migration or inability to reconcile.
- **High/P1:** major workflow blocked, report totals inaccurate, source traceability missing, or important role permissions incorrect.
- **Medium/P2:** non-critical UX or report issue with a safe workaround.
- **Low/P3:** cosmetic issue or enhancement with no financial/security impact.

No Blocker/P0 defects may remain at release. Any accepted lower severity defect must have an owner, impact statement, workaround and target date.

## 7. Implemented automated tests

The backend has 319 tests in 33 suites (268 run by default; the three database suites, including a centre-scope authorization matrix over every service, need `TEST_DATABASE_URL`), including refresh-token rotation and the dashboard summary. The frontend has 95 Vitest tests (formatting and exact decimal arithmetic, the API client's token refresh, sign-in, permission-filtered navigation, and the payment page's approval buttons and allocation dialog; see doc 21 §7). There is no browser end-to-end suite yet (`Backend/src/**/*.spec.ts`, run with `npm test`). Invariants covered: INV-001 (row total vs channel sum, blocking), INV-002 (control total not double-counted), INV-003 (reproducible charges), INV-004 (missing rule never zero), INV-005 (rate change not applied across history or inside a report), INV-008 (ledger debits equal posted charge lines), INV-009 (repeat commit/post is a no-op), INV-012 (inclusive effective-date boundaries). Also covered: per-assignment centre scope, privilege ceiling, role conflicts, maker-checker on import commit and charge-run approve/post, content-fingerprint duplicate detection, upload safety, ₦ amount parsing, half-up rounding, refusal to import to or charge a non-active centre, due dates counted on the centre's Lagos business day (including the 23:30 UTC case), and the database constraints (rule overlap, one-sided ledger, balance consistency, append-only ledger and audit, restrictive deletes, duplicate-report index). The database suite runs only when `TEST_DATABASE_URL` points at a throw-away database whose name contains "test" or "scratch".

INV-006, INV-007 (including parallel allocations against one receipt and one receivable on a real database; removing the row locks makes these tests fail) and INV-011 (allocation reversal) are covered. Not yet covered because the features are not built: INV-010, the HTTP-level authorization matrix, end-to-end flows and the performance targets. `21_IMPLEMENTATION_STATUS.md` §7 keeps the current list.
