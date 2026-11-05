import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { ageingBucket, daysOverdue } from '../common/utils/ageing';
import { parseDate } from '../common/utils/dates';
import { moneyString } from '../common/utils/money';
import {
  BUCKET_LABEL,
  capped,
  hospitalIdScope,
  hospitalLabel,
  col,
  dateRange,
  dec,
  iso,
  scopeOf,
  timeRange,
  zero,
} from './report-definitions';
import { MAX_REPORT_ROWS, ReportContext, ReportDefinition, ReportRow } from './report-types';

const pct = (part: Decimal, whole: Decimal) =>
  whole.gt(0) ? part.div(whole).times(100).toFixed(1) : null;
const sortDesc = (a: Decimal, b: Decimal) => b.comparedTo(a);

/** Committed revenue lines in scope, with their department and hospital. */
async function revenueLines(ctx: ReportContext) {
  const range = dateRange(ctx);
  return capped(
    await ctx.prisma.revenueLine.findMany({
      where: {
        report: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          status: 'COMMITTED',
          ...(range?.gte ? { periodStart: { gte: range.gte } } : {}),
          ...(range?.lte ? { periodEnd: { lte: range.lte } } : {}),
        },
      },
      include: {
        department: { select: { code: true, name: true } },
        report: { select: { hospital: { select: { code: true, name: true } } } },
      },
      take: MAX_REPORT_ROWS + 1,
    }),
  );
}

const REVENUE_NOTE =
  'Reported revenue as printed by each hospital in its committed reports; not verified against patient-level records or bank deposits.';

const departmentAnalysis: ReportDefinition = {
  id: 'department-revenue',
  title: 'Department revenue analysis',
  description: 'Reported revenue by department with its share of the total.',
  category: 'Revenue',
  dateBasis: 'Report period (reports wholly inside the range)',
  filters: ['hospitalId', 'from', 'to'],
  requires: [],
  totals: ['revenue'],
  async run(ctx) {
    const lines = await revenueLines(ctx);
    const grouped = new Map<string, { label: string; revenue: Decimal; hospitals: Set<string> }>();
    for (const line of lines) {
      const key = line.department.name.trim().toUpperCase();
      const entry = grouped.get(key) ?? {
        label: line.department.name,
        revenue: zero(),
        hospitals: new Set(),
      };
      entry.revenue = entry.revenue.plus(dec(line.reportedTotal));
      entry.hospitals.add(line.report.hospital.code);
      grouped.set(key, entry);
    }
    const total = [...grouped.values()].reduce((t, e) => t.plus(e.revenue), zero());
    const rows = [...grouped.values()]
      .sort((a, b) => sortDesc(a.revenue, b.revenue))
      .map((e) => ({
        department: e.label,
        hospitals: e.hospitals.size,
        revenue: moneyString(e.revenue),
        share: pct(e.revenue, total),
      }));
    return {
      columns: [
        col('department', 'Department'),
        col('hospitals', 'Hospitals reporting it', 'int'),
        col('revenue', 'Reported revenue', 'money'),
        col('share', 'Share of total (%)', 'percent'),
      ],
      rows,
      notes: [REVENUE_NOTE, 'Departments with the same name in different hospitals are combined.'],
    };
  },
};

const channelAnalysis: ReportDefinition = {
  id: 'channel-revenue',
  title: 'Payment-channel analysis',
  description: 'Reported revenue by payment channel with its share of the total.',
  category: 'Revenue',
  dateBasis: 'Report period (reports wholly inside the range)',
  filters: ['hospitalId', 'from', 'to'],
  requires: [],
  totals: ['revenue'],
  async run(ctx) {
    const lines = await revenueLines(ctx);
    const grouped = new Map<string, Decimal>();
    for (const line of lines) {
      for (const [code, value] of Object.entries(
        (line.amountsJson ?? {}) as Record<string, string>,
      )) {
        grouped.set(code, (grouped.get(code) ?? zero()).plus(value));
      }
    }
    const total = [...grouped.values()].reduce((t, v) => t.plus(v), zero());
    const rows = [...grouped.entries()]
      .sort((a, b) => sortDesc(a[1], b[1]))
      .map(([code, revenue]) => ({
        channel: code,
        revenue: moneyString(revenue),
        share: pct(revenue, total),
      }));
    return {
      columns: [
        col('channel', 'Channel'),
        col('revenue', 'Reported revenue', 'money'),
        col('share', 'Share of total (%)', 'percent'),
      ],
      rows,
      notes: [REVENUE_NOTE],
    };
  },
};

