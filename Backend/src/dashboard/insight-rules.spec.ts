import { Decimal } from 'decimal.js';
import { Insight, InsightInput, deriveInsights } from './insight-rules';

const centre = { centreId: 'c1', code: 'C1', name: 'One' };
const d = (v: string) => new Decimal(v);
const empty = (): InsightInput => ({
  months: ['2026-08', '2026-09'],
  monthly: [],
  balances: [],
  revenueLast12Months: [],
  lateCentres: [],
  lateAfterDays: 7,
  unallocated: { count: 0, total: d('0'), olderThanDays: 7 },
  importTroubles: [],
  oldDisputes: { count: 0, total: d('0') },
});
const ids = (list: Insight[]) => list.map((i) => i.id);

describe('deriveInsights', () => {
  it('says nothing when nothing is unusual', () => {
    expect(deriveInsights(empty())).toEqual([]);
  });

  it('flags a revenue fall with both months and figures, and asks for completeness to be checked', () => {
    const input = empty();
    input.monthly = [
      { ...centre, month: '2026-08', revenue: d('1000000'), base: d('0'), charge: d('0') },
      { ...centre, month: '2026-09', revenue: d('700000'), base: d('0'), charge: d('0') },
    ];
    const [insight] = deriveInsights(input);
    expect(insight).toMatchObject({
      id: 'revenue-drop-c1-2026-09',
      severity: 'attention',
      area: 'Revenue',
    });
    expect(insight.title).toContain('fell 30.0%');
    expect(insight.detail).toContain('September 2026');
    expect(insight.detail).toContain('August 2026');
    expect(insight.detail).toContain('every report for the month has been uploaded');
    expect(insight.evidence.map((e) => e.value)).toEqual(['1000000.00', '700000.00']);
  });

  it('ignores a modest change and a centre with no prior month', () => {
    const input = empty();
    input.monthly = [
      { ...centre, month: '2026-08', revenue: d('1000'), base: d('0'), charge: d('0') },
      { ...centre, month: '2026-09', revenue: d('900'), base: d('0'), charge: d('0') },
      {
        centreId: 'c2',
        code: 'C2',
        name: 'Two',
        month: '2026-09',
        revenue: d('50'),
        base: d('0'),
        charge: d('0'),
      },
    ];
    expect(deriveInsights(input)).toEqual([]);
  });

  it('flags a move in effective yield of a point or more', () => {
    const input = empty();
    input.monthly = [
      { ...centre, month: '2026-08', revenue: d('0'), base: d('1000'), charge: d('50') },
      { ...centre, month: '2026-09', revenue: d('0'), base: d('1000'), charge: d('35') },
    ];
    const [insight] = deriveInsights(input);
    expect(insight.id).toBe('yield-c1-2026-09');
    expect(insight.title).toContain('5.00% to 3.50%');
  });

  it('raises overdue exposure at attention, then urgent, by share of what is owed', () => {
    const input = empty();
    input.balances = [
      { ...centre, outstanding: d('1000'), overdue: d('600') },
      { centreId: 'c2', code: 'C2', name: 'Two', outstanding: d('1000'), overdue: d('900') },
      { centreId: 'c3', code: 'C3', name: 'Three', outstanding: d('1000'), overdue: d('100') },
    ];
    const result = deriveInsights(input);
    expect(result.map((i) => [i.centreId, i.severity])).toEqual([
      ['c2', 'urgent'],
      ['c1', 'attention'],
    ]);
  });

  it('flags dependence on one centre only when there are several', () => {
    const input = empty();
    input.revenueLast12Months = [{ ...centre, revenue: d('600') }];
    expect(deriveInsights(input)).toEqual([]);
    input.revenueLast12Months = [
      { ...centre, revenue: d('600') },
      { centreId: 'c2', code: 'C2', name: 'Two', revenue: d('400') },
    ];
    expect(ids(deriveInsights(input))).toEqual(['concentration-c1']);
  });

  it('groups late centres into one insight, urgent when one has never reported', () => {
    const input = empty();
    input.lateCentres = [
      { ...centre, daysSince: 9 },
      { centreId: 'c2', code: 'C2', name: 'Two', daysSince: null },
    ];
    const [insight] = deriveInsights(input);
    expect(insight).toMatchObject({ id: 'late-reporting', severity: 'urgent' });
    expect(insight.title).toContain('2 centres have not reported');
    expect(insight.detail).toContain('never reported');
  });

  it('reports old unallocated cash, repeated import failures and stale disputes with their numbers', () => {
    const input = empty();
    input.unallocated = { count: 2, total: d('250000'), olderThanDays: 7 };
    input.importTroubles = [
      { ...centre, count: 3 },
      { centreId: 'c2', code: 'C2', name: 'Two', count: 2 },
    ];
    input.oldDisputes = { count: 1, total: d('40000') };
    const result = deriveInsights(input);
    expect(ids(result).sort()).toEqual(['import-trouble-c1', 'old-disputes', 'unallocated-cash']);
    expect(result.find((i) => i.id === 'unallocated-cash')?.evidence).toEqual([
      { label: 'Receipts', value: '2' },
      { label: 'Unallocated', value: '250000.00' },
    ]);
  });

  it('orders urgent items before the rest', () => {
    const input = empty();
    input.lateCentres = [{ ...centre, daysSince: 20 }];
    input.unallocated = { count: 1, total: d('1'), olderThanDays: 7 };
    expect(deriveInsights(input)[0].id).toBe('late-reporting');
  });
});
