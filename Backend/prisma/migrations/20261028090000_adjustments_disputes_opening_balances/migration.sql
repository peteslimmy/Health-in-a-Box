-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UPHELD', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "adjustmentTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "disputeId" UUID,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "raisedById" UUID NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "adjustmentId" UUID,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBalance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "asAt" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "sourceNote" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "receivableId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Adjustment_organizationId_centreId_status_idx" ON "Adjustment"("organizationId", "centreId", "status");

-- CreateIndex
CREATE INDEX "Adjustment_receivableId_idx" ON "Adjustment"("receivableId");

-- CreateIndex
CREATE INDEX "Dispute_organizationId_centreId_status_idx" ON "Dispute"("organizationId", "centreId", "status");

-- CreateIndex
CREATE INDEX "Dispute_receivableId_idx" ON "Dispute"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_receivableId_key" ON "OpeningBalance"("receivableId");

-- CreateIndex
CREATE INDEX "OpeningBalance_organizationId_centreId_status_idx" ON "OpeningBalance"("organizationId", "centreId", "status");

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Receivable: what is owed is the original charge plus net adjustments, less what has been paid.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "Receivable"
  DROP CONSTRAINT "Receivable_paid_bounds",
  DROP CONSTRAINT "Receivable_balance_consistent";
ALTER TABLE "Receivable"
  ADD CONSTRAINT "Receivable_paid_bounds"
    CHECK ("amountPaid" >= 0 AND "amountPaid" <= "originalAmount" + "adjustmentTotal"),
  ADD CONSTRAINT "Receivable_balance_consistent"
    CHECK ("balance" >= 0 AND "balance" = "originalAmount" + "adjustmentTotal" - "amountPaid");

-- ---------------------------------------------------------------------------------------------
-- Approval controls enforced by the database as well as the application.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "Adjustment"
  ADD CONSTRAINT "Adjustment_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "Adjustment_decider_not_maker" CHECK ("decidedById" IS NULL OR "decidedById" <> "createdById"),
  ADD CONSTRAINT "Adjustment_decision_complete"
    CHECK (("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
        OR ("status" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));

ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "Dispute_resolution_complete"
    CHECK (("status" = 'OPEN' AND "resolvedById" IS NULL AND "resolvedAt" IS NULL)
        OR ("status" <> 'OPEN' AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL));
-- One open dispute per receivable.
CREATE UNIQUE INDEX "Dispute_one_open_per_receivable" ON "Dispute" ("receivableId") WHERE "status" = 'OPEN';

ALTER TABLE "OpeningBalance"
  ADD CONSTRAINT "OpeningBalance_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "OpeningBalance_decider_not_maker" CHECK ("decidedById" IS NULL OR "decidedById" <> "createdById"),
  ADD CONSTRAINT "OpeningBalance_approved_has_receivable"
    CHECK (("status" = 'APPROVED') = ("receivableId" IS NOT NULL)),
  ADD CONSTRAINT "OpeningBalance_decision_complete"
    CHECK (("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
        OR ("status" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));
-- One live opening balance per centre and as-at date.
CREATE UNIQUE INDEX "OpeningBalance_one_live_per_centre_date"
  ON "OpeningBalance" ("centreId", "asAt") WHERE "status" <> 'REJECTED';

-- ---------------------------------------------------------------------------------------------
-- Permissions for the new areas, granted to the system roles that need them. Idempotent.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "name", "description", "group") VALUES
  (gen_random_uuid(), 'adjustments.read',    'View adjustments',    'View credit and debit adjustments and opening balances', 'Adjustments'),
  (gen_random_uuid(), 'adjustments.create',  'Propose adjustments', 'Propose credit or debit adjustments and opening balances', 'Adjustments'),
  (gen_random_uuid(), 'adjustments.approve', 'Approve adjustments', 'Approve or reject adjustments and opening balances proposed by someone else', 'Adjustments'),
  (gen_random_uuid(), 'disputes.read',       'View disputes',       'View disputes raised against receivables', 'Adjustments'),
  (gen_random_uuid(), 'disputes.manage',     'Manage disputes',     'Raise and resolve disputes', 'Adjustments')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('adjustments.read', 'adjustments.create', 'adjustments.approve', 'disputes.read', 'disputes.manage')
WHERE r."isSystem" = true AND r."code" IN ('ADMIN', 'FINANCE_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('adjustments.read', 'adjustments.create', 'disputes.read', 'disputes.manage')
WHERE r."isSystem" = true AND r."code" = 'FINANCE_OFFICER'
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('adjustments.read', 'disputes.read')
WHERE r."isSystem" = true AND r."code" = 'AUDITOR'
ON CONFLICT DO NOTHING;
