import * as XLSX from 'xlsx';
import { neutraliseFormula, toCsv, toXlsx } from './report-export';
import { ReportColumn, ReportRow } from './report-types';

const columns: ReportColumn[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'amount', label: 'Amount', type: 'money' },
  { key: 'count', label: 'Count', type: 'int' },
];
const meta = {
  title: 'Test report',
  generatedAt: '2026-10-27T10:00:00.000Z',
  generatedBy: 'user@test.local',
  filters: 'from=2026-10-01',
  notes: ['A note'],
};

describe('neutraliseFormula', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx'])('prefixes %j', (value) => {
    expect(neutraliseFormula(value).startsWith("'")).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(neutraliseFormula('Pharmacy')).toBe('Pharmacy');
  });
});

describe('toCsv', () => {
  const rows: ReportRow[] = [
    { name: '=HYPERLINK("http://evil")', amount: '1234.50', count: 3 },
    { name: 'Smith, "Jo"', amount: '-50.00', count: 1 },
  ];
  const csv = toCsv(columns, rows, { name: 'Total', amount: '1184.50', count: 4 }, meta)
    .toString('utf8')
    .replace(String.fromCharCode(0xfeff), '');
  const lines = csv.split('\r\n');

  it('starts with a byte-order mark and states what, when, by whom and under which filters', () => {
    const raw = toCsv(columns, rows, null, meta);
    expect(raw[0]).toBe(0xef);
    expect(lines[0]).toBe('Test report');
    expect(lines[1]).toContain('user@test.local');
    expect(lines[2]).toBe('Filters: from=2026-10-01');
    expect(lines[3]).toBe('A note');
  });

  it('neutralises formulas in text cells but keeps negative money as a number', () => {
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")",1234.50,3`);
    expect(csv).toContain('-50.00');
    expect(csv).not.toContain("'-50.00");
  });

  it('quotes commas and quotes, and ends with the totals row', () => {
    expect(csv).toContain('"Smith, ""Jo""",-50.00,1');
    expect(lines.filter(Boolean).pop()).toBe('Total,1184.50,4');
  });
});

describe('toXlsx', () => {
  it('writes numbers for money and counts, text for names, and a totals row', () => {
    const buffer = toXlsx(
      columns,
      [{ name: 'A', amount: '10.25', count: 2 }],
      { name: 'Total', amount: '10.25', count: 2 },
      meta,
    );
    const sheet = XLSX.read(buffer, { type: 'buffer' }).Sheets.Report;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
    const headerIndex = grid.findIndex((row) => row[0] === 'Name');
    expect(grid[headerIndex + 1]).toEqual(['A', 10.25, 2]);
    expect(grid[headerIndex + 2]).toEqual(['Total', 10.25, 2]);
  });

  it('keeps money wider than Excel can hold exactly as text', () => {
    const buffer = toXlsx(
      columns,
      [{ name: 'A', amount: '12345678901234567.89', count: 1 }],
      null,
      meta,
    );
    const sheet = XLSX.read(buffer, { type: 'buffer' }).Sheets.Report;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
    const headerIndex = grid.findIndex((row) => row[0] === 'Name');
    expect(grid[headerIndex + 1][1]).toBe('12345678901234567.89');
  });

  it('neutralises formula text in cells and labels', () => {
    const buffer = toXlsx(
      [{ key: 'name', label: '=bad', type: 'text' }],
      [{ name: '=1+1' }],
      null,
      meta,
    );
    const sheet = XLSX.read(buffer, { type: 'buffer' }).Sheets.Report;
    const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true }).flat();
    expect(values).toContain("'=bad");
    expect(values).toContain("'=1+1");
  });
});
