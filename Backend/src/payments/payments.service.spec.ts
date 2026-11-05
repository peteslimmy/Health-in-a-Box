import { Decimal } from 'decimal.js';
import { allHospitalsUser, D } from '../testing/fixtures';
import { PaymentsService } from './payments.service';
import { receivableStatusFor } from './receivable-status';

const HOSPITAL = 'hospital-1';

function paymentFixture(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    organizationId: 'org-1',
    hospitalId: HOSPITAL,
    status,
    createdById: 'maker',
    amount: new Decimal('1000.00'),
    unallocatedAmount: new Decimal('1000.00'),
    receiptDate: D('2026-10-01'),
    reference: 'REF-1',
    hospital: { id: HOSPITAL, status: 'ACTIVE', timezone: 'Africa/Lagos' },
    allocations: [],
    ...overrides,
  };
}

function build(
  payment: ReturnType<typeof paymentFixture>,
  hospital = { id: HOSPITAL, status: 'ACTIVE', timezone: 'Africa/Lagos' },
) {
  const tx = {
    payment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(async ({ data }) => ({ id: 'pay-new', ...data })),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    payment: {
      findFirst: jest.fn().mockResolvedValue(payment),
    },
    hospital: { findFirst: jest.fn().mockResolvedValue(hospital) },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  return { service: new PaymentsService(prisma as never, audit as never), prisma, tx, audit };
}

const maker = allHospitalsUser('maker');
const checker = allHospitalsUser('checker');
const code = (c: string) => ({ response: { code: c } });

describe('receipt lifecycle (P-015) and maker-checker', () => {
  it('only the recorder can submit a draft', async () => {
    const { service } = build(paymentFixture('DRAFT'));
    await expect(service.submit(checker, 'pay-1')).rejects.toMatchObject(code('NOT_PAYMENT_OWNER'));
  });

  it('moves a draft to submitted with an audit event in the same transaction', async () => {
    const { service, tx, audit } = build(paymentFixture('DRAFT'));
    await service.submit(maker, 'pay-1');
    expect(tx.payment.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'SUBMITTED' });
    expect(audit.record.mock.calls[0][1]).toBe(tx);
  });

  it('the recorder cannot approve, reject or post their own receipt', async () => {
    await expect(
      build(paymentFixture('SUBMITTED')).service.approve(maker, 'pay-1'),
    ).rejects.toMatchObject(code('MAKER_CHECKER_VIOLATION'));
    await expect(
      build(paymentFixture('SUBMITTED')).service.reject(maker, 'pay-1', 'because'),
    ).rejects.toMatchObject(code('MAKER_CHECKER_VIOLATION'));
    await expect(
      build(paymentFixture('APPROVED')).service.post(maker, 'pay-1'),
    ).rejects.toMatchObject(code('MAKER_CHECKER_VIOLATION'));
  });

  it('a different user can approve and then post', async () => {
    const a = build(paymentFixture('SUBMITTED'));
    await a.service.approve(checker, 'pay-1');
    expect(a.tx.payment.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED' });
    const b = build(paymentFixture('APPROVED'));
    await b.service.post(checker, 'pay-1');
    expect(b.tx.payment.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'POSTED' });
  });

  it('refuses transitions that skip a step', async () => {
    await expect(
      build(paymentFixture('DRAFT')).service.approve(checker, 'pay-1'),
    ).rejects.toMatchObject(code('INVALID_PAYMENT_STATUS'));
    await expect(
      build(paymentFixture('SUBMITTED')).service.post(checker, 'pay-1'),
    ).rejects.toMatchObject(code('INVALID_PAYMENT_STATUS'));
    await expect(
      build(paymentFixture('POSTED')).service.submit(maker, 'pay-1'),
    ).rejects.toMatchObject(code('INVALID_PAYMENT_STATUS'));
  });

  it('will not post a receipt for a suspended hospital', async () => {
    const payment = paymentFixture('APPROVED', {
      hospital: { id: HOSPITAL, status: 'SUSPENDED', timezone: 'Africa/Lagos' },
    });
    await expect(build(payment).service.post(checker, 'pay-1')).rejects.toMatchObject(
      code('HOSPITAL_NOT_ACTIVE'),
    );
  });

  it('only the recorder can edit, and only while draft or rejected', async () => {
    await expect(
      build(paymentFixture('DRAFT')).service.update(checker, 'pay-1', { notes: 'x' }),
    ).rejects.toMatchObject(code('NOT_PAYMENT_OWNER'));
    await expect(
      build(paymentFixture('POSTED')).service.update(maker, 'pay-1', { notes: 'x' }),
    ).rejects.toMatchObject(code('INVALID_PAYMENT_STATUS'));
  });
});

