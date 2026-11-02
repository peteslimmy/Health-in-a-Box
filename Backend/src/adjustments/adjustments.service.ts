import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { moneyString } from '../common/utils/money';
import { paged, pagination } from '../common/utils/pagination';
import { assertCentreAccess, centreWhere } from '../common/utils/scope';
import { receivableStatusFor } from '../payments/receivable-status';
import { PrismaService } from '../prisma/prisma.service';
import { applyAdjustment, totalDue } from './adjustment-math';
import {
  CreateAdjustmentDto,
  DecisionDto,
  ListQueryDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
} from './dto/adjustment.dto';

const dec = (value: { toString(): string }) => new Decimal(value.toString());

const WHO = { select: { id: true, fullName: true } } as const;
const CENTRE = { select: { id: true, code: true, name: true } } as const;

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const DISPUTE_STATUSES = ['OPEN', 'UPHELD', 'REJECTED', 'WITHDRAWN'];

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private lock(tx: Prisma.TransactionClient, receivableId: string) {
    return tx.$queryRaw`SELECT id FROM "Receivable" WHERE id = ${receivableId}::uuid FOR UPDATE`;
  }

  /** The receivable, only if it is in the caller's organisation and centre scope (404 otherwise). */
  private async receivableFor(user: AuthUser, receivableId: string) {
    const receivable = await this.prisma.receivable.findFirst({
      where: { id: receivableId, organizationId: user.organizationId },
    });
    if (!receivable) throw new NotFoundException('Receivable not found');
    assertCentreAccess(user, receivable.centreId);
    return receivable;
  }

  private checkStatus(value: string | undefined, allowed: string[]) {
    if (value && !allowed.includes(value)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: `Status must be one of ${allowed.join(', ')}`,
      });
    }
  }

  private presentAdjustment<T extends { amount: Prisma.Decimal }>(row: T) {
    return { ...row, amount: moneyString(dec(row.amount)) };
  }

  // ------------------------------------------------------------ adjustments

  async listAdjustments(user: AuthUser, query: ListQueryDto) {
    this.checkStatus(query.status, STATUSES);
    const { page, pageSize, skip, take } = pagination(query);
    const where: Prisma.AdjustmentWhereInput = {
      organizationId: user.organizationId,
      ...centreWhere(user, query.centreId),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.receivableId ? { receivableId: query.receivableId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adjustment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          centre: CENTRE,
          receivable: { select: { id: true, reference: true, balance: true } },
          createdBy: WHO,
          decidedBy: WHO,
        },
      }),
      this.prisma.adjustment.count({ where }),
    ]);
    return paged(
      items.map((row) => ({
        ...this.presentAdjustment(row),
        receivable: { ...row.receivable, balance: moneyString(dec(row.receivable.balance)) },
      })),
      total,
      page,
      pageSize,
    );
  }

  async createAdjustment(user: AuthUser, dto: CreateAdjustmentDto) {
    const receivable = await this.receivableFor(user, dto.receivableId);
    const outcome = applyAdjustment(receivable, dto.type, dto.amount);
    if (!outcome.ok) {
      throw new ConflictException({
        code: outcome.code,
        message: `A credit cannot exceed the balance of ${moneyString(outcome.balance)}; anything already paid in excess is a refund, handled separately`,
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.adjustment.create({
        data: {
          organizationId: user.organizationId,
          centreId: receivable.centreId,
          receivableId: receivable.id,
          type: dto.type,
          amount: dto.amount,
          reasonCode: dto.reasonCode,
          reason: dto.reason.trim(),
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          centreId: receivable.centreId,
          action: 'ADJUSTMENT_PROPOSED',
          targetType: 'Adjustment',
          targetId: created.id,
          summary: `Proposed ${dto.type.toLowerCase()} adjustment of ${dto.amount} on ${receivable.reference}`,
          after: { type: dto.type, amount: dto.amount, reasonCode: dto.reasonCode },
        },
        tx,
      );
      return this.presentAdjustment(created);
    });
  }

  /** Posts the adjustment to the ledger. Only someone other than the proposer may do this. */
  async approveAdjustment(user: AuthUser, id: string) {
    const found = await this.prisma.adjustment.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!found) throw new NotFoundException('Adjustment not found');
    assertCentreAccess(user, found.centreId);
    if (found.createdById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The person who proposed an adjustment cannot approve it',
      });
    }
    if (found.status === 'APPROVED') return { id, status: 'APPROVED', alreadyApproved: true };

    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, found.receivableId);
      const claimed = await tx.adjustment.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_ADJUSTMENT_STATUS',
          message: 'Only a pending adjustment can be approved',
        });
      }
      const receivable = await tx.receivable.findUniqueOrThrow({
        where: { id: found.receivableId },
      });
      const outcome = applyAdjustment(receivable, found.type, found.amount);
      if (!outcome.ok) {
        throw new ConflictException({
          code: outcome.code,
          message: `The balance is now ${moneyString(outcome.balance)}, less than this credit; reject it and propose a smaller one`,
        });
      }
      const open = await tx.dispute.count({
        where: { receivableId: receivable.id, status: 'OPEN' },
      });
      await tx.receivable.update({
        where: { id: receivable.id },
        data: {
          adjustmentTotal: outcome.adjustmentTotal,
          balance: outcome.balance,
          status: receivableStatusFor(
            totalDue({
              originalAmount: receivable.originalAmount,
              adjustmentTotal: outcome.adjustmentTotal,
            }),
            receivable.amountPaid,
            open > 0 ? 'DISPUTED' : 'OPEN',
          ),
        },
      });
      await tx.ledgerEntry.create({
        data: {
          organizationId: user.organizationId,
          centreId: receivable.centreId,
          receivableId: receivable.id,
          type: found.type === 'CREDIT' ? 'ADJUSTMENT_CREDIT' : 'ADJUSTMENT_DEBIT',
          debit: found.type === 'DEBIT' ? found.amount : 0,
          credit: found.type === 'CREDIT' ? found.amount : 0,
          description:
            `${found.type === 'CREDIT' ? 'Credit' : 'Debit'} adjustment: ${found.reason}`.slice(
              0,
              500,
            ),
          occurredAt: new Date(),
          createdById: user.id,
          sourceType: 'Adjustment',
          sourceId: found.id,
        },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          centreId: receivable.centreId,
          action: 'ADJUSTMENT_APPROVED',
          targetType: 'Adjustment',
          targetId: found.id,
          summary: `Approved ${found.type.toLowerCase()} adjustment of ${moneyString(dec(found.amount))} on ${receivable.reference}`,
          after: { balance: moneyString(outcome.balance) },
        },
        tx,
      );
      return {
        id,
        status: 'APPROVED',
        alreadyApproved: false,
        balance: moneyString(outcome.balance),
      };
    });
  }

  async rejectAdjustment(user: AuthUser, id: string, dto: DecisionDto) {
    const found = await this.prisma.adjustment.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!found) throw new NotFoundException('Adjustment not found');
    assertCentreAccess(user, found.centreId);
    if (found.createdById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The person who proposed an adjustment cannot decide it; withdraw it instead',
      });
    }
    if (!dto.note?.trim()) {
      throw new BadRequestException({
        code: 'NOTE_REQUIRED',
        message: 'Say why the adjustment is rejected',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.adjustment.updateMany({
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
          code: 'INVALID_ADJUSTMENT_STATUS',
          message: 'Only a pending adjustment can be rejected',
        });
      }
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          centreId: found.centreId,
          action: 'ADJUSTMENT_REJECTED',
          targetType: 'Adjustment',
          targetId: id,
          summary: `Rejected adjustment: ${dto.note?.trim()}`,
        },
        tx,
      );
      return { id, status: 'REJECTED' };
    });
  }

  // --------------------------------------------------------------- disputes

  async listDisputes(user: AuthUser, query: ListQueryDto) {
    this.checkStatus(query.status, DISPUTE_STATUSES);
    const { page, pageSize, skip, take } = pagination(query);
    const where: Prisma.DisputeWhereInput = {
      organizationId: user.organizationId,
      ...centreWhere(user, query.centreId),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.receivableId ? { receivableId: query.receivableId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where,
        orderBy: { raisedAt: 'desc' },
        skip,
        take,
        include: {
          centre: CENTRE,
          receivable: { select: { id: true, reference: true, balance: true } },
          raisedBy: WHO,
          resolvedBy: WHO,
        },
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return paged(
      items.map((row) => ({
        ...this.presentAdjustment(row),
        receivable: { ...row.receivable, balance: moneyString(dec(row.receivable.balance)) },
      })),
      total,
      page,
      pageSize,
    );
  }

  async raiseDispute(user: AuthUser, dto: RaiseDisputeDto) {
    const receivable = await this.receivableFor(user, dto.receivableId);
    return this.prisma
      .$transaction(async (tx) => {
        await this.lock(tx, receivable.id);
        const current = await tx.receivable.findUniqueOrThrow({ where: { id: receivable.id } });
        if (dec(current.balance).lte(0)) {
          throw new ConflictException({
            code: 'NOTHING_TO_DISPUTE',
            message: 'This receivable is already settled',
          });
        }
        if (new Decimal(dto.amount).gt(dec(current.balance))) {
          throw new ConflictException({
            code: 'DISPUTE_EXCEEDS_BALANCE',
            message: `The disputed amount cannot exceed the balance of ${moneyString(dec(current.balance))}`,
          });
        }
        const dispute = await tx.dispute.create({
          data: {
            organizationId: user.organizationId,
            centreId: current.centreId,
            receivableId: current.id,
            amount: dto.amount,
            reason: dto.reason.trim(),
            raisedById: user.id,
          },
        });
        await tx.receivable.update({ where: { id: current.id }, data: { status: 'DISPUTED' } });
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            centreId: current.centreId,
            action: 'DISPUTE_RAISED',
            targetType: 'Dispute',
            targetId: dispute.id,
            summary: `Dispute of ${dto.amount} raised on ${current.reference}`,
            after: { amount: dto.amount },
          },
          tx,
        );
        return this.presentAdjustment(dispute);
      })
      .catch((error: unknown) => {
        // The database allows only one open dispute per receivable.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException({
            code: 'DISPUTE_ALREADY_OPEN',
            message: 'This receivable already has an open dispute; resolve it first',
          });
        }
        throw error;
      });
  }

  async resolveDispute(user: AuthUser, id: string, dto: ResolveDisputeDto) {
    const found = await this.prisma.dispute.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!found) throw new NotFoundException('Dispute not found');
    assertCentreAccess(user, found.centreId);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, found.receivableId);
      const claimed = await tx.dispute.updateMany({
        where: { id, status: 'OPEN' },
        data: {
          status: dto.outcome,
          resolvedById: user.id,
          resolvedAt: new Date(),
          resolutionNote: dto.note.trim(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'DISPUTE_NOT_OPEN',
          message: 'This dispute has already been resolved',
        });
      }
      let adjustmentId: string | null = null;
      if (dto.outcome === 'UPHELD' && dto.proposeCredit) {
        // The credit still needs a second person's approval before it touches the ledger.
        const adjustment = await tx.adjustment.create({
          data: {
            organizationId: user.organizationId,
            centreId: found.centreId,
            receivableId: found.receivableId,
            type: 'CREDIT',
            amount: found.amount,
            reasonCode: 'DISPUTE_UPHELD',
            reason: `Dispute upheld: ${dto.note.trim()}`.slice(0, 1000),
            createdById: user.id,
            disputeId: found.id,
          },
        });
        adjustmentId = adjustment.id;
        await tx.dispute.update({ where: { id }, data: { adjustmentId } });
      }
      const receivable = await tx.receivable.findUniqueOrThrow({
        where: { id: found.receivableId },
      });
      await tx.receivable.update({
        where: { id: receivable.id },
        data: {
          status: receivableStatusFor(totalDue(receivable), receivable.amountPaid, 'OPEN'),
        },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          centreId: found.centreId,
          action: 'DISPUTE_RESOLVED',
          targetType: 'Dispute',
          targetId: id,
          summary: `Dispute ${dto.outcome.toLowerCase()}: ${dto.note.trim()}`.slice(0, 500),
          after: { outcome: dto.outcome, adjustmentId },
        },
        tx,
      );
      return { id, status: dto.outcome, adjustmentId };
    });
  }
}
