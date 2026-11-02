-- Approved variance: a held report can be committed although its printed totals do not add up,
-- by someone holding this permission, with a written reason. Idempotent.
INSERT INTO "Permission" ("id", "code", "name", "description", "group")
VALUES (
  gen_random_uuid(),
  'imports.approve_variance',
  'Approve report differences',
  'Commit a held report whose totals do not add up, accepting the differences in writing (audited; cannot be the uploader)',
  'Imports'
)
ON CONFLICT ("code") DO NOTHING;

-- Administrators and the super admin only. Other roles can be given it by a custom role.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'imports.approve_variance'
WHERE r."isSystem" = true AND r."code" IN ('ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

ALTER TABLE "RevenueReport"
  ADD COLUMN "varianceApprovedById" UUID,
  ADD COLUMN "varianceApprovedAt" TIMESTAMP(3),
  ADD COLUMN "varianceReason" TEXT,
  ADD COLUMN "varianceJson" JSONB;

-- Approval always has an approver, a time and a reason, or none of them.
ALTER TABLE "RevenueReport"
  ADD CONSTRAINT "RevenueReport_variance_complete" CHECK (
    ("varianceApprovedById" IS NULL AND "varianceApprovedAt" IS NULL AND "varianceReason" IS NULL AND "varianceJson" IS NULL)
    OR ("varianceApprovedById" IS NOT NULL AND "varianceApprovedAt" IS NOT NULL AND length(btrim("varianceReason")) >= 20 AND "varianceJson" IS NOT NULL)
  );

ALTER TABLE "RevenueReport"
  ADD CONSTRAINT "RevenueReport_varianceApprovedById_fkey" FOREIGN KEY ("varianceApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
