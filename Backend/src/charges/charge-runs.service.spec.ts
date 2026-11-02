import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { allCentresUser, D } from '../testing/fixtures';
import { ChargeRunsService } from './charge-runs.service';

const CENTRE = 'centre-1';

const channels = [
  { id: 'ch-cash', code: 'CASH', name: 'Cash', aliases: [] },
  { id: 'ch-pos', code: 'POS', name: 'POS', aliases: [] },
];

const dept = { id: 'dep-pharm', code: 'PHARM', name: 'Pharmacy' };

function line(reported: string, cash: string, pos: string, id = 'line-1') {
  return {
    id,
    reportId: 'rep',
    departmentId: dept.id,
    department: dept,
    reportedTotal: new Decimal(reported),
    channelTotal: new Decimal(new Decimal(cash).plus(pos)),
    variance: new Decimal(0),
    amountsJson: { CASH: cash, POS: pos },
  };
}

function report(
  id: string,
  start: string,
  end: string,
  lines = [line('1000.00', '600.00', '400.00')],
) {
  return {
    id,
    organizationId: 'org-1',
    centreId: CENTRE,
    periodStart: D(start),
    periodEnd: D(end),
    reportDate: D(end),
    status: 'COMMITTED',
    grandTotal: new Decimal('1000.00'),
    channelTotal: new Decimal('1000.00'),
    sourceFileName: 'test.csv',
    lines,
  };
}

function rule(
  id: string,
  rate: string,
  from: string,
  to: string | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    centreId: CENTRE,
    name: `rule-${id}`,
    basis: 'PERCENTAGE',
    rate: new Decimal(rate),
    departmentId: null as string | null,
    paymentChannelId: null as string | null,
    effectiveFrom: D(from),
    effectiveTo: to ? D(to) : null,
    priority: 0,
    rounding: 'HALF_UP',
    isActive: true,
    ...extra,
  };
}

