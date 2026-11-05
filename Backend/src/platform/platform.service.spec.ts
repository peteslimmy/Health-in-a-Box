import { decryptSecret } from '../auth/mfa-crypto';
import { allHospitalsUser } from '../testing/fixtures';
import { PlatformService } from './platform.service';

const owner = allHospitalsUser('owner', ['platform.manage']);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);

function build(initial: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: 'set-1',
    organizationId: 'org-1',
    appName: 'HNB Receivables',
    tagline: null,
    supportEmail: null,
    smtpHost: null,
    smtpPort: null,
    smtpSecure: true,
    smtpUser: null,
    smtpPasswordEnc: null,
    smtpFromName: null,
    smtpFromEmail: null,
    smtpReplyTo: null,
    smtpUpdatedAt: null,
    smtpLastTestAt: null,
    smtpLastTestOk: null,
    smtpLastTestNote: null,
    ...initial,
  };
  const domains: Array<Record<string, unknown>> = [];
  const prisma = {
    platformSetting: {
      upsert: jest.fn(async () => row),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        Object.assign(row, data),
      ),
    },
    brandingAsset: {
      findMany: jest.fn(async () => []),
      upsert: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    approvedDomain: {
      findMany: jest.fn(async () => domains),
      findUnique: jest.fn(
        async ({ where }: { where: { organizationId_domain: { domain: string } } }) =>
          domains.find((d) => d.domain === where.organizationId_domain.domain) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          domains.find((d) => d.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `d${domains.length + 1}`,
          isActive: true,
          createdAt: new Date(),
          ...data,
        };
        domains.push(created);
        return created;
      }),
      update: jest.fn(async () => ({})),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        domains.splice(
          domains.findIndex((d) => d.id === where.id),
          1,
        );
      }),
    },
    user: { findMany: jest.fn(async () => []) },
    role: { findFirst: jest.fn(async () => ({ id: 'role-super' })) },
  };
  const audit = { record: jest.fn<Promise<unknown>, [unknown]>(async () => ({})) };
  const config = {
    get: (key: string) => (key === 'MFA_ENCRYPTION_KEY' ? 'test-key-material' : undefined),
    getOrThrow: () => 'refresh-secret',
  };
  const access = {
    invalidate: jest.fn(),
    check: jest.fn(async () => ({ allowed: true })),
    approvedDomains: jest.fn(async () => new Set<string>()),
  };
  const mail = {
    send: jest.fn<Promise<{ messageId: string }>, [string, unknown]>(async () => ({
      messageId: 'm1',
    })),
  };
  const users = { create: jest.fn<Promise<unknown>, [unknown, unknown]>(async () => ({})) };
  const service = new PlatformService(
    prisma as never,
    audit as never,
    config as never,
    access as never,
    mail as never,
    users as never,
  );
  return { service, prisma, audit, access, mail, users, row, domains };
}

const smtp = (extra: Record<string, unknown> = {}) => ({
  host: 'smtp.sendgrid.net',
  port: 587,
  secure: false,
  user: 'apikey',
  password: 'SG.super-secret-key',
  fromName: 'HNB Receivables',
  fromEmail: 'No-Reply@4coretech.com',
  ...extra,
});

describe('outgoing email settings', () => {
  it('stores the password encrypted, never returns it, and keeps it out of the audit trail', async () => {
    const { service, row, audit } = build();
    const result = await service.saveSmtp(owner, smtp() as never);
    expect(row.smtpPasswordEnc).not.toContain('SG.super-secret-key');
    expect(decryptSecret(row.smtpPasswordEnc as string, 'test-key-material:settings')).toBe(
      'SG.super-secret-key',
    );
    expect(JSON.stringify(result)).not.toContain('SG.super-secret-key');
    expect(JSON.stringify(result)).not.toContain(row.smtpPasswordEnc as string);
    expect(result.smtp).toMatchObject({
      configured: true,
      hasPassword: true,
      host: 'smtp.sendgrid.net',
      fromEmail: 'no-reply@4coretech.com',
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('super-secret');
    expect(audit.record.mock.calls[0][0]).toMatchObject({ action: 'SMTP_SETTINGS_UPDATED' });
  });

  it('keeps the saved password when none is sent, and replaces it when one is', async () => {
    const { service, row } = build();
    await service.saveSmtp(owner, smtp() as never);
    const first = row.smtpPasswordEnc;
    await service.saveSmtp(owner, smtp({ password: undefined, fromName: 'Renamed' }) as never);
    expect(row.smtpPasswordEnc).toBe(first);
    await service.saveSmtp(owner, smtp({ password: 'a-new-key' }) as never);
    expect(row.smtpPasswordEnc).not.toBe(first);
    expect(decryptSecret(row.smtpPasswordEnc as string, 'test-key-material:settings')).toBe(
      'a-new-key',
    );
  });

  it('asks for the password when a user is given and none was ever saved', async () => {
    const { service } = build();
    await expect(
      service.saveSmtp(owner, smtp({ password: undefined }) as never),
    ).rejects.toMatchObject({
      response: { code: 'SMTP_PASSWORD_REQUIRED' },
    });
  });

  it('forgets the saved password when the login is removed', async () => {
    const { service, row } = build();
    await service.saveSmtp(owner, smtp() as never);
    await service.saveSmtp(owner, smtp({ user: '', password: undefined }) as never);
    expect(row.smtpPasswordEnc).toBeNull();
  });

  it('refuses a mail server inside the network', async () => {
    const { service, row } = build();
    for (const host of ['localhost', '10.1.2.3', '169.254.169.254']) {
      await expect(service.saveSmtp(owner, smtp({ host }) as never)).rejects.toMatchObject({
        response: { code: 'SMTP_HOST_INVALID' },
      });
    }
    expect(row.smtpHost).toBeNull();
  });

  it('a changed setup is marked as not yet tested', async () => {
    const { service, row } = build({ smtpLastTestOk: true, smtpLastTestAt: new Date() });
    await service.saveSmtp(owner, smtp() as never);
    expect(row.smtpLastTestOk).toBeNull();
  });

  it('records whether the test message was accepted or why not', async () => {
    const ok = build();
    const accepted = await ok.service.testSmtp(owner, 'peter@4coretech.com');
    expect(accepted.ok).toBe(true);
    expect(ok.row.smtpLastTestOk).toBe(true);
    expect(ok.mail.send).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ to: 'peter@4coretech.com' }),
    );

    const bad = build();
    bad.mail.send.mockRejectedValueOnce(
      new Error('Invalid login: 535 Authentication failed') as never,
    );
    const failed = await bad.service.testSmtp(owner, 'peter@4coretech.com');
    expect(failed).toEqual({ ok: false, note: 'Invalid login: 535 Authentication failed' });
    expect(bad.row.smtpLastTestOk).toBe(false);
  });

  it('can be removed, and says so in the audit trail', async () => {
    const { service, row, audit } = build();
    await service.saveSmtp(owner, smtp() as never);
    const result = await service.clearSmtp(owner);
    expect(result.smtp.configured).toBe(false);
    expect(row.smtpPasswordEnc).toBeNull();
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'SMTP_SETTINGS_CLEARED' }),
    );
  });
});

