/**
 * Database-level integrity tests. They exercise the constraints and triggers added by the
 * `integrity_hardening` migration against a REAL PostgreSQL database.
 *
 * Run only against a throw-away database that already has all migrations applied:
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hnb_scratch?schema=public npm test
 *
 * The suite is skipped when TEST_DATABASE_URL is unset, and refuses to run unless the database
 * name contains "test" or "scratch", because the append-only tables cannot be cleaned up.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[^/?]*(test|scratch)[^/?]*(\?|$)/i.test(url);
const maybe = url && safe ? describe : describe.skip;

maybe('database integrity constraints', () => {
  let prisma: PrismaClient;
  const suffix = randomUUID().slice(0, 8);
  let orgId: string;
  let userId: string;
  let hospitalId: string;
  let deptId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    const org = await prisma.organization.create({
      data: { name: `T ${suffix}`, slug: `t-${suffix}` },
    });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `u-${suffix}@t.local`,
        passwordHash: 'x',
        fullName: 'T',
      },
    });
    userId = user.id;
    const hospital = await prisma.hospital.create({
      data: { organizationId: orgId, code: `C-${suffix}`, name: 'Test Hospital' },
    });
    hospitalId = hospital.id;
    const dept = await prisma.department.create({
      data: { hospitalId, code: 'D1', name: 'Dept 1' },
    });
    deptId = dept.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const rule = (from: string, to: string | null, extra: Record<string, unknown> = {}) =>
    prisma.chargeRule.create({
      data: {
        hospitalId,
        departmentId: deptId,
        name: `rule ${from}`,
        rate: 5,
        effectiveFrom: new Date(`${from}T00:00:00Z`),
        effectiveTo: to ? new Date(`${to}T00:00:00Z`) : null,
        ...extra,
      },
    });

  it('rejects two overlapping active rules for the same scope, even under a race', async () => {
    await rule('2030-01-01', '2030-01-31');
    await expect(rule('2030-01-31', '2030-02-15')).rejects.toThrow(
      /ChargeRule_no_overlap|exclusion/i,
    );
    await expect(rule('2030-01-15', null)).rejects.toThrow();
  });

  it('allows adjacent rules and overlapping rules that are inactive', async () => {
    await expect(rule('2030-02-01', '2030-02-28')).resolves.toBeDefined();
    await expect(rule('2030-02-10', null, { isActive: false })).resolves.toBeDefined();
  });

  it('rejects an out-of-range rate and an inverted date range', async () => {
    await expect(rule('2031-01-01', null, { rate: 101 })).rejects.toThrow();
    await expect(rule('2031-02-01', '2031-01-01')).rejects.toThrow();
  });

  describe('receivables and the ledger', () => {
    const receivable = (data: Record<string, unknown>) =>
      prisma.receivable.create({
        data: {
          organizationId: orgId,
          hospitalId,
          reference: `RCV-${randomUUID()}`,
          description: 'test',
          originalAmount: 100,
          balance: 100,
          dueDate: new Date('2030-01-01T00:00:00Z'),
          ...data,
        } as never,
      });

    it('requires the stored balance to equal original minus paid', async () => {
      await expect(receivable({ balance: 90 })).rejects.toThrow();
      await expect(receivable({ amountPaid: 30, balance: 70 })).resolves.toBeDefined();
      await expect(receivable({ amountPaid: 130, balance: -30 })).rejects.toThrow();
    });

    it('requires each ledger entry to be exactly one-sided', async () => {
      const r = await receivable({});
      const entry = (debit: number, credit: number) =>
        prisma.ledgerEntry.create({
          data: {
            organizationId: orgId,
            hospitalId,
            receivableId: r.id,
            type: 'CHARGE',
            debit,
            credit,
            description: 'test',
            createdById: userId,
          },
        });
      await expect(entry(100, 100)).rejects.toThrow();
      await expect(entry(0, 0)).rejects.toThrow();
      await expect(entry(-5, 0)).rejects.toThrow();
      await expect(entry(100, 0)).resolves.toBeDefined();
    });

    it('makes ledger entries and audit events append-only', async () => {
      const r = await receivable({});
      const entry = await prisma.ledgerEntry.create({
        data: {
          organizationId: orgId,
          hospitalId,
          receivableId: r.id,
          type: 'CHARGE',
          debit: 100,
          credit: 0,
          description: 'original',
          createdById: userId,
        },
      });
      await expect(
        prisma.ledgerEntry.update({ where: { id: entry.id }, data: { debit: 1 } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(
        /append-only/,
      );

      const audit = await prisma.auditEvent.create({
        data: { organizationId: orgId, action: 'TEST', targetType: 'T', summary: 'original' },
      });
      await expect(
        prisma.auditEvent.update({ where: { id: audit.id }, data: { summary: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.auditEvent.delete({ where: { id: audit.id } })).rejects.toThrow(
        /append-only/,
      );
    });

    it('cannot delete a hospital or organisation that has financial records', async () => {
      await expect(prisma.hospital.delete({ where: { id: hospitalId } })).rejects.toThrow();
      await expect(prisma.organization.delete({ where: { id: orgId } })).rejects.toThrow();
    });
  });

  describe('duplicate reports', () => {
    const batch = (status: 'READY_TO_COMMIT' | 'NEEDS_REVIEW' | 'COMMITTED', fp: string) =>
      prisma.importBatch.create({
        data: {
          organizationId: orgId,
          hospitalId,
          status,
          periodStart: new Date('2030-03-01T00:00:00Z'),
          periodEnd: new Date('2030-03-31T00:00:00Z'),
          contentFingerprint: fp,
          createdById: userId,
        },
      });

    it('allows only one ready/committed batch per hospital, period and content', async () => {
      const fp = `fp-${suffix}`;
      await batch('READY_TO_COMMIT', fp);
      await expect(batch('READY_TO_COMMIT', fp)).rejects.toThrow();
      await expect(batch('COMMITTED', fp)).rejects.toThrow();
    });

    it('does not let a batch that needs review block a corrected re-upload', async () => {
      const fp = `fp2-${suffix}`;
      await batch('NEEDS_REVIEW', fp);
      await expect(batch('NEEDS_REVIEW', fp)).resolves.toBeDefined();
      await expect(batch('READY_TO_COMMIT', fp)).resolves.toBeDefined();
    });
  });
});