const concentration: ReportDefinition = {
  id: 'revenue-concentration',
  title: 'Revenue concentration',
  description: 'How much of reported revenue and expected service charge depends on each hospital.',
  category: 'Performance',
  dateBasis: 'Report period end and charge period end',
  filters: ['from', 'to'],
  requires: ['charge_runs.read'],
  totals: ['revenue', 'charges'],
  async run(ctx) {
    const range = dateRange(ctx);
    const org = ctx.user.organizationId;
    const scope = scopeOf(ctx);
    const [hospitals, revenue, charges] = await Promise.all([
      ctx.prisma.hospital.findMany({
        where: { organizationId: org, ...hospitalIdScope(ctx) },
        select: { id: true, code: true, name: true },
      }),
      ctx.prisma.revenueReport.groupBy({
        by: ['hospitalId'],
        where: {
          organizationId: org,
          ...scope,
          status: 'COMMITTED',
          ...(range?.gte ? { periodStart: { gte: range.gte } } : {}),
          ...(range?.lte ? { periodEnd: { lte: range.lte } } : {}),
        },
        _sum: { grandTotal: true },
      }),
      ctx.prisma.chargeRun.groupBy({
        by: ['hospitalId'],
        where: { organizationId: org, ...scope, status: 'POSTED', periodEnd: range },
        _sum: { chargeTotal: true },
      }),
    ]);
    const rev = new Map(revenue.map((r) => [r.hospitalId, dec(r._sum.grandTotal)]));
    const chg = new Map(charges.map((r) => [r.hospitalId, dec(r._sum.chargeTotal)]));
    const totalRev = [...rev.values()].reduce((t, v) => t.plus(v), zero());
    const totalChg = [...chg.values()].reduce((t, v) => t.plus(v), zero());
    let cumulative = zero();
    const rows = hospitals
      .map((c) => ({ c, r: rev.get(c.id) ?? zero(), g: chg.get(c.id) ?? zero() }))
      .sort((a, b) => sortDesc(a.r, b.r))
      .map(({ c, r, g }) => {
        cumulative = cumulative.plus(r);
        return {
          hospital: hospitalLabel(c),
          revenue: moneyString(r),
          revenueShare: pct(r, totalRev),
          cumulativeShare: pct(cumulative, totalRev),
          charges: moneyString(g),
          chargeShare: pct(g, totalChg),
        };
      });
    return {
      columns: [
        col('hospital', 'Hospital'),
        col('revenue', 'Reported revenue', 'money'),
        col('revenueShare', 'Share of revenue (%)', 'percent'),
        col('cumulativeShare', 'Cumulative share (%)', 'percent'),
        col('charges', 'Expected charges (posted)', 'money'),
        col('chargeShare', 'Share of charges (%)', 'percent'),
      ],
      rows,
      notes: [
        REVENUE_NOTE,
        'Hospitals are ordered by reported revenue; the cumulative share shows how few hospitals carry most of it.',
      ],
    };
  },
};

