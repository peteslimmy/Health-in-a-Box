import { allHospitalsUser } from '../testing/fixtures';
import { UsersService } from './users.service';

const role = (id: string, code: string, permissions: string[], isSystem = false) => ({
  id,
  code,
  isSystem,
  permissions: permissions.map((p) => ({ permission: { code: p } })),
});

function build(roles: ReturnType<typeof role>[] = [], targetPermissions: string[] = []) {
  const targetUser = {
    id: 'target',
    email: 't@test.local',
    fullName: 'Target',
    isActive: true,
    roleAssignments: targetPermissions.length
      ? [{ role: role('t-role', 'TARGET_ROLE', targetPermissions), hospital: null }]
      : [],
  };
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(targetUser),
      update: jest.fn().mockResolvedValue({ ...targetUser }),
    },
    role: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          roles.find((r) => r.id === where.id) ?? null,
      ),
      findMany: jest.fn().mockResolvedValue(roles),
      create: jest.fn(),
    },
    userRoleAssignment: { findMany: jest.fn().mockResolvedValue(targetUser.roleAssignments) },
    refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    mfaRecoveryCode: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    hospital: { count: jest.fn().mockResolvedValue(0) },
    permission: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)({}) : Promise.all(arg as []),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const access = { assert: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new UsersService(prisma as never, audit as never, access as never),
    prisma,
    audit,
    access,
  };
}

const assignments = (...roleIds: string[]) => roleIds.map((roleId) => ({ roleId }));

