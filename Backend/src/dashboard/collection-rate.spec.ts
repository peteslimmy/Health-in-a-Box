import { Decimal } from 'decimal.js';
import { buildCollectionSeries, reportingStatus } from './collection-rate';

const row = (month: string, due: string, within: string, toDate: string) => ({
  month,
  due: new Decimal(due),
  withinWindow: new Decimal(within),
  toDate: new Decimal(toDate),
});

describe('buildCollectionSeries', () => {
  const today = '2026-10-27';

  it('gives a final on-time rate only for months whose window has fully closed', () => {
    const series = buildCollectionSeries({
      months: ['2026-08', '2026-09', '2026-10'],
      rows: [
        row('2026-08', '1000', '600', '900'),
        row('2026-09', '1000', '100', '500'),
        row('2026-10', '1000', '0', '0'),
      ],
      today,
      windowDays: 30,
    });
    // August ends 31 Aug; +30 days = 30 Sep, before today: final.
    expect(series[0]).toMatchObject({ mature: true, rateWithinWindow: '60.0', rateToDate: '90.0' });
    // September ends 30 Sep; +30 days = 30 Oct, after today: not final yet.
    expect(series[1]).toMatchObject({ mature: false, rateWithinWindow: null, rateToDate: '50.0' });
    expect(series[2].mature).toBe(false);
  });

  it('treats the window as a parameter', () => {
    const series = buildCollectionSeries({
      months: ['2026-09'],
      rows: [row('2026-09', '200', '50', '100')],
      today,
      windowDays: 7,
    });
    expect(series[0]).toMatchObject({ mature: true, rateWithinWindow: '25.0' });
  });

  it('has no rate for a month in which nothing fell due, and keeps money as 2 dp strings', () => {
    const [empty, full] = buildCollectionSeries({
      months: ['2026-01', '2026-02'],
      rows: [row('2026-02', '10.5', '10.5', '10.5')],
      today,
      windowDays: 30,
    });
    expect(empty).toMatchObject({ due: '0.00', rateWithinWindow: null, rateToDate: null });
    expect(full).toMatchObject({ due: '10.50', rateWithinWindow: '100.0' });
  });
});

describe('reportingStatus', () => {
  const today = '2026-10-27';

  it('is on time when the latest report ended within the last 7 days', () => {
    expect(reportingStatus(today, '2026-10-27')).toEqual({
      lastReportEnd: '2026-10-27',
      daysSince: 0,
      late: false,
    });
    expect(reportingStatus(today, '2026-10-20')).toMatchObject({ daysSince: 7, late: false });
  });

  it('is late once more than 7 days have passed without a report', () => {
    expect(reportingStatus(today, '2026-10-19')).toMatchObject({ daysSince: 8, late: true });
  });

  it('treats a hospital that has never reported as late', () => {
    expect(reportingStatus(today, null)).toEqual({
      lastReportEnd: null,
      daysSince: null,
      late: true,
    });
  });
});
