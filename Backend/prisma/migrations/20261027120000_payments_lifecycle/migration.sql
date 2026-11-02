-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED', 'REVERSED');
ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING (CASE "status"::text WHEN 'REVERSED' THEN 'REVERSED' ELSE 'POSTED' END::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropIndex
DROP INDEX "PaymentAllocation_paymentId_receivableId_key";

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "chargeRunId" UUID;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedById" UUID,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" UUID,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" UUID,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "allocatedById" UUID,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedById" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_chargeRunId_key" ON "Receivable"("chargeRunId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_centreId_status_idx" ON "Payment"("organizationId", "centreId", "status");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_chargeRunId_fkey" FOREIGN KEY ("chargeRunId") REFERENCES "ChargeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Payments lifecycle (hand-written)
-- ============================================================================

-- Existing receipts pre-date the approval workflow: they were recorded and (partly) allocated
-- directly, so they become POSTED (the old allocation-state values UNALLOCATED /
-- PARTIALLY_ALLOCATED / ALLOCATED are now derived from "unallocatedAmount").
UPDATE "Payment" SET "postedAt" = "createdAt" WHERE "status" = 'POSTED' AND "postedAt" IS NULL;

-- Maker-checker enforced by the database as well as the service.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_approver_not_maker" CHECK ("approvedById" IS NULL OR "approvedById" <> "createdById"),
  ADD CONSTRAINT "Payment_poster_not_maker" CHECK ("postedById" IS NULL OR "postedById" <> "createdById");

-- Cash can only have been allocated once it is posted: before that the whole amount is unallocated.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_allocation_needs_posting"
  CHECK ("status" IN ('POSTED', 'REVERSED') OR "unallocatedAmount" = "amount");
-- A live receipt reference is unique per centre (case-insensitive); rejected and reversed receipts
-- release their reference so a corrected receipt can reuse it.
CREATE UNIQUE INDEX "Payment_live_reference_key"
  ON "Payment" ("centreId", lower("reference"))
  WHERE "reference" IS NOT NULL AND "status" NOT IN ('REJECTED'::"PaymentStatus", 'REVERSED'::"PaymentStatus");