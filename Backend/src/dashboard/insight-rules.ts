import { Decimal } from 'decimal.js';
import { moneyString } from '../common/utils/money';

export type Severity = 'info' | 'attention' | 'urgent';
export type InsightArea = 'Revenue' | 'Service charge' | 'Receivables' | 'Reporting' | 'Control';

export type Insight = {
  /** Stable, so a screen can keep its place and a later release can mute one. */
  id: string;
  area: InsightArea;
  severity: Severity;
  title: string;
  /** One factual sentence naming the figures and the periods compared. */
  detail: string;
  /** The figures behind the sentence, so it can be checked against the records. */
  evidence: Array<{ label: string; value: string }>;
  centreId: string | null;
  link: string;
};

/** Thresholds are stated in one place so they can be reviewed and later made settings. */
export const THRESHOLDS = {
  revenueDropPct: 20,
  revenueRisePct: 25,
  yieldChangePoints: 1,
  overdueShareAttentionPct: 50,
  overdueShareUrgentPct: 80,
  concentrationPct: 50,
  repeatedImportProblems: 3,
  disputeAgeDays: 30,
} as const;

type CentreRef = { centreId: string; code: string; name: string };
export type CentreMonth = CentreRef & {
  month: string;
  revenue: Decimal;
  base: Decimal;
  charge: Decimal;
};
export type CentreBalance = CentreRef & { outstanding: Decimal; overdue: Decimal };

export type InsightInput = {
  /** The two most recent complete months, oldest first: [previous, latest]. */
  months: [string, string];
  monthly: CentreMonth[];
  balances: CentreBalance[];
  revenueLast12Months: Array<CentreRef & { revenue: Decimal }>;
  lateCentres: Array<CentreRef & { daysSince: number | null }>;
  lateAfterDays: number;
  unallocated: { count: number; total: Decimal; olderThanDays: number };
  importTroubles: Array<CentreRef & { count: number }>;
  oldDisputes: { count: number; total: Decimal };
};

const label = (c: CentreRef) => `${c.code} · ${c.name}`;
const naira = (value: Decimal) =>
  `₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(moneyString(value)))}`;
const change = (now: Decimal, before: Decimal) =>
  before.gt(0) ? now.minus(before).div(before).times(100) : null;
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Deterministic rules over figures the system already holds. Each insight names the periods it
 * compares and carries its evidence; nothing here estimates or predicts.
 */
