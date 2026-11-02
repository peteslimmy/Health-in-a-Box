import { Decimal } from 'decimal.js';
import { moneyString } from '../common/utils/money';

export type MonthTotals = Map<string, Decimal>;

/** The last `count` calendar months ending with the month of `today` (YYYY-MM-DD), oldest first. */
export function lastMonths(today: string, count: number): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const result: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const index = year * 12 + (month - 1) - offset;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    result.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return result;
}

export type TrendPoint = {
  month: string;
  reportedRevenue: string;
  chargesPosted: string;
  paymentsReceived: string;
  /** Receivable balance at the end of the month (or today, for the current month). */
  outstanding: string;
  /** Payments received as a percentage of charges posted in the month; null when nothing was charged. */
  collectionRate: string | null;
};

const get = (map: MonthTotals, month: string) => map.get(month) ?? new Decimal(0);

/** Assembles the monthly series; the balance is the opening balance plus the running net ledger movement. */
export function buildTrendSeries(input: {
  months: string[];
  openingBalance: Decimal;
  reported: MonthTotals;
  charges: MonthTotals;
  received: MonthTotals;
  ledgerNet: MonthTotals;
}): TrendPoint[] {
  let running = input.openingBalance;
  return input.months.map((month) => {
    running = running.plus(get(input.ledgerNet, month));
    const charged = get(input.charges, month);
    const received = get(input.received, month);
    return {
      month,
      reportedRevenue: moneyString(get(input.reported, month)),
      chargesPosted: moneyString(charged),
      paymentsReceived: moneyString(received),
      outstanding: moneyString(running),
      collectionRate: charged.gt(0)
        ? received.div(charged).times(100).toDecimalPlaces(1).toFixed(1)
        : null,
    };
  });
}
