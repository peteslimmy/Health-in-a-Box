# HNB Receivables Platform: Data Cut-over and Migration Plan

**Date:** 2026-11-05 · **Applies to:** Finance Lead, IT Operations, Centre Accountants

---

## 1. Objective
To establish a precise, repeatable, and reconcilable transition path from the accountant's legacy control workbooks (Excel/manual) to the HNB Receivables Platform, preventing double-counting, missing opening figures, or unreconciled variances.

---

## 2. Pre-requisites
1. **Infrastructure Ready:** Production environment validated using `validate-prod-env.ts`, TLS active, MinIO storage mounted and backed up.
2. **Access Control:** Super admin created, approved domains configured, MFA enforced for administrators and approvers.
3. **Signed Agreements:** Every participating centre's charge rules (percentage, rounding, calculation level, due dates) verified and locked in the platform.

---

## 3. Cut-over Timeline (Per Centre)

### Phase A: Historical Alignment (T-14 Days)
1. **Load Master Data:** Create the hospital, its departments, payment channels, and charge rules in the platform.
2. **Parallel Run Period:** The centre accountant maintains *both* their control workbook and the platform for a full billing cycle.
3. **Reconciliation Check:** Compare platform charge runs against the workbook daily. Any variance must be investigated immediately (e.g., differing rounding modes or unrecorded exemptions).

### Phase B: Opening Balance Cut-over Date (T-Day)
1. **Cut-off Time:** End of the prior month (e.g., October 31st, 2026 at 23:59). No new charges or receipts may be recorded in the legacy system after this timestamp.
2. **Extract Legacy Balances:** Generate the final aged receivables trial balance from the legacy system/workbook, certified and signed by the Centre Accountant.
3. **Post Opening Balances:** 
   - Use the opening balance service / admin screen to create a single **Opening Balance Receivable** per aged period per centre, dated *before* the first platform charge.
   - Reference the legacy trial balance schedule in the description.

### Phase C: Live Operation (T+1 Day Onwards)
1. **First Platform Billing:** Run the first official charge run inside the platform for the new period (e.g., November).
2. **First Platform Receipts:** Record all new incoming payments directly into the platform, subject to maker-checker approval.
3. **Weekly Reconciliation:** Verify that `Unallocated Cash` + `Active Receivables` equals the General Ledger control total.

---

## 4. Reconciliation Protocol (The University of Abuja Test Case)
- **Rule:** If historical reports do not tally (e.g., the known ₦106,500 variance case), they **must not** be committed blindly.
- **Resolution:** 
  1. Use the **Approved Variance** exception path (`POST /imports/:id/commit-with-variance`).
  2. Provide a mandatory written justification (20+ characters) explaining the discrepancy.
  3. Ensure the finance manager signs off on the exception.

---

## 5. Rollback and Contingency
- If critical data corruption is detected during cut-over:
  1. Stop API container (`docker compose stop api`).
  2. Restore the pre-cut-over database backup using `pg_restore` into a fresh database.
  3. Revert to the legacy workbook until the discrepancy is resolved.
- **Never** attempt manual database edits via SQL `UPDATE`/`DELETE` on the ledger or audit tables.
