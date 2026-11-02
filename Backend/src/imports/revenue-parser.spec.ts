import { RevenueParserService, parseAmount } from './revenue-parser.service';

const departments = [
  { id: 'dep-pharm', code: 'PHARM', name: 'Pharmacy', aliases: [] },
  { id: 'dep-rad', code: 'RAD', name: 'Radiology', aliases: [{ alias: 'X-Ray' }] },
] as never;

const channels = [
  { id: 'ch-cash', code: 'CASH', name: 'Cash', aliases: [] },
  { id: 'ch-pos', code: 'POS', name: 'POS', aliases: [] },
] as never;

const parser = new RevenueParserService();
const parseCsv = (csv: string) =>
  parser.parse(Buffer.from(csv), 'report.csv', departments, channels);
const codes = (items: Array<{ code: string }>) => items.map((item) => item.code);

describe('revenue report parser', () => {
  describe('parseAmount', () => {
    it('accepts the Naira sign and NGN prefix (regression: garbled currency regex)', () => {
      expect(parseAmount('₦1,000.50')?.toFixed(2)).toBe('1000.50');
      expect(parseAmount('NGN 2,500')?.toFixed(2)).toBe('2500.00');
      expect(parseAmount('$10')?.toFixed(2)).toBe('10.00');
    });

    it('treats a blank cell as zero and rejects text, formulas and extra decimals', () => {
      expect(parseAmount('')?.toFixed(2)).toBe('0.00');
      expect(parseAmount('abc')).toBeNull();
      expect(parseAmount('=1+1')).toBeNull();
      expect(parseAmount('10.001')).toBeNull();
    });

    it('reads accounting negatives in brackets', () => {
      expect(parseAmount('(50.00)')?.toFixed(2)).toBe('-50.00');
    });
  });

  it('INV-001: blocks a row whose reported total differs from its channel sum', () => {
    const result = parseCsv('Department,Cash,POS,Total Amount\nPharmacy,600.00,400.00,1200.00\n');
    expect(codes(result.errors)).toContain('ROW_TOTAL_MISMATCH');
  });

  it('INV-001: tolerates a difference of one kobo as a warning only', () => {
    const result = parseCsv('Department,Cash,POS,Total Amount\nPharmacy,600.00,400.00,1000.01\n');
    expect(result.errors).toHaveLength(0);
    expect(codes(result.warnings)).toContain('ROW_VARIANCE');
  });

  it('INV-002: a Total Amount column is a control total, not extra revenue', () => {
    const result = parseCsv('Department,Cash,POS,Total Amount\nPharmacy,600.00,400.00,1000.00\n');
    expect(result.errors).toHaveLength(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].channelTotal).toBe('1000.00');
    expect(result.lines[0].reportedTotal).toBe('1000.00');
    expect(result.grandTotal).toBe('1000.00'); // not 2000.00
    expect(Object.keys(result.lines[0].amounts).sort()).toEqual(['CASH', 'POS']);
  });

  it('INV-002: a grand-total footer row is validated, never added as a department', () => {
    const ok = parseCsv(
      'Department,Cash,POS,Total Amount\nPharmacy,600,400,1000\nRadiology,100,100,200\nGrand Total,700,500,1200\n',
    );
    expect(ok.errors).toHaveLength(0);
    expect(ok.lines).toHaveLength(2);
    expect(ok.grandTotal).toBe('1200.00');

    const bad = parseCsv(
      'Department,Cash,POS,Total Amount\nPharmacy,600,400,1000\nRadiology,100,100,200\nGrand Total,0,0,9999\n',
    );
    expect(codes(bad.errors)).toContain('GRAND_TOTAL_MISMATCH');
  });

  it('flags unknown departments and channels instead of dropping them silently', () => {
    const dept = parseCsv('Department,Cash,POS,Total Amount\nDentistry,10,10,20\n');
    expect(codes(dept.errors)).toContain('UNKNOWN_DEPARTMENT');

    const channel = parseCsv('Department,Cash,Cheque,Total Amount\nPharmacy,10,5,15\n');
    expect(codes(channel.errors)).toContain('UNKNOWN_CHANNEL_COLUMN');
  });

  it('resolves department aliases', () => {
    const result = parseCsv('Department,Cash,POS,Total Amount\nx-ray,10,10,20\n');
    expect(result.errors).toHaveLength(0);
    expect(result.lines[0].departmentId).toBe('dep-rad');
  });

  it('rejects negative amounts, text amounts and duplicate departments', () => {
    expect(
      codes(parseCsv('Department,Cash,POS,Total Amount\nPharmacy,-5,10,5\n').errors),
    ).toContain('NEGATIVE_AMOUNT');
    expect(
      codes(parseCsv('Department,Cash,POS,Total Amount\nPharmacy,abc,10,10\n').errors),
    ).toContain('INVALID_AMOUNT');
    expect(
      codes(parseCsv('Department,Cash,POS,Total Amount\nPharmacy,1,1,2\nPharmacy,1,1,2\n').errors),
    ).toContain('DUPLICATE_DEPARTMENT');
  });

  it('reads Naira-formatted amounts end to end', () => {
    const result = parseCsv(
      'Department,Cash,POS,Total Amount\nPharmacy,₦600.00,"₦400.00","₦1,000.00"\n',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.grandTotal).toBe('1000.00');
  });

  it('rejects files over the row limit instead of exhausting memory', () => {
    const rows = Array.from({ length: 20_005 }, (_, i) => `Pharmacy${i},1,1,2`).join('\n');
    expect(() => parseCsv(`Department,Cash,POS,Total Amount\n${rows}\n`)).toThrow(/more than/);
  });

  it('requires a department column', () => {
    const result = parseCsv('Name,Cash\nPharmacy,10\n');
    expect(codes(result.errors)).toContain('MISSING_DEPARTMENT_COLUMN');
  });
});
