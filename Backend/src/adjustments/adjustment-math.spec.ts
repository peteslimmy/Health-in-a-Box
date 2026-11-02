import { applyAdjustment, totalDue } from './adjustment-math';

const base = { originalAmount: '1000.00', adjustmentTotal: '0.00', amountPaid: '0.00' };

describe('applyAdjustment', () => {
  it('a credit reduces what is owed and records a negative adjustment', () => {
    const result = applyAdjustment(base, 'CREDIT', '250.50');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.adjustmentTotal.toFixed(2)).toBe('-250.50');
      expect(result.balance.toFixed(2)).toBe('749.50');
    }
  });

  it('a debit increases what is owed', () => {
    const result = applyAdjustment({ ...base, amountPaid: '400.00' }, 'DEBIT', '100.00');
    if (!result.ok) throw new Error('expected ok');
    expect(result.adjustmentTotal.toFixed(2)).toBe('100.00');
    expect(result.balance.toFixed(2)).toBe('700.00');
  });

  it('refuses a credit larger than the balance, because that would be a refund', () => {
    const result = applyAdjustment({ ...base, amountPaid: '900.00' }, 'CREDIT', '100.01');
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: 'ADJUSTMENT_EXCEEDS_BALANCE' }),
    );
    expect(applyAdjustment({ ...base, amountPaid: '900.00' }, 'CREDIT', '100.00').ok).toBe(true);
  });

  it('builds on earlier adjustments and keeps exact decimals', () => {
    const result = applyAdjustment(
      { originalAmount: '0.30', adjustmentTotal: '0.10', amountPaid: '0' },
      'DEBIT',
      '0.20',
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.adjustmentTotal.toFixed(2)).toBe('0.30');
    expect(result.balance.toFixed(2)).toBe('0.60');
  });
});

describe('totalDue', () => {
  it('is the charge plus net adjustments', () => {
    expect(totalDue({ originalAmount: '500.00', adjustmentTotal: '-120.00' }).toFixed(2)).toBe(
      '380.00',
    );
  });
});
