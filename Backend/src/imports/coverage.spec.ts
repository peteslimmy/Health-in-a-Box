import { assessCoverage, CoveredPeriod } from './coverage';

const committed = (start: string, end: string, label = 'oct.pdf'): CoveredPeriod => ({
  start,
  end,
  state: 'COMMITTED',
  label,
});
const codes = (items: Array<{ code: string }>) => items.map((item) => item.code);
const today = '2026-10-27';

describe('assessCoverage', () => {
  it('accepts the first report for a centre without any flag', () => {
    const result = assessCoverage({ start: '2026-09-25', end: '2026-10-25', today, existing: [] });
    expect(result).toEqual({ errors: [], warnings: [], flags: [] });
  });

  it('accepts a report that starts the day after the previous one ends', () => {
    const result = assessCoverage({
      start: '2026-10-12',
      end: '2026-10-13',
      today,
      existing: [committed('2026-10-01', '2026-10-11')],
    });
    expect(result.flags).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('flags omitted days: previous report ends on the 11th, new one starts on the 13th', () => {
    const result = assessCoverage({
      start: '2026-10-13',
      end: '2026-10-20',
      today,
      existing: [committed('2026-10-01', '2026-10-11')],
    });
    expect(codes(result.flags)).toEqual(['PERIOD_GAP']);
    expect(result.flags[0]).toMatchObject({
      missingFrom: '2026-10-12',
      missingTo: '2026-10-12',
      days: 1,
      requiresAcknowledgement: true,
    });
    expect(result.flags[0].message).toContain('12 Oct 2026');
    expect(result.errors).toEqual([]);
  });

  it('flags days skipped after the new report when a later report already exists', () => {
    const result = assessCoverage({
      start: '2026-10-01',
      end: '2026-10-05',
      today,
      existing: [committed('2026-10-09', '2026-10-20')],
    });
    expect(result.flags[0]).toMatchObject({
      missingFrom: '2026-10-06',
      missingTo: '2026-10-08',
      days: 3,
    });
  });

  it('blocks days that are already in the system and names the overlapping days', () => {
    const result = assessCoverage({
      start: '2026-10-10',
      end: '2026-10-15',
      today,
      existing: [committed('2026-10-01', '2026-10-11')],
    });
    expect(codes(result.errors)).toEqual(['PERIOD_ALREADY_UPLOADED']);
    expect(result.errors[0]).toMatchObject({
      missingFrom: '2026-10-10',
      missingTo: '2026-10-11',
      days: 2,
    });
  });

  it('blocks an identical period and a single repeated day', () => {
    expect(
      codes(
        assessCoverage({
          start: '2026-10-01',
          end: '2026-10-11',
          today,
          existing: [committed('2026-10-01', '2026-10-11')],
        }).errors,
      ),
    ).toEqual(['PERIOD_ALREADY_UPLOADED']);
    const oneDay = assessCoverage({
      start: '2026-10-11',
      end: '2026-10-12',
      today,
      existing: [committed('2026-10-01', '2026-10-11')],
    });
    expect(oneDay.errors[0].days).toBe(1);
  });

  it('warns, but does not block, when the days are only in an upload awaiting commit', () => {
    const result = assessCoverage({
      start: '2026-10-05',
      end: '2026-10-08',
      today,
      existing: [{ start: '2026-10-01', end: '2026-10-31', state: 'PENDING', label: 'draft.csv' }],
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual(['PERIOD_PENDING_UPLOAD']);
  });

  it('blocks periods that end in the future and questions very long periods', () => {
    expect(
      codes(assessCoverage({ start: '2026-10-20', end: '2026-10-28', today, existing: [] }).errors),
    ).toEqual(['PERIOD_IN_FUTURE']);
    expect(
      codes(
        assessCoverage({ start: '2026-01-01', end: '2026-10-01', today, existing: [] }).warnings,
      ),
    ).toEqual(['PERIOD_VERY_LONG']);
  });

  it('raises no gap flag for days that overlapping reports already cover', () => {
    const result = assessCoverage({
      start: '2026-09-25',
      end: '2026-10-25',
      today,
      existing: [
        committed('2026-08-01', '2026-08-31'),
        committed('2026-09-01', '2026-09-30'),
        committed('2026-10-01', '2026-10-26'),
      ],
    });
    expect(result.flags).toEqual([]);
    expect(codes(result.errors)).toEqual(['PERIOD_ALREADY_UPLOADED', 'PERIOD_ALREADY_UPLOADED']);
  });

  it('measures gaps from the nearest earlier report, not the first one', () => {
    const result = assessCoverage({
      start: '2026-10-20',
      end: '2026-10-25',
      today,
      existing: [committed('2026-09-01', '2026-09-30'), committed('2026-10-01', '2026-10-18')],
    });
    expect(result.flags[0]).toMatchObject({ missingFrom: '2026-10-19', missingTo: '2026-10-19' });
  });
});
