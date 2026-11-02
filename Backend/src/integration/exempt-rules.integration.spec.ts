/**
 * An exemption must never carry a charge. Checked at the service and, independently, at the
 * database, against a REAL PostgreSQL database.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hnb_scratch?schema=public npm test
 *
 * Skipped when TEST_DATABASE_URL is unset; refuses any database whose name lacks "test" or "scratch".
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ChargeConfigService } from '../charges/charge-config.service';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { allCentresUser } from '../testing/fixtures';

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[^/?]*(test|scratch)[^/?]*(\?|$)/i.test(url);
const maybe = url && safe ? describe : describe.skip;

maybe('exempt charge rules against a real database', () => {
  let prisma: PrismaClient;
  let service: ChargeConfigService;
  let user: AuthUser;
  let centreId: string;
  let departmentId: string;
  let agreementId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    const org = await prisma.organization.create({
      data: { name: `E ${suffix}`, slug: `e-${suffix}` },
    });
    const person = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `u-${suffix}@t.local`,
        passwordHash: 'x',
        fullName: 'U',
      },
    });
    user = { ...allCentresUser(person.id), organizationId: org.id };
    const centre = await prisma.centre.create({
      data: {
        organizationId: org.id,
        code: `EX-${suffix}`,
        name: 'Exempt Centre',
        status: 'ACTIVE',
      },
    });
    centreId = centre.id;
    const department = await prisma.department.create({
      data: { centreId, code: 'OXY', name: 'Oxygen' },
    });
    departmentId = department.id;
    const agreement = await prisma.commercialAgreement.create({
      data: {
        centreId,
        name: 'Main',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    agreementId = agreement.id;
    service = new ChargeConfigService(prisma as never, new AuditService(prisma as never));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const dto = (overrides: Record<string, unknown>) =>
    ({
      name: 'Oxygen exempt',
      rate: 0,
      effectiveFrom: '2026-01-01',
      departmentId,
      ...overrides,
    }) as never;

  it('refuses an exempt rule that carries a rate', async () => {
    await expect(
      service.addRule(user, agreementId, dto({ isExempt: true, rate: 5 })),
    ).rejects.toMatchObject({
      response: { code: 'EXEMPT_RATE_MUST_BE_ZERO' },
    });
  });

  it('stores an exempt rule with a zero rate and lets it be switched back to a charged rule', async () => {
    const rule = await service.addRule(user, agreementId, dto({ isExempt: true }));
    expect(rule).toMatchObject({ isExempt: true });
    const stored = await prisma.chargeRule.findUniqueOrThrow({
      where: { id: (rule as { id: string }).id },
    });
    expect(stored.isExempt).toBe(true);
    expect(Number(stored.rate)).toBe(0);
    await expect(service.updateRule(user, stored.id, { rate: 3 } as never)).rejects.toMatchObject({
      response: { code: 'EXEMPT_RATE_MUST_BE_ZERO' },
    });
    const switched = await service.updateRule(user, stored.id, {
      isExempt: false,
      rate: 3,
    } as never);
    expect(switched).toMatchObject({ isExempt: false });
  });

  it('the database refuses an exempt rule with a rate even if the service is bypassed', async () => {
    await expect(
      prisma.chargeRule.create({
        data: {
          centreId,
          agreementId,
          name: 'Bypass',
          rate: 4,
          isExempt: true,
          effectiveFrom: new Date('2027-01-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });
});