function build(options: { reports: unknown[]; rules: unknown[] }) {
  const tx = {
    chargeLine: { findFirst: jest.fn().mockResolvedValue(null) },
    chargeRun: {
      create: jest.fn(async ({ data }) => ({
        id: 'run-new',
        centreId: CENTRE,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        status: 'DRAFT',
        baseTotal: new Decimal(data.baseTotal),
        chargeTotal: new Decimal(data.chargeTotal),
        lines: [],
      })),
    },
  };
  const prisma = {
    revenueReport: { findMany: jest.fn().mockResolvedValue(options.reports) },
    paymentChannel: { findMany: jest.fn().mockResolvedValue(channels) },
    chargeRule: { findMany: jest.fn().mockResolvedValue(options.rules) },
    chargeLine: { findFirst: jest.fn().mockResolvedValue(null) },
    centre: {
      findUnique: jest.fn().mockResolvedValue({
        id: CENTRE,
        code: 'HNB-1',
        name: 'Test Centre',
        status: 'ACTIVE',
        currency: 'NGN',
        paymentTermsDays: 30,
        gracePeriodDays: 0,
      }),
    },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const service = new ChargeRunsService(prisma as never, audit as never);
  return { service, prisma, audit, tx };
}

const maker = allCentresUser('maker');
const reportIds = (...ids: string[]) => ({ centreId: CENTRE, reportIds: ids });

describe('charge calculation', () => {
  it('charges a department default rule on the reported total, half-up to 2 dp', async () => {
    const { service } = build({
      reports: [report('rep-1', '2026-09-01', '2026-09-30', [line('10.10', '5.10', '5.00')])],
      rules: [rule('r1', '5', '2026-01-01', null)],
    });
    const preview = await service.preview(maker, reportIds('rep-1'));
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].baseAmount).toBe('10.10');
    expect(preview.lines[0].chargeAmount).toBe('0.51'); // 0.505 -> 0.51 half-up
    expect(preview.chargeTotal).toBe('0.51');
  });

  it('INV-003: the same inputs always give the same amounts and trace', async () => {
    const make = () =>
      build({
        reports: [report('rep-1', '2026-09-01', '2026-09-30')],
        rules: [rule('r1', '4.5', '2026-01-01', null)],
      }).service.preview(maker, reportIds('rep-1'));
    const [a, b] = await Promise.all([make(), make()]);
    expect(a.lines).toEqual(b.lines);
    expect(a.baseTotal).toBe(b.baseTotal);
    expect(a.chargeTotal).toBe(b.chargeTotal);
    expect(a.chargeTotal).toBe('45.00');
  });

  it('applies channel-specific rules when they exist, per channel amount', async () => {
    const { service } = build({
      reports: [report('rep-1', '2026-09-01', '2026-09-30')],
      rules: [
        rule('default', '5', '2026-01-01', null),
        rule('pos', '2', '2026-01-01', null, { paymentChannelId: 'ch-pos' }),
      ],
    });
    const preview = await service.preview(maker, reportIds('rep-1'));
    const byChannel = Object.fromEntries(
      preview.lines.map((l) => [l.paymentChannel?.code, l.chargeAmount]),
    );
    expect(byChannel).toEqual({ CASH: '30.00', POS: '8.00' }); // 5% of 600, 2% of 400
    expect(preview.chargeTotal).toBe('38.00');
  });

  it('INV-004: a missing rule blocks the calculation and is never treated as zero', async () => {
    const { service } = build({
      reports: [report('rep-1', '2026-09-01', '2026-09-30')],
      rules: [],
    });
    await expect(service.preview(maker, reportIds('rep-1'))).rejects.toMatchObject({
      response: { code: 'RULE_MISSING' },
    });
  });

  it('INV-005: each report is charged with the rule effective for its own period', async () => {
    const { service } = build({
      reports: [
        report('jan', '2026-01-01', '2026-01-31'),
        report('feb', '2026-02-01', '2026-02-28', [line('1000.00', '600.00', '400.00', 'line-2')]),
      ],
      rules: [rule('old', '5', '2026-01-01', '2026-01-31'), rule('new', '6', '2026-02-01', null)],
    });
    const preview = await service.preview(maker, reportIds('jan', 'feb'));
    const byReport = Object.fromEntries(preview.lines.map((l) => [l.reportId, l.chargeAmount]));
    // January is charged at the 5% rule, February at the 6% rule; history is never repriced.
    expect(byReport).toEqual({ jan: '50.00', feb: '60.00' });
  });

  it('INV-005: a rate change inside one report is rejected, not charged at either rate', async () => {
    const { service } = build({
      reports: [report('mid', '2026-01-15', '2026-02-15')],
      rules: [rule('old', '5', '2026-01-01', '2026-01-31'), rule('new', '6', '2026-02-01', null)],
    });
    const failure = service.preview(maker, reportIds('mid'));
    await expect(failure).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(failure).rejects.toMatchObject({
      response: {
        details: [expect.objectContaining({ message: expect.stringContaining('split') })],
      },
    });
  });

  it('cannot pick a rate by choosing an "as-of" date', async () => {
    const { service } = build({
      reports: [report('rep-1', '2026-01-01', '2026-01-31')],
      rules: [
        rule('old', '5', '2026-01-01', '2026-01-31'),
        rule('future', '9', '2027-01-01', null),
      ],
    });
    const preview = await service.preview(maker, {
      ...reportIds('rep-1'),
      calculationAsOfDate: '2027-06-01',
    });
    expect(preview.calculationAsOfDate).toBe('2026-01-31');
    expect(preview.chargeTotal).toBe('50.00'); // 5% rule, not the 9% future rule
  });

  it('ignores a legacy non-HALF_UP rounding mode stored on a rule (D-004)', async () => {
    const { service } = build({
      reports: [report('rep-1', '2026-09-01', '2026-09-30', [line('10.10', '5.10', '5.00')])],
      rules: [rule('r1', '5', '2026-01-01', null, { rounding: 'DOWN' })],
    });
    const preview = await service.preview(maker, reportIds('rep-1'));
    expect(preview.lines[0].chargeAmount).toBe('0.51'); // DOWN would give 0.50
    expect(preview.lines[0].rounding).toBe('HALF_UP');
  });

  it('INV-001: refuses to charge a revenue line whose totals disagree', async () => {
    const bad = { ...line('1000.00', '600.00', '300.00'), reportedTotal: new Decimal('1000.00') };
    const { service } = build({
      reports: [report('rep-1', '2026-09-01', '2026-09-30', [bad])],
      rules: [rule('r1', '5', '2026-01-01', null)],
    });
    await expect(service.preview(maker, reportIds('rep-1'))).rejects.toMatchObject({
      response: { code: 'REVENUE_LINE_VARIANCE' },
    });
  });

  describe('a report committed with approved variance', () => {
    const approved = (lines: ReturnType<typeof line>[]) => ({
      ...report('rep-1', '2026-09-01', '2026-09-30', lines),
      varianceApprovedAt: new Date('2026-10-28T10:00:00Z'),
      varianceApprovedById: 'approver',
    });
    // printed 1000.00, but the channels beneath it add up to 900.00
    const off = () => ({
      ...line('1000.00', '600.00', '300.00'),
      reportedTotal: new Decimal('1000.00'),
      variance: new Decimal('100.00'),
    });

    it('is charged on its channel amounts, not on the printed total', async () => {
      const { service } = build({
        reports: [approved([off()])],
        rules: [rule('r1', '5', '2026-01-01', null)],
      });
      const preview = await service.preview(maker, reportIds('rep-1'));
      expect(preview.lines[0].baseAmount).toBe('900.00');
      expect(preview.chargeTotal).toBe('45.00'); // 5% of 900, not of 1,000
    });

    it('charges each channel on its own amount when channel rules exist', async () => {
      const { service } = build({
        reports: [approved([off()])],
        rules: [
          rule('cash', '5', '2026-01-01', null, { paymentChannelId: 'ch-cash' }),
          rule('pos', '10', '2026-01-01', null, { paymentChannelId: 'ch-pos' }),
        ],
      });
      const preview = await service.preview(maker, reportIds('rep-1'));
      expect(preview.chargeTotal).toBe('60.00'); // 5% of 600 + 10% of 300
      expect(preview.warnings).toEqual([]);
    });

    it('an unapproved report with the same difference is still refused', async () => {
      const { service } = build({
        reports: [report('rep-1', '2026-09-01', '2026-09-30', [off()])],
        rules: [rule('r1', '5', '2026-01-01', null)],
      });
      await expect(service.preview(maker, reportIds('rep-1'))).rejects.toMatchObject({
        response: { code: 'REVENUE_LINE_VARIANCE' },
      });
    });
  });

  it.each(['DRAFT', 'SUSPENDED', 'ARCHIVED'])(
    'FR-CEN-009: will not create a charge run for a %s centre',
    async (status) => {
      const { service, prisma, tx } = build({
        reports: [report('rep-1', '2026-09-01', '2026-09-30')],
        rules: [rule('r1', '5', '2026-01-01', null)],
      });
      prisma.centre.findUnique.mockResolvedValue({ status });
      await expect(service.create(maker, reportIds('rep-1'))).rejects.toMatchObject({
        response: { code: 'CENTRE_NOT_ACTIVE' },
      });
      expect(tx.chargeRun.create).not.toHaveBeenCalled();
    },
  );

  it('writes the audit event inside the same transaction as the charge run', async () => {
    const { service, audit, tx } = build({
      reports: [report('rep-1', '2026-09-01', '2026-09-30')],
      rules: [rule('r1', '5', '2026-01-01', null)],
    });
    await service.create(maker, reportIds('rep-1'));
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1]).toBe(tx);
  });
});

