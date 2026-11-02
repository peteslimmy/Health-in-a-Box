import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AGEING_BUCKETS, ageingBucket, daysOverdue } from '../common/utils/ageing';
import { parseDate } from '../common/utils/dates';
import { moneyString } from '../common/utils/money';
import { centreWhere } from '../common/utils/scope';
import { loadReportingStatus } from '../dashboard/reporting-status';
import {
  MAX_REPORT_ROWS,
  ReportColumn,
  ReportContext,
  ReportDefinition,
  ReportRow,
} from './report-types';

export const iso = (date: Date) => date.toISOString().slice(0, 10);
export const dec = (value: { toString(): string } | null | undefined) =>
  new Decimal(value ? value.toString() : 0);
export const zero = () => new Decimal(0);

export const BUCKET_LABEL: Record<(typeof AGEING_BUCKETS)[number] | 'SETTLED', string> = {
  NOT_YET_DUE: 'Not yet due',
  DAYS_1_30: '1–30 days overdue',
  DAYS_31_60: '31–60 days overdue',
  DAYS_61_90: '61–90 days overdue',
  DAYS_91_120: '91–120 days overdue',
  OVER_120: 'Over 120 days overdue',
  SETTLED: 'Settled',
};

/** Reports are bounded: a request that would return too many rows must be narrowed, not truncated. */
export function capped<T>(rows: T[]): T[] {
  if (rows.length > MAX_REPORT_ROWS) {
    throw new UnprocessableEntityException({
      code: 'REPORT_TOO_LARGE',
      message: `This report has more than ${MAX_REPORT_ROWS} rows; narrow it with a centre or date range`,
    });
  }
  return rows;
}

/** Centre scope for tables that carry centreId; throws 404 for a centre the caller cannot see. */
export const scopeOf = (ctx: ReportContext) => centreWhere(ctx.user, ctx.filters.centreId);

/** The same scope for the centre table itself, where the column is `id`. */
export function centreIdScope(ctx: ReportContext): Prisma.CentreWhereInput {
  const scope = scopeOf(ctx);
  return 'centreId' in scope ? { id: scope.centreId } : {};
}

export function dateRange(ctx: ReportContext) {
  const { from, to } = ctx.filters;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = parseDate(from, 'from');
  if (to) range.lte = parseDate(to, 'to');
  return Object.keys(range).length > 0 ? range : undefined;
}

/** For timestamp columns the end date includes the whole day. */
export function timeRange(ctx: ReportContext) {
  const { from, to } = ctx.filters;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = parseDate(from, 'from');
  if (to) range.lte = new Date(`${parseDate(to, 'to').toISOString().slice(0, 10)}T23:59:59.999Z`);
  return Object.keys(range).length > 0 ? range : undefined;
}

export const centreLabel = (centre: { code: string; name: string }) =>
  `${centre.name} (${centre.code})`;

export const col = (
  key: string,
  label: string,
  type: ReportColumn['type'] = 'text',
): ReportColumn => ({
  key,
  label,
  type,
});

const receivablesAgeing: ReportDefinition = {
  id: 'receivables-ageing',
  title: 'Receivables ageing',
  description: 'Open balances by centre, grouped by how far past the due date they are.',
  category: 'Receivables',
  filters: ['centreId'],
  requires: ['receivables.read'],
  totals: ['*'],
  async run(ctx) {
    const asAt = parseDate(ctx.today, 'asAt');
    const groups = await ctx.prisma.receivable.groupBy({
      by: ['centreId', 'dueDate'],
      where: { organizationId: ctx.user.organizationId, ...scopeOf(ctx), balance: { gt: 0 } },
      _sum: { balance: true },
    });
    const centres = await ctx.prisma.centre.findMany({
      where: { id: { in: [...new Set(groups.map((g) => g.centreId))] } },
      select: { id: true, code: true, name: true },
    });
    const byCentre = new Map<string, Record<string, Decimal>>();
    for (const group of groups) {
      const totals = byCentre.get(group.centreId) ?? {};
      const bucket = ageingBucket(group.dueDate, asAt, dec(group._sum.balance));
      totals[bucket] = (totals[bucket] ?? zero()).plus(dec(group._sum.balance));
      byCentre.set(group.centreId, totals);
    }
    const rows: ReportRow[] = centres.map((centre) => {
      const totals = byCentre.get(centre.id) ?? {};
      const row: ReportRow = { centre: centreLabel(centre) };
      let outstanding = zero();
      let overdue = zero();
      for (const bucket of AGEING_BUCKETS) {
        const value = totals[bucket] ?? zero();
        row[bucket] = moneyString(value);
        outstanding = outstanding.plus(value);
        if (bucket !== 'NOT_YET_DUE') overdue = overdue.plus(value);
      }
      row.outstanding = moneyString(outstanding);
      row.overdue = moneyString(overdue);
      return row;
    });
    rows.sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
    return {
      columns: [
        col('centre', 'Centre'),
        ...AGEING_BUCKETS.map((bucket) => col(bucket, BUCKET_LABEL[bucket], 'money')),
        col('outstanding', 'Outstanding', 'money'),
        col('overdue', 'Of which overdue', 'money'),
      ],
      rows,
      notes: [
        `Balances as at ${ctx.today}. A balance is overdue only after its due date; "not yet due" is outstanding but not overdue.`,
      ],
    };
  },
};