describe('user and role administration controls', () => {
  const admin = allHospitalsUser('admin', [
    'users.manage',
    'roles.manage',
    'imports.manage',
    'reports.read',
  ]);

  it('blocks changing your own role assignments (no self-escalation)', async () => {
    const { service } = build();
    await expect(
      service.replaceAssignments(admin, 'admin', assignments('r1')),
    ).rejects.toMatchObject({
      response: { code: 'SELF_ASSIGNMENT_FORBIDDEN' },
    });
  });

  it('blocks deactivating your own account', async () => {
    const { service } = build();
    await expect(
      service.update(admin, 'admin', { isActive: false } as never),
    ).rejects.toMatchObject({
      response: { code: 'SELF_DEACTIVATION_FORBIDDEN' },
    });
  });

  it('blocks assigning a role that carries permissions the administrator lacks', async () => {
    const { service } = build([role('r1', 'SUPER', ['imports.manage', 'settings.manage'])]);
    await expect(
      service.replaceAssignments(admin, 'target', assignments('r1')),
    ).rejects.toMatchObject({
      response: { code: 'PRIVILEGE_CEILING_EXCEEDED' },
    });
  });

  it("blocks creating a role above the administrator's own permissions", async () => {
    const { service, prisma } = build();
    await expect(
      service.createRole(admin, {
        code: 'POWER',
        name: 'Power',
        permissionCodes: ['reports.read', 'payments.allocate'],
      } as never),
    ).rejects.toMatchObject({ response: { code: 'PRIVILEGE_CEILING_EXCEEDED' } });
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('blocks combining the Auditor role with a role that can change data', async () => {
    const { service } = build([
      role('r1', 'AUDITOR', ['reports.read']),
      role('r2', 'OFFICER', ['imports.manage']),
    ]);
    await expect(
      service.replaceAssignments(admin, 'target', assignments('r1', 'r2')),
    ).rejects.toMatchObject({ response: { code: 'ROLE_CONFLICT' } });
  });

  it('protects built-in roles from being edited', async () => {
    const { service } = build([role('sys', 'FINANCE_OFFICER', ['imports.manage'], true)]);
    await expect(
      service.updateRole(admin, 'sys', { permissionCodes: ['reports.read'] } as never),
    ).rejects.toMatchObject({ response: { code: 'SYSTEM_ROLE_PROTECTED' } });
  });
});

describe('administering other users (no takeover of a more privileged account)', () => {
  const lowAdmin = allHospitalsUser('low-admin', ['users.manage', 'users.read']);

  it('cannot reset the password of a user who holds permissions the administrator lacks', async () => {
    const { service, prisma } = build([], ['users.manage', 'payments.post', 'roles.manage']);
    await expect(
      service.resetPassword(lowAdmin, 'target', { password: 'Str0ngPassw0rd!' }),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_OUTRANKS_YOU' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('cannot change the email, name or status of a more privileged user', async () => {
    const { service, prisma } = build([], ['payments.post']);
    await expect(
      service.update(lowAdmin, 'target', { email: 'attacker@evil.test' } as never),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_OUTRANKS_YOU' } });
    await expect(
      service.update(lowAdmin, 'target', { isActive: false } as never),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_OUTRANKS_YOU' } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('cannot replace the roles of a more privileged user', async () => {
    const { service } = build([role('r1', 'LOW', ['users.read'])], ['payments.post']);
    await expect(
      service.replaceAssignments(lowAdmin, 'target', [{ roleId: 'r1' }] as never),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_OUTRANKS_YOU' } });
  });

  it('can still administer a user whose permissions are within their own', async () => {
    const { service, prisma } = build([], ['users.read']);
    await expect(
      service.resetPassword(lowAdmin, 'target', { password: 'Str0ngPassw0rd!' }),
    ).resolves.toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});

describe('hospital-scoped user administrators', () => {
  const scopedAdmin = {
    ...allHospitalsUser('scoped-admin', ['users.manage', 'users.read', 'imports.read']),
    allHospitals: false,
    hospitalIds: ['hospital-a'],
  };
  const lowRole = [role('r1', 'LOW', ['imports.read'])];
  const withScopes = (scopes: Array<string | null>) => {
    const ctx = build(lowRole, ['imports.read']);
    // the number of hospitals found equals the number asked for, so only the scope rule can reject
    ctx.prisma.hospital.count.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length,
    );
    const tx = {
      userRoleAssignment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'target',
          email: 't@test.local',
          fullName: 'Target',
          isActive: true,
          roleAssignments: [],
        }),
      },
    };
    ctx.prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
    );
    ctx.prisma.userRoleAssignment.findMany.mockResolvedValue(
      scopes.map((hospitalId) => ({ hospitalId, role: role('t', 'T', ['imports.read']) })) as never,
    );
    return ctx;
  };

  it('cannot give anyone access to a hospital outside their own scope', async () => {
    const { service } = withScopes(['hospital-a']);
    await expect(
      service.replaceAssignments(scopedAdmin, 'target', [
        { roleId: 'r1', hospitalId: 'hospital-b' },
      ]),
    ).rejects.toMatchObject({ response: { code: 'HOSPITAL_SCOPE_EXCEEDED' } });
  });

  it('cannot give anyone all-hospitals access', async () => {
    const { service } = withScopes(['hospital-a']);
    await expect(
      service.replaceAssignments(scopedAdmin, 'target', [{ roleId: 'r1' }]),
    ).rejects.toMatchObject({ response: { code: 'HOSPITAL_SCOPE_EXCEEDED' } });
  });

  it('can assign a role for a hospital inside their own scope', async () => {
    const { service } = withScopes(['hospital-a']);
    await expect(
      service.replaceAssignments(scopedAdmin, 'target', [
        { roleId: 'r1', hospitalId: 'hospital-a' },
      ]),
    ).resolves.toBeDefined();
  });

  it.each([
    ['an all-hospitals user', [null]],
    ['a user who also works in another hospital', ['hospital-a', 'hospital-b']],
  ])(
    "cannot administer %s (their access would be changed beyond the admin's scope)",
    async (_label, scopes) => {
      const { service, prisma } = withScopes(scopes as Array<string | null>);
      await expect(
        service.resetPassword(scopedAdmin, 'target', { password: 'Str0ngPassw0rd!' }),
      ).rejects.toMatchObject({ response: { code: 'ACCOUNT_OUTRANKS_YOU' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );
});

describe('resetting a lost authenticator', () => {
  const lowAdmin = allHospitalsUser('low-admin', ['users.manage', 'users.read']);

  it('clears the factor and recovery codes, ends every session, and is audited', async () => {
    const { service, prisma, audit } = build([], ['users.read']);
    await expect(service.resetMfa(lowAdmin, 'target')).resolves.toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'target' },
        data: expect.objectContaining({ mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: null }),
      }),
    );
    expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } });
    expect(prisma.refreshSession.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_MFA_RESET' }),
    );
  });

  it('cannot be used on a more privileged account (no takeover by removing its second factor)', async () => {
    const { service, prisma } = build([], ['users.manage', 'payments.post']);
    await expect(service.resetMfa(lowAdmin, 'target')).rejects.toMatchObject({
      response: { code: 'ACCOUNT_OUTRANKS_YOU' },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('which email addresses an account may have', () => {
  const superAdmin = allHospitalsUser('owner', ['users.manage', 'users.read', 'imports.read']);
  const create = jest.fn(async ({ data }: { data: { email: string } }) => ({
    id: 'new',
    email: data.email,
    fullName: 'N',
    isActive: true,
    createdAt: new Date(),
    roleAssignments: [],
  }));

  function withRoles() {
    const ctx = build([
      role('r-staff', 'FINANCE_OFFICER', ['imports.read']),
      role('r-super', 'SUPER_ADMIN', ['imports.read'], true),
    ]);
    const all = [
      role('r-staff', 'FINANCE_OFFICER', ['imports.read']),
      role('r-super', 'SUPER_ADMIN', ['imports.read'], true),
    ];
    // answer with the roles that were asked for, as the database would
    ctx.prisma.role.findMany = jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      all.filter((r) => where.id.in.includes(r.id)),
    ) as never;
    (ctx.prisma.user as Record<string, unknown>).create = create;
    create.mockClear();
    return ctx;
  }
  const body = (email: string, roleId: string, hospitalId?: string) =>
    ({
      email,
      fullName: 'Name',
      password: 'Str0ngPassw0rd',
      assignments: [{ roleId, ...(hospitalId && { hospitalId }) }],
    }) as never;

  it('checks a new account against the policy, as a super admin when it has that role', async () => {
    const { service, access } = withRoles();
    await service.create(superAdmin, body('Peter@4coretech.com', 'r-staff'));
    expect(access.assert).toHaveBeenLastCalledWith('org-1', 'Peter@4coretech.com', false);
    await service.create(superAdmin, body('owner@gmail.com', 'r-super'));
    expect(access.assert).toHaveBeenLastCalledWith('org-1', 'owner@gmail.com', true);
  });

  it('creates nothing when the policy refuses the address', async () => {
    const { service, access } = withRoles();
    access.assert.mockRejectedValueOnce(
      Object.assign(new Error('blocked'), { response: { code: 'GMAIL_RESERVED' } }),
    );
    await expect(service.create(superAdmin, body('someone@gmail.com', 'r-staff'))).rejects.toThrow(
      'blocked',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the super admin role to all hospitals', async () => {
    const { service, prisma } = withRoles();
    prisma.hospital.count = jest.fn().mockResolvedValue(1) as never;
    await expect(
      service.create(superAdmin, body('owner@gmail.com', 'r-super', 'hospital-1')),
    ).rejects.toMatchObject({
      response: { code: 'SUPER_ADMIN_ALL_HOSPITALS' },
    });
  });

  it('checks a changed email using the roles the person already has', async () => {
    const { service, access } = withRoles();
    await service.update(superAdmin, 'target', { email: 'new@4coretech.com' } as never);
    expect(access.assert).toHaveBeenLastCalledWith('org-1', 'new@4coretech.com', false);
  });

  it('checks the address again when roles change, so a Gmail account cannot stop being a super admin', async () => {
    const { service, access } = withRoles();
    // the transaction itself is not modelled here; the policy check happens before it
    await service
      .replaceAssignments(superAdmin, 'target', [{ roleId: 'r-staff' }] as never)
      .catch(() => undefined);
    expect(access.assert).toHaveBeenLastCalledWith('org-1', 't@test.local', false);
  });

  it('will not deactivate the only active super admin', async () => {
    const { service, prisma } = withRoles();
    (prisma.user as Record<string, unknown>).findFirst = jest.fn().mockResolvedValue({
      id: 'target',
      email: 'sole@gmail.com',
      fullName: 'Sole',
      isActive: true,
      roleAssignments: [{ role: role('r-super', 'SUPER_ADMIN', []), hospital: null }],
    });
    (prisma.user as Record<string, unknown>).count = jest.fn().mockResolvedValue(0);
    await expect(
      service.update(superAdmin, 'target', { isActive: false } as never),
    ).rejects.toMatchObject({
      response: { code: 'LAST_SUPER_ADMIN' },
    });
    (prisma.user as Record<string, unknown>).count = jest.fn().mockResolvedValue(1);
    await expect(
      service.update(superAdmin, 'target', { isActive: false } as never),
    ).resolves.toBeDefined();
  });
});
