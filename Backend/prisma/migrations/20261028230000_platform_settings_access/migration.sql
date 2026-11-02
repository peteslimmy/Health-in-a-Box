-- Platform settings (SMTP, branding), approved email domains and their permission.
INSERT INTO "Permission" ("id", "code", "name", "description", "group")
VALUES (
  gen_random_uuid(),
  'platform.manage',
  'Manage platform settings',
  'Email (SMTP) setup, logo and favicon, the approved email domains and the registered super admins (super admin only)',
  'Platform'
)
ON CONFLICT ("code") DO NOTHING;

-- The SUPER_ADMIN system role only. ADMIN deliberately does not hold it.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'platform.manage'
WHERE r."isSystem" = true AND r."code" = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

CREATE TYPE "BrandingKind" AS ENUM ('LOGO', 'FAVICON');

CREATE TABLE "ApprovedDomain" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "domain" TEXT NOT NULL,
  "note" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApprovedDomain_pkey" PRIMARY KEY ("id"),
  -- Stored lower case, never a mailbox provider reserved for super admins.
  CONSTRAINT "ApprovedDomain_domain_lowercase" CHECK ("domain" = lower("domain")),
  CONSTRAINT "ApprovedDomain_not_gmail" CHECK ("domain" NOT IN ('gmail.com', 'googlemail.com'))
);
CREATE UNIQUE INDEX "ApprovedDomain_organizationId_domain_key" ON "ApprovedDomain"("organizationId", "domain");

CREATE TABLE "PlatformSetting" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "appName" TEXT NOT NULL DEFAULT 'HNB Receivables',
  "tagline" TEXT,
  "supportEmail" TEXT,
  "smtpHost" TEXT,
  "smtpPort" INTEGER,
  "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
  "smtpUser" TEXT,
  "smtpPasswordEnc" TEXT,
  "smtpFromName" TEXT,
  "smtpFromEmail" TEXT,
  "smtpReplyTo" TEXT,
  "smtpUpdatedAt" TIMESTAMP(3),
  "smtpUpdatedById" UUID,
  "smtpLastTestAt" TIMESTAMP(3),
  "smtpLastTestOk" BOOLEAN,
  "smtpLastTestNote" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformSetting_organizationId_key" ON "PlatformSetting"("organizationId");

CREATE TABLE "BrandingAsset" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "kind" "BrandingKind" NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "updatedById" UUID NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrandingAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrandingAsset_organizationId_kind_key" ON "BrandingAsset"("organizationId", "kind");

ALTER TABLE "ApprovedDomain" ADD CONSTRAINT "ApprovedDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrandingAsset" ADD CONSTRAINT "BrandingAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
