-- Exporting report data is a separate permission from viewing it. Idempotent.
INSERT INTO "Permission" ("id", "code", "name", "description", "group")
VALUES (
  gen_random_uuid(),
  'reports.export',
  'Export reports',
  'Download report data as CSV or Excel (every export is audited)',
  'Revenue Reports'
)
ON CONFLICT ("code") DO NOTHING;

-- System roles that may export: administrators, finance managers and auditors.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'reports.export'
WHERE r."isSystem" = true AND r."code" IN ('ADMIN', 'FINANCE_MANAGER', 'AUDITOR')
ON CONFLICT DO NOTHING;