describe('receipt entry validation', () => {
  const dto = (extra: Record<string, unknown> = {}) =>
    ({
      hospitalId: HOSPITAL,
      receiptDate: '2026-10-01',
      amount: '250000.00',
      method: 'bank_transfer',
      reference: 'BANK-1',
      ...extra,
    }) as never;

  function buildCreate(existing: { reference?: unknown; similar?: unknown } = {}) {
    const ctx = build(paymentFixture('DRAFT'));
    // 1st duplicate lookup = same reference, 2nd = same hospital/date/amount
    ctx.prisma.payment.findFirst = jest
      .fn()
      .mockResolvedValueOnce(existing.reference ?? null)
      .mockResolvedValueOnce(existing.similar ?? null);
    return ctx;
  }

  it('creates a draft with the whole amount unallocated', async () => {
    const { service, tx } = buildCreate();
    await service.create(maker, dto());
    const data = tx.payment.create.mock.calls[0][0].data;
    expect(data.status).toBe('DRAFT');
    expect(new Decimal(data.unallocatedAmount.toString()).eq(data.amount)).toBe(true);
    expect(data.method).toBe('BANK_TRANSFER');
  });

  it('rejects zero, negative and over-precise amounts', async () => {
    const { service } = buildCreate();
    await expect(service.create(maker, dto({ amount: '0.00' }))).rejects.toMatchObject(
      code('INVALID_MONEY'),
    );
    await expect(service.create(maker, dto({ amount: '10.005' }))).rejects.toBeDefined();
  });

  it('rejects a receipt dated in the future', async () => {
    const { service } = buildCreate();
    await expect(service.create(maker, dto({ receiptDate: '2999-01-01' }))).rejects.toMatchObject(
      code('RECEIPT_DATE_IN_FUTURE'),
    );
  });

  it('FR-AR-004: blocks a repeated reference', async () => {
    const { service, tx } = buildCreate({ reference: { id: 'old', status: 'POSTED' } });
    await expect(service.create(maker, dto())).rejects.toMatchObject(
      code('DUPLICATE_PAYMENT_REFERENCE'),
    );
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('FR-AR-004: asks for confirmation when hospital, date and amount match another receipt', async () => {
    const { service, tx } = buildCreate({
      similar: { id: 'old', status: 'POSTED', reference: 'X' },
    });
    await expect(service.create(maker, dto())).rejects.toMatchObject(
      code('POSSIBLE_DUPLICATE_PAYMENT'),
    );
    expect(tx.payment.create).not.toHaveBeenCalled();

    const confirmed = build(paymentFixture('DRAFT'));
    confirmed.prisma.payment.findFirst = jest.fn().mockResolvedValue(null);
    await expect(
      confirmed.service.create(maker, dto({ confirmPossibleDuplicate: true })),
    ).resolves.toBeDefined();
  });

  it('refuses a receipt for a draft hospital', async () => {
    const ctx = build(paymentFixture('DRAFT'), {
      id: HOSPITAL,
      status: 'DRAFT',
      timezone: 'Africa/Lagos',
    });
    await expect(ctx.service.create(maker, dto())).rejects.toMatchObject(
      code('HOSPITAL_NOT_ACTIVE'),
    );
  });
});

describe('allocation guards', () => {
  const body = {
    allocations: [{ receivableId: 'a1b2c3d4-0000-0000-0000-000000000001', amount: '10.00' }],
  };

  it('only a posted receipt can be previewed or allocated', async () => {
    await expect(
      build(paymentFixture('APPROVED')).service.allocationPreview(maker, 'pay-1'),
    ).rejects.toMatchObject(code('INVALID_PAYMENT_STATUS'));
  });

  it('rejects a malformed Idempotency-Key', async () => {
    await expect(
      build(paymentFixture('POSTED')).service.allocate(maker, 'pay-1', body as never, 'short'),
    ).rejects.toMatchObject(code('INVALID_IDEMPOTENCY_KEY'));
  });

  it('rejects a zero allocation amount', async () => {
    await expect(
      build(paymentFixture('POSTED')).service.allocate(maker, 'pay-1', {
        allocations: [{ receivableId: 'a1b2c3d4-0000-0000-0000-000000000001', amount: '0.00' }],
      } as never),
    ).rejects.toMatchObject(code('INVALID_MONEY'));
  });
});

describe('receivable settlement status', () => {
  it('is PAID only at a zero balance, never because cash was recorded', () => {
    expect(receivableStatusFor('100', '0', 'OPEN')).toBe('OPEN');
    expect(receivableStatusFor('100', '40', 'OPEN')).toBe('PARTIALLY_PAID');
    expect(receivableStatusFor('100', '100', 'PARTIALLY_PAID')).toBe('PAID');
  });

  it('keeps a dispute flag until the item is fully settled', () => {
    expect(receivableStatusFor('100', '40', 'DISPUTED')).toBe('DISPUTED');
    expect(receivableStatusFor('100', '100', 'DISPUTED')).toBe('PAID');
  });

  it('returns to the right status after a reversal', () => {
    expect(receivableStatusFor('100', '0', 'PAID')).toBe('OPEN');
    expect(receivableStatusFor('100', '60', 'PAID')).toBe('PARTIALLY_PAID');
  });
});

describe('what a receipt response reveals', () => {
  it('never returns the internal evidence storage key', async () => {
    const { service, prisma } = build(paymentFixture('DRAFT'));
    await service.get(maker, 'pay-1');
    expect(prisma.payment.findFirst.mock.calls[0][0].omit).toMatchObject({ evidenceKey: true });
  });
});
