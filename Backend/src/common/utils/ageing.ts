import { Decimal } from 'decimal.js';

/** D-014 buckets. An item is overdue only when the as-at date is strictly after its due date. */
export const AGEING_BUCKETS = [
  'NOT_YET_DUE',
  'DAYS_1_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_91_120',
  'OVER_120',
] as const;

export type AgeingBucket = (typeof AGEING_BUCKETS)[number] | 'SETTLED';

const MS_PER_DAY = 86_400_000;

/** Whole calendar days from `from` to `to` (both are date-only UTC midnights). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function daysOverdue(dueDate: Date, asAt: Date): number {
  return Math.max(0, daysBetween(dueDate, asAt));
}

export function ageingBucket(dueDate: Date, asAt: Date, balance: Decimal.Value): AgeingBucket {
  if (new Decimal(balance).lte(0)) return 'SETTLED';
  const overdue = daysOverdue(dueDate, asAt);
  if (overdue === 0) return 'NOT_YET_DUE';
  if (overdue <= 30) return 'DAYS_1_30';
  if (overdue <= 60) return 'DAYS_31_60';
  if (overdue <= 90) return 'DAYS_61_90';
  if (overdue <= 120) return 'DAYS_91_120';
  return 'OVER_120';
}
