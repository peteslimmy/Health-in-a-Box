import { Decimal } from 'decimal.js';
import { moneyString } from '../common/utils/money';

export type ValidationIssue = { row?: number; field?: string; code: string; message: string };

/**
 * Differences between a report's printed totals and the figures beneath them. These are the only
 * findings an approver may knowingly accept. Everything else (unreadable amounts, unknown
 * departments, repeated days, a report printed before its period ended ...) still blocks the commit.
 */
export const OVERRIDABLE_CODES: ReadonlySet<string> = new Set([
  'ROW_TOTAL_MISMATCH',
  'GRAND_TOTAL_MISMATCH',
  'COLUMN_TOTAL_MISMATCH',
  'CROSS_FOOTING_MISMATCH',
  'SERIAL_GAP',
]);

export type VarianceAssessment = {
  /** True when every finding is a tally difference and at least one exists. */
  eligible: boolean;
  tally: ValidationIssue[];
  blockers: ValidationIssue[];
};

export function assessVariance(errors: ValidationIssue[]): VarianceAssessment {
  const tally = errors.filter((error) => OVERRIDABLE_CODES.has(error.code));
  const blockers = errors.filter((error) => !OVERRIDABLE_CODES.has(error.code));
  return { eligible: blockers.length === 0 && tally.length > 0, tally, blockers };
}

export type VarianceLine = {
  rowNumber?: number;
  rawDepartment?: string;
  departmentId: string;
  reportedTotal: string;
  channelTotal: string;
  variance: string;
};

export type VarianceSummary = {
  /** The grand total printed on the report. Not used for charging. */
  printedGrandTotal: string;
  /** The sum of the channel amounts under the departments: what the report evidences. Used for charging. */
  evidencedTotal: string;
  /** Printed minus evidenced. Positive means the report prints more than its rows support. */
  difference: string;
  linesWithDifference: Array<{
    rowNumber: number | null;
    department: string;
    printed: string;
    channels: string;
    difference: string;
  }>;
  findings: number;
  findingsByCode: Record<string, number>;
  /** The messages the approver accepted, capped. */
  accepted: string[];
};

const TOLERANCE = new Decimal('0.01');

export function summariseVariance(input: {
  errors: ValidationIssue[];
  printedGrandTotal: string;
  lines: VarianceLine[];
}): VarianceSummary {
  const evidenced = input.lines.reduce((sum, line) => sum.plus(line.channelTotal), new Decimal(0));
  const printed = new Decimal(input.printedGrandTotal);
  const findingsByCode: Record<string, number> = {};
  for (const error of input.errors) {
    findingsByCode[error.code] = (findingsByCode[error.code] ?? 0) + 1;
  }
  return {
    printedGrandTotal: moneyString(printed),
    evidencedTotal: moneyString(evidenced),
    difference: moneyString(printed.minus(evidenced)),
    linesWithDifference: input.lines
      .filter((line) => new Decimal(line.variance).abs().gt(TOLERANCE))
      .slice(0, 500)
      .map((line) => ({
        rowNumber: line.rowNumber ?? null,
        department: line.rawDepartment ?? line.departmentId,
        printed: moneyString(line.reportedTotal),
        channels: moneyString(line.channelTotal),
        difference: moneyString(new Decimal(line.reportedTotal).minus(line.channelTotal)),
      })),
    findings: input.errors.length,
    findingsByCode,
    accepted: input.errors.slice(0, 200).map((error) => error.message),
  };
}
