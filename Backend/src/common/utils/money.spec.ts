import { calculateCharge, money, parseMoney, parseRate, roundMoney } from './money';

describe('money', () => {
  it('rounds half-up to two decimals at the boundary', () => {
    expect(money('0.005').toFixed(2)).toBe('0.01');
    expect(money('0.004').toFixed(2)).toBe('0.00');
    expect(money('1.005').toFixed(2)).toBe('1.01');
  });

  it('computes a charge as base x rate% with half-up rounding', () => {
    expect(calculateCharge(money('10.10'), parseRate('5')).toFixed(2)).toBe('0.51'); // 0.505
    expect(calculateCharge(money('1000'), parseRate('4.5')).toFixed(2)).toBe('45.00');
  });

  it('never loses precision the way binary floats do', () => {
    // 0.1 + 0.2 !== 0.3 with JS numbers; decimal arithmetic must be exact.
    expect(money('0.1').plus('0.2').toFixed(2)).toBe('0.30');
    expect(roundMoney('2.675', 'HALF_UP').toFixed(2)).toBe('2.68');
  });

  it('rejects amounts with more than two decimals', () => {
    expect(() => parseMoney('10.001')).toThrow();
    expect(() => parseMoney('abc')).toThrow();
    expect(parseMoney('10.05').toFixed(2)).toBe('10.05');
  });

  it('rejects rates outside 0..100 or beyond six decimals', () => {
    expect(() => parseRate('100.01')).toThrow();
    expect(() => parseRate('-1')).toThrow();
    expect(() => parseRate('1.1234567')).toThrow();
    expect(parseRate('0').toString()).toBe('0');
  });
});
