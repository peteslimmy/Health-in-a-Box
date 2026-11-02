import { D } from '../../testing/fixtures';
import { ageingBucket, daysOverdue } from './ageing';

describe('ageing buckets (D-014)', () => {
  const due = D('2026-09-30');

  it('is not overdue on the due date itself, only after it', () => {
    expect(ageingBucket(due, D('2026-09-29'), '100')).toBe('NOT_YET_DUE');
    expect(ageingBucket(due, D('2026-09-30'), '100')).toBe('NOT_YET_DUE');
    expect(ageingBucket(due, D('2026-10-01'), '100')).toBe('DAYS_1_30');
  });

  it('uses the confirmed bucket edges', () => {
    const at = (days: number) =>
      ageingBucket(due, new Date(due.getTime() + days * 86_400_000), '1');
    expect(at(30)).toBe('DAYS_1_30');
    expect(at(31)).toBe('DAYS_31_60');
    expect(at(60)).toBe('DAYS_31_60');
    expect(at(61)).toBe('DAYS_61_90');
    expect(at(90)).toBe('DAYS_61_90');
    expect(at(91)).toBe('DAYS_91_120');
    expect(at(120)).toBe('DAYS_91_120');
    expect(at(121)).toBe('OVER_120');
  });

  it('classifies a fully paid item as settled however old it is', () => {
    expect(ageingBucket(due, D('2030-01-01'), '0')).toBe('SETTLED');
    expect(ageingBucket(due, D('2030-01-01'), '0.00')).toBe('SETTLED');
  });

  it('counts overdue days across month and year boundaries', () => {
    expect(daysOverdue(D('2026-12-31'), D('2027-01-02'))).toBe(2);
    expect(daysOverdue(D('2026-10-10'), D('2026-10-01'))).toBe(0);
  });
});
