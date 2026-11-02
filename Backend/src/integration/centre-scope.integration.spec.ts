/**
 * Authorization matrix at service level, against a REAL database: a user scoped to Centre A must
 * not be able to read or change anything that belongs to Centre B, in any service.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hnb_scratch?schema=public npm test
 *
 * Skipped when TEST_DATABASE_URL is unset; refuses any database whose name lacks "test" or "scratch".
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { CentresService } from '../centres/centres.service';
import { ChargeConfigService } from '../charges/charge-config.service';
import { ChargeRunsService } from '../charges/charge-runs.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { ImportsService } from '../imports/imports.service';
import { RevenueParserService } from '../imports/revenue-parser.service';
import { PaymentsService } from '../payments/payments.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { grant, makeUser } from '../testing/fixtures';

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[^/?]*(test|scratch)[^/?]*(\?|$)/i.test(url);
const maybe = url && safe ? describe : describe.skip;

maybe('centre scope isolation (user scoped to A, data in B)', () => {
  let prisma: PrismaClient;
  let scoped: AuthUser;
  let a: { id: string };
  let b: { id: string };
  let bAgreementId: string;
  let bChargeRunId: string;
  let bPaymentId: string;
  let bReceivableId: string;
  let bImportId: string;
  let bDepartmentId: string;
  let bChannelId: string;
  let centres: CentresService;
  let config: ChargeConfigService;
  let runs: ChargeRunsService;
  let payments: PaymentsService;
  let receivables: ReceivablesService;
  let imports: ImportsService;
  let dashboard: DashboardService;
  const suffix = randomUUID().slice(0, 8);

  const notFound = { status: 404 };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    const org = await prisma.organization.create({
      data: { name: `S ${suffix}`, slug: `s-${suffix}` },
    });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `s-${suffix}@t.local`,
        passwordHash: 'x',
        fullName: 'Scoped',
      },
    });
    a = await prisma.centre.create({
      data: { organizationId: org.id, code: `A-${suffix}`, name: 'Centre A', status: 'ACTIVE' },
    });
    b = await prisma.centre.create({
      data: { organizationId: org.id, code: `B-${suffix}`, name: 'Centre B', status: 'ACTIVE' },
    });

    const all = [
      'centres.read',
      'centres.update',
      'charge_rules.read',
      'charge_rules.manage',
      'charge_runs.read',
      'charge_runs.create',
      'charge_runs.approve',
      'charge_runs.post',
      'payments.read',
      'payments.create',
      'payments.allocate',
      'payments.reverse',
      'receivables.read',
      'imports.read',
      'imports.manage',
      'imports.commit',
      'dashboard.read',
    ];
    scoped = { ...makeUser(user.id, [grant('SCOPED', all, [a.id])]), organizationId: org.id };

    const dept = await prisma.department.create({
      data: { centreId: b.id, code: 'D1', name: 'Dept B' },
    });
    const channel = await prisma.paymentChannel.create({
      data: { centreId: b.id, code: 'C1', name: 'Chan B' },
    });
    bDepartmentId = dept.id;
    bChannelId = channel.id;
    const agreement = await prisma.commercialAgreement.create({
      data: {
        centreId: b.id,
        name: 'B agreement',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });
    bAgreementId = agreement.id;
    const run = await prisma.chargeRun.create({
      data: {
        organizationId: org.id,
        centreId: b.id,
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-09-30T00:00:00Z'),
        asOf: new Date('2026-09-30T00:00:00Z'),
        status: 'SUBMITTED',
        createdById: user.id,
      },
    });
    bChargeRunId = run.id;
    const receivable = await prisma.receivable.create({
      data: {
        organizationId: org.id,
        centreId: b.id,
        reference: `RCV-${suffix}`,
        description: 'B receivable',
        originalAmount: 100,
        balance: 100,
        dueDate: new Date('2030-01-01T00:00:00Z'),
      },
    });
    bReceivableId = receivable.id;
    const payment = await prisma.payment.create({
      data: {
        organizationId: org.id,
        centreId: b.id,
        receiptDate: new Date('2026-10-01T00:00:00Z'),
        amount: 50,
        unallocatedAmount: 50,
        method: 'CASH',
        reference: `PAY-${suffix}`,
        status: 'POSTED',
        createdById: user.id,
      },
    });
    bPaymentId = payment.id;
    const batch = await prisma.importBatch.create({
      data: {
        organizationId: org.id,
        centreId: b.id,
        status: 'READY_TO_COMMIT',
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-09-30T00:00:00Z'),
        createdById: user.id,
      },
    });
    bImportId = batch.id;

    const audit = new AuditService(prisma as never);
    centres = new CentresService(prisma as never, audit);
    config = new ChargeConfigService(prisma as never, audit);
    runs = new ChargeRunsService(prisma as never, audit);
    payments = new PaymentsService(prisma as never, audit);
    receivables = new ReceivablesService(prisma as never);
    imports = new ImportsService(
      prisma as never,
      new RevenueParserService(),
      { put: jest.fn() } as never,
      audit,
    );
    dashboard = new DashboardService(prisma as never);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe('centres', () => {
    it('returns the requested centre when it is in scope, never a different one', async () => {
      const result = await centres.get(scoped, a.id);
      expect(result.id).toBe(a.id);
    });

    it('does not return, or reveal, a centre outside the scope', async () => {
      await expect(centres.get(scoped, b.id)).rejects.toMatchObject(notFound);
    });

    it('lists only the centres in scope', async () => {
      const list = await centres.list(scoped, {});
      expect(list.items.map((c) => c.id)).toEqual([a.id]);
    });

    it('cannot modify a centre outside the scope', async () => {
      await expect(
        centres.update(scoped, b.id, { name: 'taken over' } as never),
      ).rejects.toMatchObject(notFound);
      expect((await prisma.centre.findUniqueOrThrow({ where: { id: b.id } })).name).toBe(
        'Centre B',
      );
    });

    it('cannot add or edit departments and channels of a centre outside the scope', async () => {
      await expect(
        centres.addDepartment(scoped, b.id, { code: 'EVIL', name: 'Evil' } as never),
      ).rejects.toMatchObject(notFound);
      await expect(
        centres.addChannel(scoped, b.id, { code: 'EVIL', name: 'Evil' } as never),
      ).rejects.toMatchObject(notFound);
      await expect(
        centres.updateDepartment(scoped, b.id, bDepartmentId, { name: 'Renamed' } as never),
      ).rejects.toMatchObject(notFound);
      await expect(
        centres.updateChannel(scoped, b.id, bChannelId, { name: 'Renamed' } as never),
      ).rejects.toMatchObject(notFound);
      expect(await prisma.department.count({ where: { centreId: b.id } })).toBe(1);
      expect(await prisma.paymentChannel.count({ where: { centreId: b.id } })).toBe(1);
      expect(
        (await prisma.department.findUniqueOrThrow({ where: { id: bDepartmentId } })).name,
      ).toBe('Dept B');
    });
  });

  describe('charge configuration', () => {
    it('cannot read or change agreements and rules of another centre', async () => {
      await expect(config.listAgreements(scoped, b.id, {})).rejects.toMatchObject(notFound);
      await expect(
        config.createAgreement(scoped, b.id, { name: 'x', effectiveFrom: '2026-01-01' } as never),
      ).rejects.toMatchObject(notFound);
      await expect(
        config.updateAgreement(scoped, bAgreementId, { name: 'x' } as never),
      ).rejects.toMatchObject(notFound);
      await expect(config.listRules(scoped, bAgreementId, {})).rejects.toMatchObject(notFound);
      await expect(
        config.addRule(scoped, bAgreementId, {
          name: 'x',
          rate: 5,
          effectiveFrom: '2026-01-01',
        } as never),
      ).rejects.toMatchObject(notFound);
    });
  });

  describe('charge runs', () => {
    it("cannot read, approve or post another centre's run", async () => {
      await expect(runs.get(scoped, bChargeRunId)).rejects.toMatchObject(notFound);
      await expect(runs.approve(scoped, bChargeRunId)).rejects.toMatchObject(notFound);
      await expect(runs.post(scoped, bChargeRunId)).rejects.toMatchObject(notFound);
      expect(
        (await prisma.chargeRun.findUniqueOrThrow({ where: { id: bChargeRunId } })).status,
      ).toBe('SUBMITTED');
    });
    it('cannot preview or create a run for another centre', async () => {
      const body = { centreId: b.id, periodStart: '2026-09-01', periodEnd: '2026-09-30' };
      await expect(runs.preview(scoped, body)).rejects.toMatchObject(notFound);
      await expect(runs.create(scoped, body)).rejects.toMatchObject(notFound);
    });
    it("does not list another centre's runs even when asked by id", async () => {
      await expect(runs.list(scoped, { centreId: b.id } as never)).rejects.toMatchObject(notFound);
      const list = await runs.list(scoped, {} as never);
      expect(list.items.map((r) => r.id)).not.toContain(bChargeRunId);
    });
  });

  describe('payments and receivables', () => {
    it("cannot read, advance or allocate another centre's receipt", async () => {
      await expect(payments.get(scoped, bPaymentId)).rejects.toMatchObject(notFound);
      await expect(payments.allocationPreview(scoped, bPaymentId)).rejects.toMatchObject(notFound);
      await expect(
        payments.allocate(scoped, bPaymentId, {
          allocations: [{ receivableId: bReceivableId, amount: '10.00' }],
        }),
      ).rejects.toMatchObject(notFound);
      await expect(payments.reverse(scoped, bPaymentId, 'no')).rejects.toMatchObject(notFound);
      expect(
        Number(
          (await prisma.payment.findUniqueOrThrow({ where: { id: bPaymentId } })).unallocatedAmount,
        ),
      ).toBe(50);
    });
    it('cannot record a receipt for another centre', async () => {
      await expect(
        payments.create(scoped, {
          centreId: b.id,
          receiptDate: '2026-10-01',
          amount: '10.00',
          method: 'cash',
        } as never),
      ).rejects.toMatchObject(notFound);
    });
    it("cannot see another centre's receipts or receivables in lists", async () => {
      expect((await payments.list(scoped, {})).items.map((p) => p.id)).not.toContain(bPaymentId);
      expect((await receivables.list(scoped, {})).items.map((r) => r.id)).not.toContain(
        bReceivableId,
      );
      await expect(receivables.get(scoped, bReceivableId)).rejects.toMatchObject(notFound);
      await expect(receivables.list(scoped, { centreId: b.id })).rejects.toMatchObject(notFound);
      await expect(receivables.ageing(scoped, { centreId: b.id })).rejects.toMatchObject(notFound);
    });
  });

  describe('imports and dashboard', () => {
    it("cannot read or commit another centre's import", async () => {
      await expect(imports.get(scoped, bImportId)).rejects.toMatchObject(notFound);
      await expect(imports.commit(scoped, bImportId)).rejects.toMatchObject(notFound);
      expect(
        (await prisma.importBatch.findUniqueOrThrow({ where: { id: bImportId } })).status,
      ).toBe('READY_TO_COMMIT');
    });
    it("cannot download another centre's template or list its imports", async () => {
      await expect(imports.template(scoped, b.id)).rejects.toMatchObject(notFound);
      await expect(imports.list(scoped, { centreId: b.id })).rejects.toMatchObject(notFound);
    });
    it('does not include another centre in dashboard figures or accept it as a filter', async () => {
      await expect(dashboard.summary(scoped, { centreId: b.id })).rejects.toMatchObject(notFound);
      const summary = await dashboard.summary(scoped, {});
      expect(summary.measures.outstandingReceivables.amount).toBe('0.00'); // B's 100.00 is not counted
      expect(summary.measures.unallocatedReceipts.amount).toBe('0.00');
    });
  });
});
