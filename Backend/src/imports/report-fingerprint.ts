import { createHash } from 'crypto';

export type FingerprintLine = {
  departmentId: string;
  reportedTotal: string;
  amounts: Record<string, string>;
};

/**
 * Content fingerprint of a revenue report: the same hospital, period and normalised
 * department x channel amounts always produce the same value, whatever the file is called,
 * how it was formatted, or in which row order the departments appear.
 */
export function fingerprintReport(
  hospitalId: string,
  periodStart: string,
  periodEnd: string,
  lines: FingerprintLine[],
): string {
  const canonical = [...lines]
    .sort((a, b) => a.departmentId.localeCompare(b.departmentId))
    .map((line) => ({
      d: line.departmentId,
      t: line.reportedTotal,
      a: Object.entries(line.amounts).sort(([x], [y]) => x.localeCompare(y)),
    }));
  return createHash('sha256')
    .update(JSON.stringify({ hospitalId, periodStart, periodEnd, lines: canonical }))
    .digest('hex');
}
