import { TextItem, layoutToTable } from './pdf-report-reader';

// Mirrors the real "Daily Collection Report" layout: column positions, wrapped names, a repeated
// heading on page 2, a grand-total row and signature lines.
const COLUMN_X = [45, 84, 284, 373, 462];
const word = (str: string, x: number, y: number, width = str.length * 6): TextItem => ({
  str,
  x,
  y,
  width,
});

const heading = (y: number): TextItem[] => [
  word('S/', 45, y, 10),
  word('N', 56, y, 8),
  word('Revenue ', 84, y, 45),
  word('Department', 129, y, 58),
  word('Cash', 284, y),
  word('Mobile ', 373, y, 36),
  word('Money', 409, y, 33),
  word('Total ', 462, y, 27),
  word('Amount', 489, y, 39),
];
const row = (
  sn: string,
  name: string,
  cash: string,
  mobile: string,
  total: string,
  y: number,
): TextItem[] => [
  word(sn, COLUMN_X[0], y),
  ...name.split(' ').map((part, i) => word(part, COLUMN_X[1] + i * 40, y)),
  word(cash, COLUMN_X[2], y),
  word(mobile, COLUMN_X[3], y),
  word(total, COLUMN_X[4], y),
];

const page1: TextItem[] = [
  word('TEST', 440, 770),
  word('HOSPITAL', 480, 770),
  word('DAILY', 519, 702),
  word('COLLECTION', 553, 702),
  word('REPORT', 627, 702),
  word('Print', 40, 675),
  word('Date :', 63, 675),
  word('26/10/2026', 94, 675),
  word('Between :', 300, 675),
  word('25/9/2026', 360, 675),
  word('and', 420, 675),
  word('25/10/2026', 440, 675),
  ...heading(654),
  ...row('1', 'ACCIDENT AND EMERGENCY', '0.00', '464,000.00', '464,000.00', 636),
  ...row('2', 'ASSISTED REPRODUCTIVE', '10.00', '0.00', '10.00', 618),
  word('TECHNOLOGY', 84, 605),
  word('(ART)', 157, 605),
];
const page2: TextItem[] = [
  ...heading(789),
  ...row('3', 'SURGERY', '5.50', '0.00', '5.50', 771),
  word('Grand', 47, 750),
  word('Total', 76, 750),
  word('15.50', 284, 750),
  word('464,000.00', 373, 750),
  word('464,015.50', 462, 750),
  word('...............................', 118, 700),
  word('Director', 89, 690),
  word('of', 131, 690),
  word('Finance', 143, 690),
];

describe('layoutToTable', () => {
  const table = layoutToTable([page1, page2]);

  it('reads the period, print date and title above the table', () => {
    expect(table.period).toEqual({ start: '2026-09-25', end: '2026-10-25' });
    expect(table.printDate).toBe('2026-10-26');
    expect(table.title).toBe('TEST HOSPITAL');
    expect(table.pages).toBe(2);
  });

  it('builds the heading from words that sit together and ignores the repeated heading', () => {
    expect(table.rows[0]).toEqual([
      'S/N',
      'Revenue Department',
      'Cash',
      'Mobile Money',
      'Total Amount',
    ]);
    expect(table.rows.filter((r) => r[1] === 'Revenue Department')).toHaveLength(1);
  });

  it('keeps one row per department and joins names that wrapped onto a second line', () => {
    expect(table.rows.map((r) => r[0])).toEqual(['S/N', '1', '2', '3', '']);
    expect(table.rows[2][1]).toBe('ASSISTED REPRODUCTIVE TECHNOLOGY (ART)');
    expect(table.rows[2].slice(2)).toEqual(['10.00', '0.00', '10.00']);
  });

  it('ends the table at the grand total and sets signature lines aside', () => {
    expect(table.rows[table.rows.length - 1]).toEqual([
      '',
      'Grand Total',
      '15.50',
      '464,000.00',
      '464,015.50',
    ]);
    expect(table.ignoredLines).toEqual(expect.arrayContaining(['Director of Finance']));
    expect(table.rows.flat().join(' ')).not.toContain('Director');
  });

  it('returns no rows when there is no revenue table', () => {
    expect(layoutToTable([[word('Hello', 10, 10)]]).rows).toEqual([]);
  });
});
