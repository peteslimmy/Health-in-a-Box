-- CreateEnum
CREATE TYPE "CentreStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('REVENUE_REPORT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('DRAFT', 'UPLOADED', 'QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'READY_TO_COMMIT', 'FAILED', 'COMMITTED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('COMMITTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ChargeRunStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('HALF_UP', 'DOWN', 'UP');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNALLOCATED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CHARGE', 'OPENING_BALANCE', 'ADJUSTMENT_DEBIT', 'ADJUSTMENT_CREDIT', 'PAYMENT_ALLOCATION', 'REVERSAL');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "group" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "centreId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Centre" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "status" "CentreStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "openedAt" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Centre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentAlias" (
    "id" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "DepartmentAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentChannel" (
    "id" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentChannelAlias" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "PaymentChannelAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialAgreement" (
    "id" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeRule" (
    "id" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "agreementId" UUID,
    "departmentId" UUID,
    "name" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "rate" DECIMAL(9,6) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "rounding" "RoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL DEFAULT 'REVENUE_REPORT',
    "status" "ImportStatus" NOT NULL DEFAULT 'DRAFT',
    "fileName" TEXT,
    "fileKey" TEXT,
    "fileHash" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "rowsJson" JSONB,
    "normalizedJson" JSONB,
    "validationJson" JSONB,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validRowCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2),
    "errorMessage" TEXT,
    "createdById" UUID NOT NULL,
    "committedReportId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueReport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "reportDate" DATE NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'COMMITTED',
    "grandTotal" DECIMAL(18,2) NOT NULL,
    "channelTotal" DECIMAL(18,2) NOT NULL,
    "sourceFileName" TEXT,
    "sourceFileHash" TEXT,
    "importBatchId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueLine" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "reportedTotal" DECIMAL(18,2) NOT NULL,
    "channelTotal" DECIMAL(18,2) NOT NULL,
    "variance" DECIMAL(18,2) NOT NULL,
    "amountsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "asOf" DATE NOT NULL,
    "status" "ChargeRunStatus" NOT NULL DEFAULT 'DRAFT',
    "baseTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "chargeTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rulesSnapshot" JSONB,
    "createdById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeLine" (
    "id" UUID NOT NULL,
    "chargeRunId" UUID NOT NULL,
    "revenueLineId" UUID,
    "departmentId" UUID NOT NULL,
    "ruleId" UUID,
    "baseAmount" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(9,6) NOT NULL,
    "chargeAmount" DECIMAL(18,2) NOT NULL,
    "ruleName" TEXT,
    "traceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receivable" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "chargeLineId" UUID,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    "sourceType" TEXT,
    "sourceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID NOT NULL,
    "receiptDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "unallocatedAmount" DECIMAL(18,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "payerName" TEXT,
    "notes" TEXT,
    "evidenceKey" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNALLOCATED',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "centreId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "User_organizationId_isActive_idx" ON "User"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_code_key" ON "Role"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_organizationId_userId_idx" ON "UserRoleAssignment"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_roleId_idx" ON "UserRoleAssignment"("roleId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_centreId_idx" ON "UserRoleAssignment"("centreId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_organizationId_userId_revokedAt_idx" ON "RefreshSession"("organizationId", "userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Centre_organizationId_status_idx" ON "Centre"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Centre_organizationId_code_key" ON "Centre"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_centreId_code_key" ON "Department"("centreId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentAlias_departmentId_alias_key" ON "DepartmentAlias"("departmentId", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentChannel_centreId_code_key" ON "PaymentChannel"("centreId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentChannelAlias_channelId_alias_key" ON "PaymentChannelAlias"("channelId", "alias");

-- CreateIndex
CREATE INDEX "ChargeRule_centreId_effectiveFrom_idx" ON "ChargeRule"("centreId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ChargeRule_departmentId_idx" ON "ChargeRule"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_committedReportId_key" ON "ImportBatch"("committedReportId");

-- CreateIndex
CREATE INDEX "ImportBatch_organizationId_centreId_status_idx" ON "ImportBatch"("organizationId", "centreId", "status");

-- CreateIndex
CREATE INDEX "ImportBatch_fileHash_idx" ON "ImportBatch"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueReport_importBatchId_key" ON "RevenueReport"("importBatchId");

-- CreateIndex
CREATE INDEX "RevenueReport_organizationId_centreId_periodEnd_idx" ON "RevenueReport"("organizationId", "centreId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueLine_reportId_departmentId_key" ON "RevenueLine"("reportId", "departmentId");

-- CreateIndex
CREATE INDEX "ChargeRun_organizationId_centreId_status_idx" ON "ChargeRun"("organizationId", "centreId", "status");

-- CreateIndex
CREATE INDEX "ChargeLine_chargeRunId_idx" ON "ChargeLine"("chargeRunId");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_chargeLineId_key" ON "Receivable"("chargeLineId");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_reference_key" ON "Receivable"("reference");

-- CreateIndex
CREATE INDEX "Receivable_organizationId_centreId_status_dueDate_idx" ON "Receivable"("organizationId", "centreId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_centreId_occurredAt_idx" ON "LedgerEntry"("organizationId", "centreId", "occurredAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_receivableId_idx" ON "LedgerEntry"("receivableId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_centreId_receiptDate_idx" ON "Payment"("organizationId", "centreId", "receiptDate");

-- CreateIndex
CREATE INDEX "Payment_reference_idx" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "PaymentAllocation_receivableId_idx" ON "PaymentAllocation"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_receivableId_key" ON "PaymentAllocation"("paymentId", "receivableId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_centreId_createdAt_idx" ON "AuditEvent"("centreId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_organizationId_userId_endpoint_key_key" ON "IdempotencyKey"("organizationId", "userId", "endpoint", "key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Centre" ADD CONSTRAINT "Centre_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentAlias" ADD CONSTRAINT "DepartmentAlias_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentChannel" ADD CONSTRAINT "PaymentChannel_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentChannelAlias" ADD CONSTRAINT "PaymentChannelAlias_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "PaymentChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialAgreement" ADD CONSTRAINT "CommercialAgreement_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "CommercialAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_committedReportId_fkey" FOREIGN KEY ("committedReportId") REFERENCES "RevenueReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReport" ADD CONSTRAINT "RevenueReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReport" ADD CONSTRAINT "RevenueReport_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReport" ADD CONSTRAINT "RevenueReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReport" ADD CONSTRAINT "RevenueReport_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueLine" ADD CONSTRAINT "RevenueLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "RevenueReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueLine" ADD CONSTRAINT "RevenueLine_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRun" ADD CONSTRAINT "ChargeRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRun" ADD CONSTRAINT "ChargeRun_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRun" ADD CONSTRAINT "ChargeRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRun" ADD CONSTRAINT "ChargeRun_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_chargeRunId_fkey" FOREIGN KEY ("chargeRunId") REFERENCES "ChargeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_revenueLineId_fkey" FOREIGN KEY ("revenueLineId") REFERENCES "RevenueLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ChargeRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_chargeLineId_fkey" FOREIGN KEY ("chargeLineId") REFERENCES "ChargeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
