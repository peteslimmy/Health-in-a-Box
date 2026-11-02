import { TextItem, layoutToTable } from '../imports/pdf-report-reader';
import {
  codeFromCentreName,
  codeFromName,
  findPrintedNumber,
  profileReport,
  titleCase,
} from './report-profile';

const HEADER = ['S/N', 'Revenue Department', 'Cash', 'POS', 'Mobile Money', 'Total Amount'];
const pdfMeta = {
  rows: [],
  title: 'UNIVERSITY OF ABUJA TEACHING HOSPITAL, GWAGWALADA',
  printDate: '2026-10-26',
  printedAt: '2026-10-26T18:14',
  period: { start: '2026-09-25', end: '2026-10-25' },
  pages: 2,
  ignoredLines: ['Director of Finance & Accounts'],
};

describe('reading a centre from a report', () => {
  const rows = [
    HEADER,
    ['1', 'ACCIDENT  AND EMERGENCY UNIT', '0.00', '0.00', '464,000.00', '464,000.00'],
    ['2', 'PHARMACY', '100.00', '0.00', '900.00', '1,000.00'],
    ['', 'Grand Total', '100.00', '0.00', '464,900.00', '465,000.00'],
  ];
  const profile = profileReport({
    fileName: 'uath revenue.pdf',
    kind: 'PDF',
    rows,
    pdf: { ...pdfMeta, rows },
  });

  it('proposes the centre name, a code, the period and when it was printed', () => {
    expect(profile.centre.suggestedName).toBe('University of Abuja Teaching Hospital, Gwagwalada');
    expect(profile.centre.suggestedCode).toBe('UATH');
    expect(profile.centre.printedNumber).toBeNull();
    expect(profile.source.period).toEqual({ start: '2026-09-25', end: '2026-10-25' });
    expect(profile.source.printedAt).toBe('2026-10-26T18:14');
  });

  it('lists the departments with tidy spacing, unique codes and their totals', () => {
    expect(profile.departments.map((d) => [d.name, d.code, d.total])).toEqual([
      ['ACCIDENT AND EMERGENCY UNIT', 'ACCIDENT_AND_EMERGENCY_UNI', '464000.00'],
      ['PHARMACY', 'PHARMACY', '1000.00'],
    ]);
  });

  it('lists payment channels as printed (not the total column) and flags those with no activity', () => {
    expect(profile.channels.map((c) => [c.printedHeading, c.code, c.hasActivity])).toEqual([
      ['Cash', 'CASH', true],
      ['POS', 'POS', false],
      ['Mobile Money', 'MOBILE_MONEY', true],
    ]);
    expect(profile.grandTotal).toBe('465000.00');
  });

  it('is clean when the totals tally', () => {
    expect(profile.tally).toEqual({ ok: true, problems: [] });
  });

  it('reports a total that does not tally, naming the row, without refusing to read the file', () => {
    const broken = [
      HEADER,
      ['1', 'PHARMACY', '100.00', '0.00', '900.00', '1,500.00'],
      ['', 'Grand Total', '100.00', '0.00', '900.00', '1,500.00'],
    ];
    const result = profileReport({ fileName: 'x.csv', kind: 'CSV', rows: broken, pdf: null });
    expect(result.tally.ok).toBe(false);
    expect(result.tally.problems[0].message).toMatch(/1500\.00|1,500|differs/);
    expect(result.departments).toHaveLength(1);
  });

  it('copes with a file that has no department column', () => {
    const result = profileReport({
      fileName: 'odd.csv',
      kind: 'CSV',
      rows: [
        ['Name', 'Amount'],
        ['x', '1'],
      ],
      pdf: null,
    });
    expect(result.departments).toEqual([]);
    expect(result.tally.ok).toBe(false);
  });

  it('falls back to the file name for a CSV that has no title', () => {
    const result = profileReport({ fileName: 'lekki_phase_1.csv', kind: 'CSV', rows, pdf: null });
    expect(result.centre.suggestedName).toBe('lekki phase 1');
  });

  it('lists a department that repeats only once and says so', () => {
    const repeated = [
      HEADER,
      ['1', 'PHARMACY', '1', '0', '0', '1'],
      ['2', 'Pharmacy', '1', '0', '0', '1'],
    ];
    const result = profileReport({ fileName: 'x.csv', kind: 'CSV', rows: repeated, pdf: null });
    expect(result.departments).toHaveLength(1);
    expect(result.notes.join(' ')).toMatch(/more than once/);
  });
});