const outstandingReceivables: ReportDefinition = {
  id: 'outstanding-receivables',
  title: 'Outstanding receivables',
  description: 'Every receivable that still has a balance, oldest due date first.',
  category: 'Receivables',
  dateBasis: 'Due date',
  filters: ['centreId', 'from', 'to'],
  requires: ['receivables.read'],
  totals: ['original', 'paid', 'balance'],
  async run(ctx) {
    const asAt = parseDate(ctx.today, 'asAt');
    const items = capped(
      await ctx.prisma.receivable.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          balance: { gt: 0 },
          dueDate: dateRange(ctx),
        },
        include: { centre: { select: { code: true, name: true } } },
        orderBy: [{ dueDate: 'asc' }, { reference: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('centre', 'Centre'),
        col('reference', 'Reference'),
        col('description', 'Description'),
        col('dueDate', 'Due date', 'date'),
        col('original', 'Original amount', 'money'),
        col('paid', 'Paid', 'money'),
        col('balance', 'Balance', 'money'),
        col('daysOverdue', 'Days overdue', 'int'),
        col('bucket', 'Ageing'),
      ],
      rows: items.map((item) => ({
        centre: centreLabel(item.centre),
        reference: item.reference,
        description: item.description,
        dueDate: iso(item.dueDate),
        original: moneyString(dec(item.originalAmount)),
        paid: moneyString(dec(item.amountPaid)),
        balance: moneyString(dec(item.balance)),
        daysOverdue: daysOverdue(item.dueDate, asAt),
        bucket: BUCKET_LABEL[ageingBucket(item.dueDate, asAt, dec(item.balance))],
      })),
      notes: [`Balances as at ${ctx.today}.`],
    };
  },
};

const receivablesLedger: ReportDefinition = {
  id: 'receivables-ledger',
  title: 'Receivables ledger',
  description:
    'Every posted ledger entry: charges, allocations and reversals, with debits and credits.',
  category: 'Receivables',
  dateBasis: 'Posting date',
  filters: ['centreId', 'from', 'to'],
  requires: ['receivables.read'],
  totals: ['debit', 'credit'],
  async run(ctx) {
    const entries = capped(
      await ctx.prisma.ledgerEntry.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          occurredAt: timeRange(ctx),
        },
        include: {
          centre: { select: { code: true, name: true } },
          receivable: { select: { reference: true } },
        },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('date', 'Date', 'date'),
        col('centre', 'Centre'),
        col('receivable', 'Receivable'),
        col('type', 'Entry type'),
        col('description', 'Description'),
        col('debit', 'Debit', 'money'),
        col('credit', 'Credit', 'money'),
      ],
      rows: entries.map((entry) => ({
        date: iso(entry.occurredAt),
        centre: centreLabel(entry.centre),
        receivable: entry.receivable.reference,
        type: entry.type.replace(/_/g, ' ').toLowerCase(),
        description: entry.description,
        debit: moneyString(dec(entry.debit)),
        credit: moneyString(dec(entry.credit)),
      })),
      notes: ['Debits increase what is owed; credits (payments allocated, reversals) reduce it.'],
    };
  },
};

