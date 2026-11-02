import { Decimal } from 'decimal.js';
import { moneyString } from '../common/utils/money';
import type { ParsedLine } from './revenue-parser.service';

export type RecordedLine = {
  departmentId: string;
  reportedTotal: string;
  channelTotal: string;
  amounts: Record<string, string>;
};

export type TrimResult = {
  lines: ParsedLine[];
  errors: Array<{ code: string; message: string; row?: number }>;
  grandTotal: string;
  channelTotal: string;
  /** What was taken out: the already-recorded totals. */
  recordedTotal: string;
};

const zero = new Decimal(0);

/**
 * Figures for the new days = the file's totals minus what is already recorded for the other days,
 * per department and per payment channel. A figure that would be negative means the file shows
 * less than the system already holds; that is a discrepancy to resolve, never to absorb.
 */
export function subtractRecorded(fileLines: ParsedLine[], recorded: RecordedLine[]): TrimResult {
  const errors: TrimResult['errors'] = [];
  const byDepartment = new Map<
    string,
    { reported: Decimal; channel: Decimal; amounts: Map<string, Decimal> }
  >();
  for (const line of recorded) {
    const entry = byDepartment.get(line.departmentId) ?? {
      reported: zero,
      channel: zero,
      amounts: new Map(),
    };
    entry.reported = entry.reported.plus(line.reportedTotal);
    entry.channel = entry.channel.plus(line.channelTotal);
    for (const [code, value] of Object.entries(line.amounts)) {
      entry.amounts.set(code, (entry.amounts.get(code) ?? zero).plus(value));
    }
    byDepartment.set(line.departmentId, entry);
  }

  let grand = zero;
  let channelSum = zero;
  const lines = fileLines.map((line) => {
    const taken = byDepartment.get(line.departmentId);
    byDepartment.delete(line.departmentId);
    const amounts: Record<string, string> = {};
    for (const [code, value] of Object.entries(line.amounts)) {
      const remaining = new Decimal(value).minus(taken?.amounts.get(code) ?? zero);
      if (remaining.isNegative()) {
        errors.push({
          code: 'NEW_FIGURES_BELOW_RECORDED',
          row: line.rowNumber,
          message: `${line.rawDepartment} (${code}): the file shows ${value} but ${moneyString(taken?.amounts.get(code) ?? zero)} is already recorded for the earlier days`,
        });
      }
      amounts[code] = moneyString(remaining);
    }
    const reported = new Decimal(line.reportedTotal).minus(taken?.reported ?? zero);
    const channel = new Decimal(line.channelTotal).minus(taken?.channel ?? zero);
    if (reported.isNegative() || channel.isNegative()) {
      errors.push({
        code: 'NEW_FIGURES_BELOW_RECORDED',
        row: line.rowNumber,
        message: `${line.rawDepartment}: the file's total is less than what is already recorded for the earlier days`,
      });
    }
    grand = grand.plus(reported);
    channelSum = channelSum.plus(channel);
    return {
      ...line,
      reportedTotal: moneyString(reported),
      channelTotal: moneyString(channel),
      variance: moneyString(reported.minus(channel)),
      amounts,
    };
  });

  // A department recorded earlier but absent from the file would mean the file is not a superset.
  for (const [departmentId, entry] of byDepartment) {
    if (entry.reported.gt(0) || entry.channel.gt(0)) {
      errors.push({
        code: 'NEW_FIGURES_BELOW_RECORDED',
        message: `Department ${departmentId} has figures already recorded for the earlier days but is missing from this file`,
      });
    }
  }
  const recordedTotal = recorded.reduce((total, line) => total.plus(line.reportedTotal), zero);
  return {
    lines,
    errors,
    grandTotal: moneyString(grand),
    channelTotal: moneyString(channelSum),
    recordedTotal: moneyString(recordedTotal),
  };
}
