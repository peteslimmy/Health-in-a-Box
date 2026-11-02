import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AuthUser } from '../common/types/auth-user';
import { dateInTimeZone, dateOnly, parseDate } from '../common/utils/dates';
import { moneyString } from '../common/utils/money';
import { assertCentreAccess } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_COLLECTION_WINDOW_DAYS,
  LATE_AFTER_DAYS,
  buildCollectionSeries,
} from './collection-rate';
import { loadReportingStatus } from './reporting-status';
import { MonthTotals, buildTrendSeries, lastMonths } from './trend-series';

const DEFAULT_TIME_ZONE = 'Africa/Lagos';

const sum = (value: { toString(): string } | null | undefined) =>
  moneyString(new Decimal(value ? value.toString() : 0));

export type DashboardQuery = { centreId?: string; from?: string; to?: string };
export type TrendQuery = { centreId?: string; months?: number };
export type CollectionQuery = TrendQuery & { windowDays?: number };

/**
 * Headline measures (FR-RPT-007 / doc 16 §3). Flow measures use the stated period and date
 * basis; balance measures are "as at today". Each figure is a separate, labelled measure; reported
 * revenue, expected charge, cash received and outstanding balance are never merged.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthUser, query: DashboardQuery) {
    if (query.centreId) assertCentreAccess(user, query.centreId);
    const today = dateInTimeZone(new Date(), DEFAULT_TIME_ZONE);
    const toText = query.to ?? today;
    const fromText = query.from ?? `${today.slice(0, 7)}-01`;
    const from = parseDate(fromText, 'from');
    const to = parseDate(toText, 'to');
    const asAt = parseDate(today, 'asAt');
    const toEndOfDay = new Date(`${toText}T23:59:59.999Z`);

    const org = user.organizationId;
    const centreFilter = query.centreId
      ? { centreId: query.centreId }
      : user.allCentres
        ? {}
        : { centreId: { in: user.centreIds } };
    const base = { organizationId: org, ...centreFilter };

    const [
      reported,
      reportedWithVariance,
      expected,
      chargesPosted,
      received,
      allocated,
      outstanding,
      overdue,
      unallocated,
      importsReady,
      importsNeedReview,
      runsSubmitted,
      runsApproved,
      paymentsSubmitted,
      paymentsApproved,
      draftCentres,
    ] = await this.prisma.$transaction([
      this.prisma.revenueReport.aggregate({
        where: { ...base, status: 'COMMITTED', periodStart: { gte: from }, periodEnd: { lte: to } },
        _sum: { grandTotal: true },
        _count: true,
      }),
      this.prisma.revenueReport.count({
        where: {
          ...base,
          status: 'COMMITTED',
          periodStart: { gte: from },
          periodEnd: { lte: to },
          varianceApprovedAt: { not: null },
        },
      }),
      this.prisma.chargeRun.aggregate({
        where: { ...base, status: 'POSTED', periodEnd: { gte: from, lte: to } },
        _sum: { chargeTotal: true },
        _count: true,
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { ...base, type: 'CHARGE', occurredAt: { gte: from, lte: toEndOfDay } },
        _sum: { debit: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...base, status: 'POSTED', receiptDate: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.paymentAllocation.aggregate({
        where: {
          reversedAt: null,
          allocatedAt: { gte: from, lte: toEndOfDay },
          payment: base,
        },
        _sum: { amount: true },
      }),
      this.prisma.receivable.aggregate({
        where: { ...base, balance: { gt: 0 } },
        _sum: { balance: true },
        _count: true,
      }),
      this.prisma.receivable.aggregate({
        where: { ...base, balance: { gt: 0 }, dueDate: { lt: asAt } },
        _sum: { balance: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { ...base, status: 'POSTED', unallocatedAmount: { gt: 0 } },
        _sum: { unallocatedAmount: true },
        _count: true,
      }),
      this.prisma.importBatch.count({ where: { ...base, status: 'READY_TO_COMMIT' } }),
      this.prisma.importBatch.count({ where: { ...base, status: 'NEEDS_REVIEW' } }),
      this.prisma.chargeRun.count({ where: { ...base, status: 'SUBMITTED' } }),
      this.prisma.chargeRun.count({ where: { ...base, status: 'APPROVED' } }),
      this.prisma.payment.count({ where: { ...base, status: 'SUBMITTED' } }),
      this.prisma.payment.count({ where: { ...base, status: 'APPROVED' } }),
      this.prisma.centre.count({
        where: {
          organizationId: org,
          status: 'DRAFT',
          ...(user.allCentres ? {} : { id: { in: user.centreIds } }),
        } satisfies Prisma.CentreWhereInput,
      }),
    ]);

    // The money flow for the selected period and centres: what centres reported, what is due to
    // the operator, what was paid, and what is still owing (due less paid). Exact decimals.
    const expectedAmount = new Decimal(expected._sum.chargeTotal?.toString() ?? 0);
    const receivedAmount = new Decimal(received._sum.amount?.toString() ?? 0);
    const owedAmount = expectedAmount.minus(receivedAmount);

    return {
      currency: 'NGN',
      period: { from: dateOnly(from), to: dateOnly(to) },
      asAt: dateOnly(asAt),
      measures: {
        reportedRevenue: {
          label: 'Reported revenue',
          basis: 'Committed reports within the period',
          amount: sum(reported._sum.grandTotal),
          count: reported._count,
          // Reports committed although their printed totals did not add up (figures are the channel amounts).
          varianceReports: reportedWithVariance,
        },
        expectedServiceCharge: {
          label: 'Expected service charge',
          basis: 'Posted charge runs whose period ends within the period',
          amount: sum(expected._sum.chargeTotal),
          count: expected._count,
        },
        owedForPeriod: {
          label: 'Still owing',
          basis:
            'Expected service charge less payments received, both within the period. Negative means more was paid than charged in the period',
          amount: moneyString(owedAmount),
          // Share of the expected charge that has been paid; null when nothing was charged.
          percentPaid: expectedAmount.gt(0)
            ? receivedAmount.div(expectedAmount).times(100).toDecimalPlaces(1).toFixed(1)
            : null,
        },
        chargesPosted: {
          label: 'Charges posted',
          basis: 'Ledger debits by posting date',
          amount: sum(chargesPosted._sum.debit),
        },
        paymentsReceived: {
          label: 'Payments received',
          basis: 'Posted receipts by receipt date',
          amount: sum(received._sum.amount),
          count: received._count,
        },
        paymentsAllocated: {
          label: 'Payments allocated',
          basis: 'Active allocations by allocation date',
          amount: sum(allocated._sum.amount),
        },
        outstandingReceivables: {
          label: 'Outstanding receivables',
          basis: 'Open balances as at today',
          amount: sum(outstanding._sum.balance),
          count: outstanding._count,
        },
        overdueReceivables: {
          label: 'Overdue receivables',
          basis: 'Open balances past their due date as at today',
          amount: sum(overdue._sum.balance),
          count: overdue._count,
        },
        unallocatedReceipts: {
          label: 'Unallocated receipts',
          basis: 'Posted receipts with cash not yet allocated, as at today',
          amount: sum(unallocated._sum.unallocatedAmount),
          count: unallocated._count,
        },
      },
      awaitingAction: {
        importsReadyToCommit: importsReady,
        importsNeedingReview: importsNeedReview,
        chargeRunsToApprove: runsSubmitted,
        chargeRunsToPost: runsApproved,
        receiptsToApprove: paymentsSubmitted,
        receiptsToPost: paymentsApproved,
        draftCentres,
      },
    };
  }

  /** Monthly series for the dashboard charts. Months follow the centre time zone; balances come from the ledger. */
  async trends(user: AuthUser, query: TrendQuery) {
    if (query.centreId) assertCentreAccess(user, query.centreId);
    const count = Math.min(24, Math.max(3, query.months ?? 12));
    const today = dateInTimeZone(new Date(), DEFAULT_TIME_ZONE);
    const months = lastMonths(today, count);
    // Africa/Lagos has no daylight saving, so a fixed +01:00 offset marks the start of the first month.
    const windowStart = new Date(`${months[0]}-01T00:00:00+01:00`);
    const windowStartDate = `${months[0]}-01`;

    const org = user.organizationId;
    const scope = query.centreId
      ? Prisma.sql`AND "centreId" = ${query.centreId}::uuid`
      : user.allCentres
        ? Prisma.empty
        : Prisma.sql`AND "centreId" = ANY(${user.centreIds}::uuid[])`;
    const tz = DEFAULT_TIME_ZONE;

    type Row = { m: string; total: Prisma.Decimal | string | null };
    const toMap = (rows: Row[]): MonthTotals =>
      new Map(rows.map((row) => [row.m, new Decimal(row.total ? row.total.toString() : 0)]));

    const [opening, ledger, received, reported] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
        SELECT COALESCE(SUM(debit - credit), 0) AS total FROM "LedgerEntry"
        WHERE "organizationId" = ${org}::uuid ${scope} AND "occurredAt" < ${windowStart}`,
      this.prisma.$queryRaw<Array<{ m: string; charges: Prisma.Decimal; net: Prisma.Decimal }>>`
        SELECT to_char("occurredAt" AT TIME ZONE ${tz}, 'YYYY-MM') AS m,
               COALESCE(SUM(CASE WHEN type = 'CHARGE' THEN debit ELSE 0 END), 0) AS charges,
               COALESCE(SUM(debit - credit), 0) AS net
        FROM "LedgerEntry"
        WHERE "organizationId" = ${org}::uuid ${scope} AND "occurredAt" >= ${windowStart}
        GROUP BY 1`,
      this.prisma.$queryRaw<Row[]>`
        SELECT to_char("receiptDate", 'YYYY-MM') AS m, SUM(amount) AS total FROM "Payment"
        WHERE "organizationId" = ${org}::uuid ${scope} AND status = 'POSTED'
          AND "receiptDate" >= ${windowStartDate}::date
        GROUP BY 1`,
      this.prisma.$queryRaw<Row[]>`
        SELECT to_char("periodEnd", 'YYYY-MM') AS m, SUM("grandTotal") AS total FROM "RevenueReport"
        WHERE "organizationId" = ${org}::uuid ${scope} AND status = 'COMMITTED'
          AND "periodEnd" >= ${windowStartDate}::date
        GROUP BY 1`,
    ]);

    return {
      currency: 'NGN',
      asAt: today,
      currentMonth: months[months.length - 1],
      series: buildTrendSeries({
        months,
        openingBalance: new Decimal(opening[0]?.total ? opening[0].total.toString() : 0),
        reported: toMap(reported),
        received: toMap(received),
        charges: toMap(ledger.map((row) => ({ m: row.m, total: row.charges }))),
        ledgerNet: toMap(ledger.map((row) => ({ m: row.m, total: row.net }))),
      }),
    };
  }

  /**
   * D-204: of the receivables that fell due in each month, how much was settled within the window
   * after the due date. Allocations are counted by their Lagos calendar date; reversed ones are not.
   */
  async collection(user: AuthUser, query: CollectionQuery) {
    if (query.centreId) assertCentreAccess(user, query.centreId);
    const count = Math.min(24, Math.max(3, query.months ?? 12));
    const windowDays = Math.min(
      120,
      Math.max(7, query.windowDays ?? DEFAULT_COLLECTION_WINDOW_DAYS),
    );
    const today = dateInTimeZone(new Date(), DEFAULT_TIME_ZONE);
    const months = lastMonths(today, count);
    const first = `${months[0]}-01`;
    const last = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);

    const org = user.organizationId;
    const scope = query.centreId
      ? Prisma.sql`AND r."centreId" = ${query.centreId}::uuid`
      : user.allCentres
        ? Prisma.empty
        : Prisma.sql`AND r."centreId" = ANY(${user.centreIds}::uuid[])`;
    const tz = DEFAULT_TIME_ZONE;

    const rows = await this.prisma.$queryRaw<
      Array<{
        m: string;
        due: Prisma.Decimal;
        within_window: Prisma.Decimal;
        to_date: Prisma.Decimal;
      }>
    >`
      SELECT to_char(r."dueDate", 'YYYY-MM') AS m,
             COALESCE(SUM((r."originalAmount" + r."adjustmentTotal")), 0) AS due,
             COALESCE(SUM(LEAST((r."originalAmount" + r."adjustmentTotal"), COALESCE(a.in_window, 0))), 0) AS within_window,
             COALESCE(SUM(LEAST((r."originalAmount" + r."adjustmentTotal"), COALESCE(a.total, 0))), 0) AS to_date
      FROM "Receivable" r
      LEFT JOIN LATERAL (
        SELECT SUM(pa.amount) FILTER (
                 WHERE (pa."allocatedAt" AT TIME ZONE ${tz})::date <= r."dueDate" + ${windowDays}::int
               ) AS in_window,
               SUM(pa.amount) AS total
        FROM "PaymentAllocation" pa
        WHERE pa."receivableId" = r.id AND pa."reversedAt" IS NULL
      ) a ON true
      WHERE r."organizationId" = ${org}::uuid ${scope}
        AND r."dueDate" >= ${first}::date AND r."dueDate" <= ${last}::date
      GROUP BY 1`;

    return {
      windowDays,
      asAt: today,
      series: buildCollectionSeries({
        months,
        today,
        windowDays,
        rows: rows.map((row) => ({
          month: row.m,
          due: new Decimal(row.due.toString()),
          withinWindow: new Decimal(row.within_window.toString()),
          toDate: new Decimal(row.to_date.toString()),
        })),
      }),
    };
  }

  /** Centres that have not reported within 7 days (D-203), with when each last reported. */
  async reportingStatus(user: AuthUser, query: { centreId?: string }) {
    const today = dateInTimeZone(new Date(), DEFAULT_TIME_ZONE);
    const centres = await loadReportingStatus(this.prisma, user, today, query.centreId);
    return {
      asAt: today,
      lateAfterDays: LATE_AFTER_DAYS,
      lateCount: centres.filter((centre) => centre.late).length,
      centres,
    };
  }
}
