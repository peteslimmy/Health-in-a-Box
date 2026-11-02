import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AuthUser } from '../common/types/auth-user';
import { dateInTimeZone, parseDate } from '../common/utils/dates';
import { assertCentreAccess, centreWhere } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import { LATE_AFTER_DAYS } from './collection-rate';
import { CentreMonth, THRESHOLDS, deriveInsights } from './insight-rules';
import { loadReportingStatus } from './reporting-status';
import { lastMonths } from './trend-series';

const TIME_ZONE = 'Africa/Lagos';
const dec = (value: { toString(): string } | null | undefined) =>
  new Decimal(value ? value.toString() : 0);
const monthOf = (date: Date) => date.toISOString().slice(0, 7);

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async insights(user: AuthUser, query: { centreId?: string }) {
    if (query.centreId) assertCentreAccess(user, query.centreId);
    const org = user.organizationId;
    const scope = centreWhere(user, query.centreId);
    const today = dateInTimeZone(new Date(), TIME_ZONE);
    const todayDate = parseDate(today, 'today');
    const [previous, latest] = lastMonths(today, 3).slice(0, 2) as [string, string];
    const since = parseDate(`${previous}-01`, 'since');
    const yearAgo = new Date(todayDate.getTime() - 365 * 86_400_000);
    const sevenAgo = new Date(todayDate.getTime() - 7 * 86_400_000);
    const sixtyAgo = new Date(todayDate.getTime() - 60 * 86_400_000);
    const disputeCut = new Date(todayDate.getTime() - THRESHOLDS.disputeAgeDays * 86_400_000);

    const [
      centres,
      reports,
      runs,
      outstanding,
      overdue,
      year,
      status,
      unallocated,
      troubles,
      disputes,
    ] = await Promise.all([
      this.prisma.centre.findMany({
        where: { organizationId: org, ...(scope.centreId ? { id: scope.centreId } : {}) },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.revenueReport.findMany({
        where: { organizationId: org, ...scope, status: 'COMMITTED', periodEnd: { gte: since } },
        select: { centreId: true, periodEnd: true, grandTotal: true },
        take: 5000,
      }),
      this.prisma.chargeRun.findMany({
        where: { organizationId: org, ...scope, status: 'POSTED', periodEnd: { gte: since } },
        select: { centreId: true, periodEnd: true, baseTotal: true, chargeTotal: true },
        take: 5000,
      }),
      this.prisma.receivable.groupBy({
        by: ['centreId'],
        where: { organizationId: org, ...scope, balance: { gt: 0 } },
        _sum: { balance: true },
      }),
      this.prisma.receivable.groupBy({
        by: ['centreId'],
        where: { organizationId: org, ...scope, balance: { gt: 0 }, dueDate: { lt: todayDate } },
        _sum: { balance: true },
      }),
      this.prisma.revenueReport.groupBy({
        by: ['centreId'],
        where: { organizationId: org, ...scope, status: 'COMMITTED', periodEnd: { gte: yearAgo } },
        _sum: { grandTotal: true },
      }),
      loadReportingStatus(this.prisma, user, today, query.centreId),
      this.prisma.payment.aggregate({
        where: {
          organizationId: org,
          ...scope,
          status: 'POSTED',
          unallocatedAmount: { gt: 0 },
          receiptDate: { lt: sevenAgo },
        },
        _sum: { unallocatedAmount: true },
        _count: true,
      }),
      this.prisma.importBatch.groupBy({
        by: ['centreId'],
        where: {
          organizationId: org,
          ...scope,
          status: 'NEEDS_REVIEW',
          createdAt: { gte: sixtyAgo },
        },
        _count: true,
      }),
      this.prisma.dispute.aggregate({
        where: { organizationId: org, ...scope, status: 'OPEN', raisedAt: { lt: disputeCut } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const ref = new Map(centres.map((c) => [c.id, { centreId: c.id, code: c.code, name: c.name }]));
    const named = (id: string) =>
      ref.get(id) ?? { centreId: id, code: '?', name: 'Unknown centre' };

    const monthly = new Map<string, CentreMonth>();
    const cell = (centreId: string, month: string) => {
      const key = `${centreId}|${month}`;
      const existing = monthly.get(key);
      if (existing) return existing;
      const created: CentreMonth = {
        ...named(centreId),
        month,
        revenue: new Decimal(0),
        base: new Decimal(0),
        charge: new Decimal(0),
      };
      monthly.set(key, created);
      return created;
    };
    for (const r of reports)
      cell(r.centreId, monthOf(r.periodEnd)).revenue = cell(
        r.centreId,
        monthOf(r.periodEnd),
      ).revenue.plus(dec(r.grandTotal));
    for (const r of runs) {
      const c = cell(r.centreId, monthOf(r.periodEnd));
      c.base = c.base.plus(dec(r.baseTotal));
      c.charge = c.charge.plus(dec(r.chargeTotal));
    }
    const overdueBy = new Map(overdue.map((o) => [o.centreId, dec(o._sum.balance)]));

    const items = deriveInsights({
      months: [previous, latest],
      monthly: [...monthly.values()],
      balances: outstanding.map((o) => ({
        ...named(o.centreId),
        outstanding: dec(o._sum.balance),
        overdue: overdueBy.get(o.centreId) ?? new Decimal(0),
      })),
      revenueLast12Months: year.map((y) => ({
        ...named(y.centreId),
        revenue: dec(y._sum.grandTotal),
      })),
      lateCentres: status
        .filter((s) => s.late)
        .map((s) => ({ centreId: s.centreId, code: s.code, name: s.name, daysSince: s.daysSince })),
      lateAfterDays: LATE_AFTER_DAYS,
      unallocated: {
        count: unallocated._count,
        total: dec(unallocated._sum.unallocatedAmount),
        olderThanDays: 7,
      },
      importTroubles: troubles.map((t) => ({ ...named(t.centreId), count: t._count })),
      oldDisputes: { count: disputes._count, total: dec(disputes._sum.amount) },
    });
    return { asAt: today, comparedMonths: { previous, latest }, count: items.length, items };
  }
}
