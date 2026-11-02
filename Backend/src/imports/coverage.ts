/** A period already held in the system for the centre (dates are YYYY-MM-DD, inclusive). */
export type CoveredPeriod = {
  /** Report id, for COMMITTED periods. */
  id?: string;
  start: string;
  end: string;
  /** COMMITTED reports are final; PENDING ones are uploads waiting to be committed. */
  state: 'COMMITTED' | 'PENDING';
  label: string;
};

export type CoverageIssue = {
  code: string;
  message: string;
  /** For gaps: the missing days, so the reviewer can see exactly what is absent. */
  missingFrom?: string;
  missingTo?: string;
  days?: number;
  /** A flag the reviewer must explicitly acknowledge (with a reason) before the import can be committed. */
  requiresAcknowledgement?: boolean;
};

export type CoverageAssessment = {
  errors: CoverageIssue[];
  warnings: CoverageIssue[];
  flags: CoverageIssue[];
};

const DAY_MS = 86_400_000;

const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const fromDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function readableDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

export const range = (start: string, end: string) =>
  start === end ? readableDate(start) : `${readableDate(start)} to ${readableDate(end)}`;

/** Longest period one report may cover before it is questioned (about a quarter). */
export const LONG_PERIOD_DAYS = 92;

/**
 * Checks a new report period against what the centre already holds:
 * - days already reported are an error (never overwritten or double counted);
 * - days skipped between the previous report and this one, or this one and the next, are flagged
 *   and must be acknowledged with a reason;
 * - future-dated and unusually long periods are questioned.
 */
export function assessCoverage(input: {
  start: string;
  end: string;
  today: string;
  existing: CoveredPeriod[];
}): CoverageAssessment {
  const { start, end, today, existing } = input;
  const result: CoverageAssessment = { errors: [], warnings: [], flags: [] };
  const s = toDay(start);
  const e = toDay(end);

  if (e > toDay(today)) {
    result.errors.push({
      code: 'PERIOD_IN_FUTURE',
      message: `The report period ends on ${readableDate(end)}, which is after today (${readableDate(today)}); revenue for days that have not happened cannot be uploaded`,
    });
  }
  const length = e - s + 1;
  if (length > LONG_PERIOD_DAYS) {
    result.warnings.push({
      code: 'PERIOD_VERY_LONG',
      message: `The period covers ${length} days; confirm this is one report and not several joined together`,
    });
  }

  for (const period of existing) {
    const overlapStart = Math.max(s, toDay(period.start));
    const overlapEnd = Math.min(e, toDay(period.end));
    if (overlapStart > overlapEnd) continue;
    const overlap = range(fromDay(overlapStart), fromDay(overlapEnd));
    if (period.state === 'COMMITTED') {
      result.errors.push({
        code: 'PERIOD_ALREADY_UPLOADED',
        message: `${overlap} ${overlapStart === overlapEnd ? 'is' : 'are'} already in the system (${period.label}, covering ${range(period.start, period.end)}). Existing records are never overwritten; upload only days that have not been reported`,
        missingFrom: fromDay(overlapStart),
        missingTo: fromDay(overlapEnd),
        days: overlapEnd - overlapStart + 1,
      });
    } else {
      result.warnings.push({
        code: 'PERIOD_PENDING_UPLOAD',
        message: `${overlap} ${overlapStart === overlapEnd ? 'is' : 'are'} also covered by an upload still waiting to be committed (${period.label}); only one of them should be committed`,
      });
    }
  }

  // Days skipped on either side. A report that already covers the day next to this one (even by
  // overlapping it) means nothing is skipped there.
  const before = existing.filter((p) => toDay(p.start) < s).map((p) => toDay(p.end));
  const after = existing.filter((p) => toDay(p.end) > e).map((p) => toDay(p.start));
  if (before.length > 0) {
    const previousEnd = Math.max(...before);
    if (s - previousEnd > 1) {
      const from = fromDay(previousEnd + 1);
      const to = fromDay(s - 1);
      result.flags.push({
        code: 'PERIOD_GAP',
        message: `Omitted days: nothing has been uploaded for ${range(from, to)} (${s - previousEnd - 1} day${s - previousEnd - 1 === 1 ? '' : 's'}). The previous report ends on ${readableDate(fromDay(previousEnd))} and this one starts on ${readableDate(start)}`,
        missingFrom: from,
        missingTo: to,
        days: s - previousEnd - 1,
        requiresAcknowledgement: true,
      });
    }
  }
  if (after.length > 0) {
    const nextStart = Math.min(...after);
    if (nextStart - e > 1) {
      const from = fromDay(e + 1);
      const to = fromDay(nextStart - 1);
      result.flags.push({
        code: 'PERIOD_GAP',
        message: `Omitted days: nothing has been uploaded for ${range(from, to)} (${nextStart - e - 1} day${nextStart - e - 1 === 1 ? '' : 's'}). This report ends on ${readableDate(end)} and the next one starts on ${readableDate(fromDay(nextStart))}`,
        missingFrom: from,
        missingTo: to,
        days: nextStart - e - 1,
        requiresAcknowledgement: true,
      });
    }
  }
  return result;
}

export type TrimPlan = {
  /** The days this file adds: the file's period minus the days already reported. */
  start: string;
  end: string;
  /** The committed reports that already hold the other days (all wholly inside the file's period). */
  covered: CoveredPeriod[];
};

/**
 * A file that overlaps reports already committed can still be used when every one of those
 * reports lies wholly inside the file's period and the remaining days form one stretch: the
 * file's totals minus the recorded totals are the figures for the new days. Anything else
 * cannot be separated by day and is left to the overlap error.
 */
export function planTrim(input: { start: string; end: string; existing: CoveredPeriod[] }): {
  plan?: TrimPlan;
  blocked?: string;
} {
  const s = toDay(input.start);
  const e = toDay(input.end);
  const overlapping = input.existing
    .filter((p) => p.state === 'COMMITTED' && toDay(p.start) <= e && toDay(p.end) >= s)
    .sort((a, b) => toDay(a.start) - toDay(b.start));
  if (overlapping.length === 0) return {};
  const outside = overlapping.find((p) => toDay(p.start) < s || toDay(p.end) > e);
  if (outside) {
    return {
      blocked: `This file gives totals for the whole period, not for each day, so it cannot be split where an existing report (${outside.label}, ${range(outside.start, outside.end)}) reaches outside it`,
    };
  }
  let cursor = s;
  let previousEnd = s - 1;
  const gaps: Array<[number, number]> = [];
  for (const p of overlapping) {
    if (toDay(p.start) <= previousEnd) {
      return {
        blocked:
          'Existing reports for this centre overlap each other, so the recorded totals cannot be subtracted safely',
      };
    }
    if (toDay(p.start) > cursor) gaps.push([cursor, toDay(p.start) - 1]);
    cursor = toDay(p.end) + 1;
    previousEnd = toDay(p.end);
  }
  if (cursor <= e) gaps.push([cursor, e]);
  if (gaps.length === 0) return {};
  if (gaps.length > 1) {
    return {
      blocked:
        'The days not yet reported are split into several stretches, so the new figures cannot be assigned to one period',
    };
  }
  return { plan: { start: fromDay(gaps[0][0]), end: fromDay(gaps[0][1]), covered: overlapping } };
}