describe('centre number, codes and names', () => {
  it('finds a centre number printed in the heading', () => {
    expect(findPrintedNumber(['Centre No: UATH-014'])).toBe('UATH-014');
    expect(findPrintedNumber(['Facility Code : 0042'])).toBe('0042');
    expect(findPrintedNumber(['Print Date : 26/10/2026'])).toBeNull();
    expect(findPrintedNumber(['Director of Finance & Accounts'])).toBeNull();
  });

  it('uses a printed centre number as the suggested code', () => {
    const result = profileReport({
      fileName: 'x.pdf',
      kind: 'PDF',
      rows: [HEADER, ['1', 'PHARMACY', '1', '0', '0', '1']],
      pdf: { ...pdfMeta, rows: [], ignoredLines: ['Centre No: 77'] },
    });
    expect(result.centre.printedNumber).toBe('77');
    expect(result.centre.suggestedCode).toBe('77');
  });

  it('builds codes from names', () => {
    expect(codeFromCentreName('UNIVERSITY OF ABUJA TEACHING HOSPITAL, GWAGWALADA')).toBe('UATH');
    expect(codeFromCentreName('Lekki Phase 1 Centre')).toBe('LP1C');
    const taken = new Set<string>();
    expect(codeFromName('Mobile Money', taken)).toBe('MOBILE_MONEY');
    expect(codeFromName('Mobile  money', taken)).toBe('MOBILE_MONEY_2');
    expect(codeFromName('%', taken)).toBe('ITEM');
  });

  it('tidies capitalisation for display', () => {
    expect(titleCase('ACCIDENT  AND EMERGENCY UNIT')).toBe('Accident and Emergency Unit');
    expect(titleCase('EAR NOSE AND THROAT (ENT)')).toBe(
      'Ear Nose and Throat (ENT)'.replace('(ENT)', '(Ent)'),
    );
  });
});

describe('printed time from a PDF heading', () => {
  const word = (str: string, x: number, y: number): TextItem => ({
    str,
    x,
    y,
    width: str.length * 6,
  });
  const page = (printLine: string): TextItem[] => [
    word('UNIVERSITY OF ABUJA TEACHING HOSPITAL, GWAGWALADA', 45, 800),
    word(printLine, 45, 780),
    word('S/', 45, 760),
    word('N', 56, 760),
    word('Revenue Department', 84, 760),
    word('Cash', 284, 760),
    word('Total Amount', 462, 760),
    word('1', 45, 740),
    word('PHARMACY', 84, 740),
    word('1.00', 284, 740),
    word('1.00', 462, 740),
  ];

  it.each([
    ['Print Date : 26/10/2026 6:14 pm Between : 25/9/2026 and 25/10/2026', '2026-10-26T18:14'],
    ['Print Date : 26/10/2026 12:05 am Between : 25/9/2026 and 25/10/2026', '2026-10-26T00:05'],
    ['Print Date : 26/10/2026 14:30 Between : 25/9/2026 and 25/10/2026', '2026-10-26T14:30'],
    ['Print Date : 26/10/2026 Between : 25/9/2026 and 25/10/2026', null],
  ])('reads %s', (line, expected) => {
    const data = layoutToTable([page(line)]);
    expect(data.printedAt).toBe(expected);
    expect(data.printDate).toBe('2026-10-26');
    expect(data.period).toEqual({ start: '2026-09-25', end: '2026-10-25' });
  });
});
