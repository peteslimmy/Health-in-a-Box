import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { loadReportingStatus } from '../dashboard/reporting-status';
import { AuthUser } from '../common/types/auth-user';
import { dateInTimeZone, parseDate } from '../common/utils/dates';
import { moneyString } from '../common/utils/money';
import { centreWhere, narrowUserScope } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';

const TIME_ZONE = 'Africa/Lagos';
/** Unallocated cash older than this is chased. */
export const UNALLOCATED_AFTER_DAYS = 7;
/** An approval waiting longer than this is flagged as stale. */
export const STALE_AFTER_DAYS = 3;

export type WorkItem = {
  /** Stable key so the screen can keep its place between refreshes. */
  key: string;
  kind: string;
  /** What the person is being asked to do. */
  action: string;
  title: string;
  centre: string | null;
  ageDays: number;
  severity: 'info' | 'attention' | 'urgent';
  link: string;
};

const dec = (value: { toString(): string } | null | undefined) =>
  new Decimal(value ? value.toString() : 0);
const centreName = (centre: { code: string; name: string }) => `${centre.code} · ${centre.name}`;

/**
 * Everything waiting for this person, drawn only from the areas they may act on. Items they
 * prepared themselves are never offered for approval (segregation of duties), and every query is
 * limited to the centres where they hold the relevant permission.
 */
@Injectable()
export class WorkQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async queue(user: AuthUser) {
    const today = dateInTimeZone(new Date(), TIME_ZONE);
    const todayDate = parseDate(today, 'today');
    const age = (date: Date) =>
      Math.max(0, Math.round((todayDate.getTime() - date.getTime()) / 86_400_000));
    const org = user.organizationId;
    const items: WorkItem[] = [];
    const scopeFor = (permission: string) => {
      const narrowed = narrowUserScope(user, [permission]);
      return narrowed ? { user: narrowed, where: centreWhere(narrowed) } : null;
    };
    const stale = (days: number): WorkItem['severity'] =>
      days > STALE_AFTER_DAYS ? 'attention' : 'info';

