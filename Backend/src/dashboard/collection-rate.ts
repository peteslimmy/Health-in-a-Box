import { Decimal } from 'decimal.js';
import { moneyString } from '../common/utils/money';

/** D-204: a receivable counts as collected on time when it is settled within this many days after its due date. */
export const DEFAULT_COLLECTION_WINDOW_DAYS = 30;
/** D-203: a centre is late when no report for it ends within this many days. */
export const LATE_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

export type CollectionRow = { month: string; due: Decimal; withinWindow: Decimal; toDate: Decimal };

export type CollectionPoint = {
  /** The month in which the receivables fell due. */
  month: string;
  due: string;
  settledWithinWindow: string;
  settledToDate: string;
  /** True once every receivable due in the month has had its full window; only then is the on-time rate final. */
  mature: boolean;
  /** Settled within the window ÷ fell due, as a percentage; null when the month is not mature or nothing fell due. */
  rateWithinWindow: string | null;
  /** Settled so far ÷ fell due; always shown, never presented as the final rate. */
  rateToDate: string | null;
};

const percent = (part: Decimal, whole: Decimal) =>
  whole.gt(0) ? part.div(whole).times(100).toDecimalPlaces(1).toFixed(1) : null;

/** Last day of a YYYY-MM month. */
function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

export function buildCollectionSeries(input: {
  months: string[];
  rows: CollectionRow[];
  today: string;
  windowDays: number;
}): CollectionPoint[] {
  const byMonth = new Map(input.rows.map((row) => [row.month, row]));
  return input.months.map((month) => {
    const row = byMonth.get(month);
    const due = row?.due ?? new Decimal(0);
    const within = row?.withinWindow ?? new Decimal(0);
    const toDate = row?.toDate ?? new Decimal(0);
    // Every item due by month end has had its window once month end + window is in the past.
    const mature = toDay(monthEnd(month)) + input.windowDays < toDay(input.today);
    return {
      month,
      due: moneyString(due),
      settledWithinWindow: moneyString(within),
      settledToDate: moneyString(toDate),
      mature,
      rateWithinWindow: mature ? percent(within, due) : null,
      rateToDate: percent(toDate, due),
    };
  });
}

export type ReportingStatus = {
  lastReportEnd: string | null;
  daysSince: number | null;
  late: boolean;
};

/** A centre is late when it has never reported or its latest report ended more than 7 days ago. */
export function reportingStatus(today: string, lastReportEnd: string | null): ReportingStatus {
  if (!lastReportEnd) return { lastReportEnd: null, daysSince: null, late: true };
  const daysSince = toDay(today) - toDay(lastReportEnd);
  return { lastReportEnd, daysSince, late: daysSince > LATE_AFTER_DAYS };
}