const revenueRegister: ReportDefinition = {
  id: 'revenue-reports',
  title: 'Committed revenue reports',
  description: 'Every committed revenue report: period, days covered, totals and source file.',
  category: 'Revenue',
  dateBasis: 'Report period end',
  filters: ['hospitalId', 'from', 'to'],
  requires: [],
  totals: ['grand', 'channels'],
  async run(ctx) {
    const reports = capped(
      await ctx.prisma.revenueReport.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          status: 'COMMITTED',
          periodEnd: dateRange(ctx),
        },
        include: {
          hospital: { select: { code: true, name: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ periodStart: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('hospital', 'Hospital'),
        col('start', 'Period start', 'date'),
        col('end', 'Period end', 'date'),
        col('days', 'Days covered', 'int'),
        col('departments', 'Departments', 'int'),
        col('grand', 'Reported total', 'money'),
        col('channels', 'Sum of channels', 'money'),
        col('variance', 'Approved variance'),
        col('file', 'Source file'),
      ],
      rows: reports.map((r) => ({
        hospital: hospitalLabel(r.hospital),
        start: iso(r.periodStart),
        end: iso(r.periodEnd),
        variance: r.varianceApprovedAt ? `Yes, ${iso(r.varianceApprovedAt)}` : '',
        days: Math.round((r.periodEnd.getTime() - r.periodStart.getTime()) / 86_400_000) + 1,
        departments: r._count.lines,
        grand: moneyString(dec(r.grandTotal)),
        channels: moneyString(dec(r.channelTotal)),
        file: r.sourceFileName ?? '',
      })),
      notes: [
        'A report may cover one day or a longer period; figures are never spread across days.',
        'Reports marked "Approved variance" were committed although their printed totals did not add up. Their totals here are the sum of the channel amounts; the printed totals and the reason are on the import.',
      ],
    };
  },
};

const submissionRegister: ReportDefinition = {
  id: 'submission-register',
  title: 'Report submission register',
  description:
    'Every upload: who sent it, when, its period, validation result and whether it was committed.',
  category: 'Revenue',
  dateBasis: 'Upload date',
  filters: ['hospitalId', 'from', 'to', 'status'],
  statuses: ['ALL', 'READY_TO_COMMIT', 'NEEDS_REVIEW', 'COMMITTED', 'FAILED'],
  requires: ['imports.read'],
  async run(ctx) {
    const status = ctx.filters.status ?? 'ALL';
    const batches = capped(
      await ctx.prisma.importBatch.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          createdAt: timeRange(ctx),
          ...(status === 'ALL' ? {} : { status: status as never }),
        },
        include: {
          hospital: { select: { code: true, name: true } },
          createdBy: { select: { fullName: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('uploaded', 'Uploaded', 'date'),
        col('hospital', 'Hospital'),
        col('file', 'File'),
        col('start', 'Period start', 'date'),
        col('end', 'Period end', 'date'),
        col('status', 'Status'),
        col('errors', 'Errors', 'int'),
        col('warnings', 'Warnings', 'int'),
        col('total', 'Total', 'money'),
        col('by', 'Uploaded by'),
      ],
      rows: batches.map((b) => {
        const v = (b.validationJson ?? {}) as { errors?: unknown[]; warnings?: unknown[] };
        return {
          uploaded: iso(b.createdAt),
          hospital: hospitalLabel(b.hospital),
          file: b.fileName ?? '',
          start: iso(b.periodStart),
          end: iso(b.periodEnd),
          status: b.status.replace(/_/g, ' ').toLowerCase(),
          errors: v.errors?.length ?? 0,
          warnings: v.warnings?.length ?? 0,
          total: b.totalAmount ? moneyString(dec(b.totalAmount)) : null,
          by: b.createdBy.fullName,
        };
      }),
    };
  },
};

const importErrors: ReportDefinition = {
  id: 'import-errors',
  title: 'Import error report',
  description:
    'Row-level problems found in uploads that have not been committed, with what to correct.',
  category: 'Revenue',
  dateBasis: 'Upload date',
  filters: ['hospitalId', 'from', 'to'],
  requires: ['imports.read'],
  async run(ctx) {
    const batches = await ctx.prisma.importBatch.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        ...scopeOf(ctx),
        createdAt: timeRange(ctx),
        status: { in: ['NEEDS_REVIEW', 'FAILED'] },
      },
      select: {
        fileName: true,
        createdAt: true,
        validationJson: true,
        hospital: { select: { code: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    const rows: ReportRow[] = [];
    for (const batch of batches) {
      const errors =
        (
          (batch.validationJson ?? {}) as {
            errors?: Array<{ row?: number; field?: string; code: string; message: string }>;
          }
        ).errors ?? [];
      for (const e of errors) {
        rows.push({
          uploaded: iso(batch.createdAt),
          hospital: hospitalLabel(batch.hospital),
          file: batch.fileName ?? '',
          row: e.row ?? null,
          field: e.field ?? '',
          code: e.code,
          message: e.message,
        });
      }
    }
    return {
      columns: [
        col('uploaded', 'Uploaded', 'date'),
        col('hospital', 'Hospital'),
        col('file', 'File'),
        col('row', 'Row', 'int'),
        col('field', 'Field'),
        col('code', 'Problem code'),
        col('message', 'What is wrong'),
      ],
      rows: capped(rows),
      notes: [
        'Lists uploads still waiting for correction. Corrected figures must come from a re-exported source report; the system never adjusts them.',
      ],
    };
  },
};

const variance: ReportDefinition = {
  id: 'revenue-variance',
  title: 'Revenue variance and data quality',
  description:
    'Department lines whose printed total differs from the sum of their channel figures.',
  category: 'Revenue',
  dateBasis: 'Report period (reports wholly inside the range)',
  filters: ['hospitalId', 'from', 'to'],
  requires: [],
  totals: ['reported', 'channels', 'variance'],
  async run(ctx) {
    const lines = (await revenueLines(ctx)).filter((l) => !dec(l.variance).isZero());
    return {
      columns: [
        col('hospital', 'Hospital'),
        col('department', 'Department'),
        col('reported', 'Printed total', 'money'),
        col('channels', 'Sum of channels', 'money'),
        col('variance', 'Difference', 'money'),
      ],
      rows: lines.map((l) => ({
        hospital: hospitalLabel(l.report.hospital),
        department: l.department.name,
        reported: moneyString(dec(l.reportedTotal)),
        channels: moneyString(dec(l.channelTotal)),
        variance: moneyString(dec(l.variance)),
      })),
      notes: [
        'Reports with a difference above one kobo cannot be committed, so lines shown here are within the rounding tolerance.',
      ],
    };
  },
};

const departmentEarnings: ReportDefinition = {
  id: 'departmental-earnings',
  title: 'Departmental earnings and yield',
  description:
    'Service charge earned by department, its share of the total, and the effective yield on its revenue base.',
  category: 'Service charges',
  dateBasis: 'End of the charge-run period',
  filters: ['hospitalId', 'from', 'to'],
  requires: ['charge_runs.read'],
  totals: ['base', 'charge'],
  async run(ctx) {
    const lines = capped(
      await ctx.prisma.chargeLine.findMany({
        where: {
          chargeRun: {
            organizationId: ctx.user.organizationId,
            ...scopeOf(ctx),
            status: 'POSTED',
            periodEnd: dateRange(ctx),
          },
        },
        include: { department: { select: { name: true } } },
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    const grouped = new Map<string, { label: string; base: Decimal; charge: Decimal }>();
    for (const line of lines) {
      const key = line.department.name.trim().toUpperCase();
      const entry = grouped.get(key) ?? {
        label: line.department.name,
        base: zero(),
        charge: zero(),
      };
      entry.base = entry.base.plus(dec(line.baseAmount));
      entry.charge = entry.charge.plus(dec(line.chargeAmount));
      grouped.set(key, entry);
    }
    const total = [...grouped.values()].reduce((t, e) => t.plus(e.charge), zero());
    return {
      columns: [
        col('department', 'Department'),
        col('base', 'Revenue base', 'money'),
        col('charge', 'Service charge', 'money'),
        col('share', 'Share of charges (%)', 'percent'),
        col('yield', 'Effective yield (%)', 'percent'),
      ],
      rows: [...grouped.values()]
        .sort((a, b) => sortDesc(a.charge, b.charge))
        .map((e) => ({
          department: e.label,
          base: moneyString(e.base),
          charge: moneyString(e.charge),
          share: pct(e.charge, total),
          yield: pct(e.charge, e.base),
        })),
      notes: [
        'Posted charge runs only. Yield is service charge divided by the revenue base it was calculated on.',
      ],
    };
  },
};

const ruleConfiguration: ReportDefinition = {
  id: 'commercial-configuration',
  title: 'Commercial configuration and rule history',
  description:
    'Every agreement and charge rule with its rate, scope and effective dates, current and historical.',
  category: 'Service charges',
  dateBasis: 'Not date filtered',
  filters: ['hospitalId'],
  requires: ['charge_rules.read'],
  async run(ctx) {
    const hospitalScope = scopeOf(ctx);
    const rules = capped(
      await ctx.prisma.chargeRule.findMany({
        where: { hospital: { organizationId: ctx.user.organizationId }, ...hospitalScope },
        include: {
          hospital: { select: { code: true, name: true } },
          department: { select: { name: true } },
          paymentChannel: { select: { code: true } },
          agreement: { select: { name: true, status: true } },
        },
        orderBy: [{ hospitalId: 'asc' }, { effectiveFrom: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    ) as unknown as Array<{
      name: string;
      rate: Prisma.Decimal;
      basis: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      isActive: boolean;
      priority: number;
      hospital: { code: string; name: string };
      department: { name: string } | null;
      paymentChannel: { code: string } | null;
      agreement: { name: string; status: string } | null;
    }>;
    const today = parseDate(ctx.today, 'today');
    return {
      columns: [
        col('hospital', 'Hospital'),
        col('agreement', 'Agreement'),
        col('rule', 'Rule'),
        col('scope', 'Applies to'),
        col('rate', 'Rate (%)', 'percent'),
        col('from', 'Effective from', 'date'),
        col('to', 'Effective to', 'date'),
        col('state', 'State'),
      ],
      rows: rules.map((r) => ({
        hospital: hospitalLabel(r.hospital),
        agreement: r.agreement ? `${r.agreement.name} (${r.agreement.status.toLowerCase()})` : '',
        rule: r.name,
        scope: [
          r.department?.name ?? 'all departments',
          r.paymentChannel?.code ?? 'all channels',
        ].join(' · '),
        rate: dec(r.rate).toFixed(2),
        from: iso(r.effectiveFrom),
        to: r.effectiveTo ? iso(r.effectiveTo) : null,
        state: !r.isActive
          ? 'inactive'
          : r.effectiveFrom > today
            ? 'future'
            : r.effectiveTo && r.effectiveTo < today
              ? 'expired'
              : 'current',
      })),
      notes: [
        'Rules are never edited in place once used; changes appear as new rules with new effective dates.',
      ],
    };
  },
};

const overdueReceivables: ReportDefinition = {
  id: 'overdue-receivables',
  title: 'Overdue receivables',
  description:
    'Balances past their due date, longest overdue first, with the hospital’s payment terms.',
  category: 'Receivables',
  dateBasis: 'Due date',
  filters: ['hospitalId'],
  requires: ['receivables.read'],
  totals: ['balance'],
  async run(ctx) {
    const asAt = parseDate(ctx.today, 'asAt');
    const items = capped(
      await ctx.prisma.receivable.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          balance: { gt: 0 },
          dueDate: { lt: asAt },
        },
        include: { hospital: { select: { code: true, name: true, paymentTermsDays: true } } },
        orderBy: [{ dueDate: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('hospital', 'Hospital'),
        col('terms', 'Terms (days)', 'int'),
        col('reference', 'Reference'),
        col('due', 'Due date', 'date'),
        col('days', 'Days overdue', 'int'),
        col('bucket', 'Ageing'),
        col('balance', 'Balance', 'money'),
        col('disputed', 'Disputed'),
      ],
      rows: items.map((i) => ({
        hospital: hospitalLabel(i.hospital),
        terms: i.hospital.paymentTermsDays,
        reference: i.reference,
        due: iso(i.dueDate),
        days: daysOverdue(i.dueDate, asAt),
        bucket: BUCKET_LABEL[ageingBucket(i.dueDate, asAt, dec(i.balance))],
        balance: moneyString(dec(i.balance)),
        disputed: i.status === 'DISPUTED' ? 'yes' : '',
      })),
      notes: [
        `Overdue means past the due date as at ${ctx.today}. Disputed items remain owed but are flagged.`,
      ],
    };
  },
};

const settlementHistory: ReportDefinition = {
  id: 'settlement-history',
  title: 'Partial payments and settlement history',
  description: 'Receivables that have received payments: how many, when, and what remains.',
  category: 'Payments',
  dateBasis: 'Due date',
  filters: ['hospitalId', 'from', 'to'],
  requires: ['receivables.read', 'payments.read'],
  totals: ['due', 'paid', 'balance'],
  async run(ctx) {
    const items = capped(
      await ctx.prisma.receivable.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          amountPaid: { gt: 0 },
          dueDate: dateRange(ctx),
        },
        include: {
          hospital: { select: { code: true, name: true } },
          allocations: { where: { reversedAt: null }, select: { allocatedAt: true } },
        },
        orderBy: [{ dueDate: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('hospital', 'Hospital'),
        col('reference', 'Reference'),
        col('dueDate', 'Due date', 'date'),
        col('due', 'Amount due', 'money'),
        col('paid', 'Paid', 'money'),
        col('balance', 'Balance', 'money'),
        col('payments', 'Payments', 'int'),
        col('first', 'First payment', 'date'),
        col('last', 'Latest payment', 'date'),
        col('state', 'State'),
      ],
      rows: items.map((i) => {
        const dates = i.allocations.map((a) => a.allocatedAt.getTime()).sort((a, b) => a - b);
        return {
          hospital: hospitalLabel(i.hospital),
          reference: i.reference,
          dueDate: iso(i.dueDate),
          due: moneyString(dec(i.originalAmount).plus(dec(i.adjustmentTotal))),
          paid: moneyString(dec(i.amountPaid)),
          balance: moneyString(dec(i.balance)),
          payments: i.allocations.length,
          first: dates.length ? iso(new Date(dates[0])) : null,
          last: dates.length ? iso(new Date(dates[dates.length - 1])) : null,
          state: dec(i.balance).isZero() ? 'settled' : 'partly paid',
        };
      }),
    };
  },
};

const paymentBehaviour: ReportDefinition = {
  id: 'payment-behaviour',
  title: 'Collection delay and payment-terms compliance',
  description:
    'For settled receivables: how long after the due date each hospital pays, and how often on time.',
  category: 'Performance',
  dateBasis: 'Due date',
  filters: ['hospitalId', 'from', 'to'],
  requires: ['receivables.read', 'payments.read'],
  async run(ctx) {
    const items = capped(
      await ctx.prisma.receivable.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          balance: { equals: 0 },
          amountPaid: { gt: 0 },
          dueDate: dateRange(ctx),
        },
        include: {
          hospital: { select: { id: true, code: true, name: true, paymentTermsDays: true } },
          allocations: { where: { reversedAt: null }, select: { allocatedAt: true } },
        },
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    const byHospital = new Map<
      string,
      {
        label: string;
        count: number;
        onTime: number;
        weighted: Decimal;
        weight: Decimal;
        worst: number;
      }
    >();
    for (const item of items) {
      const settled = Math.max(...item.allocations.map((a) => a.allocatedAt.getTime()));
      if (!Number.isFinite(settled)) continue;
      const delay = Math.round((settled - item.dueDate.getTime()) / 86_400_000);
      const entry = byHospital.get(item.hospital.id) ?? {
        label: hospitalLabel(item.hospital),
        count: 0,
        onTime: 0,
        weighted: zero(),
        weight: zero(),
        worst: -9999,
      };
      const amount = dec(item.originalAmount).plus(dec(item.adjustmentTotal));
      entry.count += 1;
      if (delay <= 0) entry.onTime += 1;
      entry.weighted = entry.weighted.plus(amount.times(delay));
      entry.weight = entry.weight.plus(amount);
      entry.worst = Math.max(entry.worst, delay);
      byHospital.set(item.hospital.id, entry);
    }
    return {
      columns: [
        col('hospital', 'Hospital'),
        col('settled', 'Settled receivables', 'int'),
        col('onTime', 'Paid by the due date', 'int'),
        col('onTimePct', 'On-time share (%)', 'percent'),
        col('delay', 'Average days after due date (amount-weighted)', 'int'),
        col('worst', 'Longest delay (days)', 'int'),
      ],
      rows: [...byHospital.values()]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((e) => ({
          hospital: e.label,
          settled: e.count,
          onTime: e.onTime,
          onTimePct: pct(new Decimal(e.onTime), new Decimal(e.count)),
          delay: e.weight.gt(0) ? Math.round(e.weighted.div(e.weight).toNumber()) : null,
          worst: e.worst,
        })),
      notes: [
        'Uses the date of the last payment allocated to each fully settled receivable. A negative average means payment before the due date. Only settled receivables are counted, so hospitals with nothing settled yet do not appear.',
      ],
    };
  },
};

const adjustmentRegister: ReportDefinition = {
  id: 'adjustment-register',
  title: 'Credit, debit and reversal report',
  description: 'Adjustments with their reasons and approvals, and reversals posted to the ledger.',
  category: 'Receivables',
  dateBasis: 'Proposal date for adjustments; posting date for reversals',
  filters: ['hospitalId', 'from', 'to'],
  requires: ['receivables.read', 'adjustments.read'],
  totals: ['amount'],
  async run(ctx) {
    const [adjustments, reversals] = await Promise.all([
      ctx.prisma.adjustment.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          createdAt: timeRange(ctx),
        },
        include: {
          hospital: { select: { code: true, name: true } },
          receivable: { select: { reference: true } },
          createdBy: { select: { fullName: true } },
          decidedBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_REPORT_ROWS + 1,
      }),
      ctx.prisma.ledgerEntry.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          type: 'REVERSAL',
          occurredAt: timeRange(ctx),
        },
        include: {
          hospital: { select: { code: true, name: true } },
          receivable: { select: { reference: true } },
        },
        orderBy: { occurredAt: 'asc' },
        take: MAX_REPORT_ROWS + 1,
      }),
    ]);
    const rows: ReportRow[] = [
      ...adjustments.map((a) => ({
        date: iso(a.createdAt),
        hospital: hospitalLabel(a.hospital),
        receivable: a.receivable.reference,
        kind: `${a.type.toLowerCase()} adjustment`,
        amount: moneyString(dec(a.amount)),
        status: a.status.toLowerCase(),
        reason: `${a.reasonCode.replace(/_/g, ' ').toLowerCase()}: ${a.reason}`,
        by: a.createdBy.fullName,
        approver: a.decidedBy?.fullName ?? '',
      })),
      ...reversals.map((r) => ({
        date: iso(r.occurredAt),
        hospital: hospitalLabel(r.hospital),
        receivable: r.receivable.reference,
        kind: 'allocation reversal',
        amount: moneyString(dec(r.debit)),
        status: 'posted',
        reason: r.description,
        by: '',
        approver: '',
      })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return {
      columns: [
        col('date', 'Date', 'date'),
        col('hospital', 'Hospital'),
        col('receivable', 'Receivable'),
        col('kind', 'Kind'),
        col('amount', 'Amount', 'money'),
        col('status', 'Status'),
        col('reason', 'Reason'),
        col('by', 'Proposed by'),
        col('approver', 'Decided by'),
      ],
      rows: capped(rows),
      notes: [
        'The totals row adds every line shown, including proposals not yet approved and rejected ones; filter in a spreadsheet to total only approved items.',
      ],
    };
  },
};

const pendingActions: ReportDefinition = {
  id: 'pending-actions',
  title: 'Approval and pending action report',
  description: 'Everything waiting for a decision or a next step, and how long it has waited.',
  category: 'Performance',
  filters: ['hospitalId'],
  requires: ['imports.read'],
  async run(ctx) {
    const org = ctx.user.organizationId;
    const scope = scopeOf(ctx);
    const today = parseDate(ctx.today, 'today');
    const age = (date: Date) =>
      Math.max(0, Math.round((today.getTime() - date.getTime()) / 86_400_000));
    const [imports, runs, payments, adjustments, openings] = await Promise.all([
      ctx.prisma.importBatch.findMany({
        where: {
          organizationId: org,
          ...scope,
          status: { in: ['READY_TO_COMMIT', 'NEEDS_REVIEW'] },
        },
        select: {
          fileName: true,
          status: true,
          createdAt: true,
          hospital: { select: { code: true, name: true } },
          createdBy: { select: { fullName: true } },
        },
        take: 500,
      }),
      ctx.prisma.chargeRun.findMany({
        where: { organizationId: org, ...scope, status: { in: ['SUBMITTED', 'APPROVED'] } },
        select: {
          status: true,
          createdAt: true,
          periodStart: true,
          periodEnd: true,
          hospital: { select: { code: true, name: true } },
          createdBy: { select: { fullName: true } },
        },
        take: 500,
      }),
      ctx.prisma.payment.findMany({
        where: { organizationId: org, ...scope, status: { in: ['SUBMITTED', 'APPROVED'] } },
        select: {
          status: true,
          reference: true,
          amount: true,
          createdAt: true,
          hospital: { select: { code: true, name: true } },
          createdBy: { select: { fullName: true } },
        },
        take: 500,
      }),
      ctx.prisma.adjustment.findMany({
        where: { organizationId: org, ...scope, status: 'PENDING' },
        select: {
          type: true,
          amount: true,
          createdAt: true,
          receivable: { select: { reference: true } },
          hospital: { select: { code: true, name: true } },
          createdBy: { select: { fullName: true } },
        },
        take: 500,
      }),
      ctx.prisma.openingBalance.findMany({
        where: { organizationId: org, ...scope, status: 'PENDING' },
        select: {
          asAt: true,
          amount: true,
          createdAt: true,
          hospital: { select: { code: true, name: true } },
          createdBy: { select: { fullName: true } },
        },
        take: 500,
      }),
    ]);
    const rows: ReportRow[] = [
      ...imports.map((i) => ({
        kind: 'Revenue import',
        hospital: hospitalLabel(i.hospital),
        item: i.fileName ?? '',
        waiting:
          i.status === 'READY_TO_COMMIT'
            ? 'commit by a second person'
            : 'errors to correct and re-upload',
        amount: null,
        since: iso(i.createdAt),
        days: age(i.createdAt),
        by: i.createdBy.fullName,
      })),
      ...runs.map((r) => ({
        kind: 'Charge run',
        hospital: hospitalLabel(r.hospital),
        item: `${iso(r.periodStart)} to ${iso(r.periodEnd)}`,
        waiting: r.status === 'SUBMITTED' ? 'approval' : 'posting',
        amount: null,
        since: iso(r.createdAt),
        days: age(r.createdAt),
        by: r.createdBy.fullName,
      })),
      ...payments.map((p) => ({
        kind: 'Receipt',
        hospital: hospitalLabel(p.hospital),
        item: p.reference ?? '',
        waiting: p.status === 'SUBMITTED' ? 'approval' : 'posting',
        amount: moneyString(dec(p.amount)),
        since: iso(p.createdAt),
        days: age(p.createdAt),
        by: p.createdBy.fullName,
      })),
      ...adjustments.map((a) => ({
        kind: `${a.type === 'CREDIT' ? 'Credit' : 'Debit'} adjustment`,
        hospital: hospitalLabel(a.hospital),
        item: a.receivable.reference,
        waiting: 'approval',
        amount: moneyString(dec(a.amount)),
        since: iso(a.createdAt),
        days: age(a.createdAt),
        by: a.createdBy.fullName,
      })),
      ...openings.map((o) => ({
        kind: 'Opening balance',
        hospital: hospitalLabel(o.hospital),
        item: `as at ${iso(o.asAt)}`,
        waiting: 'approval',
        amount: moneyString(dec(o.amount)),
        since: iso(o.createdAt),
        days: age(o.createdAt),
        by: o.createdBy.fullName,
      })),
    ].sort((a, b) => Number(b.days) - Number(a.days));
    return {
      columns: [
        col('kind', 'Kind'),
        col('hospital', 'Hospital'),
        col('item', 'Item'),
        col('waiting', 'Waiting for'),
        col('amount', 'Amount', 'money'),
        col('since', 'Since', 'date'),
        col('days', 'Days waiting', 'int'),
        col('by', 'Prepared by'),
      ],
      rows,
      notes: [
        'Longest-waiting first. Items you prepared yourself must be decided by someone else.',
      ],
    };
  },
};

const accessReport: ReportDefinition = {
  id: 'user-access',
  title: 'User access and permission report',
  description: 'Every user with their roles, hospital scope and last sign-in, for access reviews.',
  category: 'Performance',
  filters: [],
  requires: ['users.read'],
  async run(ctx) {
    const users = await ctx.prisma.user.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: {
        fullName: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
        roleAssignments: { select: { hospitalId: true, role: { select: { name: true } } } },
      },
      orderBy: { fullName: 'asc' },
      take: 2000,
    });
    const hospitals = await ctx.prisma.hospital.findMany({
      where: { organizationId: ctx.user.organizationId },
      select: { id: true, code: true },
    });
    const code = new Map(hospitals.map((c) => [c.id, c.code]));
    return {
      columns: [
        col('name', 'Name'),
        col('email', 'Email'),
        col('state', 'Account'),
        col('roles', 'Roles and scope'),
        col('last', 'Last sign-in', 'date'),
      ],
      rows: users.map((u) => ({
        name: u.fullName,
        email: u.email,
        state: u.isActive ? 'active' : 'inactive',
        roles: u.roleAssignments
          .map(
            (a) =>
              `${a.role.name} (${a.hospitalId ? (code.get(a.hospitalId) ?? 'one hospital') : 'all hospitals'})`,
          )
          .join('; '),
        last: u.lastLoginAt ? iso(u.lastLoginAt) : null,
      })),
      notes: [
        'Active accounts that have never signed in, or have not signed in for a long time, are candidates for review.',
      ],
    };
  },
};

const hospitalStatement: ReportDefinition = {
  id: 'hospital-statement',
  title: 'Statement of account by hospital',
  description:
    'Opening balance, every charge, adjustment, payment and reversal in the period, and the closing balance.',
  category: 'Receivables',
  dateBasis: 'Posting date',
  filters: ['hospitalId', 'from', 'to'],
  requiresHospital: true,
  requires: ['receivables.read'],
  async run(ctx) {
    const from = ctx.filters.from ? parseDate(ctx.filters.from, 'from') : null;
    const range = timeRange(ctx);
    const where = { organizationId: ctx.user.organizationId, ...scopeOf(ctx) };
    const [opening, entries] = await Promise.all([
      from
        ? ctx.prisma.ledgerEntry.aggregate({
            where: { ...where, occurredAt: { lt: from } },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve({ _sum: { debit: null, credit: null } }),
      ctx.prisma.ledgerEntry.findMany({
        where: { ...where, occurredAt: range },
        include: { receivable: { select: { reference: true } } },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    ]);
    capped(entries);
    let running = dec(opening._sum.debit).minus(dec(opening._sum.credit));
    const rows: ReportRow[] = [
      {
        date: from ? iso(from) : null,
        receivable: '',
        type: 'opening balance',
        description: from ? 'Balance brought forward' : 'Start of records',
        debit: null,
        credit: null,
        balance: moneyString(running),
      },
    ];
    for (const e of entries) {
      running = running.plus(dec(e.debit)).minus(dec(e.credit));
      rows.push({
        date: iso(e.occurredAt),
        receivable: e.receivable.reference,
        type: e.type.replace(/_/g, ' ').toLowerCase(),
        description: e.description,
        debit: dec(e.debit).gt(0) ? moneyString(dec(e.debit)) : null,
        credit: dec(e.credit).gt(0) ? moneyString(dec(e.credit)) : null,
        balance: moneyString(running),
      });
    }
    rows.push({
      date: ctx.filters.to ?? ctx.today,
      receivable: '',
      type: 'closing balance',
      description: 'Amount owed at the end of the period',
      debit: null,
      credit: null,
      balance: moneyString(running),
    });
    return {
      columns: [
        col('date', 'Date', 'date'),
        col('receivable', 'Receivable'),
        col('type', 'Entry'),
        col('description', 'Description'),
        col('debit', 'Charges and debits', 'money'),
        col('credit', 'Payments and credits', 'money'),
        col('balance', 'Running balance', 'money'),
      ],
      rows,
      notes: [
        'The closing balance equals debits less credits in the ledger and agrees with the hospital’s receivables as at the end date.',
      ],
    };
  },
};

const exemptions: ReportDefinition = {
  id: 'exemptions',
  title: 'Exemptions and overrides',
  description:
    'Departments and channels exempt from the service charge, why they matter, and the revenue they kept out of the charge base.',
  category: 'Service charges',
  dateBasis: 'Not date filtered',
  filters: ['hospitalId'],
  requires: ['charge_rules.read', 'charge_runs.read'],
  totals: ['exemptBase'],
  async run(ctx) {
    const rules = capped(
      await ctx.prisma.chargeRule.findMany({
        where: {
          hospital: { organizationId: ctx.user.organizationId },
          ...scopeOf(ctx),
          isExempt: true,
        },
        include: {
          hospital: { select: { code: true, name: true } },
          department: { select: { name: true } },
          paymentChannel: { select: { code: true } },
          agreement: { select: { name: true } },
        },
        orderBy: [{ hospitalId: 'asc' }, { effectiveFrom: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    const used = await ctx.prisma.chargeLine.groupBy({
      by: ['ruleId'],
      where: { ruleId: { in: rules.map((r) => r.id) }, chargeRun: { status: 'POSTED' } },
      _sum: { baseAmount: true },
    });
    const base = new Map(used.map((u) => [u.ruleId, dec(u._sum.baseAmount)]));
    const today = parseDate(ctx.today, 'today');
    return {
      columns: [
        col('hospital', 'Hospital'),
        col('rule', 'Rule'),
        col('scope', 'Exempt'),
        col('agreement', 'Agreement'),
        col('from', 'Effective from', 'date'),
        col('to', 'Effective to', 'date'),
        col('state', 'State'),
        col('exemptBase', 'Revenue kept out of the charge', 'money'),
      ],
      rows: rules.map((r) => ({
        hospital: hospitalLabel(r.hospital),
        rule: r.name,
        scope: [
          r.department?.name ?? 'all departments',
          r.paymentChannel?.code ?? 'all channels',
        ].join(' · '),
        agreement: r.agreement?.name ?? '',
        from: iso(r.effectiveFrom),
        to: r.effectiveTo ? iso(r.effectiveTo) : null,
        state: !r.isActive
          ? 'inactive'
          : r.effectiveFrom > today
            ? 'future'
            : r.effectiveTo && r.effectiveTo < today
              ? 'expired'
              : 'current',
        exemptBase: moneyString(base.get(r.id) ?? zero()),
      })),
      notes: [
        'An exempt rule always has a rate of 0. The amount shown is the reported revenue in posted charge runs that the exemption excluded from the service charge.',
      ],
    };
  },
};

export const MORE_REPORTS: ReportDefinition[] = [
  hospitalStatement,
  overdueReceivables,
  settlementHistory,
  paymentBehaviour,
  adjustmentRegister,
  pendingActions,
  departmentAnalysis,
  channelAnalysis,
  concentration,
  revenueRegister,
  submissionRegister,
  importErrors,
  variance,
  departmentEarnings,
  ruleConfiguration,
  exemptions,
  accessReport,
];