describe('logo and favicon', () => {
  it('stores a valid image and refuses an SVG, a missing file and a wrong type', async () => {
    const { service, prisma } = build();
    await service.saveAsset(owner, 'logo', {
      buffer: PNG,
      originalname: 'my logo (1).png',
    } as never);
    expect(prisma.brandingAsset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          kind: 'LOGO',
          contentType: 'image/png',
          fileName: 'my_logo__1_.png',
        }),
      }),
    );
    await expect(
      service.saveAsset(owner, 'logo', {
        buffer: Buffer.from('<svg onload=alert(1)>'),
        originalname: 'a.svg',
      } as never),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_INVALID' } });
    await expect(service.saveAsset(owner, 'favicon', undefined)).rejects.toMatchObject({
      response: { code: 'FILE_REQUIRED' },
    });
    expect(prisma.brandingAsset.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('approved domains', () => {
  it('adds a domain in a normal form, clears the cached list and audits it', async () => {
    const { service, access, audit, domains } = build();
    await service.addDomain(owner, { domain: ' @4CoreTech.com ', note: 'Our staff' });
    expect(domains[0]).toMatchObject({ domain: '4coretech.com', note: 'Our staff' });
    expect(access.invalidate).toHaveBeenCalledWith('org-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOMAIN_APPROVED' }),
    );
  });

  it('never approves Gmail, and refuses a repeat', async () => {
    const { service } = build();
    for (const gmail of ['gmail.com', '@GMAIL.com', 'googlemail.com']) {
      await expect(service.addDomain(owner, { domain: gmail })).rejects.toMatchObject({
        response: { code: 'DOMAIN_INVALID' },
      });
    }
    await service.addDomain(owner, { domain: 'uath.gov.ng' });
    await expect(service.addDomain(owner, { domain: 'UATH.gov.ng' })).rejects.toMatchObject({
      response: { code: 'DOMAIN_EXISTS' },
    });
  });

  it('removing a domain takes effect at once', async () => {
    const { service, access, domains } = build();
    await service.addDomain(owner, { domain: '4coretech.com' });
    access.invalidate.mockClear();
    await service.removeDomain(owner, 'd1');
    expect(domains).toHaveLength(0);
    expect(access.invalidate).toHaveBeenCalledWith('org-1');
  });

  it('lists people the rules now block, with the reason', async () => {
    const { service, prisma, access } = build();
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'peter@4coretech.com', fullName: 'Peter', roleAssignments: [] },
      { id: 'u2', email: 'rando@gmail.com', fullName: 'Rando', roleAssignments: [] },
    ] as never);
    access.check.mockImplementation((async (_org: string, email: string) =>
      email.endsWith('@gmail.com')
        ? { allowed: false, code: 'GMAIL_RESERVED', message: 'Gmail addresses are blocked' }
        : { allowed: true }) as never);
    const result = await service.listDomains(owner);
    expect(result.blockedAccounts).toEqual([
      expect.objectContaining({ email: 'rando@gmail.com', reason: 'Gmail addresses are blocked' }),
    ]);
  });
});

describe('registered super admins', () => {
  it('registers only Gmail addresses, with the super admin role on all hospitals', async () => {
    const { service, users } = build();
    await expect(
      service.addSuperAdmin(owner, {
        email: 'boss@4coretech.com',
        fullName: 'Boss',
        password: 'Str0ngPassw0rd',
      }),
    ).rejects.toMatchObject({ response: { code: 'SUPER_ADMIN_NEEDS_GMAIL' } });
    expect(users.create).not.toHaveBeenCalled();
    await service.addSuperAdmin(owner, {
      email: 'Boss@Gmail.com',
      fullName: 'Boss',
      password: 'Str0ngPassw0rd',
    });
    expect(users.create).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ email: 'Boss@Gmail.com', assignments: [{ roleId: 'role-super' }] }),
    );
  });
});
