-- Centre setup wizard: its permission (super admin only) and the drafts it keeps.
INSERT INTO "Permission" ("id", "code", "name", "description", "group")
VALUES (
  gen_random_uuid(),
  'centres.onboard',
  'Set up centres from a report',
  'Use the setup wizard to create a centre with its departments, payment channels and terms from a report file (super admin only)',
  'Centres'
)
ON CONFLICT ("code") DO NOTHING;

-- Only the SUPER_ADMIN system role holds it. ADMIN deliberately does not.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'centres.onboard'
WHERE r."isSystem" = true AND r."code" = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

CREATE TYPE "SetupDraftStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

CREATE TABLE "CentreSetupDraft" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "analysisJson" JSONB NOT NULL,
  "status" "SetupDraftStatus" NOT NULL DEFAULT 'OPEN',
  "centreId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CentreSetupDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CentreSetupDraft_organizationId_status_createdAt_idx"
  ON "CentreSetupDraft"("organizationId", "status", "createdAt");

ALTER TABLE "CentreSetupDraft"
  ADD CONSTRAINT "CentreSetupDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CentreSetupDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
