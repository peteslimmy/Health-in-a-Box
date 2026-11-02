/**
 * First-time set-up for a real (production) environment: the organisation, the permissions, the
 * system roles and ONE administrator. It creates no demo data and no centres.
 *
 *   BOOTSTRAP_ORG_NAME="University of Abuja Teaching Hospital" \
 *   BOOTSTRAP_ADMIN_EMAIL=admin@example.org BOOTSTRAP_ADMIN_NAME="Full Name" \
 *   BOOTSTRAP_ADMIN_PASSWORD='a long passphrase' \
 *   npx ts-node prisma/bootstrap.ts
 *
 * Safe to re-run: it changes nothing once an administrator exists. Change the password at first
 * sign-in, and create the other accounts from the Users screen.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { PERMISSIONS, ROLE_PERMISSIONS } from './reference-data';

const prisma = new PrismaClient();

const env = (name: string) => (process.env[name] ?? '').trim();

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'organisation'
  );
}

async function main() {
  const orgName = env('BOOTSTRAP_ORG_NAME');
  const email = env('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const fullName = env('BOOTSTRAP_ADMIN_NAME');
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';

  const problems: string[] = [];
  if (!orgName) problems.push('BOOTSTRAP_ORG_NAME is required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    problems.push('BOOTSTRAP_ADMIN_EMAIL must be an email address');
  if (!fullName) problems.push('BOOTSTRAP_ADMIN_NAME is required');
  if (password.length < 12)
    problems.push('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');
  if (/hnbdemo|password|changeme|12345678/i.test(password))
    problems.push('BOOTSTRAP_ADMIN_PASSWORD is too guessable');
  if (/@hnb\.local$/i.test(email)) problems.push('Use a real address, not a demo one');
  if (problems.length > 0) throw new Error(`Cannot bootstrap:\n - ${problems.join('\n - ')}`);

  const existing = await prisma.organization.findMany({ take: 2 });
  if (existing.some((org) => org.slug === 'hnb-demo')) {
    throw new Error(
      'This database holds the demo organisation. Bootstrap a clean database instead.',
    );
  }
  const slug = slugify(orgName);
  const org =
    existing.find((o) => o.slug === slug) ??
    (existing.length === 0
      ? await prisma.organization.create({ data: { name: orgName, slug } })
      : null);
  if (!org)
    throw new Error('An organisation with a different name already exists; nothing was changed.');

  const permissionIds = new Map<string, string>();
  for (const [code, name, group, description] of PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: { name, group, description },
      create: { code, name, group, description },
    });
    permissionIds.set(code, permission.id);
  }
  const roleIds = new Map<string, string>();
  for (const [code, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { organizationId_code: { organizationId: org.id, code } },
      update: { isSystem: true },
      create: {
        organizationId: org.id,
        code,
        name: code
          .split('_')
          .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
          .join(' '),
        description: `System role: ${code}`,
        isSystem: true,
      },
    });
    roleIds.set(code, role.id);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((code) => ({
        roleId: role.id,
        permissionId: permissionIds.get(code)!,
      })),
      skipDuplicates: true,
    });
  }

  const already = await prisma.user.findFirst({
    where: {
      organizationId: org.id,
      roleAssignments: {
        some: { roleId: { in: [roleIds.get('ADMIN')!, roleIds.get('SUPER_ADMIN')!] } },
      },
    },
  });
  if (already) {
    console.log(
      `An administrator (${already.email}) already exists. Reference data refreshed; no account was created.`,
    );
    return;
  }
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email,
      fullName,
      passwordHash: await argon2.hash(password),
      isActive: true,
    },
  });
  await prisma.userRoleAssignment.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      roleId: roleIds.get('SUPER_ADMIN')!,
      centreId: null,
    },
  });
  console.log(
    `Created "${org.name}" and administrator ${email}. Sign in, then change the password.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