    const commit = scopeFor('imports.commit');
    if (commit) {
      const rows = await this.prisma.importBatch.findMany({
        where: {
          organizationId: org,
          ...commit.where,
          status: 'READY_TO_COMMIT',
          createdById: { not: user.id },
        },
        select: {
          id: true,
          fileName: true,
          createdAt: true,
          centre: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      for (const r of rows) {
        const days = age(r.createdAt);
        items.push({
          key: `import-${r.id}`,
          kind: 'Revenue import',
          action: 'Review and commit',
          title: r.fileName ?? 'Upload',
          centre: centreName(r.centre),
          ageDays: days,
          severity: stale(days),
          link: `/imports/${r.id}`,
        });
      }
    }

    for (const [permission, status, action] of [
      ['charge_runs.approve', 'SUBMITTED', 'Approve'],
      ['charge_runs.post', 'APPROVED', 'Post'],
    ] as const) {
      const scope = scopeFor(permission);
      if (!scope) continue;
      const rows = await this.prisma.chargeRun.findMany({
        where: { organizationId: org, ...scope.where, status, createdById: { not: user.id } },
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          centre: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      for (const r of rows) {
        const days = age(r.createdAt);
        items.push({
          key: `run-${r.id}`,
          kind: 'Service charge run',
          action,
          title: `${r.periodStart.toISOString().slice(0, 10)} to ${r.periodEnd.toISOString().slice(0, 10)}`,
          centre: centreName(r.centre),
          ageDays: days,
          severity: stale(days),
          link: `/charge-runs/${r.id}`,
        });
      }
    }

    for (const [permission, status, action] of [
      ['payments.approve', 'SUBMITTED', 'Approve'],
      ['payments.post', 'APPROVED', 'Post'],
    ] as const) {
      const scope = scopeFor(permission);
      if (!scope) continue;
      const rows = await this.prisma.payment.findMany({
        where: { organizationId: org, ...scope.where, status, createdById: { not: user.id } },
        select: {
          id: true,
          reference: true,
          amount: true,
          createdAt: true,
          centre: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      for (const r of rows) {
        const days = age(r.createdAt);
        items.push({
          key: `payment-${r.id}`,
          kind: 'Receipt',
          action,
          title: `${r.reference ?? 'Receipt'} · ${moneyString(dec(r.amount))}`,
          centre: centreName(r.centre),
          ageDays: days,
          severity: stale(days),
          link: `/payments/${r.id}`,
        });
      }
    }

    const decide = scopeFor('adjustments.approve');
    if (decide) {
      const [adjustments, openings] = await Promise.all([
        this.prisma.adjustment.findMany({
          where: {
            organizationId: org,
            ...decide.where,
            status: 'PENDING',
            createdById: { not: user.id },
          },
          select: {
            id: true,
            type: true,
            amount: true,
            createdAt: true,
            receivable: { select: { reference: true } },
            centre: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 100,
        }),
        this.prisma.openingBalance.findMany({
          where: {
            organizationId: org,
            ...decide.where,
            status: 'PENDING',
            createdById: { not: user.id },
          },
          select: {
            id: true,
            asAt: true,
            amount: true,
            createdAt: true,
            centre: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 100,
        }),
      ]);
      for (const r of adjustments) {
        const days = age(r.createdAt);
        items.push({
          key: `adjustment-${r.id}`,
          kind: `${r.type === 'CREDIT' ? 'Credit' : 'Debit'} adjustment`,
          action: 'Approve or reject',
          title: `${r.receivable.reference} · ${moneyString(dec(r.amount))}`,
          centre: centreName(r.centre),
          ageDays: days,
          severity: stale(days),
          link: '/adjustments',
        });
      }
      for (const r of openings) {
        const days = age(r.createdAt);
        items.push({
          key: `opening-${r.id}`,
          kind: 'Opening balance',
          action: 'Approve or reject',
          title: `as at ${r.asAt.toISOString().slice(0, 10)} · ${moneyString(dec(r.amount))}`,
          centre: centreName(r.centre),
          ageDays: days,
          severity: stale(days),
          link: '/adjustments?tab=opening-balances',
        });
      }
    }

    const disputes = scopeFor('disputes.manage');
    if (disputes) {
      const rows = await this.prisma.dispute.findMany({
        where: { organizationId: org, ...disputes.where, status: 'OPEN' },
        select: {
          id: true,
          amount: true,
          raisedAt: true,
          receivable: { select: { reference: true } },
          centre: { select: { code: true, name: true } },
        },
        orderBy: { raisedAt: 'asc' },
        take: 100,
      });
      for (const r of rows) {
        const days = age(r.raisedAt);
        items.push({
          key: `dispute-${r.id}`,
          kind: 'Dispute',
          action: 'Resolve',
          title: `${r.receivable.reference} · ${moneyString(dec(r.amount))} disputed`,
          centre: centreName(r.centre),
          ageDays: days,
          severity: days > 30 ? 'urgent' : days > 14 ? 'attention' : 'info',
          link: '/adjustments?tab=disputes',
        });
      }
    }

    const allocate = scopeFor('payments.allocate');
    if (allocate) {
      const rows = await this.prisma.payment.findMany({
        where: {
          organizationId: org,
          ...allocate.where,
          status: 'POSTED',
          unallocatedAmount: { gt: 0 },
        },
        select: {
          id: true,
          reference: true,
          unallocatedAmount: true,
          receiptDate: true,
          centre: { select: { code: true, name: true } },
        },
        orderBy: { receiptDate: 'asc' },
        take: 100,
      });
      for (const r of rows) {
        const days = age(r.receiptDate);
        if (days < UNALLOCATED_AFTER_DAYS) continue;
        items.push({
          key: `unallocated-${r.id}`,
          kind: 'Unallocated cash',
          action: 'Allocate',
          title: `${r.reference ?? 'Receipt'} · ${moneyString(dec(r.unallocatedAmount))} unallocated`,
          centre: centreName(r.centre),
          ageDays: days,
          severity: days > 30 ? 'urgent' : 'attention',
          link: `/payments/${r.id}`,
        });
      }
    }

    const dashboard = scopeFor('dashboard.read');
    if (dashboard) {
      const status = await loadReportingStatus(this.prisma, dashboard.user, today);
      for (const c of status.filter((s) => s.late)) {
        items.push({
          key: `late-${c.centreId}`,
          kind: 'Late report',
          action: 'Chase the centre',
          title:
            c.daysSince === null
              ? 'Has never reported'
              : `Last report ended ${c.daysSince} days ago`,
          centre: `${c.code} · ${c.name}`,
          ageDays: c.daysSince ?? 0,
          severity: c.daysSince === null || c.daysSince > 14 ? 'urgent' : 'attention',
          link: `/imports?centreId=${c.centreId}`,
        });
      }
    }

    const receivables = scopeFor('receivables.read');
    if (receivables) {
      const old = await this.prisma.receivable.findMany({
        where: {
          organizationId: org,
          ...receivables.where,
          balance: { gt: 0 },
          dueDate: { lt: new Date(todayDate.getTime() - 90 * 86_400_000) },
          status: { not: 'DISPUTED' },
        },
        select: {
          id: true,
          reference: true,
          balance: true,
          dueDate: true,
          centre: { select: { code: true, name: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 50,
      });
      for (const r of old) {
        items.push({
          key: `overdue-${r.id}`,
          kind: 'Long overdue',
          action: 'Follow up',
          title: `${r.reference} · ${moneyString(dec(r.balance))}`,
          centre: centreName(r.centre),
          ageDays: age(r.dueDate),
          severity: 'urgent',
          link: `/receivables/${r.id}`,
        });
      }
    }

    const rank = { urgent: 0, attention: 1, info: 2 } as const;
    items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.ageDays - a.ageDays);
    const counts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1;
      return acc;
    }, {});
    return {
      asAt: today,
      total: items.length,
      urgent: items.filter((i) => i.severity === 'urgent').length,
      counts,
      items: items.slice(0, 300),
    };
  }
}
