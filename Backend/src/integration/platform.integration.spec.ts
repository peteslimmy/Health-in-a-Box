/**
 * Platform settings and the email access rules against a REAL PostgreSQL database: the database
 * itself refuses Gmail on the approved list, stores uploaded images byte for byte, and the policy
 * follows changes to the list.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hnb_scratch?schema=public npm test
 *
 * Skipped when TEST_DATABASE_URL is unset; refuses any database whose name lacks "test" or "scratch".
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AccessPolicyService } from '../access/access-policy.service';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { PlatformService } from '../platform/platform.service';
import { allCentresUser } from '../testing/fixtures';

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[^/?]*(test|scratch)[^/?]*(\?|$)/i.test(url);
const maybe = url && safe ? describe : describe.skip;

jest.setTimeout(30_000);

maybe('platform settings and email access against a real database', () => {
  let prisma: PrismaClient;
  let platform: PlatformService;
  let access: AccessPolicyService;
  let owner: AuthUser;
  let orgId: string;
  const suffix = randomUUID().slice(0, 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7) % 256)),
  ]);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    const org = await prisma.organization.create({
      data: { name: `P ${suffix}`, slug: `p-${suffix}` },
    });
    orgId = org.id;
    const person = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `owner-${suffix}@gmail.com`,
        passwordHash: 'x',
        fullName: 'Owner',
      },
    });
    owner = { ...allCentresUser(person.id, ['platform.manage']), organizationId: org.id };
    access = new AccessPolicyService(prisma as never);
    const config = {
      get: (key: string) => (key === 'MFA_ENCRYPTION_KEY' ? 'integration-key' : undefined),
      getOrThrow: () => 'refresh',
    };
    platform = new PlatformService(
      prisma as never,
      new AuditService(prisma as never),
      config as never,
      access,
      { send: async () => ({ messageId: 'x' }) } as never,
      { create: async () => ({}) } as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('the database refuses Gmail or an upper-case name on the approved list, even if the service were bypassed', async () => {
    const insert = (domain: string) =>
      prisma.approvedDomain.create({
        data: { organizationId: orgId, domain, createdById: owner.id },
      });
    await expect(insert('gmail.com')).rejects.toThrow(/not_gmail/);
    await expect(insert('googlemail.com')).rejects.toThrow(/not_gmail/);
    await expect(insert('4CoreTech.com')).rejects.toThrow(/lowercase/);
    await expect(insert('4coretech.com')).resolves.toBeDefined();
    await expect(insert('4coretech.com')).rejects.toThrow(/Unique/i);
  });

  it('the policy follows the list: approve, switch off, remove', async () => {
    const domain = `staff-${suffix}.example.com`;
    expect((await access.check(orgId, `a@${domain}`, false)).allowed).toBe(false);
    await platform.addDomain(owner, { domain: domain.toUpperCase(), note: 'test' });
    expect((await access.check(orgId, `A@${domain}`, false)).allowed).toBe(true);
    const row = await prisma.approvedDomain.findFirstOrThrow({
      where: { organizationId: orgId, domain },
    });
    await platform.updateDomain(owner, row.id, { isActive: false });
    expect((await access.check(orgId, `a@${domain}`, false)).allowed).toBe(false);
    await platform.updateDomain(owner, row.id, { isActive: true });
    await platform.removeDomain(owner, row.id);
    expect((await access.check(orgId, `a@${domain}`, false)).allowed).toBe(false);
  });

  it('Gmail stays blocked for everyone but a super admin however the list looks', async () => {
    expect((await access.check(orgId, 'someone@gmail.com', false)).allowed).toBe(false);
    expect((await access.check(orgId, 'owner@gmail.com', true)).allowed).toBe(true);
    await expect(platform.addDomain(owner, { domain: 'gmail.com' })).rejects.toMatchObject({
      response: { code: 'DOMAIN_INVALID' },
    });
  });

  it('keeps the logo exactly as uploaded and serves it back, replacing it on a second upload', async () => {
    await platform.saveAsset(owner, 'logo', {
      buffer: png,
      originalname: 'logo.png',
    } as Express.Multer.File);
    const stored = await prisma.brandingAsset.findFirstOrThrow({
      where: { organizationId: orgId, kind: 'LOGO' },
    });
    expect(Buffer.from(stored.data).equals(png)).toBe(true);
    expect(stored.contentType).toBe('image/png');
    const second = Buffer.concat([png, Buffer.from([1, 2, 3])]);
    await platform.saveAsset(owner, 'logo', {
      buffer: second,
      originalname: 'logo2.png',
    } as Express.Multer.File);
    expect(
      await prisma.brandingAsset.count({ where: { organizationId: orgId, kind: 'LOGO' } }),
    ).toBe(1);
    await platform.removeAsset(owner, 'logo');
    expect(
      await prisma.brandingAsset.count({ where: { organizationId: orgId, kind: 'LOGO' } }),
    ).toBe(0);
  });

  it('stores the SMTP password encrypted and returns only whether one exists', async () => {
    const view = await platform.saveSmtp(owner, {
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      user: 'apikey',
      password: 'SG.plain-text-secret',
      fromName: 'HNB',
      fromEmail: 'no-reply@example.com',
    } as never);
    const row = await prisma.platformSetting.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    expect(row.smtpPasswordEnc).toBeTruthy();
    expect(row.smtpPasswordEnc).not.toContain('plain-text-secret');
    expect(JSON.stringify(view)).not.toContain('plain-text-secret');
    expect(view.smtp).toMatchObject({ configured: true, hasPassword: true });
    const events = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
    expect(JSON.stringify(events)).not.toContain('plain-text-secret');
    expect(events.map((e) => e.action)).toContain('SMTP_SETTINGS_UPDATED');
  });
});
