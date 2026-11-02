import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AuthUser } from '../common/types/auth-user';
import { AGEING_BUCKETS, AgeingBucket, ageingBucket, daysOverdue } from '../common/utils/ageing';
import { dateInTimeZone, dateOnly, parseDate } from '../common/utils/dates';
import { moneyString } from '../common/utils/money';
import { paged, pagination } from '../common/utils/pagination';
import { assertCentreAccess } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import { AgeingQueryDto, ReceivableQueryDto } from './dto/receivable.dto';

/** D-016 default business time zone, used when no centre-specific date is involved. */
const DEFAULT_TIME_ZONE = 'Africa/Lagos';

const dec = (value: { toString(): string }) => new Decimal(value.toString());

@Injectable()
export class ReceivablesService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser): Prisma.ReceivableWhereInput {
    return {
      organizationId: user.organizationId,
      ...(user.allCentres ? {} : { centreId: { in: user.centreIds } }),
    };
  }

  private asAt(value?: string): Date {
    return parseDate(value ?? dateInTimeZone(new Date(), DEFAULT_TIME_ZONE), 'asAt');
  }

  async list(user: AuthUser, query: ReceivableQueryDto) {
    const { page, pageSize, skip, take } = pagination(query);
    if (query.centreId) assertCentreAccess(user, query.centreId);
    const asAt = this.asAt(query.asAt);
    const where: Prisma.ReceivableWhereInput = {
      ...this.scope(user),
      ...(query.centreId ? { centreId: query.centreId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.openOnly || query.overdueOnly ? { balance: { gt: 0 } } : {}),
      ...(query.overdueOnly ? { dueDate: { lt: asAt } } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.receivable.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        skip,
        take,
        include: { centre: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.receivable.count({ where }),
    ]);
    return paged(
      items.map((item) => ({
        ...item,
        asAt: dateOnly(asAt),
        daysOverdue: dec(item.balance).gt(0) ? daysOverdue(item.dueDate, asAt) : 0,
        ageingBucket: ageingBucket(item.dueDate, asAt, item.balance),
      })),
      total,
      page,
      pageSize,
    );
  }

  /**
   * One receivable with its full history. `ledger` re-derives the balance from the posted ledger
   * entries so a screen (or an auditor) can see that the stored balance agrees with them (INV-008).
   */
  async get(user: AuthUser, id: string, asAtValue?: string) {
    const receivable = await this.prisma.receivable.findFirst({
      where: { id, ...this.scope(user) },
      include: {
        centre: { select: { id: true, code: true, name: true } },
        ledgerEntries: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
        allocations: {
          orderBy: { allocatedAt: 'asc' },
          include: { payment: { select: { id: true, reference: true, receiptDate: true } } },
        },
        chargeRun: { select: { id: true, periodStart: true, periodEnd: true, status: true } },
      },
    });
    if (!receivable) throw new NotFoundException('Receivable not found');
    assertCentreAccess(user, receivable.centreId);

    const debit = receivable.ledgerEntries.reduce(
      (sum, e) => sum.plus(dec(e.debit)),
      new Decimal(0),
    );
    const credit = receivable.ledgerEntries.reduce(
      (sum, e) => sum.plus(dec(e.credit)),
      new Decimal(0),
    );
    const derived = debit.minus(credit);
    const asAt = this.asAt(asAtValue);
    return {
      ...receivable,
      asAt: dateOnly(asAt),
      daysOverdue: dec(receivable.balance).gt(0) ? daysOverdue(receivable.dueDate, asAt) : 0,
      ageingBucket: ageingBucket(receivable.dueDate, asAt, receivable.balance),
      ledger: {
        debit: moneyString(debit),
        credit: moneyString(credit),
        derivedBalance: moneyString(derived),
        storedBalance: moneyString(dec(receivable.balance)),
        consistent: derived.eq(dec(receivable.balance)),
      },
    };
  }

  /** Open receivables per ageing bucket, per centre and in total, as at a date (RPT-004). */
  async ageing(user: AuthUser, query: AgeingQueryDto) {
    if (query.centreId) assertCentreAccess(user, query.centreId);
    const asAt = this.asAt(query.asAt);
    // Aggregate in the database by (centre, due date): the number of rows returned is bounded by
    // the number of distinct due dates, not by the number of receivables.
    const groups = await this.prisma.receivable.groupBy({
      by: ['centreId', 'dueDate'],
      where: {
        ...this.scope(user),
        ...(query.centreId ? { centreId: query.centreId } : {}),
        balance: { gt: 0 },
      },
      _sum: { balance: true },
    });
    const centres = await this.prisma.centre.findMany({
      where: { id: { in: [...new Set(groups.map((group) => group.centreId))] } },
      select: { id: true, code: true, name: true },
    });
    const centreById = new Map(centres.map((centre) => [centre.id, centre]));
    type Totals = Record<AgeingBucket, Decimal>;
    const empty = (): Totals =>
      ({
        SETTLED: new Decimal(0),
        ...Object.fromEntries(AGEING_BUCKETS.map((b) => [b, new Decimal(0)])),
      }) as Totals;
    const total = empty();
    const byCentre = new Map<string, { code: string; name: string; buckets: Totals }>();
    for (const group of groups) {
      const amount = dec(group._sum.balance ?? 0);
      const bucket = ageingBucket(group.dueDate, asAt, amount);
      total[bucket] = total[bucket].plus(amount);
      const centre = centreById.get(group.centreId);
      const entry = byCentre.get(group.centreId) ?? {
        code: centre?.code ?? group.centreId,
        name: centre?.name ?? '',
        buckets: empty(),
      };
      entry.buckets[bucket] = entry.buckets[bucket].plus(amount);
      byCentre.set(group.centreId, entry);
    }
    const format = (totals: Totals): Record<string, string> => ({
      ...Object.fromEntries(AGEING_BUCKETS.map((b) => [b, moneyString(totals[b])])),
      outstanding: moneyString(AGEING_BUCKETS.reduce((s, b) => s.plus(totals[b]), new Decimal(0))),
      overdue: moneyString(
        AGEING_BUCKETS.filter((b) => b !== 'NOT_YET_DUE').reduce(
          (s, b) => s.plus(totals[b]),
          new Decimal(0),
        ),
      ),
    });
    return {
      asAt: dateOnly(asAt),
      currency: 'NGN',
      total: format(total),
      centres: [...byCentre.entries()].map(([centreId, value]) => ({
        centreId,
        code: value.code,
        name: value.name,
        ...format(value.buckets),
      })),
    };
  }
}