export function deriveInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const [previous, latest] = input.months;
  const at = (c: CentreRef, month: string) =>
    input.monthly.find((m) => m.centreId === c.centreId && m.month === month);
  const centres = new Map<string, CentreRef>();
  for (const m of input.monthly) centres.set(m.centreId, m);

  // 1. Reported revenue moved sharply for a centre.
  for (const centre of centres.values()) {
    const now = at(centre, latest);
    const before = at(centre, previous);
    if (!now || !before) continue;
    const pct = change(now.revenue, before.revenue);
    if (pct === null) continue;
    if (pct.lte(-THRESHOLDS.revenueDropPct) || pct.gte(THRESHOLDS.revenueRisePct)) {
      const down = pct.isNegative();
      out.push({
        id: `revenue-${down ? 'drop' : 'rise'}-${centre.centreId}-${latest}`,
        area: 'Revenue',
        severity: down ? 'attention' : 'info',
        title: `${label(centre)}: reported revenue ${down ? 'fell' : 'rose'} ${pct.abs().toFixed(1)}%`,
        detail: `Reported revenue was ${naira(now.revenue)} in ${monthName(latest)} against ${naira(before.revenue)} in ${monthName(previous)}.${down ? ' Check that every report for the month has been uploaded before treating this as a real decline.' : ''}`,
        evidence: [
          { label: monthName(previous), value: moneyString(before.revenue) },
          { label: monthName(latest), value: moneyString(now.revenue) },
        ],
        centreId: centre.centreId,
        link: `/reports/revenue-reports?centreId=${centre.centreId}`,
      });
    }
  }

  // 2. The effective service-charge yield moved.
  for (const centre of centres.values()) {
    const now = at(centre, latest);
    const before = at(centre, previous);
    if (!now || !before || !now.base.gt(0) || !before.base.gt(0)) continue;
    const y1 = now.charge.div(now.base).times(100);
    const y0 = before.charge.div(before.base).times(100);
    if (y1.minus(y0).abs().gte(THRESHOLDS.yieldChangePoints)) {
      out.push({
        id: `yield-${centre.centreId}-${latest}`,
        area: 'Service charge',
        severity: 'info',
        title: `${label(centre)}: effective service-charge yield moved from ${y0.toFixed(2)}% to ${y1.toFixed(2)}%`,
        detail: `Posted charges were ${y1.toFixed(2)}% of the revenue base for periods ending in ${monthName(latest)} and ${y0.toFixed(2)}% for ${monthName(previous)}. A new rate, an exemption or a change in the department mix can cause this.`,
        evidence: [
          {
            label: `${monthName(previous)} charge on base`,
            value: `${moneyString(before.charge)} on ${moneyString(before.base)}`,
          },
          {
            label: `${monthName(latest)} charge on base`,
            value: `${moneyString(now.charge)} on ${moneyString(now.base)}`,
          },
        ],
        centreId: centre.centreId,
        link: `/reports/departmental-earnings?centreId=${centre.centreId}`,
      });
    }
  }

  // 3. A large share of a centre's debt is overdue.
  for (const b of input.balances) {
    if (!b.outstanding.gt(0)) continue;
    const share = b.overdue.div(b.outstanding).times(100);
    if (share.gte(THRESHOLDS.overdueShareAttentionPct)) {
      out.push({
        id: `overdue-share-${b.centreId}`,
        area: 'Receivables',
        severity: share.gte(THRESHOLDS.overdueShareUrgentPct) ? 'urgent' : 'attention',
        title: `${label(b)}: ${share.toFixed(1)}% of what it owes is overdue`,
        detail: `${naira(b.overdue)} of ${naira(b.outstanding)} outstanding is past its due date.`,
        evidence: [
          { label: 'Outstanding', value: moneyString(b.outstanding) },
          { label: 'Overdue', value: moneyString(b.overdue) },
        ],
        centreId: b.centreId,
        link: `/reports/overdue-receivables?centreId=${b.centreId}`,
      });
    }
  }

  // 4. One centre carries most of the revenue.
  const total12 = input.revenueLast12Months.reduce((t, r) => t.plus(r.revenue), new Decimal(0));
  if (input.revenueLast12Months.length > 1 && total12.gt(0)) {
    const top = [...input.revenueLast12Months].sort((a, b) => b.revenue.comparedTo(a.revenue))[0];
    const share = top.revenue.div(total12).times(100);
    if (share.gte(THRESHOLDS.concentrationPct)) {
      out.push({
        id: `concentration-${top.centreId}`,
        area: 'Revenue',
        severity: 'attention',
        title: `${label(top)} accounts for ${share.toFixed(1)}% of reported revenue`,
        detail: `Over the last 12 months it reported ${naira(top.revenue)} of ${naira(total12)}. Earnings depend heavily on this one centre.`,
        evidence: [
          { label: 'This centre', value: moneyString(top.revenue) },
          { label: 'All centres', value: moneyString(total12) },
        ],
        centreId: top.centreId,
        link: '/reports/revenue-concentration',
      });
    }
  }

  // 5. Centres that have not reported.
  if (input.lateCentres.length > 0) {
    out.push({
      id: 'late-reporting',
      area: 'Reporting',
      severity: input.lateCentres.some((c) => c.daysSince === null || c.daysSince > 14)
        ? 'urgent'
        : 'attention',
      title: `${input.lateCentres.length} centre${input.lateCentres.length === 1 ? ' has' : 's have'} not reported in over ${input.lateAfterDays} days`,
      detail: input.lateCentres
        .map(
          (c) => `${label(c)} (${c.daysSince === null ? 'never reported' : `${c.daysSince} days`})`,
        )
        .join('; '),
      evidence: input.lateCentres.map((c) => ({
        label: label(c),
        value: c.daysSince === null ? 'never' : `${c.daysSince} days`,
      })),
      centreId: null,
      link: '/reports/reporting-status',
    });
  }

  // 6. Cash received but not applied.
  if (input.unallocated.count > 0) {
    out.push({
      id: 'unallocated-cash',
      area: 'Control',
      severity: 'attention',
      title: `${naira(input.unallocated.total)} received has not been allocated for over ${input.unallocated.olderThanDays} days`,
      detail: `${input.unallocated.count} receipt${input.unallocated.count === 1 ? '' : 's'} hold cash that is not yet applied to any receivable, so balances look higher than they are.`,
      evidence: [
        { label: 'Receipts', value: String(input.unallocated.count) },
        { label: 'Unallocated', value: moneyString(input.unallocated.total) },
      ],
      centreId: null,
      link: '/reports/unallocated-receipts',
    });
  }

  // 7. A centre keeps sending reports that fail validation.
  for (const t of input.importTroubles) {
    if (t.count >= THRESHOLDS.repeatedImportProblems) {
      out.push({
        id: `import-trouble-${t.centreId}`,
        area: 'Control',
        severity: 'attention',
        title: `${label(t)}: ${t.count} uploads in 60 days failed validation`,
        detail:
          'Repeated rejected uploads usually mean the source report format or the centre set-up needs fixing, not just re-uploading.',
        evidence: [{ label: 'Uploads needing review', value: String(t.count) }],
        centreId: t.centreId,
        link: `/reports/import-errors?centreId=${t.centreId}`,
      });
    }
  }

  // 8. Disputes left open too long.
  if (input.oldDisputes.count > 0) {
    out.push({
      id: 'old-disputes',
      area: 'Receivables',
      severity: 'attention',
      title: `${input.oldDisputes.count} dispute${input.oldDisputes.count === 1 ? ' has' : 's have'} been open for over ${THRESHOLDS.disputeAgeDays} days`,
      detail: `${naira(input.oldDisputes.total)} is held in dispute and cannot be treated as collectable until resolved.`,
      evidence: [{ label: 'Amount disputed', value: moneyString(input.oldDisputes.total) }],
      centreId: null,
      link: '/adjustments?tab=disputes&status=OPEN',
    });
  }

  const rank = { urgent: 0, attention: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
