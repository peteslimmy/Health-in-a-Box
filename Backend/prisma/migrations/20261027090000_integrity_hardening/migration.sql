-- DropForeignKey
ALTER TABLE "Centre" DROP CONSTRAINT "Centre_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_centreId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentChannel" DROP CONSTRAINT "PaymentChannel_centreId_fkey";

-- DropForeignKey
ALTER TABLE "CommercialAgreement" DROP CONSTRAINT "CommercialAgreement_centreId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeRule" DROP CONSTRAINT "ChargeRule_centreId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeRule" DROP CONSTRAINT "ChargeRule_agreementId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeRule" DROP CONSTRAINT "ChargeRule_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeRule" DROP CONSTRAINT "ChargeRule_paymentChannelId_fkey";

-- DropForeignKey
ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_centreId_fkey";

-- DropForeignKey
ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_committedReportId_fkey";

-- DropForeignKey
ALTER TABLE "RevenueReport" DROP CONSTRAINT "RevenueReport_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "RevenueReport" DROP CONSTRAINT "RevenueReport_centreId_fkey";

-- DropForeignKey
ALTER TABLE "RevenueReport" DROP CONSTRAINT "RevenueReport_importBatchId_fkey";

-- DropForeignKey
ALTER TABLE "RevenueLine" DROP CONSTRAINT "RevenueLine_reportId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeRun" DROP CONSTRAINT "ChargeRun_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeRun" DROP CONSTRAINT "ChargeRun_centreId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeLine" DROP CONSTRAINT "ChargeLine_chargeRunId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeLine" DROP CONSTRAINT "ChargeLine_revenueLineId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeLine" DROP CONSTRAINT "ChargeLine_paymentChannelId_fkey";

-- DropForeignKey
ALTER TABLE "ChargeLine" DROP CONSTRAINT "ChargeLine_ruleId_fkey";

-- DropForeignKey
ALTER TABLE "Receivable" DROP CONSTRAINT "Receivable_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Receivable" DROP CONSTRAINT "Receivable_centreId_fkey";

-- DropForeignKey
ALTER TABLE "Receivable" DROP CONSTRAINT "Receivable_chargeLineId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_centreId_fkey";

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_receivableId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_centreId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentAllocation" DROP CONSTRAINT "PaymentAllocation_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_centreId_fkey";

-- DropForeignKey
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_actorId_fkey";

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "contentFingerprint" TEXT;

-- AlterTable
ALTER TABLE "RevenueReport" ADD COLUMN     "contentFingerprint" TEXT;

-- AddForeignKey
ALTER TABLE "Centre" ADD CONSTRAINT "Centre_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentChannel" ADD CONSTRAINT "PaymentChannel_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialAgreement" ADD CONSTRAINT "CommercialAgreement_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_paymentChannelId_fkey" FOREIGN KEY ("paymentChannelId") REFERENCES "PaymentChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_committedReportId_fkey" FOREIGN KEY ("committedReportId") REFERENCES "RevenueReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReport" ADD CONSTRAINT "RevenueReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReport" ADD CONSTRAINT "RevenueReport_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReport" ADD CONSTRAINT "RevenueReport_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueLine" ADD CONSTRAINT "RevenueLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "RevenueReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRun" ADD CONSTRAINT "ChargeRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRun" ADD CONSTRAINT "ChargeRun_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_chargeRunId_fkey" FOREIGN KEY ("chargeRunId") REFERENCES "ChargeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_revenueLineId_fkey" FOREIGN KEY ("revenueLineId") REFERENCES "RevenueLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_paymentChannelId_fkey" FOREIGN KEY ("paymentChannelId") REFERENCES "PaymentChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ChargeRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_chargeLineId_fkey" FOREIGN KEY ("chargeLineId") REFERENCES "ChargeLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Integrity hardening (hand-written; Prisma cannot express these controls)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Charge rules: valid rate, valid dates, and no overlapping active rule for the same scope.
ALTER TABLE "ChargeRule"
  ADD CONSTRAINT "ChargeRule_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100),
  ADD CONSTRAINT "ChargeRule_dates_ordered" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "ChargeRule_no_overlap" EXCLUDE USING gist (
    "centreId" WITH =,
    (COALESCE("departmentId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE("paymentChannelId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
  ) WHERE ("isActive");

ALTER TABLE "CommercialAgreement"
  ADD CONSTRAINT "CommercialAgreement_dates_ordered" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- Revenue facts.
ALTER TABLE "RevenueReport"
  ADD CONSTRAINT "RevenueReport_period_ordered" CHECK ("periodEnd" >= "periodStart"),
  ADD CONSTRAINT "RevenueReport_totals_nonneg" CHECK ("grandTotal" >= 0 AND "channelTotal" >= 0);

ALTER TABLE "RevenueLine"
  ADD CONSTRAINT "RevenueLine_amounts_nonneg" CHECK ("reportedTotal" >= 0 AND "channelTotal" >= 0);

-- Charge calculation.
ALTER TABLE "ChargeRun"
  ADD CONSTRAINT "ChargeRun_period_ordered" CHECK ("periodEnd" >= "periodStart"),
  ADD CONSTRAINT "ChargeRun_totals_nonneg" CHECK ("baseTotal" >= 0 AND "chargeTotal" >= 0);

ALTER TABLE "ChargeLine"
  ADD CONSTRAINT "ChargeLine_amounts_nonneg" CHECK ("baseAmount" >= 0 AND "chargeAmount" >= 0),
  ADD CONSTRAINT "ChargeLine_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100);

-- Receivables: stored balance must always equal original - paid.
ALTER TABLE "Receivable"
  ADD CONSTRAINT "Receivable_original_positive" CHECK ("originalAmount" > 0),
  ADD CONSTRAINT "Receivable_paid_bounds" CHECK ("amountPaid" >= 0 AND "amountPaid" <= "originalAmount"),
  ADD CONSTRAINT "Receivable_balance_consistent" CHECK ("balance" >= 0 AND "balance" = "originalAmount" - "amountPaid");

-- Ledger: exactly one of debit/credit is positive.
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_one_sided" CHECK (
    ("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)
  );

-- Payments and allocations.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "Payment_unallocated_bounds" CHECK ("unallocatedAmount" >= 0 AND "unallocatedAmount" <= "amount");

ALTER TABLE "PaymentAllocation"
  ADD CONSTRAINT "PaymentAllocation_amount_positive" CHECK ("amount" > 0);

-- Duplicate-report protection: the same content for the same centre and period cannot be
-- ready/committed twice (a NEEDS_REVIEW batch does not block a corrected re-upload).
CREATE UNIQUE INDEX "ImportBatch_active_fingerprint_key"
  ON "ImportBatch" ("centreId", "periodStart", "periodEnd", "contentFingerprint")
  WHERE "contentFingerprint" IS NOT NULL
    AND "status" IN ('READY_TO_COMMIT'::"ImportStatus", 'PROCESSING'::"ImportStatus", 'COMMITTED'::"ImportStatus");

CREATE UNIQUE INDEX "RevenueReport_fingerprint_key"
  ON "RevenueReport" ("centreId", "periodStart", "periodEnd", "contentFingerprint")
  WHERE "contentFingerprint" IS NOT NULL AND "status" = 'COMMITTED'::"ReportStatus";

-- Append-only ledger and audit trail: no UPDATE or DELETE by the application role.
CREATE OR REPLACE FUNCTION hnb_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on "%" is not permitted: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION hnb_forbid_mutation();

CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION hnb_forbid_mutation();