const PAYMENT_STATUSES = [
  'POSTED',
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'REVERSED',
  'ALL',
];

const paymentRegister: ReportDefinition = {
  id: 'payment-register',
  title: 'Payment receipt register',
  description:
    'Service-charge money received from centres, with how much of each receipt is allocated.',
  category: 'Payments',
  dateBasis: 'Receipt date',
  filters: ['centreId', 'from', 'to', 'status'],
  statuses: PAYMENT_STATUSES,
  requires: ['payments.read'],
  totals: ['amount', 'allocated', 'unallocated'],
  async run(ctx) {
    const status = ctx.filters.status ?? 'POSTED';
    const payments = capped(
      await ctx.prisma.payment.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          receiptDate: dateRange(ctx),
          ...(status === 'ALL' ? {} : { status: status as never }),
        },
        include: { centre: { select: { code: true, name: true } } },
        orderBy: [{ receiptDate: 'asc' }, { createdAt: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('date', 'Receipt date', 'date'),
        col('centre', 'Centre'),
        col('reference', 'Reference'),
        col('payer', 'Payer'),
        col('method', 'Method'),
        col('status', 'Status'),
        col('amount', 'Amount', 'money'),
        col('allocated', 'Allocated', 'money'),
        col('unallocated', 'Unallocated', 'money'),
      ],
      rows: payments.map((payment) => {
        const posted = payment.status === 'POSTED';
        return {
          date: iso(payment.receiptDate),
          centre: centreLabel(payment.centre),
          reference: payment.reference ?? '',
          payer: payment.payerName ?? '',
          method: payment.method,
          status: payment.status.toLowerCase(),
          amount: moneyString(dec(payment.amount)),
          allocated: posted
            ? moneyString(dec(payment.amount).minus(dec(payment.unallocatedAmount)))
            : null,
          unallocated: posted ? moneyString(dec(payment.unallocatedAmount)) : null,
        };
      }),
      notes: [
        status === 'POSTED'
          ? 'Showing posted receipts only: these are the amounts counted as received.'
          : `Showing ${status === 'ALL' ? 'receipts of every status' : `${status.toLowerCase()} receipts`}; only posted receipts count as money received, so the totals row is not a cash figure.`,
      ],
    };
  },
};

