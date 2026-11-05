import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { dateInTimeZone, parseDate } from '../common/utils/dates';
import { moneyString } from '../common/utils/money';
import { paged, pagination } from '../common/utils/pagination';
import { assertHospitalAccess, hospitalWhere } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOpeningBalanceDto, DecisionDto, ListQueryDto } from './dto/adjustment.dto';

const WHO = { select: { id: true, fullName: true } } as const;

@Injectable()
export class OpeningBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: ListQueryDto) {
    if (query.status && !['PENDING', 'APPROVED', 'REJECTED'].includes(query.status)) {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: 'Unknown status' });
    }
    const { page, pageSize, skip, take } = pagination(query);
    const where: Prisma.OpeningBalanceWhereInput = {
      organizationId: user.organizationId,
      ...hospitalWhere(user, query.hospitalId),
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.openingBalance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          hospital: { select: { id: true, code: true, name: true } },
          receivable: { select: { id: true, reference: true } },
          createdBy: WHO,
          decidedBy: WHO,
        },
      }),
      this.prisma.openingBalance.count({ where }),
    ]);
    return paged(
      items.map((row) => ({ ...row, amount: moneyString(new Decimal(row.amount.toString())) })),
      total,
      page,
      pageSize,
    );
  }

  /**
   * Opening balances stand in for everything owed before the platform. They must not overlap
   * periods the platform has charged itself, or the same revenue would be billed twice.
   */
  private async assertNoOverlap(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    hospitalId: string,
    asAt: Date,
  ) {
    const overlapping = await client.chargeRun.findFirst({
      where: { organizationId, hospitalId, status: 'POSTED', periodStart: { lte: asAt } },
      select: { periodStart: true, periodEnd: true },
      orderBy: { periodStart: 'asc' },
    });
    if (overlapping) {
      throw new ConflictException({
        code: 'OPENING_OVERLAPS_HISTORY',
        message: `Charges were already posted from ${overlapping.periodStart.toISOString().slice(0, 10)}, on or before the as-at date; an opening balance would count those periods twice`,
      });
    }
  }

  async create(user: AuthUser, dto: CreateOpeningBalanceDto) {
    assertHospitalAccess(user, dto.hospitalId);
    const hospital = await this.prisma.hospital.findFirst({
      where: { id: dto.hospitalId, organizationId: user.organizationId },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    if (hospital.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'HOSPITAL_NOT_ACTIVE',
        message: `The hospital is ${hospital.status.toLowerCase()}; activate it first`,
      });
    }
    const asAt = parseDate(dto.asAt, 'asAt');
    const dueDate = parseDate(dto.dueDate, 'dueDate');
    if (asAt.toISOString().slice(0, 10) > dateInTimeZone(new Date(), hospital.timezone)) {
      throw new BadRequestException({
        code: 'AS_AT_IN_FUTURE',
        message: 'An opening balance cannot be stated as at a future date',
      });
    }
    await this.assertNoOverlap(this.prisma, user.organizationId, hospital.id, asAt);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.openingBalance.create({
          data: {
            organizationId: user.organizationId,
            hospitalId: hospital.id,
            asAt,
            amount: dto.amount,
            dueDate,
            sourceNote: dto.sourceNote.trim(),
            createdById: user.id,
          },
        });
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            hospitalId: hospital.id,
            action: 'OPENING_BALANCE_PROPOSED',
            targetType: 'OpeningBalance',
            targetId: created.id,
            summary: `Proposed opening balance of ${dto.amount} as at ${dto.asAt}`,
            after: { amount: dto.amount, asAt: dto.asAt },
          },
          tx,
        );
        return { ...created, amount: dto.amount };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'OPENING_BALANCE_EXISTS',
          message: 'This hospital already has an opening balance as at that date',
        });
      }
      throw error;
    }
  }

  async approve(user: AuthUser, id: string) {
    const found = await this.prisma.openingBalance.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { hospital: true },
    });
    if (!found) throw new NotFoundException('Opening balance not found');
    assertHospitalAccess(user, found.hospitalId);
    if (found.createdById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The person who proposed an opening balance cannot approve it',
      });
    }
    if (found.status === 'APPROVED') return { id, status: 'APPROVED', alreadyApproved: true };

    return this.prisma.$transaction(async (tx) => {
      // History may have been posted since it was proposed.
      await this.assertNoOverlap(tx, user.organizationId, found.hospitalId, found.asAt);
      const asAtText = found.asAt.toISOString().slice(0, 10);
      const receivable = await tx.receivable.create({
        data: {
          organizationId: user.organizationId,
          hospitalId: found.hospitalId,
          reference: `OB-${found.hospital.code}-${asAtText.replace(/-/g, '')}`,
          description: `Opening balance as at ${asAtText}`,
          originalAmount: found.amount,
          balance: found.amount,
          dueDate: found.dueDate,
        },
      });
      // Approval and the link to its receivable happen in one statement (the database requires both together).
      const claimed = await tx.openingBalance.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          decidedById: user.id,
          decidedAt: new Date(),
          receivableId: receivable.id,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_OPENING_STATUS',
          message: 'Only a pending opening balance can be approved',
        });
      }
      await tx.ledgerEntry.create({
        data: {
          organizationId: user.organizationId,
          hospitalId: found.hospitalId,
          receivableId: receivable.id,
          type: 'OPENING_BALANCE',
          debit: found.amount,
          credit: 0,
          description: `Opening balance as at ${asAtText}`,
          occurredAt: new Date(),
          createdById: user.id,
          sourceType: 'OpeningBalance',
          sourceId: found.id,
        },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: found.hospitalId,
          action: 'OPENING_BALANCE_APPROVED',
          targetType: 'OpeningBalance',
          targetId: id,
          summary: `Approved opening balance ${receivable.reference}`,
          after: { receivableId: receivable.id },
        },
        tx,
      );
      return { id, status: 'APPROVED', alreadyApproved: false, receivableId: receivable.id };
    });
  }

  async reject(user: AuthUser, id: string, dto: DecisionDto) {
    const found = await this.prisma.openingBalance.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!found) throw new NotFoundException('Opening balance not found');
    assertHospitalAccess(user, found.hospitalId);
    if (found.createdById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The person who proposed an opening balance cannot decide it',
      });
    }
    if (!dto.note?.trim()) {
      throw new BadRequestException({ code: 'NOTE_REQUIRED', message: 'Say why it is rejected' });
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.openingBalance.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedById: user.id,
          decidedAt: new Date(),
          decisionNote: dto.note?.trim(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_OPENING_STATUS',
          message: 'Only a pending opening balance can be rejected',
        });
      }
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: found.hospitalId,
          action: 'OPENING_BALANCE_REJECTED',
          targetType: 'OpeningBalance',
          targetId: id,
          summary: `Rejected opening balance: ${dto.note?.trim()}`,
        },
        tx,
      );
      return { id, status: 'REJECTED' };
    });
  }
}
