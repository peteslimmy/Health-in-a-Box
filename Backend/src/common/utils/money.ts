import { BadRequestException } from '@nestjs/common';
import { Decimal } from 'decimal.js';

export const MONEY_SCALE = 2;

export type MoneyRounding = 'HALF_UP' | 'DOWN' | 'UP';

const ROUNDING: Record<MoneyRounding, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  DOWN: Decimal.ROUND_DOWN,
  UP: Decimal.ROUND_UP,
};

export function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function roundMoney(value: Decimal.Value, rounding: MoneyRounding = 'HALF_UP'): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_SCALE, ROUNDING[rounding]);
}

export function moneyString(value: Decimal.Value): string {
  return money(value).toFixed(2);
}

export function parseMoney(value: string | number, field = 'amount'): Decimal {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('not finite');
    if (parsed.decimalPlaces() > 2) {
      throw new Error('more than two decimal places');
    }
    return parsed;
  } catch {
    throw new BadRequestException({
      code: 'INVALID_MONEY',
      message: `${field} must be a valid amount with at most two decimal places`,
      details: [{ field, code: 'INVALID_MONEY', message: 'Invalid decimal amount' }],
    });
  }
}

export function parseRate(value: string | number, field = 'rate'): Decimal {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.lt(0) || parsed.gt(100)) throw new Error('out of range');
    if (parsed.decimalPlaces() > 6) throw new Error('too many decimal places');
    return parsed;
  } catch {
    throw new BadRequestException({
      code: 'INVALID_RATE',
      message: `${field} must be a percentage between 0 and 100 with at most six decimal places`,
      details: [{ field, code: 'INVALID_RATE', message: 'Invalid percentage rate' }],
    });
  }
}

export function calculateCharge(base: Decimal, ratePercent: Decimal): Decimal {
  return money(base.mul(ratePercent).div(100));
}
