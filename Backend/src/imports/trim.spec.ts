import { planTrim } from './coverage';
import type { ParsedLine } from './revenue-parser.service';
import { subtractRecorded } from './trim';

const committed = (id: string, start: string, end: string) => ({
  id,
  start,
  end,
  state: 'COMMITTED' as const,
  label: `${id}.pdf`,
});

describe('planTrim', () => {
  it('needs no trimming when nothing overlaps', () => {
    expect(
      planTrim({
        start: '2026-10-01',
        end: '2026-10-31',
        existing: [committed('a', '2026-09-01', '2026-09-30')],
      }),
    ).toEqual({});
  });

  it('takes only the days after an earlier report that sits inside the file period', () => {
    const { plan } = planTrim({
      start: '2026-09-25',
      end: '2026-10-25',
      existing: [committed('a', '2026-09-25', '2026-10-11')],
    });
    expect(plan).toMatchObject({ start: '2026-10-12', end: '2026-10-25' });
    expect(plan?.covered).toHaveLength(1);
  });

  it('takes only the days before a later report that sits inside the file period', () => {
    const { plan } = planTrim({
      start: '2026-10-01',
      end: '2026-10-20',
      existing: [committed('a', '2026-10-11', '2026-10-20')],
    });
    expect(plan).toMatchObject({ start: '2026-10-01', end: '2026-10-10' });
  });

  it('joins several earlier reports that together cover the front of the period', () => {
    const { plan } = planTrim({
      start: '2026-10-01',
      end: '2026-10-31',
      existing: [
        committed('a', '2026-10-01', '2026-10-10'),
        committed('b', '2026-10-11', '2026-10-20'),
      ],
    });
    expect(plan).toMatchObject({ start: '2026-10-21', end: '2026-10-31' });
    expect(plan?.covered).toHaveLength(2);
  });

  it('refuses to split when an existing report reaches outside the file period', () => {
    const result = planTrim({
      start: '2026-09-25',
      end: '2026-10-25',
      existing: [committed('sep', '2026-09-01', '2026-09-30')],
    });
    expect(result.plan).toBeUndefined();
    expect(result.blocked).toContain('not for each day');
  });

  it('refuses when the new days fall in two separate stretches', () => {
    const result = planTrim({
      start: '2026-10-01',
      end: '2026-10-31',
      existing: [committed('a', '2026-10-10', '2026-10-15')],
    });
    expect(result.plan).toBeUndefined();
    expect(result.blocked).toContain('several stretches');
  });

  it('has nothing to take when every day is already reported', () => {
    expect(
      planTrim({
        start: '2026-10-01',
        end: '2026-10-10',
        existing: [committed('a', '2026-10-01', '2026-10-10')],
      }),
    ).toEqual({});
  });

  it('ignores uploads that are not committed yet', () => {
    expect(
      planTrim({
        start: '2026-10-01',
        end: '2026-10-10',
        existing: [{ start: '2026-10-01', end: '2026-10-05', state: 'PENDING', label: 'draft' }],
      }),
    ).toEqual({});
  });
});

const line = (dept: string, cash: string, pos: string, row = 1): ParsedLine => ({
  rowNumber: row,
  rawDepartment: dept,
  departmentId: dept,
  departmentCode: dept,
  reportedTotal: (Number(cash) + Number(pos)).toFixed(2),
  channelTotal: (Number(cash) + Number(pos)).toFixed(2),
  variance: '0.00',
  amounts: { CASH: cash, POS: pos },
});
const recorded = (dept: string, cash: string, pos: string) => ({
  departmentId: dept,
  reportedTotal: (Number(cash) + Number(pos)).toFixed(2),
  channelTotal: (Number(cash) + Number(pos)).toFixed(2),
  amounts: { CASH: cash, POS: pos },
});

describe('subtractRecorded', () => {
  it('leaves the new days: the file figures minus what is recorded, per department and channel', () => {
    const result = subtractRecorded(
      [line('PHARM', '1000.00', '500.00', 1), line('RAD', '300.00', '0.00', 2)],
      [recorded('PHARM', '600.00', '200.00')],
    );
    expect(result.errors).toEqual([]);
    expect(result.lines[0]).toMatchObject({
      reportedTotal: '700.00',
      channelTotal: '700.00',
      variance: '0.00',
      amounts: { CASH: '400.00', POS: '300.00' },
    });
    expect(result.lines[1].amounts).toEqual({ CASH: '300.00', POS: '0.00' });
    expect(result.grandTotal).toBe('1000.00');
    expect(result.recordedTotal).toBe('800.00');
  });

  it('adds up several recorded reports', () => {
    const result = subtractRecorded(
      [line('PHARM', '1000.00', '0.00')],
      [recorded('PHARM', '100.00', '0.00'), recorded('PHARM', '200.00', '0.00')],
    );
    expect(result.lines[0].amounts.CASH).toBe('700.00');
  });

  it('reports a figure that would go negative instead of absorbing it', () => {
    const result = subtractRecorded(
      [line('PHARM', '100.00', '0.00')],
      [recorded('PHARM', '600.00', '0.00')],
    );
    expect(result.errors.map((e) => e.code)).toContain('NEW_FIGURES_BELOW_RECORDED');
    expect(result.errors[0].message).toContain('600.00');
  });

  it('reports a department that was recorded earlier but is missing from the file', () => {
    const result = subtractRecorded(
      [line('RAD', '10.00', '0.00')],
      [recorded('PHARM', '600.00', '0.00')],
    );
    expect(result.errors.map((e) => e.code)).toContain('NEW_FIGURES_BELOW_RECORDED');
  });
});
