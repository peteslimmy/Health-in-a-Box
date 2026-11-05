/**
 * Money-invariant tests for adjustments, disputes and opening balances, run against a REAL
 * PostgreSQL database so that locks, transactions and the CHECK constraints are exercised.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hnb_scratch?schema=public npm test
 *
 * Skipped when TEST_DATABASE_URL is unset; refuses any database whose name lacks "test" or
 * "scratch" (the ledger and audit tables are append-only, so test data cannot be cleaned up).
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AdjustmentsService } from '../adjustments/adjustments.service';
import { OpeningBalancesService } from '../adjustments/opening-balances.service';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { allHospitalsUser } from '../testing/fixtures';

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[^/?]*(test|scratch)[^/?]*(\?|$)/i.test(url);
const maybe = url && safe ? describe : describe.skip;

maybe('adjustments, disputes and opening balances against a real database', () => {
  let prisma: PrismaClient;
  let adjustments: AdjustmentsService;
  let openings: OpeningBalancesService;
  let orgId: string;
  let hospitalId: string;
  let maker: AuthUser;
  let checker: AuthUser;
  const suffix = randomUUID().slice(0, 8);
  let seq = 0;
  const ref = (label: string) => `${label}-${suffix}-${++seq}`;

  async function makeUser(label: string): Promise<AuthUser> {
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `${label}-${suffix}@t.local`,
        passwordHash: 'x',
        fullName: label,
      },
    });
    return { ...allHospitalsUser(user.id), organizationId: orgId };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    const org = await prisma.organization.create({
      data: { name: `A ${suffix}`, slug: `a-${suffix}` },
    });
    orgId = org.id;
    const hospital = await prisma.hospital.create({
      data: { organizationId: orgId, code: `AC-${suffix}`, name: 'Adj Hospital', status: 'ACTIVE' },
    });
    hospitalId = hospital.id;
    maker = await makeUser('maker');
    checker = await makeUser('checker');
    const audit = new AuditService(prisma as never);
    adjustments = new AdjustmentsService(prisma as never, audit);
    openings = new OpeningBalancesService(prisma as never, audit);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function receivable(amount: number, paid = 0) {
    const r = await prisma.receivable.create({
      data: {
        organizationId: orgId,
        hospitalId,
        reference: ref('RCV'),
        description: 'fixture',
        originalAmount: amount,
        amountPaid: paid,
        balance: amount - paid,
        dueDate: new Date('2030-01-31T00:00:00Z'),
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        organizationId: orgId,
        hospitalId,
        receivableId: r.id,
        type: 'CHARGE',
        debit: amount,
        credit: 0,
        description: 'fixture charge',
        createdById: maker.id,
      },
    });
    if (paid > 0) {
      await prisma.ledgerEntry.create({
        data: {
          organizationId: orgId,
          hospitalId,
          receivableId: r.id,
          type: 'PAYMENT_ALLOCATION',
          debit: 0,
          credit: paid,
          description: 'fixture payment',
          createdById: maker.id,
        },
      });
    }
    return r;
  }

  const ledgerBalance = async (receivableId: string) => {
    const rows = await prisma.ledgerEntry.findMany({ where: { receivableId } });
    return rows.reduce((t, e) => t + Number(e.debit) - Number(e.credit), 0);
  };

  const propose = (receivableId: string, type: 'CREDIT' | 'DEBIT', amount: string) =>
    adjustments.createAdjustment(maker, {
      receivableId,
      type,
      amount,
      reasonCode: 'BILLING_ERROR',
      reason: 'Billed on the wrong revenue base',
    });

  it('a credit lowers the balance, matches the ledger and stays consistent with the database checks', async () => {
    const r = await receivable(1000);
    const a = await propose(r.id, 'CREDIT', '250.00');
    await adjustments.approveAdjustment(checker, a.id);
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } });
    expect(Number(after.adjustmentTotal)).toBe(-250);
    expect(Number(after.balance)).toBe(750);
    expect(await ledgerBalance(r.id)).toBe(750);
  });

  it('a debit raises the balance and the ledger agrees', async () => {
    const r = await receivable(500, 100);
    const a = await propose(r.id, 'DEBIT', '40.50');
    await adjustments.approveAdjustment(checker, a.id);
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } });
    expect(Number(after.balance)).toBe(440.5);
    expect(await ledgerBalance(r.id)).toBe(440.5);
  });

  it('nothing reaches the ledger until a different person approves', async () => {
    const r = await receivable(300);
    const a = await propose(r.id, 'CREDIT', '50.00');
    await expect(adjustments.approveAdjustment(maker, a.id)).rejects.toMatchObject({
      response: { code: 'MAKER_CHECKER_VIOLATION' },
    });
    expect(
      Number((await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } })).balance),
    ).toBe(300);
    expect(await ledgerBalance(r.id)).toBe(300);
  });

  it('approving twice posts once', async () => {
    const r = await receivable(300);
    const a = await propose(r.id, 'CREDIT', '50.00');
    await adjustments.approveAdjustment(checker, a.id);
    const again = await adjustments.approveAdjustment(checker, a.id);
    expect(again).toMatchObject({ alreadyApproved: true });
    expect(await ledgerBalance(r.id)).toBe(250);
  });

  it('two credits proposed together cannot take the balance below zero', async () => {
    const r = await receivable(100);
    const first = await propose(r.id, 'CREDIT', '80.00');
    const second = await propose(r.id, 'CREDIT', '80.00');
    const results = await Promise.allSettled([
      adjustments.approveAdjustment(checker, first.id),
      adjustments.approveAdjustment(checker, second.id),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } });
    expect(Number(after.balance)).toBe(20);
    expect(await ledgerBalance(r.id)).toBe(20);
  });

  it('a credit larger than the balance is refused when proposed', async () => {
    const r = await receivable(100, 90);
    await expect(propose(r.id, 'CREDIT', '10.01')).rejects.toMatchObject({
      response: { code: 'ADJUSTMENT_EXCEEDS_BALANCE' },
    });
  });

  it('the database itself refuses an approver who is also the proposer', async () => {
    const r = await receivable(100);
    const a = await propose(r.id, 'CREDIT', '10.00');
    await expect(
      prisma.adjustment.update({
        where: { id: a.id },
        data: { status: 'APPROVED', decidedById: maker.id, decidedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it('a dispute flags the receivable, allows only one open dispute, and clears the flag when resolved', async () => {
    const r = await receivable(400);
    const d = await adjustments.raiseDispute(maker, {
      receivableId: r.id,
      amount: '100.00',
      reason: 'The hospital says the department was closed',
    });
    expect((await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      'DISPUTED',
    );
    await expect(
      adjustments.raiseDispute(maker, {
        receivableId: r.id,
        amount: '50.00',
        reason: 'A second dispute on it',
      }),
    ).rejects.toMatchObject({ response: { code: 'DISPUTE_ALREADY_OPEN' } });
    await adjustments.resolveDispute(checker, d.id, {
      outcome: 'REJECTED',
      note: 'Department was open',
    });
    expect((await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      'OPEN',
    );
  });

  it('an upheld dispute proposes a credit that still needs approval before the balance moves', async () => {
    const r = await receivable(400);
    const d = await adjustments.raiseDispute(maker, {
      receivableId: r.id,
      amount: '100.00',
      reason: 'Revenue was reported twice that day',
    });
    const resolved = await adjustments.resolveDispute(checker, d.id, {
      outcome: 'UPHELD',
      note: 'Confirmed duplicate',
      proposeCredit: true,
    });
    expect(
      Number((await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } })).balance),
    ).toBe(400);
    // The resolver proposed the credit, so the original raiser (a different person) approves it.
    await adjustments.approveAdjustment(maker, resolved.adjustmentId as string);
    const after = await prisma.receivable.findUniqueOrThrow({ where: { id: r.id } });
    expect(Number(after.balance)).toBe(300);
    expect(after.status).toBe('OPEN');
    expect(await ledgerBalance(r.id)).toBe(300);
  });

  it('an opening balance becomes one receivable with a matching ledger entry, only after approval', async () => {
    const proposal = await openings.create(maker, {
      hospitalId,
      asAt: '2026-01-31',
      amount: '12345.67',
      dueDate: '2026-03-31',
      sourceNote: 'Signed statement of account dated 31 Jan 2026',
    });
    await expect(openings.approve(maker, proposal.id)).rejects.toMatchObject({
      response: { code: 'MAKER_CHECKER_VIOLATION' },
    });
    const done = await openings.approve(checker, proposal.id);
    const receivableId = (done as { receivableId: string }).receivableId;
    const r = await prisma.receivable.findUniqueOrThrow({ where: { id: receivableId } });
    expect(Number(r.balance)).toBe(12345.67);
    expect(await ledgerBalance(receivableId)).toBe(12345.67);
    await expect(
      openings.create(maker, {
        hospitalId,
        asAt: '2026-01-31',
        amount: '1.00',
        dueDate: '2026-03-31',
        sourceNote: 'A second opening balance for the same date',
      }),
    ).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_EXISTS' } });
  });

  it('an opening balance cannot overlap periods already charged on the platform', async () => {
    const other = await prisma.hospital.create({
      data: {
        organizationId: orgId,
        code: `OV-${suffix}`,
        name: 'Overlap Hospital',
        status: 'ACTIVE',
      },
    });
    await prisma.chargeRun.create({
      data: {
        organizationId: orgId,
        hospitalId: other.id,
        periodStart: new Date('2026-02-01T00:00:00Z'),
        periodEnd: new Date('2026-02-28T00:00:00Z'),
        asOf: new Date('2026-03-01T00:00:00Z'),
        status: 'POSTED',
        baseTotal: 100,
        chargeTotal: 10,
        createdById: maker.id,
      },
    });
    await expect(
      openings.create(maker, {
        hospitalId: other.id,
        asAt: '2026-02-15',
        amount: '500.00',
        dueDate: '2026-04-30',
        sourceNote: 'Balance taken from the old ledger',
      }),
    ).rejects.toMatchObject({ response: { code: 'OPENING_OVERLAPS_HISTORY' } });
    await expect(
      openings.create(maker, {
        hospitalId: other.id,
        asAt: '2026-01-31',
        amount: '500.00',
        dueDate: '2026-04-30',
        sourceNote: 'Balance taken from the old ledger',
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });
});
