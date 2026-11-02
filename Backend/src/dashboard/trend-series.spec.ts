import { Decimal } from 'decimal.js';
import { buildTrendSeries, lastMonths } from './trend-series';

const totals = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([month, value]) => [month, new Decimal(value)]));

describe('lastMonths', () => {
  it('lists calendar months oldest first, ending with the current month', () => {
    expect(lastMonths('2026-10-27', 3)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('crosses year boundaries', () => {
    expect(lastMonths('2026-02-01', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('buildTrendSeries', () => {
  const months = ['2026-08', '2026-09', '2026-10'];

  it('fills empty months with zero and keeps money as 2 dp strings', () => {
    const series = buildTrendSeries({
      months,
      openingBalance: new Decimal(0),
      reported: totals({ '2026-09': '1000' }),
      charges: totals({}),
      received: totals({}),
      ledgerNet: totals({}),
    });
    expect(series[0]).toMatchObject({
      reportedRevenue: '0.00',
      chargesPosted: '0.00',
      outstanding: '0.00',
      collectionRate: null,
    });
    expect(series[1].reportedRevenue).toBe('1000.00');
  });

  it('carries the balance forward as opening balance plus running net movement', () => {
    const series = buildTrendSeries({
      months,
      openingBalance: new Decimal('100.10'),
      reported: totals({}),
      charges: totals({ '2026-08': '50.00', '2026-10': '20.00' }),
      received: totals({ '2026-09': '30.00' }),
      ledgerNet: totals({ '2026-08': '50.00', '2026-09': '-30.00', '2026-10': '20.00' }),
    });
    expect(series.map((p) => p.outstanding)).toEqual(['150.10', '120.10', '140.10']);
  });

  it('reports collection as a one-decimal percentage of charges, never dividing by zero', () => {
    const series = buildTrendSeries({
      months: ['2026-09', '2026-10'],
      openingBalance: new Decimal(0),
      reported: totals({}),
      charges: totals({ '2026-10': '300.00' }),
      received: totals({ '2026-09': '10.00', '2026-10': '100.00' }),
      ledgerNet: totals({}),
    });
    expect(series[0].collectionRate).toBeNull();
    expect(series[1].collectionRate).toBe('33.3');
  });
});
