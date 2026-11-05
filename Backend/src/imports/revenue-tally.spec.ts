import { RevenueParserService } from './revenue-parser.service';

const departments = [
  { id: 'dep-pharm', code: 'PHARM', name: 'Pharmacy', aliases: [] },
  { id: 'dep-rad', code: 'RAD', name: 'Radiology', aliases: [] },
] as never;
const channels = [
  { id: 'ch-cash', code: 'CASH', name: 'Cash', aliases: [] },
  { id: 'ch-pos', code: 'POS', name: 'POS', aliases: [] },
] as never;

const parser = new RevenueParserService();
const header = ['S/N', 'Revenue Department', 'Cash', 'POS', 'Total Amount'];
const run = (rows: string[][]) => parser.parseRows([header, ...rows], departments, channels);
const codes = (items: Array<{ code: string }>) => items.map((item) => item.code);

describe('printed totals must tally (PDF and spreadsheet reports)', () => {
  it('accepts a report whose rows, columns and grand total all agree', () => {
    const result = run([
      ['1', 'Pharmacy', '600.00', '400.00', '1,000.00'],
      ['2', 'Radiology', '100.00', '0.00', '100.00'],
      ['', 'Grand Total', '700.00', '400.00', '1,100.00'],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.grandTotal).toBe('1100.00');
  });

  it('flags a department whose total is more than its channels add up to', () => {
    const result = run([
      ['1', 'Pharmacy', '600.00', '400.00', '1,500.00'],
      ['', 'Grand Total', '600.00', '400.00', '1,500.00'],
    ]);
    expect(codes(result.errors)).toContain('ROW_TOTAL_MISMATCH');
  });

  it('flags a printed channel total that is not the sum of its rows', () => {
    const result = run([
      ['1', 'Pharmacy', '600.00', '400.00', '1,000.00'],
      ['2', 'Radiology', '100.00', '0.00', '100.00'],
      ['', 'Grand Total', '999.00', '400.00', '1,100.00'],
    ]);
    expect(codes(result.errors)).toContain('COLUMN_TOTAL_MISMATCH');
    expect(result.errors.find((e) => e.code === 'COLUMN_TOTAL_MISMATCH')?.field).toBe('Cash');
  });

  it('flags a printed grand total that is not the sum of the department totals', () => {
    const result = run([
      ['1', 'Pharmacy', '600.00', '400.00', '1,000.00'],
      ['', 'Grand Total', '600.00', '400.00', '1,200.00'],
    ]);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining(['GRAND_TOTAL_MISMATCH', 'CROSS_FOOTING_MISMATCH']),
    );
  });

  it('flags a missing printed row from the serial numbers', () => {
    const result = run([
      ['1', 'Pharmacy', '600.00', '400.00', '1,000.00'],
      ['3', 'Radiology', '100.00', '0.00', '100.00'],
      ['', 'Grand Total', '700.00', '400.00', '1,100.00'],
    ]);
    expect(codes(result.errors)).toContain('SERIAL_GAP');
    expect(result.errors.find((e) => e.code === 'SERIAL_GAP')?.message).toContain(
      'jump from 1 to 3',
    );
  });

  it('flags a repeated serial number', () => {
    const result = run([
      ['1', 'Pharmacy', '600.00', '400.00', '1,000.00'],
      ['1', 'Radiology', '100.00', '0.00', '100.00'],
    ]);
    expect(codes(result.errors)).toContain('SERIAL_GAP');
  });

  it('still checks the totals when a department is not set up, and lists what is unmatched', () => {
    const result = run([
      ['1', 'Pharmacy', '600.00', '400.00', '1,000.00'],
      ['2', 'Brand New Unit', '100.00', '0.00', '100.00'],
      ['', 'Grand Total', '700.00', '400.00', '1,100.00'],
    ]);
    expect(codes(result.errors)).toEqual(['UNKNOWN_DEPARTMENT']);
    expect(result.unmatched.departments).toEqual(['Brand New Unit']);
  });

  it('lists payment-channel columns that the hospital does not have', () => {
    const result = parser.parseRows(
      [
        ['Department', 'Cash', 'Mobile Money', 'Total Amount'],
        ['Pharmacy', '600.00', '25.00', '625.00'],
      ],
      departments,
      channels,
    );
    expect(result.unmatched.channels).toEqual(['Mobile Money']);
  });

  it('warns that a report without a total row could not be cross-checked', () => {
    const result = run([['1', 'Pharmacy', '600.00', '400.00', '1,000.00']]);
    expect(codes(result.warnings)).toContain('NO_TOTAL_ROW');
  });
});
