import { describe, expect, it } from 'vitest';
import { addMoney, compareMoney, formatDate, formatMoney, isValidAmount, subtractMoney, titleCase, todayIso } from './format';

describe('formatMoney', () => {
  it('groups thousands and always shows two decimals', () => {
    expect(formatMoney('1234567.8')).toBe('₦1,234,567.80');
    expect(formatMoney('0')).toBe('₦0.00');
    expect(formatMoney('999')).toBe('₦999.00');
    expect(formatMoney('1000000')).toBe('₦1,000,000.00');
  });

  it('handles negatives and numbers', () => {
    expect(formatMoney('-1500.5')).toBe('-₦1,500.50');
    expect(formatMoney(250)).toBe('₦250.00');
  });

  it('keeps full precision of very large amounts (no floating-point rounding)', () => {
    expect(formatMoney('9007199254740993.01')).toBe('₦9,007,199,254,740,993.01');
  });

  it('shows a dash for missing values and leaves unparseable text alone', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney('n/a')).toBe('n/a');
  });

  it('prefixes other currencies with their code', () => {
    expect(formatMoney('10', 'USD')).toBe('USD 10.00');
  });
});

describe('money arithmetic used for allocation checks', () => {
  it('adds without binary floating-point error', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('150000.00', '100000.00')).toBe('250000.00');
  });

  it('subtracts and can go negative', () => {
    expect(subtractMoney('100.00', '30.25')).toBe('69.75');
    expect(subtractMoney('10.00', '10.01')).toBe('-0.01');
  });

  it('compares exactly', () => {
    expect(compareMoney('100.00', '100')).toBe(0);
    expect(compareMoney('100.01', '100.00')).toBe(1);
    expect(compareMoney('99.99', '100')).toBe(-1);
  });
});

describe('isValidAmount', () => {
  it('accepts positive amounts with at most two decimals', () => {
    expect(isValidAmount('250000')).toBe(true);
    expect(isValidAmount('0.01')).toBe(true);
    expect(isValidAmount(' 12.5 ')).toBe(true);
  });
  it('rejects zero, negatives, extra decimals and text', () => {
    for (const bad of ['0', '0.00', '-5', '1.234', 'abc', '', '1,000']) expect(isValidAmount(bad)).toBe(false);
  });
});

describe('dates', () => {
  it('formats a date without shifting it across time zones', () => {
    expect(formatDate('2026-09-30')).toBe('30 Sep 2026');
    expect(formatDate('2026-09-30T00:00:00.000Z')).toBe('30 Sep 2026');
    expect(formatDate('2026-01-01T23:59:59.000Z')).toBe('1 Jan 2026');
    expect(formatDate(null)).toBe('—');
  });
  it('produces an ISO business date', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('title-cases enum values', () => {
    expect(titleCase('READY_TO_COMMIT')).toBe('Ready To Commit');
  });
});