describe('charge run approval and posting', () => {
  const checker = allCentresUser('checker');

  function runFixture(
    status: string,
    createdById = 'maker',
    centreOverrides: Record<string, unknown> = {},
  ) {
    return {
      id: 'run-1',
      centreId: CENTRE,
      createdById,
      status,
      periodStart: D('2026-09-01'),
      periodEnd: D('2026-09-30'),
      centre: {
        id: CENTRE,
        code: 'HNB-1',
        paymentTermsDays: 30,
        status: 'ACTIVE',
        timezone: 'Africa/Lagos',
        ...centreOverrides,
      },
      lines: [
        {
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          chargeAmount: new Decimal('50.00'),
          department: { code: 'PHARM' },
          paymentChannel: null,
        },
        {
          id: 'bbbbbbbb-0000-0000-0000-000000000002',
          chargeAmount: new Decimal('0.00'),
          department: { code: 'RAD' },
          paymentChannel: null,
        },
        {
          id: 'cccccccc-0000-0000-0000-000000000003',
          chargeAmount: new Decimal('12.34'),
          department: { code: 'LAB' },
          paymentChannel: { code: 'POS' },
        },
      ],
    };
  }

  function buildRun(
    status: string,
    createdById = 'maker',
    centreOverrides: Record<string, unknown> = {},
  ) {
    const tx = {
      chargeRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      receivable: { create: jest.fn().mockResolvedValue({ id: 'rcv-1' }) },
      ledgerEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      chargeRun: {
        findFirst: jest.fn().mockResolvedValue(runFixture(status, createdById, centreOverrides)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new ChargeRunsService(prisma as never, audit as never);
    return { service, prisma, audit, tx };
  }

  it('maker-checker: the creator cannot approve their own charge run', async () => {
    const { service } = buildRun('SUBMITTED', 'maker');
    await expect(service.approve(maker, 'run-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approve(maker, 'run-1')).rejects.toMatchObject({
      response: { code: 'MAKER_CHECKER_VIOLATION' },
    });
  });

  it('maker-checker: the creator cannot post their own charge run', async () => {
    const { service, tx } = buildRun('APPROVED', 'maker');
    await expect(service.post(maker, 'run-1')).rejects.toMatchObject({
      response: { code: 'MAKER_CHECKER_VIOLATION' },
    });
    expect(tx.receivable.create).not.toHaveBeenCalled();
  });

  it('P-016: posts one receivable and one ledger debit for the whole run, ignoring zero lines', async () => {
    const { service, tx, audit } = buildRun('APPROVED', 'maker');
    await service.post(checker, 'run-1');

    expect(tx.receivable.create).toHaveBeenCalledTimes(1);
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1);

    // INV-008: the ledger debit equals the sum of the run's charge lines (50.00 + 0.00 + 12.34).
    const debited = tx.ledgerEntry.create.mock.calls
      .map(([arg]) => new Decimal(arg.data.debit.toString()))
      .reduce((a, b) => a.plus(b), new Decimal(0));
    expect(debited.toFixed(2)).toBe('62.34');
    for (const [arg] of tx.ledgerEntry.create.mock.calls) {
      expect(arg.data.type).toBe('CHARGE');
      expect(new Decimal(arg.data.credit.toString()).isZero()).toBe(true);
    }

    // D-006: due date is the posting date plus the centre's payment-terms days.
    const due: Date = tx.receivable.create.mock.calls[0][0].data.dueDate;
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() + 30);
    expect(Math.abs(due.getTime() - expected.getTime())).toBeLessThan(2 * 86_400_000);

    // The audit event is committed in the same transaction.
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1]).toBe(tx);
  });

  it('INV-009: posting an already-posted run returns it without posting again', async () => {
    const { service, prisma, tx } = buildRun('POSTED', 'maker');
    const result = await service.post(checker, 'run-1');
    expect(result.status).toBe('POSTED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.receivable.create).not.toHaveBeenCalled();
  });

  it('FR-CEN-009: will not post charges for a suspended centre', async () => {
    const { service, tx } = buildRun('APPROVED', 'maker', { status: 'SUSPENDED' });
    await expect(service.post(checker, 'run-1')).rejects.toMatchObject({
      response: { code: 'CENTRE_NOT_ACTIVE' },
    });
    expect(tx.receivable.create).not.toHaveBeenCalled();
  });

  describe('D-016: due dates follow the centre business day, not UTC', () => {
    afterEach(() => jest.useRealTimers());

    // 23:30 UTC on 27 Oct is already 00:30 on 28 Oct in Lagos (UTC+1).
    const lateEvening = new Date('2026-10-27T23:30:00.000Z');

    it('counts payment terms from the Lagos date when UTC is still the previous day', async () => {
      jest.useFakeTimers({ now: lateEvening });
      const { service, tx } = buildRun('APPROVED', 'maker');
      await service.post(checker, 'run-1');
      const due: Date = tx.receivable.create.mock.calls[0][0].data.dueDate;
      expect(due.toISOString().slice(0, 10)).toBe('2026-11-27'); // 28 Oct + 30 days
      expect(tx.receivable.create.mock.calls[0][0].data.reference).toContain('-2026-10-');
    });

    it('uses the centre time zone, so a UTC centre keeps the UTC date', async () => {
      jest.useFakeTimers({ now: lateEvening });
      const { service, tx } = buildRun('APPROVED', 'maker', { timezone: 'UTC' });
      await service.post(checker, 'run-1');
      const due: Date = tx.receivable.create.mock.calls[0][0].data.dueDate;
      expect(due.toISOString().slice(0, 10)).toBe('2026-11-26'); // 27 Oct + 30 days
    });
  });

  it('refuses to post a run that is not approved', async () => {
    const { service } = buildRun('SUBMITTED', 'maker');
    await expect(service.post(checker, 'run-1')).rejects.toMatchObject({
      response: { code: 'INVALID_CHARGE_RUN_STATUS' },
    });
  });
});
