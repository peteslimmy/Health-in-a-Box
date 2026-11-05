import { Decimal } from 'decimal.js';
import { grant, makeUser } from '../testing/fixtures';
import { DashboardService } from './dashboard.service';

const agg = (sumKey: string, value: string | null, count?: number) => ({
  _sum: { [sumKey]: value === null ? null : new Decimal(value) },
  ...(count !== undefined ? { _count: count } : {}),
});

function build() {
  const calls: Record<string, unknown[]> = {};
  const track = (name: string, result: unknown) =>
    jest.fn((args: unknown) => {
      (calls[name] ??= []).push(args);
      return Promise.resolve(result);
    });
  const prisma = {
    revenueReport: {
      aggregate: track('revenueReport', agg('grandTotal', '1000.00', 2)),
      count: track('revenueReportCount', 1),
    },
    chargeRun: {
      aggregate: track('chargeRun', agg('chargeTotal', '50.50', 1)),
      count: track('chargeRunCount', 3),
    },
    ledgerEntry: { aggregate: track('ledgerEntry', agg('debit', '50.50')) },
    payment: {
      aggregate: track('payment', agg('amount', '200.00', 4)),
      count: track('paymentCount', 1),
    },
    paymentAllocation: { aggregate: track('allocation', agg('amount', null)) },
    receivable: { aggregate: track('receivable', agg('balance', '300.25', 5)) },
    importBatch: { count: track('importBatch', 0) },
    hospital: { count: track('hospital', 0) },
    $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  };
  return { service: new DashboardService(prisma as never), calls };
}

describe('dashboard summary', () => {
  const all = makeUser('a', [grant('R', ['dashboard.read'], 'ALL')]);
  const scoped = makeUser('b', [grant('R', ['dashboard.read'], ['hospital-a'])]);

  it('returns separately labelled measures as 2 dp strings, null sums as zero', async () => {
    const { service } = build();
    const result = await service.summary(all, { from: '2026-10-01', to: '2026-10-31' });
    expect(result.currency).toBe('NGN');
    expect(result.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(result.measures.reportedRevenue.amount).toBe('1000.00');
    expect(result.measures.expectedServiceCharge.amount).toBe('50.50');
    expect(result.measures.paymentsReceived.amount).toBe('200.00');
    expect(result.measures.paymentsAllocated.amount).toBe('0.00');
    expect(result.measures.outstandingReceivables.amount).toBe('300.25');
    // each measure states its own basis, so period flows and as-at balances are never mixed
    for (const measure of Object.values(result.measures)) {
      expect(measure.label.length).toBeGreaterThan(0);
      expect(measure.basis.length).toBeGreaterThan(0);
    }
    expect(result.awaitingAction.chargeRunsToApprove).toBe(3);
  });

  it('works out what is still owing as expected charge less payments received', async () => {
    const { service } = build();
    const result = await service.summary(all, { from: '2026-10-01', to: '2026-10-31' });
    // 50.50 due, 200.00 paid in this fixture: paid ahead, so the figure is negative.
    expect(result.measures.owedForPeriod.amount).toBe('-149.50');
    expect(result.measures.owedForPeriod.percentPaid).toBe('396.0');
  });

  it("limits every query to the caller's hospitals", async () => {
    const { service, calls } = build();
    await service.summary(scoped, {});
    for (const name of ['revenueReport', 'chargeRun', 'ledgerEntry', 'payment', 'receivable']) {
      const where = (calls[name][0] as { where: Record<string, unknown> }).where;
      expect(where.hospitalId).toEqual({ in: ['hospital-a'] });
      expect(where.organizationId).toBe('org-1');
    }
  });

  it("refuses a hospital outside the caller's scope", async () => {
    const { service } = build();
    await expect(service.summary(scoped, { hospitalId: 'hospital-b' })).rejects.toThrow();
  });

  it('counts only posted receipts as cash received (drafts and reversals excluded)', async () => {
    const { service, calls } = build();
    await service.summary(all, {});
    const where = (calls.payment[0] as { where: Record<string, unknown> }).where;
    expect(where.status).toBe('POSTED');
  });
});
