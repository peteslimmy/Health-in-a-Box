import { Decimal } from 'decimal.js';
import { D, grant, makeUser } from '../testing/fixtures';
import { REPORT_DEFINITIONS } from './report-registry';
import { ReportsService, totalsRow } from './reports.service';

const reader = makeUser('reader', [
  grant('R', ['reports.read', 'receivables.read', 'payments.read'], 'ALL'),
]);
const exporter = makeUser('exporter', [
  grant('E', ['reports.read', 'reports.export', 'receivables.read', 'payments.read'], 'ALL'),
]);
const noPayments = makeUser('np', [grant('R', ['reports.read', 'receivables.read'], 'ALL')]);
const scoped = makeUser('scoped', [
  grant('R', ['reports.read', 'receivables.read', 'payments.read'], ['centre-a']),
]);

function build() {
  const prisma = {
    receivable: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    centre: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  return { service: new ReportsService(prisma as never, audit as never), prisma, audit };
}

describe('report catalogue', () => {
  it('gives every report a unique id, a stated purpose and columns it can total', () => {
    const ids = REPORT_DEFINITIONS.map((report) => report.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const report of REPORT_DEFINITIONS) {
      expect(report.title.length).toBeGreaterThan(0);
      expect(report.description.length).toBeGreaterThan(0);
      if (report.filters.includes('from')) expect(report.dateBasis).toBeTruthy();
      if (report.filters.includes('status')) expect(report.statuses?.length).toBeGreaterThan(0);
    }
  });
});

describe('listing and permissions', () => {
  it('lists only reports whose underlying data the caller may read', () => {
    const { service } = build();
    const all = service.list(reader).map((r) => r.id);
    const limited = service.list(noPayments).map((r) => r.id);
    expect(all).toContain('payment-register');
    expect(limited).not.toContain('payment-register');
    expect(limited).toContain('receivables-ageing');
  });

  it('marks exports as available only to holders of reports.export', () => {
    const { service } = build();
    expect(service.list(reader).every((r) => !r.canExport)).toBe(true);
    expect(service.list(exporter).some((r) => r.canExport)).toBe(true);
  });

  it('refuses to run a report when a required permission is missing', async () => {
    const { service, prisma } = build();
    await expect(service.run(noPayments, 'payment-register', {})).rejects.toMatchObject({
      response: { code: 'REPORT_NOT_PERMITTED' },
    });
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('answers an unknown report with not found', async () => {
    const { service } = build();
    await expect(service.run(reader, 'nope', {})).rejects.toMatchObject({
      response: { code: 'REPORT_NOT_FOUND' },
    });
  });

  it('refuses to export without reports.export, and writes nothing to the audit trail', async () => {
    const { service, audit } = build();
    await expect(service.export(reader, 'receivables-ageing', {}, 'csv')).rejects.toMatchObject({
      response: { code: 'REPORT_NOT_PERMITTED' },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('limits a scoped caller to their centres and hides other centres', async () => {
    const { service, prisma } = build();
    await service.run(scoped, 'payment-register', {});
    expect(prisma.payment.findMany.mock.calls[0][0].where.centreId).toEqual({ in: ['centre-a'] });
    await expect(
      service.run(scoped, 'payment-register', { centreId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('filters', () => {
  it('rejects a status the report does not define and an end date before the start', async () => {
    const { service } = build();
    await expect(
      service.run(reader, 'payment-register', { status: 'BOGUS' }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_STATUS' },
    });
    await expect(
      service.run(reader, 'payment-register', { from: '2026-10-10', to: '2026-10-01' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PERIOD' } });
  });

  it('ignores filters a report does not declare instead of silently applying them', async () => {
    const { service, prisma } = build();
    const result = await service.run(reader, 'receivables-ageing', {
      status: 'POSTED',
      from: '2026-01-01',
    });
    expect(result.filters).toEqual({});
    expect(prisma.receivable.groupBy).toHaveBeenCalled();
  });

  it('shows posted receipts by default and says so', async () => {
    const { service, prisma } = build();
    const result = await service.run(reader, 'payment-register', {});
    expect(prisma.payment.findMany.mock.calls[0][0].where.status).toBe('POSTED');
    expect(result.notes[0]).toContain('posted receipts only');
  });
});

describe('ageing report', () => {
  it('buckets balances by due date and separates not-yet-due from overdue', async () => {
    const { service, prisma } = build();
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    prisma.receivable.groupBy.mockResolvedValue([
      { centreId: 'c1', dueDate: D(future), _sum: { balance: new Decimal('100.00') } },
      { centreId: 'c1', dueDate: D(old), _sum: { balance: new Decimal('250.50') } },
    ]);
    prisma.centre.findMany.mockResolvedValue([{ id: 'c1', code: 'C1', name: 'One' }]);
    const result = await service.run(reader, 'receivables-ageing', {});
    expect(result.items[0]).toMatchObject({
      NOT_YET_DUE: '100.00',
      DAYS_31_60: '250.50',
      outstanding: '350.50',
      overdue: '250.50',
    });
    expect(result.totals).toMatchObject({ outstanding: '350.50', overdue: '250.50' });
    expect(today.length).toBe(10);
  });
});

describe('export', () => {
  it('records the export in the audit trail with the filters and row count before returning data', async () => {
    const { service, audit, prisma } = build();
    prisma.payment.findMany.mockResolvedValue([
      {
        receiptDate: D('2026-10-05'),
        centre: { code: 'C1', name: 'One' },
        reference: 'R1',
        payerName: 'Payer',
        method: 'TRANSFER',
        status: 'POSTED',
        amount: new Decimal('500.00'),
        unallocatedAmount: new Decimal('200.00'),
      },
    ]);
    const file = await service.export(exporter, 'payment-register', { from: '2026-10-01' }, 'csv');
    expect(file.fileName).toMatch(/^payment-register-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.content.toString('utf8')).toContain('500.00');
    expect(audit.record).toHaveBeenCalledTimes(1);
    const event = audit.record.mock.calls[0][0];
    expect(event).toMatchObject({
      action: 'REPORT_EXPORTED',
      actorId: 'exporter',
      after: {
        report: 'payment-register',
        format: 'csv',
        rows: 1,
        filters: { from: '2026-10-01' },
      },
    });
  });

  it('does not return a file if the audit record cannot be written', async () => {
    const { service, audit } = build();
    audit.record.mockRejectedValue(new Error('audit down'));
    await expect(service.export(exporter, 'receivables-ageing', {}, 'csv')).rejects.toThrow(
      'audit down',
    );
  });
});

describe('totalsRow', () => {
  const columns = [
    { key: 'name', label: 'Name', type: 'text' as const },
    { key: 'a', label: 'A', type: 'money' as const },
    { key: 'b', label: 'B', type: 'money' as const },
  ];

  it('adds money exactly, with no floating-point drift', () => {
    const rows = [
      { name: 'x', a: '0.10', b: '1.00' },
      { name: 'y', a: '0.20', b: null },
    ];
    expect(totalsRow({ totals: ['a', 'b'] }, columns, rows)).toEqual({
      name: 'Total',
      a: '0.30',
      b: '1.00',
    });
  });

  it('totals every money column when asked for "*" and returns nothing for no rows', () => {
    expect(
      totalsRow({ totals: ['*'] }, columns, [{ name: 'x', a: '1.00', b: '2.00' }]),
    ).toMatchObject({ a: '1.00', b: '2.00' });
    expect(totalsRow({ totals: ['*'] }, columns, [])).toBeNull();
    expect(totalsRow({}, columns, [{ name: 'x', a: '1.00', b: '2.00' }])).toBeNull();
  });
});

describe('more reports', () => {
  const all = makeUser('all', [
    grant('R', ['reports.read', 'receivables.read', 'payments.read', 'adjustments.read'], 'ALL'),
  ]);

  it('will not produce a statement without a centre', async () => {
    const { service } = build();
    await expect(service.run(all, 'centre-statement', {})).rejects.toMatchObject({
      response: { code: 'CENTRE_REQUIRED' },
    });
  });

  it('produces a statement whose running balance ends at debits less credits', async () => {
    const { service, prisma } = build();
    const ledger = {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { debit: new Decimal('100.00'), credit: new Decimal('0') } }),
      findMany: jest.fn().mockResolvedValue([
        {
          occurredAt: D('2026-10-05'),
          type: 'CHARGE',
          description: 'Charge',
          debit: new Decimal('50.00'),
          credit: new Decimal('0'),
          receivable: { reference: 'R1' },
        },
        {
          occurredAt: D('2026-10-06'),
          type: 'PAYMENT_ALLOCATION',
          description: 'Paid',
          debit: new Decimal('0'),
          credit: new Decimal('30.25'),
          receivable: { reference: 'R1' },
        },
      ]),
    };
    (prisma as unknown as Record<string, unknown>).ledgerEntry = ledger;
    const result = await service.run(all, 'centre-statement', {
      centreId: '11111111-1111-4111-8111-111111111111',
      from: '2026-10-01',
    });
    const balances = result.items.map((row) => row.balance);
    expect(balances).toEqual(['100.00', '150.00', '119.75', '119.75']);
    expect(result.items[0].type).toBe('opening balance');
    expect(result.items[result.items.length - 1].type).toBe('closing balance');
  });

  it('weights settlement delay by amount and counts on-time payments', async () => {
    const { service, prisma } = build();
    const centre = { id: 'c1', code: 'C1', name: 'One', paymentTermsDays: 30 };
    const settled = (amount: string, due: string, paid: string) => ({
      centre,
      dueDate: D(due),
      originalAmount: new Decimal(amount),
      adjustmentTotal: new Decimal('0'),
      allocations: [{ allocatedAt: D(paid) }],
    });
    prisma.receivable.findMany.mockResolvedValue([
      settled('100', '2026-10-10', '2026-10-10'),
      settled('300', '2026-10-10', '2026-10-20'),
    ]);
    const result = await service.run(all, 'payment-behaviour', {});
    expect(result.items[0]).toMatchObject({
      settled: 2,
      onTime: 1,
      onTimePct: '50.0',
      delay: 8,
      worst: 10,
    });
  });
});
