/**
 * Money-invariant tests for receipts and allocation, run against a REAL PostgreSQL database so
 * that row locking, transactions and the database constraints are genuinely exercised.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/hnb_scratch?schema=public npm test
 *
 * Skipped when TEST_DATABASE_URL is unset; refuses any database whose name lacks "test" or
 * "scratch" (the ledger and audit tables are append-only, so test data cannot be cleaned up).
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { dateInTimeZone } from '../common/utils/dates';
import { PaymentsService } from '../payments/payments.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { allCentresUser } from '../testing/fixtures';

const url = process.env.TEST_DATABASE_URL;
const safe = !!url && /\/[^/?]*(test|scratch)[^/?]*(\?|$)/i.test(url);
const maybe = url && safe ? describe : describe.skip;

maybe('receipts and allocation against a real database', () => {
  let prisma: PrismaClient;
  let payments: PaymentsService;
  let receivables: ReceivablesService;
  let orgId: string;
  let centreId: string;
  let maker: AuthUser;
  let checker: AuthUser;
  let allocator: AuthUser;
  let reverser: AuthUser;
  const suffix = randomUUID().slice(0, 8);
  const today = () => dateInTimeZone(new Date(), 'Africa/Lagos');
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
    return { ...allCentresUser(user.id), organizationId: orgId };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: url! } } });
    const org = await prisma.organization.create({
      data: { name: `P ${suffix}`, slug: `p-${suffix}` },
    });
    orgId = org.id;
    const centre = await prisma.centre.create({
      data: { organizationId: orgId, code: `PC-${suffix}`, name: 'Pay Centre', status: 'ACTIVE' },
    });
    centreId = centre.id;
    maker = await makeUser('maker');
    checker = await makeUser('checker');
    allocator = await makeUser('allocator');
    reverser = await makeUser('reverser');
    const audit = new AuditService(prisma as never);
    payments = new PaymentsService(prisma as never, audit);
    receivables = new ReceivablesService(prisma as never);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** A posted charge: one receivable with its CHARGE ledger debit. */
  async function receivable(amount: number, dueDate = '2030-01-31', inCentre = centreId) {
    const r = await prisma.receivable.create({
      data: {
        organizationId: orgId,
        centreId: inCentre,
        reference: ref('RCV'),
        description: 'fixture',
        originalAmount: amount,
        balance: amount,
        dueDate: new Date(`${dueDate}T00:00:00Z`),
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        organizationId: orgId,
        centreId: inCentre,
        receivableId: r.id,
        type: 'CHARGE',
        debit: amount,
        credit: 0,
        description: 'fixture charge',
        createdById: maker.id,
      },
    });
    return r;
  }

  /** A receipt taken through the whole approval lifecycle to POSTED. */
  async function postedPayment(amount: string, inCentre = centreId) {
    const created = await payments.create(maker, {
      centreId: inCentre,
      receiptDate: today(),
      amount,
      method: 'bank_transfer',
      reference: ref('PAY'),
      confirmPossibleDuplicate: true,
    });
    await payments.submit(maker, created.id);
    await payments.approve(checker, created.id);
    await payments.post(checker, created.id);
    return created.id;
  }

  const open = (id: string) => prisma.receivable.findUniqueOrThrow({ where: { id } });
  const pay = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });
  const num = (v: { toString(): string }) => Number(v.toString());

  describe('lifecycle', () => {
    it('takes a receipt Draft -> Submitted -> Approved -> Posted with different people', async () => {
      const id = await postedPayment('1000.00');
      const p = await pay(id);
      expect(p.status).toBe('POSTED');
      expect(p.approvedById).toBe(checker.id);
      expect(p.postedById).toBe(checker.id);
      expect(p.createdById).toBe(maker.id);
      expect(num(p.unallocatedAmount)).toBe(1000);
    });

    it('lets the database itself refuse a self-approved or self-posted receipt', async () => {
      const created = await payments.create(maker, {
        centreId,
        receiptDate: today(),
        amount: '10.00',
        method: 'cash',
        reference: ref('SELF'),
        confirmPossibleDuplicate: true,
      });
      await expect(
        prisma.payment.update({ where: { id: created.id }, data: { approvedById: maker.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.payment.update({ where: { id: created.id }, data: { postedById: maker.id } }),
      ).rejects.toThrow();
    });

    it('refuses cash to be allocated before the receipt is posted (database check)', async () => {
      const created = await payments.create(maker, {
        centreId,
        receiptDate: today(),
        amount: '10.00',
        method: 'cash',
        reference: ref('EARLY'),
        confirmPossibleDuplicate: true,
      });
      await expect(
        prisma.payment.update({ where: { id: created.id }, data: { unallocatedAmount: 5 } }),
      ).rejects.toThrow();
    });

    it('FR-AR-004: blocks a repeated reference, case-insensitively, and frees it on rejection', async () => {
      const reference = ref('Dup');
      const first = await payments.create(maker, {
        centreId,
        receiptDate: today(),
        amount: '55.00',
        method: 'cash',
        reference,
        confirmPossibleDuplicate: true,
      });
      await expect(
        payments.create(maker, {
          centreId,
          receiptDate: today(),
          amount: '66.00',
          method: 'cash',
          reference: reference.toUpperCase(),
          confirmPossibleDuplicate: true,
        }),
      ).rejects.toMatchObject({ response: { code: 'DUPLICATE_PAYMENT_REFERENCE' } });
      // even a direct insert cannot create a second live receipt with that reference
      await expect(
        prisma.payment.create({
          data: {
            organizationId: orgId,
            centreId,
            receiptDate: new Date(),
            amount: 1,
            unallocatedAmount: 1,
            method: 'CASH',
            reference: reference.toLowerCase(),
            createdById: maker.id,
          },
        }),
      ).rejects.toThrow();
      await payments.submit(maker, first.id);
      await payments.reject(checker, first.id, 'wrong remitter');
      await expect(
        payments.create(maker, {
          centreId,
          receiptDate: today(),
          amount: '55.00',
          method: 'cash',
          reference,
          confirmPossibleDuplicate: true,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('allocation (INV-006, INV-007, INV-008)', () => {
    it('INV-006: receipt = allocated + unallocated, and each balance is reduced only by what was allocated', async () => {
      const a = await receivable(600);
      const b = await receivable(900);
      const unrelated = await receivable(500);
      const id = await postedPayment('1000.00');

      const result = (await payments.allocate(allocator, id, {
        allocations: [
          { receivableId: a.id, amount: '600.00' },
          { receivableId: b.id, amount: '250.00' },
        ],
      })) as { unallocatedAmount: string };

      expect(result.unallocatedAmount).toBe('150.00');
      const p = await pay(id);
      const allocated = await prisma.paymentAllocation.aggregate({
        where: { paymentId: id, reversedAt: null },
        _sum: { amount: true },
      });
      expect(num(allocated._sum.amount!) + num(p.unallocatedAmount)).toBe(num(p.amount));
      expect(num((await open(a.id)).balance)).toBe(0);
      expect((await open(a.id)).status).toBe('PAID');
      expect(num((await open(b.id)).balance)).toBe(650);
      expect((await open(b.id)).status).toBe('PARTIALLY_PAID');
      expect(num((await open(unrelated.id)).balance)).toBe(500); // untouched
      expect((await open(unrelated.id)).status).toBe('OPEN');
    });

    it('INV-008: stored balances always equal the balance derived from the ledger', async () => {
      const r = await receivable(300);
      const id = await postedPayment('120.00');
      await payments.allocate(allocator, id, {
        allocations: [{ receivableId: r.id, amount: '120.00' }],
      });
      const detail = await receivables.get(allocator, r.id);
      expect(detail.ledger).toMatchObject({
        debit: '300.00',
        credit: '120.00',
        derivedBalance: '180.00',
      });
      expect(detail.ledger.consistent).toBe(true);
    });

    it('INV-007: over-allocating the receipt or a receivable fails and changes nothing', async () => {
      const r = await receivable(100);
      const big = await receivable(10_000);
      const id = await postedPayment('200.00');

      await expect(
        payments.allocate(allocator, id, {
          allocations: [{ receivableId: big.id, amount: '200.01' }],
        }),
      ).rejects.toMatchObject({ response: { code: 'OVER_ALLOCATION_PAYMENT' } });

      await expect(
        payments.allocate(allocator, id, {
          allocations: [{ receivableId: r.id, amount: '100.01' }],
        }),
      ).rejects.toMatchObject({ response: { code: 'OVER_ALLOCATION_RECEIVABLE' } });

      // all-or-nothing: the valid first item must not survive a failing second item
      await expect(
        payments.allocate(allocator, id, {
          allocations: [
            { receivableId: big.id, amount: '150.00' },
            { receivableId: r.id, amount: '999.00' },
          ],
        }),
      ).rejects.toBeDefined();

      expect(num((await pay(id)).unallocatedAmount)).toBe(200);
      expect(num((await open(r.id)).balance)).toBe(100);
      expect(num((await open(big.id)).balance)).toBe(10_000);
      expect(await prisma.paymentAllocation.count({ where: { paymentId: id } })).toBe(0);
    });

    it('INV-007: parallel allocations can never spend more cash than the receipt holds', async () => {
      const targets = await Promise.all(Array.from({ length: 6 }, () => receivable(1000)));
      const id = await postedPayment('100.00');
      const outcomes = await Promise.allSettled(
        targets.map((t, i) =>
          payments.allocate(
            allocator,
            id,
            { allocations: [{ receivableId: t.id, amount: '30.00' }] },
            `parallel-cash-${suffix}-${i}`,
          ),
        ),
      );
      const succeeded = outcomes.filter((o) => o.status === 'fulfilled').length;
      expect(succeeded).toBe(3); // 3 x 30 = 90 fits; a 4th would need 120 > 100
      const p = await pay(id);
      expect(num(p.unallocatedAmount)).toBe(10);
      const sum = await prisma.paymentAllocation.aggregate({
        where: { paymentId: id },
        _sum: { amount: true },
      });
      expect(num(sum._sum.amount!)).toBe(90);
      const failures = outcomes.filter((o) => o.status === 'rejected');
      for (const failure of failures) {
        expect(failure.reason.response.code).toBe('OVER_ALLOCATION_PAYMENT');
      }
    });

    it('INV-007: parallel receipts can never over-pay one receivable', async () => {
      const r = await receivable(50);
      const ids = await Promise.all([postedPayment('30.00'), postedPayment('30.00')]);
      const outcomes = await Promise.allSettled(
        ids.map((paymentId) =>
          payments.allocate(allocator, paymentId, {
            allocations: [{ receivableId: r.id, amount: '30.00' }],
          }),
        ),
      );
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const after = await open(r.id);
      expect(num(after.balance)).toBe(20);
      expect(num(after.amountPaid)).toBe(30);
    });

    it('INV-009: a repeated Idempotency-Key returns the first outcome and allocates once', async () => {
      const r = await receivable(500);
      const id = await postedPayment('500.00');
      const key = `idem-${suffix}-${randomUUID()}`;
      const body = { allocations: [{ receivableId: r.id, amount: '200.00' }] };
      const first = await payments.allocate(allocator, id, body, key);
      const second = await payments.allocate(allocator, id, body, key);
      expect(second).toEqual(first);
      expect(await prisma.paymentAllocation.count({ where: { paymentId: id } })).toBe(1);
      expect(num((await open(r.id)).balance)).toBe(300);

      await expect(
        payments.allocate(
          allocator,
          id,
          { allocations: [{ receivableId: r.id, amount: '100.00' }] },
          key,
        ),
      ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    });

    it("refuses allocation of a receipt that is not posted, or to another centre's receivable", async () => {
      const draft = await payments.create(maker, {
        centreId,
        receiptDate: today(),
        amount: '10.00',
        method: 'cash',
        reference: ref('D'),
        confirmPossibleDuplicate: true,
      });
      const r = await receivable(100);
      await expect(
        payments.allocate(allocator, draft.id, {
          allocations: [{ receivableId: r.id, amount: '10.00' }],
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_PAYMENT_STATUS' } });

      const other = await prisma.centre.create({
        data: {
          organizationId: orgId,
          code: `OC-${suffix}-${++seq}`,
          name: 'Other',
          status: 'ACTIVE',
        },
      });
      const foreign = await prisma.receivable.create({
        data: {
          organizationId: orgId,
          centreId: other.id,
          reference: ref('FOREIGN'),
          description: 'other centre',
          originalAmount: 100,
          balance: 100,
          dueDate: new Date('2030-01-31T00:00:00Z'),
        },
      });
      const id = await postedPayment('50.00');
      await expect(
        payments.allocate(allocator, id, {
          allocations: [{ receivableId: foreign.id, amount: '10.00' }],
        }),
      ).rejects.toMatchObject({ response: { code: 'RECEIVABLE_NOT_FOUND' } });
    });

    it('suggests oldest-due first in the preview without committing anything', async () => {
      // a dedicated centre, so receivables left open by other tests do not fill the suggestion
      const own = await prisma.centre.create({
        data: {
          organizationId: orgId,
          code: 'SC-' + suffix + '-' + ++seq,
          name: 'Suggest',
          status: 'ACTIVE',
        },
      });
      const later = await receivable(80, '2031-03-31', own.id);
      const sooner = await receivable(80, '2031-01-31', own.id);
      const id = await postedPayment('100.00', own.id);
      const preview = await payments.allocationPreview(allocator, id);
      const order = preview.suggestion.map((s) => s.receivableId);
      expect(order.indexOf(sooner.id)).toBeLessThan(order.indexOf(later.id));
      expect(num((await pay(id)).unallocatedAmount)).toBe(100);
    });
  });

  describe('reversal (INV-011)', () => {
    it('reverses an allocation with a compensating ledger debit and restores both balances', async () => {
      const r = await receivable(400);
      const id = await postedPayment('400.00');
      const allocated = (await payments.allocate(allocator, id, {
        allocations: [{ receivableId: r.id, amount: '400.00' }],
      })) as { allocations: Array<{ id: string }> };
      const allocationId = allocated.allocations[0].id;
      expect((await open(r.id)).status).toBe('PAID');

      await expect(
        payments.reverseAllocation(allocator, allocationId, 'entered against the wrong period'),
      ).rejects.toMatchObject({ response: { code: 'MAKER_CHECKER_VIOLATION' } });

      await payments.reverseAllocation(reverser, allocationId, 'entered against the wrong period');
      const after = await open(r.id);
      expect(num(after.balance)).toBe(400);
      expect(after.status).toBe('OPEN');
      expect(num((await pay(id)).unallocatedAmount)).toBe(400);

      // original credit and the reversal debit are both preserved; the ledger still agrees
      const entries = await prisma.ledgerEntry.findMany({ where: { receivableId: r.id } });
      expect(entries.map((e) => e.type).sort()).toEqual([
        'CHARGE',
        'PAYMENT_ALLOCATION',
        'REVERSAL',
      ]);
      expect((await receivables.get(allocator, r.id)).ledger.consistent).toBe(true);

      // repeating the reversal is a no-op, and the cash can be allocated again
      await expect(
        payments.reverseAllocation(reverser, allocationId, 'again'),
      ).resolves.toMatchObject({
        alreadyReversed: true,
      });
      await expect(
        payments.allocate(allocator, id, {
          allocations: [{ receivableId: r.id, amount: '400.00' }],
        }),
      ).resolves.toBeDefined();
    });

    it('will not reverse a receipt that still has active allocations', async () => {
      const r = await receivable(100);
      const id = await postedPayment('100.00');
      const allocated = (await payments.allocate(allocator, id, {
        allocations: [{ receivableId: r.id, amount: '60.00' }],
      })) as { allocations: Array<{ id: string }> };

      await expect(payments.reverse(reverser, id, 'bounced')).rejects.toMatchObject({
        response: { code: 'PAYMENT_HAS_ALLOCATIONS' },
      });
      await payments.reverseAllocation(reverser, allocated.allocations[0].id, 'wrong target');
      const reversed = await payments.reverse(reverser, id, 'bounced');
      expect(reversed.status).toBe('REVERSED');
      await expect(
        payments.allocate(allocator, id, {
          allocations: [{ receivableId: r.id, amount: '10.00' }],
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_PAYMENT_STATUS' } });
    });
  });

  describe('worklists and ageing', () => {
    it('lists posted receipts with cash left as unallocated, separate from receivables', async () => {
      const id = await postedPayment('77.00');
      const list = await payments.unallocated(allocator, { centreId, pageSize: 100 });
      expect(list.items.map((p) => p.id)).toContain(id);
    });

    it('buckets an overdue receivable and treats the due date itself as not overdue (D-014)', async () => {
      const r = await receivable(250, '2030-06-30');
      const onDueDate = await receivables.get(allocator, r.id, '2030-06-30');
      expect(onDueDate.ageingBucket).toBe('NOT_YET_DUE');
      const lateBy31 = await receivables.get(allocator, r.id, '2030-07-31');
      expect(lateBy31.ageingBucket).toBe('DAYS_31_60');
      const summary = await receivables.ageing(allocator, { centreId, asAt: '2030-07-31' });
      expect(Number(summary.total.DAYS_31_60)).toBeGreaterThanOrEqual(250);
    });
  });
});