const paymentAllocations: ReportDefinition = {
  id: 'payment-allocations',
  title: 'Payment allocation report',
  description: 'How each receipt was applied against receivables, including reversed allocations.',
  category: 'Payments',
  dateBasis: 'Allocation date',
  filters: ['centreId', 'from', 'to', 'status'],
  statuses: ['ACTIVE', 'REVERSED', 'ALL'],
  requires: ['payments.read', 'receivables.read'],
  totals: ['amount'],
  async run(ctx) {
    const status = ctx.filters.status ?? 'ALL';
    const allocations = capped(
      await ctx.prisma.paymentAllocation.findMany({
        where: {
          payment: { organizationId: ctx.user.organizationId, ...scopeOf(ctx) },
          allocatedAt: timeRange(ctx),
          ...(status === 'ACTIVE'
            ? { reversedAt: null }
            : status === 'REVERSED'
              ? { reversedAt: { not: null } }
              : {}),
        },
        include: {
          payment: {
            select: {
              reference: true,
              payerName: true,
              centre: { select: { code: true, name: true } },
            },
          },
          receivable: { select: { reference: true } },
        },
        orderBy: [{ allocatedAt: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('date', 'Allocated on', 'date'),
        col('centre', 'Centre'),
        col('receipt', 'Receipt'),
        col('payer', 'Payer'),
        col('receivable', 'Applied to receivable'),
        col('amount', 'Amount', 'money'),
        col('status', 'Status'),
        col('reason', 'Reversal reason'),
      ],
      rows: allocations.map((allocation) => ({
        date: iso(allocation.allocatedAt),
        centre: centreLabel(allocation.payment.centre),
        receipt: allocation.payment.reference ?? '',
        payer: allocation.payment.payerName ?? '',
        receivable: allocation.receivable.reference,
        amount: moneyString(dec(allocation.amount)),
        status: allocation.reversedAt ? 'reversed' : 'active',
        reason: allocation.reversalReason ?? '',
      })),
      notes: [
        'The totals row adds every allocation shown, including reversed ones if they are included.',
      ],
    };
  },
};

const unallocatedReceipts: ReportDefinition = {
  id: 'unallocated-receipts',
  title: 'Unallocated receipts',
  description:
    'Posted receipts with cash not yet applied to any receivable, and how long it has been held.',
  category: 'Payments',
  dateBasis: 'Receipt date',
  filters: ['centreId', 'from', 'to'],
  requires: ['payments.read'],
  totals: ['amount', 'unallocated'],
  async run(ctx) {
    const asAt = parseDate(ctx.today, 'asAt');
    const payments = capped(
      await ctx.prisma.payment.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...scopeOf(ctx),
          status: 'POSTED',
          unallocatedAmount: { gt: 0 },
          receiptDate: dateRange(ctx),
        },
        include: { centre: { select: { code: true, name: true } } },
        orderBy: [{ receiptDate: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('date', 'Receipt date', 'date'),
        col('centre', 'Centre'),
        col('reference', 'Reference'),
        col('payer', 'Payer'),
        col('amount', 'Receipt amount', 'money'),
        col('unallocated', 'Unallocated', 'money'),
        col('daysHeld', 'Days held', 'int'),
      ],
      rows: payments.map((payment) => ({
        date: iso(payment.receiptDate),
        centre: centreLabel(payment.centre),
        reference: payment.reference ?? '',
        payer: payment.payerName ?? '',
        amount: moneyString(dec(payment.amount)),
        unallocated: moneyString(dec(payment.unallocatedAmount)),
        daysHeld: Math.max(
          0,
          Math.round((asAt.getTime() - payment.receiptDate.getTime()) / 86_400_000),
        ),
      })),
      notes: [`Days held counted to ${ctx.today}.`],
    };
  },
};

const departmentChannelMatrix: ReportDefinition = {
  id: 'department-channel-matrix',
  title: 'Department and channel matrix',
  description: 'Reported revenue by department (rows) and payment channel (columns).',
  category: 'Revenue',
  dateBasis: 'Report period (reports wholly inside the range)',
  filters: ['centreId', 'from', 'to'],
  requires: [],
  totals: ['*'],
  async run(ctx) {
    const range = dateRange(ctx);
    const lines = capped(
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
          report: { select: { centre: { select: { code: true, name: true } } } },
        },
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    const channelCodes = new Set<string>();
    const grouped = new Map<
      string,
      { centre: string; department: string; amounts: Map<string, Decimal>; reported: Decimal }
    >();
    for (const line of lines) {
      const centre = centreLabel(line.report.centre);
      const key = `${centre}|${line.department.code}`;
      const entry = grouped.get(key) ?? {
        centre,
        department: `${line.department.code} — ${line.department.name}`,
        amounts: new Map<string, Decimal>(),
        reported: zero(),
      };
      for (const [code, value] of Object.entries(
        (line.amountsJson ?? {}) as Record<string, string>,
      )) {
        channelCodes.add(code);
        entry.amounts.set(code, (entry.amounts.get(code) ?? zero()).plus(value));
      }
      entry.reported = entry.reported.plus(dec(line.reportedTotal));
      grouped.set(key, entry);
    }
    const channels = [...channelCodes].sort();
    const rows = [...grouped.values()]
      .sort((a, b) => a.centre.localeCompare(b.centre) || b.reported.comparedTo(a.reported))
      .map((entry) => {
        const row: ReportRow = { centre: entry.centre, department: entry.department };
        let channelSum = zero();
        for (const code of channels) {
          const value = entry.amounts.get(code) ?? zero();
          row[`ch_${code}`] = moneyString(value);
          channelSum = channelSum.plus(value);
        }
        row.channelTotal = moneyString(channelSum);
        row.reported = moneyString(entry.reported);
        return row;
      });
    return {
      columns: [
        col('centre', 'Centre'),
        col('department', 'Department'),
        ...channels.map((code) => col(`ch_${code}`, code, 'money')),
        col('channelTotal', 'Sum of channels', 'money'),
        col('reported', 'Reported total', 'money'),
      ],
      rows,
      notes: [
        'Reported revenue as printed by each centre in its committed reports. It is not verified against patient-level records or bank deposits.',
      ],
    };
  },
};

const CHARGE_STATUSES = ['POSTED', 'PENDING', 'CANCELLED', 'ALL'];

const expectedCharges: ReportDefinition = {
  id: 'expected-service-charges',
  title: 'Expected service charges',
  description:
    'Service charge calculated per department and channel, with the rule and rate applied.',
  category: 'Service charges',
  dateBasis: 'End of the charge-run period',
  filters: ['centreId', 'from', 'to', 'status'],
  statuses: CHARGE_STATUSES,
  requires: ['charge_runs.read'],
  totals: ['base', 'charge'],
  async run(ctx) {
    const status = ctx.filters.status ?? 'POSTED';
    const statusWhere =
      status === 'ALL'
        ? {}
        : status === 'PENDING'
          ? { status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] as never[] } }
          : { status: status as never };
    const lines = capped(
      await ctx.prisma.chargeLine.findMany({
        where: {
          chargeRun: {
            organizationId: ctx.user.organizationId,
            ...scopeOf(ctx),
            periodEnd: dateRange(ctx),
            ...statusWhere,
          },
        },
        include: {
          chargeRun: {
            select: {
              periodStart: true,
              periodEnd: true,
              status: true,
              centre: { select: { code: true, name: true } },
            },
          },
          department: { select: { code: true, name: true } },
          paymentChannel: { select: { code: true } },
        },
        orderBy: [{ chargeRun: { periodEnd: 'asc' } }, { createdAt: 'asc' }],
        take: MAX_REPORT_ROWS + 1,
      }),
    );
    return {
      columns: [
        col('centre', 'Centre'),
        col('periodStart', 'Period start', 'date'),
        col('periodEnd', 'Period end', 'date'),
        col('status', 'Run status'),
        col('department', 'Department'),
        col('channel', 'Channel'),
        col('rule', 'Rule applied'),
        col('base', 'Revenue base', 'money'),
        col('rate', 'Rate (%)', 'percent'),
        col('charge', 'Service charge', 'money'),
      ],
      rows: lines.map((line) => ({
        centre: centreLabel(line.chargeRun.centre),
        periodStart: iso(line.chargeRun.periodStart),
        periodEnd: iso(line.chargeRun.periodEnd),
        status: line.chargeRun.status.toLowerCase(),
        department: `${line.department.code} — ${line.department.name}`,
        channel: line.paymentChannel?.code ?? 'all channels',
        rule: line.ruleName ?? '',
        base: moneyString(dec(line.baseAmount)),
        rate: dec(line.rate).toFixed(2),
        charge: moneyString(dec(line.chargeAmount)),
      })),
      notes: [
        status === 'POSTED'
          ? 'Showing charges from posted runs, which are in the receivables ledger.'
          : status === 'PENDING'
            ? 'Showing charges from runs not yet posted; these are not yet receivables.'
            : 'Charges from runs that are not posted are not receivables.',
      ],
    };
  },
};

const centreComparison: ReportDefinition = {
  id: 'centre-comparison',
  title: 'Centre performance comparison',
  description:
    'Reported revenue, expected charges, receipts, outstanding and overdue balances side by side.',
  category: 'Performance',
  dateBasis:
    'Report period end, charge period end and receipt date for the flow columns; balances are as at today',
  filters: ['centreId', 'from', 'to'],
  requires: ['receivables.read', 'payments.read', 'charge_runs.read'],
  totals: ['revenue', 'charges', 'received', 'outstanding', 'overdue'],
  async run(ctx) {
    const org = ctx.user.organizationId;
    const scope = scopeOf(ctx);
    const range = dateRange(ctx);
    const asAt = parseDate(ctx.today, 'asAt');
    const [centres, revenue, charges, received, outstanding, overdue] = await Promise.all([
      ctx.prisma.centre.findMany({
        where: { organizationId: org, ...centreIdScope(ctx) },
        select: { id: true, code: true, name: true },
      }),
      ctx.prisma.revenueReport.groupBy({
        by: ['centreId'],
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
        by: ['centreId'],
        where: { organizationId: org, ...scope, status: 'POSTED', periodEnd: range },
        _sum: { chargeTotal: true },
      }),
      ctx.prisma.payment.groupBy({
        by: ['centreId'],
        where: { organizationId: org, ...scope, status: 'POSTED', receiptDate: range },
        _sum: { amount: true },
      }),
      ctx.prisma.receivable.groupBy({
        by: ['centreId'],
        where: { organizationId: org, ...scope, balance: { gt: 0 } },
        _sum: { balance: true },
      }),
      ctx.prisma.receivable.groupBy({
        by: ['centreId'],
        where: { organizationId: org, ...scope, balance: { gt: 0 }, dueDate: { lt: asAt } },
        _sum: { balance: true },
      }),
    ]);
    const lookup = <T extends { centreId: string }>(items: T[], pick: (item: T) => unknown) =>
      new Map(items.map((item) => [item.centreId, dec(pick(item) as { toString(): string })]));
    const revenueBy = lookup(revenue, (i) => i._sum.grandTotal);
    const chargesBy = lookup(charges, (i) => i._sum.chargeTotal);
    const receivedBy = lookup(received, (i) => i._sum.amount);
    const outstandingBy = lookup(outstanding, (i) => i._sum.balance);
    const overdueBy = lookup(overdue, (i) => i._sum.balance);
    const rows = centres
      .map((centre) => {
        const rev = revenueBy.get(centre.id) ?? zero();
        const chg = chargesBy.get(centre.id) ?? zero();
        const out = outstandingBy.get(centre.id) ?? zero();
        const over = overdueBy.get(centre.id) ?? zero();
        return {
          centre: centreLabel(centre),
          revenue: moneyString(rev),
          charges: moneyString(chg),
          yield: rev.gt(0) ? chg.div(rev).times(100).toFixed(1) : null,
          received: moneyString(receivedBy.get(centre.id) ?? zero()),
          outstanding: moneyString(out),
          overdue: moneyString(over),
          overduePct: out.gt(0) ? over.div(out).times(100).toFixed(1) : null,
        };
      })
      .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
    return {
      columns: [
        col('centre', 'Centre'),
        col('revenue', 'Reported revenue', 'money'),
        col('charges', 'Expected charges (posted)', 'money'),
        col('yield', 'Charge yield (%)', 'percent'),
        col('received', 'Payments received', 'money'),
        col('outstanding', 'Outstanding', 'money'),
        col('overdue', 'Overdue', 'money'),
        col('overduePct', 'Overdue share (%)', 'percent'),
      ],
      rows,
      notes: [
        'Revenue, charges and receipts are for the selected period; outstanding and overdue are balances as at today.',
        'Receipts in a period are not payments against that period’s charges; centres may settle older balances.',
      ],
    };
  },
};

const reportingStatusReport: ReportDefinition = {
  id: 'reporting-status',
  title: 'Report submission status',
  description:
    'When each active centre last reported, and which centres are late (no report ending in the last 7 days).',
  category: 'Revenue',
  filters: ['centreId'],
  requires: ['imports.read'],
  async run(ctx) {
    const centres = await loadReportingStatus(
      ctx.prisma,
      ctx.user,
      ctx.today,
      ctx.filters.centreId,
    );
    return {
      columns: [
        col('centre', 'Centre'),
        col('lastEnd', 'Latest report ends', 'date'),
        col('days', 'Days since', 'int'),
        col('state', 'Status'),
      ],
      rows: centres.map((centre) => ({
        centre: centreLabel(centre),
        lastEnd: centre.lastReportEnd,
        days: centre.daysSince,
        state: centre.lastReportEnd === null ? 'never reported' : centre.late ? 'late' : 'on time',
      })),
      notes: [
        'A centre is late when no committed report or upload awaiting commit for it ends within the last 7 days. Skipped days inside a period are flagged when the report is uploaded.',
      ],
    };
  },
};

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  receivablesAgeing,
  outstandingReceivables,
  receivablesLedger,
  paymentRegister,
  paymentAllocations,
  unallocatedReceipts,
  departmentChannelMatrix,
  expectedCharges,
  centreComparison,
  reportingStatusReport,
];
