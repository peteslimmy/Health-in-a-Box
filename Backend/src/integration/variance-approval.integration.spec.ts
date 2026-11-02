/**
 * Approved variance against a REAL PostgreSQL database: a held report is committed with a reason,
 * is stored with the channel amounts as its figures, is charged on those amounts, and the database
 * itself refuses a half-recorded approval.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hnb_scratch?schema=public npm test
 *
 * Skipped when TEST_DATABASE_URL is unset; refuses any database whose name lacks "test" or "scratch".
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ChargeRunsService } from '../charges/charge-runs.service';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { ImportsService } from '../imports/imports.service';
import { RevenueParserService } from '../imports/revenue-parser.service';
import { allCentresUser } from '../testing/fixtures';

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[^/?]*(test|scratch)[^/?]*(\?|$)/i.test(url);
const maybe = url && safe ? describe : describe.skip;

// Real-database tests can be slow on a busy machine; the default 5 s would make them flaky.
jest.setTimeout(30_000);

maybe('approved variance against a real database', () => {
  let prisma: PrismaClient;
  let imports: ImportsService;
  let runs: ChargeRunsService;
  let uploader: AuthUser;
  let approver: AuthUser;
  let centreId: string;
  let batchId: string;
  const suffix = randomUUID().slice(0, 8);
  const reason = 'The centre confirmed the printed total includes a cheque banked late';

  const heldBatch = (extra: Record<string, unknown> = {}) =>
    prisma.importBatch.create({
      data: {
        organizationId: uploader.organizationId,
        centreId,
        status: 'NEEDS_REVIEW',
        fileName: `held-${randomUUID().slice(0, 6)}.pdf`,
        fileHash: randomUUID(),
        contentFingerprint: randomUUID(),
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-09-30T00:00:00Z'),
        createdById: uploader.id,
        validationJson: {
          errors: [
            {
              code: 'ROW_TOTAL_MISMATCH',
              row: 2,
              message: 'PHARMACY: printed 1000.00 but channels 900.00',
            },
            {
              code: 'GRAND_TOTAL_MISMATCH',
              row: 3,
              message: 'Printed grand total 1000.00 vs 900.00',
            },
          ],
          grandTotal: '1000.00',
          channelTotal: '900.00',
          flags: [],
        },
        normalizedJson: {
          reportDate: '2026-09-30',
          lines: [
            {
              rowNumber: 2,
              rawDepartment: 'PHARMACY',
              departmentId: departmentId(),
              reportedTotal: '1000.00',
              channelTotal: '900.00',
              variance: '100.00',
              amounts: { CASH: '600.00', POS: '300.00' },
            },
          ],
        },
        ...extra,
      } as never,
    });
  let department = '';
  const departmentId = () => department;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    const org = await prisma.organization.create({
      data: { name: `V ${suffix}`, slug: `v-${suffix}` },
    });
    const mk = (n: string) =>
      prisma.user.create({
        data: {
          organizationId: org.id,
          email: `${n}-${suffix}@t.local`,
          passwordHash: 'x',
          fullName: n,
        },
      });
    const [u, a] = await Promise.all([mk('uploader'), mk('approver')]);
    uploader = { ...allCentresUser(u.id), organizationId: org.id };
    approver = {
      ...allCentresUser(a.id, ['imports.approve_variance', 'charge_runs.create']),
      organizationId: org.id,
    };
    const centre = await prisma.centre.create({
      data: {
        organizationId: org.id,
        code: `V${suffix}`.toUpperCase(),
        name: 'Variance Centre',
        status: 'ACTIVE',
      },
    });
    centreId = centre.id;
    department = (
      await prisma.department.create({ data: { centreId, code: 'PHARM', name: 'Pharmacy' } })
    ).id;
    await prisma.paymentChannel.createMany({
      data: [
        { centreId, code: 'CASH', name: 'Cash' },
        { centreId, code: 'POS', name: 'POS' },
      ],
    });
    const agreement = await prisma.commercialAgreement.create({
      data: {
        centreId,
        name: 'Main',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    await prisma.chargeRule.create({
      data: {
        centreId,
        agreementId: agreement.id,
        name: 'Default',
        rate: 5,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const audit = new AuditService(prisma as never);
    imports = new ImportsService(
      prisma as never,
      new RevenueParserService(),
      { put: async () => 'k', get: async () => Buffer.from('') } as never,
      audit,
    );
    runs = new ChargeRunsService(prisma as never, audit);
    batchId = (await heldBatch()).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('refuses the ordinary commit, then commits with a reason and stores the channel amounts', async () => {
    await expect(imports.commit(approver, batchId)).rejects.toMatchObject({
      response: { code: 'IMPORT_NOT_READY' },
    });
    const result = await imports.commitWithVariance(approver, batchId, { reason });
    expect(result).toMatchObject({
      withVariance: true,
      grandTotal: '900.00',
      difference: '100.00',
    });

    const report = await prisma.revenueReport.findUniqueOrThrow({
      where: { id: result.reportId },
      include: { lines: true },
    });
    expect(report.grandTotal.toString()).toBe('900');
    expect(report.varianceApprovedById).toBe(approver.id);
    expect(report.varianceReason).toBe(reason);
    expect(report.varianceJson).toMatchObject({
      printedGrandTotal: '1000.00',
      difference: '100.00',
    });
    expect(report.lines[0].reportedTotal.toString()).toBe('1000');
    expect(report.lines[0].variance.toString()).toBe('100');

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe('COMMITTED');
    const audit = await prisma.auditEvent.findFirst({
      where: { targetId: batchId, action: 'IMPORT_COMMITTED_WITH_VARIANCE' },
    });
    expect(audit?.actorId).toBe(approver.id);
  });

  it('is charged on the channel amounts: 5% of 900, not of the printed 1,000', async () => {
    const report = await prisma.revenueReport.findFirstOrThrow({ where: { centreId } });
    const preview = await runs.preview(approver, { centreId, reportIds: [report.id] } as never);
    expect(preview.chargeTotal).toBe('45.00');
  });

  it('the database refuses an approval recorded without its reason or approver', async () => {
    const report = await prisma.revenueReport.findFirstOrThrow({ where: { centreId } });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "RevenueReport" SET "varianceReason" = 'short' WHERE id = '${report.id}'`,
      ),
    ).rejects.toThrow(/variance_complete/);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "RevenueReport" SET "varianceApprovedById" = NULL WHERE id = '${report.id}'`,
      ),
    ).rejects.toThrow(/variance_complete/);
  });

  it('a second held report with a blocking problem cannot be approved', async () => {
    const other = await heldBatch({
      validationJson: {
        errors: [
          { code: 'ROW_TOTAL_MISMATCH', row: 2, message: 'x' },
          { code: 'UNKNOWN_DEPARTMENT', row: 3, message: 'Department Y is not configured' },
        ],
        flags: [],
      },
    });
    await expect(imports.commitWithVariance(approver, other.id, { reason })).rejects.toMatchObject({
      response: { code: 'VARIANCE_NOT_ALLOWED' },
    });
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
      'NEEDS_REVIEW',
    );
  });

  it('the uploader cannot approve their own held report', async () => {
    const own = await heldBatch();
    await expect(imports.commitWithVariance(uploader, own.id, { reason })).rejects.toMatchObject({
      response: { code: 'MAKER_CHECKER_VIOLATION' },
    });
  });
});
