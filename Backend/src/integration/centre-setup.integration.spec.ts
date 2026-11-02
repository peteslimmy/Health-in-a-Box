/**
 * The set-up wizard against a REAL PostgreSQL database: the whole centre is created together or
 * not at all, aliases make the next report match, and the audit trail records it.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hnb_scratch?schema=public npm test
 *
 * Skipped when TEST_DATABASE_URL is unset; refuses any database whose name lacks "test" or "scratch".
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { CentreSetupService } from '../centre-setup/centre-setup.service';
import { allCentresUser } from '../testing/fixtures';

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[^/?]*(test|scratch)[^/?]*(\?|$)/i.test(url);
const maybe = url && safe ? describe : describe.skip;

// Real-database tests can be slow on a busy machine; the default 5 s would make them flaky.
jest.setTimeout(30_000);

maybe('centre set-up wizard against a real database', () => {
  let prisma: PrismaClient;
  let service: CentreSetupService;
  let user: AuthUser;
  const suffix = randomUUID().slice(0, 8);
  const rows = [
    ['S/N', 'Revenue Department', 'Cash', 'Mobile Money', 'Total Amount'],
    ['1', 'ACCIDENT & EMERGENCY', '10.00', '90.00', '100.00'],
    ['2', 'PHARMACY', '0.00', '50.00', '50.00'],
    ['', 'Grand Total', '10.00', '140.00', '150.00'],
  ];
  const csv = Buffer.from(rows.map((row) => row.join(',')).join('\n'));

  const draftFor = async (name: string) => {
    const analysed = await service.analyse(user, {
      buffer: csv,
      size: csv.length,
      originalname: name,
    } as Express.Multer.File);
    return analysed.draftId;
  };
  const body = (code: string, extra: Record<string, unknown> = {}) =>
    ({
      centre: { code, name: `Centre ${code}` },
      departments: [
        { printedName: 'ACCIDENT & EMERGENCY', name: 'Accident and Emergency', code: 'AE' },
        { printedName: 'PHARMACY', name: 'Pharmacy', code: 'PHARMACY' },
      ],
      channels: [
        { printedName: 'Cash', name: 'Cash', code: 'CASH' },
        { printedName: 'Mobile Money', name: 'Mobile Money', code: 'MOBILE_MONEY' },
      ],
      ...extra,
    }) as never;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    const org = await prisma.organization.create({
      data: { name: `W ${suffix}`, slug: `w-${suffix}` },
    });
    const person = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `w-${suffix}@t.local`,
        passwordHash: 'x',
        fullName: 'W',
      },
    });
    user = { ...allCentresUser(person.id, ['centres.onboard']), organizationId: org.id };
    const stored = new Map<string, Buffer>();
    const storage = {
      put: async (buffer: Buffer, name: string) => {
        stored.set(name, buffer);
        return name;
      },
      get: async (key: string) => stored.get(key)!,
    };
    service = new CentreSetupService(
      prisma as never,
      storage as never,
      new AuditService(prisma as never),
      { upload: async () => ({ id: 'x', status: 'READY_TO_COMMIT' }) } as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('creates the centre, departments, channels, aliases, agreement and rule, and audits it', async () => {
    const draftId = await draftFor(`a-${suffix}.csv`);
    const result = await service.commit(
      user,
      draftId,
      body(`W${suffix}`.toUpperCase(), {
        terms: { agreementName: 'Main', ratePercent: 7.5, effectiveFrom: '2026-09-25' },
        activate: true,
      }),
    );
    expect(result.centre.status).toBe('ACTIVE');
    const centre = await prisma.centre.findUniqueOrThrow({
      where: { id: result.centre.id },
      include: {
        departments: { include: { aliases: true }, orderBy: { code: 'asc' } },
        paymentChannels: true,
        chargeRules: true,
        agreements: true,
      },
    });
    expect(centre.departments.map((d) => d.code)).toEqual(['AE', 'PHARMACY']);
    // the printed name differs from the chosen one for the first department, so it is remembered
    expect(centre.departments[0].aliases.map((a) => a.alias)).toEqual(['ACCIDENT & EMERGENCY']);
    expect(centre.departments[1].aliases).toEqual([]);
    expect(centre.paymentChannels).toHaveLength(2);
    expect(centre.agreements).toHaveLength(1);
    expect(centre.chargeRules).toHaveLength(1);
    expect(centre.chargeRules[0].rate.toString()).toBe('7.5');
    expect(centre.chargeRules[0].departmentId).toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { targetId: centre.id, action: 'CENTRE_CREATED' },
    });
    expect(audit?.summary).toContain('set-up wizard');
    const draft = await prisma.centreSetupDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe('COMPLETED');
    expect(draft.centreId).toBe(centre.id);
  });

  it('is all or nothing: a failure part-way leaves no centre behind and the draft open', async () => {
    const draftId = await draftFor(`b-${suffix}.csv`);
    // A rate the database cannot store fails only when the rule is inserted, after the centre,
    // departments and channels were already written inside the transaction.
    const broken = body(`X${suffix}`.toUpperCase(), {
      terms: { agreementName: 'Main', ratePercent: 99999999, effectiveFrom: '2026-09-25' },
    });
    await expect(service.commit(user, draftId, broken)).rejects.toBeDefined();
    const left = await prisma.centre.findFirst({ where: { code: `X${suffix}`.toUpperCase() } });
    expect(left).toBeNull();
    const draft = await prisma.centreSetupDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe('OPEN');
  });

  it('refuses a second centre with the same code, and a finished set-up cannot be reused', async () => {
    const code = `W${suffix}`.toUpperCase();
    const draftId = await draftFor(`c-${suffix}.csv`);
    await expect(service.commit(user, draftId, body(code))).rejects.toMatchObject({
      response: { code: 'CENTRE_EXISTS' },
    });
    const ok = await draftFor(`d-${suffix}.csv`);
    await service.commit(user, ok, body(`Y${suffix}`.toUpperCase()));
    await expect(service.commit(user, ok, body(`Z${suffix}`.toUpperCase()))).rejects.toMatchObject({
      response: { code: 'SETUP_NOT_OPEN' },
    });
  });

  it('proposes names that the next report will match, through the saved aliases', async () => {
    const centre = await prisma.centre.findFirstOrThrow({
      where: { code: `W${suffix}`.toUpperCase() },
      include: { departments: { include: { aliases: true } } },
    });
    const keys = centre.departments.flatMap((d) => [
      d.code,
      d.name,
      ...d.aliases.map((a) => a.alias),
    ]);
    expect(keys).toContain('ACCIDENT & EMERGENCY');
  });
});
