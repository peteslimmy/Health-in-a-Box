-- Rename the "Centre" concept to "Hospital" without touching any business data.

-- 1. Enum and tables.
ALTER TYPE "CentreStatus" RENAME TO "HospitalStatus";
ALTER TABLE "Centre" RENAME TO "Hospital";
ALTER TABLE "CentreSetupDraft" RENAME TO "HospitalSetupDraft";

-- 2. Columns that reference a centre.
ALTER TABLE "Adjustment" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "AuditEvent" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "ChargeRule" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "ChargeRun" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "CommercialAgreement" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "Department" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "Dispute" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "HospitalSetupDraft" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "ImportBatch" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "LedgerEntry" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "OpeningBalance" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "Payment" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "PaymentChannel" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "Receivable" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "RevenueReport" RENAME COLUMN "centreId" TO "hospitalId";
ALTER TABLE "UserRoleAssignment" RENAME COLUMN "centreId" TO "hospitalId";

-- 3. Constraint names (foreign keys and primary keys).
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT conname, conrelid::regclass::text AS table_name
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND conname ILIKE '%centre%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
      item.table_name,
      item.conname,
      replace(replace(item.conname, 'Centre', 'Hospital'), 'centre', 'hospital')
    );
  END LOOP;
END $$;

-- 4. Index names (including the partial unique index on OpeningBalance).
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname ILIKE '%centre%'
  LOOP
    EXECUTE format(
      'ALTER INDEX %I RENAME TO %I',
      item.indexname,
      replace(replace(item.indexname, 'Centre', 'Hospital'), 'centre', 'hospital')
    );
  END LOOP;
END $$;

-- 5. Permission catalogue.
UPDATE "Permission"
SET
  code = replace(code, 'centres.', 'hospitals.'),
  name = replace(
    replace(replace(replace(name, 'Centres', 'Hospitals'), 'centres', 'hospitals'), 'Centre', 'Hospital'),
    'centre',
    'hospital'
  ),
  description = replace(
    replace(replace(replace(description, 'Centres', 'Hospitals'), 'centres', 'hospitals'), 'Centre', 'Hospital'),
    'centre',
    'hospital'
  ),
  "group" = replace("group", 'Centres', 'Hospitals')
WHERE code LIKE 'centres.%';

-- Hospital configuration is a super-admin-only activity. Keep read access for every role.
DELETE FROM "RolePermission" rp
USING "Permission" p, "Role" r
WHERE rp."permissionId" = p.id
  AND rp."roleId" = r.id
  AND p.code IN (
    'hospitals.create',
    'hospitals.update',
    'hospitals.onboard',
    'charge_rules.manage'
  )
  AND r.code <> 'SUPER_ADMIN';
