import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { Decimal } from 'decimal.js';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { dateInTimeZone, dateOnly, parseDate } from '../common/utils/dates';
import { moneyString, parseMoney } from '../common/utils/money';
import { paged, pagination } from '../common/utils/pagination';
import { assertHospitalAccess } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  AllocatePaymentDto,
  CreatePaymentDto,
  PaymentQueryDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import { receivableStatusFor } from './receivable-status';

/** Receipts that no longer count when checking for duplicates. */
const DEAD_STATUSES: PaymentStatus[] = [PaymentStatus.REJECTED, PaymentStatus.REVERSED];

const dec = (value: { toString(): string }) => new Decimal(value.toString());

type Client = Prisma.TransactionClient | PrismaService;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- reads

  private scope(user: AuthUser): Prisma.PaymentWhereInput {
    return {
      organizationId: user.organizationId,
      ...(user.allHospitals ? {} : { hospitalId: { in: user.hospitalIds } }),
    };
  }

  private async page(user: AuthUser, query: PaymentQueryDto, extra: Prisma.PaymentWhereInput = {}) {
    const { page, pageSize, skip, take } = pagination(query);
    if (query.hospitalId) assertHospitalAccess(user, query.hospitalId);
    const where: Prisma.PaymentWhereInput = {
      ...this.scope(user),
      ...extra,
      ...(query.hospitalId ? { hospitalId: query.hospitalId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            receiptDate: {
              ...(query.from ? { gte: parseDate(query.from, 'from') } : {}),
              ...(query.to ? { lte: parseDate(query.to, 'to') } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { payerName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          hospital: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  list(user: AuthUser, query: PaymentQueryDto) {
    return this.page(user, query);
  }

  /** Worklist: posted receipts with cash not yet allocated (reported separately from receivables). */
  unallocated(user: AuthUser, query: PaymentQueryDto) {
    return this.page(
      user,
      { ...query, status: undefined },
      { status: PaymentStatus.POSTED, unallocatedAmount: { gt: 0 } },
    );
  }

  async get(user: AuthUser, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, ...this.scope(user) },
      omit: { evidenceKey: true }, // internal storage key
      include: {
        hospital: { select: { id: true, code: true, name: true, status: true, timezone: true } },
        createdBy: { select: { id: true, fullName: true } },
        allocations: {
          orderBy: { allocatedAt: 'asc' },
          include: {
            receivable: { select: { id: true, reference: true, dueDate: true, balance: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    assertHospitalAccess(user, payment.hospitalId);
    return payment;
  }

  // ---------------------------------------------------------- draft stage

  async create(user: AuthUser, dto: CreatePaymentDto) {
    const hospital = await this.activeHospital(user, dto.hospitalId);
    const amount = this.positiveAmount(dto.amount);
    const receiptDate = this.pastOrToday(dto.receiptDate, hospital.timezone);
    const reference = dto.reference?.trim() || null;
    await this.assertNotDuplicate(this.prisma, {
      hospitalId: hospital.id,
      reference,
      receiptDate,
      amount,
      confirmed: dto.confirmPossibleDuplicate,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            organizationId: user.organizationId,
            hospitalId: hospital.id,
            receiptDate,
            amount,
            unallocatedAmount: amount,
            method: dto.method.trim().toUpperCase(),
            reference,
            payerName: dto.payerName?.trim() || null,
            notes: dto.notes?.trim() || null,
            status: PaymentStatus.DRAFT,
            createdById: user.id,
          },
        });
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            hospitalId: hospital.id,
            action: 'PAYMENT_CREATED',
            targetType: 'Payment',
            targetId: created.id,
            summary: `Recorded draft receipt ${reference ?? created.id} for ${moneyString(amount)}`,
            after: {
              status: created.status,
              amount: moneyString(amount),
              receiptDate: dateOnly(receiptDate),
              reference,
            },
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      throw this.mapDuplicateReference(error);
    }
  }

  async update(user: AuthUser, id: string, dto: UpdatePaymentDto) {
    const existing = await this.get(user, id);
    if (existing.createdById !== user.id) {
      throw new ForbiddenException({
        code: 'NOT_PAYMENT_OWNER',
        message: 'Only the person who recorded a draft receipt can edit it',
      });
    }
    if (existing.status !== PaymentStatus.DRAFT && existing.status !== PaymentStatus.REJECTED) {
      throw new ConflictException({
        code: 'INVALID_PAYMENT_STATUS',
        message: 'Only draft or rejected receipts can be edited',
      });
    }
    const amount =
      dto.amount !== undefined ? this.positiveAmount(dto.amount) : dec(existing.amount);
    const receiptDate = dto.receiptDate
      ? this.pastOrToday(dto.receiptDate, existing.hospital.timezone)
      : existing.receiptDate;
    const reference =
      dto.reference !== undefined ? dto.reference.trim() || null : existing.reference;
    await this.assertNotDuplicate(this.prisma, {
      hospitalId: existing.hospitalId,
      reference,
      receiptDate,
      amount,
      confirmed: dto.confirmPossibleDuplicate,
      excludeId: id,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await tx.payment.updateMany({
          where: { id, status: existing.status, createdById: user.id },
          data: {
            status: PaymentStatus.DRAFT,
            rejectionReason: null,
            amount,
            unallocatedAmount: amount,
            receiptDate,
            reference,
            ...(dto.method !== undefined ? { method: dto.method.trim().toUpperCase() } : {}),
            ...(dto.payerName !== undefined ? { payerName: dto.payerName.trim() || null } : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          },
        });
        if (result.count === 0) {
          throw new ConflictException({
            code: 'INVALID_PAYMENT_STATUS',
            message: 'The receipt changed while you were editing it',
          });
        }
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            hospitalId: existing.hospitalId,
            action: 'PAYMENT_UPDATED',
            targetType: 'Payment',
            targetId: id,
            summary: 'Edited draft receipt',
            before: {
              amount: moneyString(dec(existing.amount)),
              receiptDate: dateOnly(existing.receiptDate),
              reference: existing.reference,
            },
            after: {
              amount: moneyString(amount),
              receiptDate: dateOnly(receiptDate),
              reference,
            },
          },
          tx,
        );
        return tx.payment.findUniqueOrThrow({ where: { id } });
      });
    } catch (error) {
      throw this.mapDuplicateReference(error);
    }
  }

  // ------------------------------------------------- approval lifecycle

  submit(user: AuthUser, id: string) {
    return this.transition(user, id, {
      from: [PaymentStatus.DRAFT],
      to: PaymentStatus.SUBMITTED,
      action: 'PAYMENT_SUBMITTED',
      summary: 'Submitted receipt for approval',
      check: (payment) => {
        if (payment.createdById !== user.id) {
          throw new ForbiddenException({
            code: 'NOT_PAYMENT_OWNER',
            message: 'Only the person who recorded a receipt can submit it',
          });
        }
      },
      data: { submittedById: user.id, submittedAt: new Date() },
    });
  }

  approve(user: AuthUser, id: string) {
    return this.transition(user, id, {
      from: [PaymentStatus.SUBMITTED],
      to: PaymentStatus.APPROVED,
      action: 'PAYMENT_APPROVED',
      summary: 'Approved receipt',
      check: (payment) => this.assertNotMaker(user, payment.createdById, 'approve'),
      data: { approvedById: user.id, approvedAt: new Date(), rejectionReason: null },
    });
  }

  reject(user: AuthUser, id: string, reason: string) {
    return this.transition(user, id, {
      from: [PaymentStatus.SUBMITTED],
      to: PaymentStatus.REJECTED,
      action: 'PAYMENT_REJECTED',
      summary: 'Rejected receipt',
      reason,
      check: (payment) => this.assertNotMaker(user, payment.createdById, 'reject'),
      data: { rejectionReason: reason },
    });
  }

  post(user: AuthUser, id: string) {
    return this.transition(user, id, {
      from: [PaymentStatus.APPROVED],
      to: PaymentStatus.POSTED,
      action: 'PAYMENT_POSTED',
      summary: 'Posted receipt as received funds',
      requireActiveHospital: true,
      check: (payment) => this.assertNotMaker(user, payment.createdById, 'post'),
      data: { postedById: user.id, postedAt: new Date() },
    });
  }

  /**
   * Reverses a posted receipt (returned or bounced). Allocations must be reversed first, so the
   * receipt's cash is fully unallocated; the original record and all history stay visible.
   */
  async reverse(user: AuthUser, id: string, reason: string) {
    const existing = await this.get(user, id);
    this.assertNotMaker(user, existing.createdById, 'reverse');
    await this.prisma.$transaction(async (tx) => {
      await this.lockPayment(tx, id);
      const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (payment.status !== PaymentStatus.POSTED) {
        throw new ConflictException({
          code: 'INVALID_PAYMENT_STATUS',
          message: 'Only posted receipts can be reversed',
        });
      }
      if (!dec(payment.unallocatedAmount).eq(dec(payment.amount))) {
        throw new ConflictException({
          code: 'PAYMENT_HAS_ALLOCATIONS',
          message: "Reverse the receipt's allocations before reversing the receipt",
        });
      }
      await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.REVERSED,
          reversalReason: reason,
          reversedById: user.id,
          reversedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: payment.hospitalId,
          action: 'PAYMENT_REVERSED',
          targetType: 'Payment',
          targetId: id,
          summary: 'Reversed receipt',
          before: { status: payment.status },
          after: { status: PaymentStatus.REVERSED, reason },
        },
        tx,
      );
    });
    return this.get(user, id);
  }

  // ------------------------------------------------------ allocation

  /** Suggestion only: oldest due date first. Nothing is committed (doc 05, Journey C step 5). */
  async allocationPreview(user: AuthUser, id: string) {
    const payment = await this.get(user, id);
    if (payment.status !== PaymentStatus.POSTED) {
      throw new ConflictException({
        code: 'INVALID_PAYMENT_STATUS',
        message: 'Only posted receipts can be allocated',
      });
    }
    const receivables = await this.prisma.receivable.findMany({
      where: {
        organizationId: user.organizationId,
        hospitalId: payment.hospitalId,
        balance: { gt: 0 },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    let remaining = dec(payment.unallocatedAmount);
    const suggestion: Array<{ receivableId: string; amount: string }> = [];
    for (const receivable of receivables) {
      if (remaining.lte(0)) break;
      const amount = Decimal.min(remaining, dec(receivable.balance));
      suggestion.push({ receivableId: receivable.id, amount: moneyString(amount) });
      remaining = remaining.minus(amount);
    }
    return {
      payment: {
        id: payment.id,
        amount: moneyString(dec(payment.amount)),
        unallocatedAmount: moneyString(dec(payment.unallocatedAmount)),
      },
      receivables: receivables.map((receivable) => ({
        id: receivable.id,
        reference: receivable.reference,
        description: receivable.description,
        dueDate: dateOnly(receivable.dueDate),
        balance: moneyString(dec(receivable.balance)),
        status: receivable.status,
      })),
      suggestion,
      unallocatedAfterSuggestion: moneyString(remaining),
    };
  }

  /**
   * Allocates a posted receipt to one or more receivables, atomically.
   *
   * The payment row and every target receivable row are locked (payment first, receivables in id
   * order, so concurrent requests cannot deadlock) before balances are read, so two users can
   * never spend the same cash or the same balance twice. Either every allocation is committed
   * or none is. A repeated Idempotency-Key returns the original outcome.
   */
  async allocate(user: AuthUser, id: string, dto: AllocatePaymentDto, idempotencyKey?: string) {
    const existing = await this.get(user, id);
    const requested = dto.allocations.map((item) => ({
      receivableId: item.receivableId,
      amount: this.positiveAmount(item.amount, 'allocation amount'),
    }));
    if (
      idempotencyKey !== undefined &&
      (idempotencyKey.length < 8 || idempotencyKey.length > 128)
    ) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be 8 to 128 characters',
      });
    }
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify(
          requested
            .map((r) => [r.receivableId, r.amount.toFixed(2)])
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
      .digest('hex');
    const endpoint = `POST /payments/${id}/allocations`;
    const receivableIds = requested.map((r) => r.receivableId).sort();

    return this.prisma.$transaction(async (tx) => {
      await this.lockPayment(tx, id);

      if (idempotencyKey) {
        const prior = await tx.idempotencyKey.findUnique({
          where: {
            organizationId_userId_endpoint_key: {
              organizationId: user.organizationId,
              userId: user.id,
              endpoint,
              key: idempotencyKey,
            },
          },
        });
        if (prior) {
          const stored = prior.response as { requestHash: string; result: unknown };
          if (stored.requestHash !== requestHash) {
            throw new UnprocessableEntityException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'This Idempotency-Key was already used with a different request',
            });
          }
          return stored.result;
        }
      }

      const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (payment.status !== PaymentStatus.POSTED) {
        throw new ConflictException({
          code: 'INVALID_PAYMENT_STATUS',
          message: 'Only posted receipts can be allocated',
        });
      }
      this.assertHospitalActive(existing.hospital.status);

      await tx.$queryRaw`SELECT id FROM "Receivable" WHERE id = ANY(${receivableIds}::uuid[]) ORDER BY id FOR UPDATE`;
      const receivables = await tx.receivable.findMany({
        where: { id: { in: receivableIds }, organizationId: user.organizationId },
      });
      const byId = new Map(receivables.map((r) => [r.id, r]));
      const problems: Array<{ field: string; code: string; message: string }> = [];
      for (const item of requested) {
        const receivable = byId.get(item.receivableId);
        if (!receivable || receivable.hospitalId !== payment.hospitalId) {
          problems.push({
            field: 'receivableId',
            code: 'RECEIVABLE_NOT_FOUND',
            message: `Receivable ${item.receivableId} was not found for this hospital`,
          });
        } else if (item.amount.gt(dec(receivable.balance))) {
          problems.push({
            field: 'amount',
            code: 'OVER_ALLOCATION_RECEIVABLE',
            message: `${receivable.reference}: ${moneyString(item.amount)} exceeds the open balance ${moneyString(
              dec(receivable.balance),
            )}`,
          });
        }
      }
      const total = requested.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
      if (total.gt(dec(payment.unallocatedAmount))) {
        problems.push({
          field: 'allocations',
          code: 'OVER_ALLOCATION_PAYMENT',
          message: `Total ${moneyString(total)} exceeds the unallocated receipt ${moneyString(
            dec(payment.unallocatedAmount),
          )}`,
        });
      }
      if (problems.length > 0) {
        throw new UnprocessableEntityException({
          code: problems[0].code,
          message: 'The allocation cannot be committed',
          details: problems,
        });
      }

      const now = new Date();
      const created: Array<{ id: string; receivableId: string; amount: string; balance: string }> =
        [];
      for (const item of requested) {
        const receivable = byId.get(item.receivableId)!;
        const allocation = await tx.paymentAllocation.create({
          data: {
            paymentId: id,
            receivableId: receivable.id,
            amount: item.amount,
            allocatedById: user.id,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            organizationId: user.organizationId,
            hospitalId: payment.hospitalId,
            receivableId: receivable.id,
            type: 'PAYMENT_ALLOCATION',
            debit: 0,
            credit: item.amount,
            description: `Payment ${payment.reference ?? payment.id} allocated`,
            occurredAt: now,
            createdById: user.id,
            sourceType: 'PaymentAllocation',
            sourceId: allocation.id,
          },
        });
        const paid = dec(receivable.amountPaid).plus(item.amount);
        const balance = dec(receivable.originalAmount)
          .plus(dec(receivable.adjustmentTotal))
          .minus(paid);
        await tx.receivable.update({
          where: { id: receivable.id },
          data: {
            amountPaid: paid,
            balance,
            status: receivableStatusFor(
              dec(receivable.originalAmount).plus(dec(receivable.adjustmentTotal)),
              paid,
              receivable.status,
            ),
          },
        });
        created.push({
          id: allocation.id,
          receivableId: receivable.id,
          amount: moneyString(item.amount),
          balance: moneyString(balance),
        });
      }
      const unallocated = dec(payment.unallocatedAmount).minus(total);
      await tx.payment.update({ where: { id }, data: { unallocatedAmount: unallocated } });

      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: payment.hospitalId,
          action: 'PAYMENT_ALLOCATED',
          targetType: 'Payment',
          targetId: id,
          summary: `Allocated ${moneyString(total)} across ${created.length} receivable(s)`,
          before: { unallocatedAmount: moneyString(dec(payment.unallocatedAmount)) },
          after: {
            unallocatedAmount: moneyString(unallocated),
            allocations: created,
            reason: dto.reason ?? null,
          },
        },
        tx,
      );

      const result = {
        paymentId: id,
        unallocatedAmount: moneyString(unallocated),
        allocations: created,
      };
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            endpoint,
            key: idempotencyKey,
            response: { requestHash, result } as Prisma.InputJsonValue,
          },
        });
      }
      return result;
    });
  }

  /**
   * Reverses one allocation with a compensating ledger debit. The original allocation and credit
   * entry stay on record. The person who made the allocation cannot reverse it.
   */
  async reverseAllocation(user: AuthUser, allocationId: string, reason: string) {
    const found = await this.prisma.paymentAllocation.findFirst({
      where: { id: allocationId, payment: { organizationId: user.organizationId } },
      include: { payment: true },
    });
    if (!found) throw new NotFoundException('Allocation not found');
    assertHospitalAccess(user, found.payment.hospitalId);
    if (found.allocatedById && found.allocatedById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The person who made an allocation cannot reverse it',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockPayment(tx, found.paymentId);
      await tx.$queryRaw`SELECT id FROM "Receivable" WHERE id = ${found.receivableId}::uuid FOR UPDATE`;
      const allocation = await tx.paymentAllocation.findUniqueOrThrow({
        where: { id: allocationId },
      });
      if (allocation.reversedAt) {
        return { allocationId, alreadyReversed: true };
      }
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.paymentId } });
      const receivable = await tx.receivable.findUniqueOrThrow({
        where: { id: allocation.receivableId },
      });
      const amount = dec(allocation.amount);
      const paid = dec(receivable.amountPaid).minus(amount);
      const balance = dec(receivable.originalAmount)
        .plus(dec(receivable.adjustmentTotal))
        .minus(paid);
      const unallocated = dec(payment.unallocatedAmount).plus(amount);
      if (paid.lt(0) || unallocated.gt(dec(payment.amount))) {
        throw new ConflictException({
          code: 'ALLOCATION_STATE_INCONSISTENT',
          message: 'Balances do not allow this reversal; contact an administrator',
        });
      }
      const now = new Date();
      await tx.ledgerEntry.create({
        data: {
          organizationId: user.organizationId,
          hospitalId: payment.hospitalId,
          receivableId: receivable.id,
          type: 'REVERSAL',
          debit: amount,
          credit: 0,
          description: `Reversal of allocation from payment ${payment.reference ?? payment.id}`,
          occurredAt: now,
          createdById: user.id,
          sourceType: 'PaymentAllocationReversal',
          sourceId: allocation.id,
        },
      });
      await tx.receivable.update({
        where: { id: receivable.id },
        data: {
          amountPaid: paid,
          balance,
          status: receivableStatusFor(
            dec(receivable.originalAmount).plus(dec(receivable.adjustmentTotal)),
            paid,
            receivable.status,
          ),
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { unallocatedAmount: unallocated },
      });
      await tx.paymentAllocation.update({
        where: { id: allocation.id },
        data: { reversedAt: now, reversedById: user.id, reversalReason: reason },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: payment.hospitalId,
          action: 'PAYMENT_ALLOCATION_REVERSED',
          targetType: 'PaymentAllocation',
          targetId: allocation.id,
          summary: `Reversed allocation of ${moneyString(amount)}`,
          before: { receivableBalance: moneyString(dec(receivable.balance)) },
          after: { receivableBalance: moneyString(balance), reason },
        },
        tx,
      );
      return {
        allocationId,
        alreadyReversed: false,
        receivableBalance: moneyString(balance),
        unallocatedAmount: moneyString(unallocated),
      };
    });
  }

  // --------------------------------------------------------- helpers

  private async transition(
    user: AuthUser,
    id: string,
    options: {
      from: PaymentStatus[];
      to: PaymentStatus;
      action: string;
      summary: string;
      reason?: string;
      requireActiveHospital?: boolean;
      check?: (payment: Awaited<ReturnType<PaymentsService['get']>>) => void;
      data: Prisma.PaymentUncheckedUpdateManyInput;
    },
  ) {
    const existing = await this.get(user, id);
    if (!options.from.includes(existing.status)) {
      throw new ConflictException({
        code: 'INVALID_PAYMENT_STATUS',
        message: `A ${existing.status.toLowerCase()} receipt cannot be moved to ${options.to.toLowerCase()}`,
      });
    }
    options.check?.(existing);
    if (options.requireActiveHospital) this.assertHospitalActive(existing.hospital.status);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: { id, status: existing.status },
        data: { ...options.data, status: options.to },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'INVALID_PAYMENT_STATUS',
          message: 'The receipt changed state while you were working on it',
        });
      }
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: existing.hospitalId,
          action: options.action,
          targetType: 'Payment',
          targetId: id,
          summary: options.summary,
          before: { status: existing.status },
          after: { status: options.to, ...(options.reason ? { reason: options.reason } : {}) },
        },
        tx,
      );
    });
    return this.get(user, id);
  }

  private assertNotMaker(user: AuthUser, makerId: string, verb: string) {
    if (makerId === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: `The person who recorded a receipt cannot ${verb} it`,
      });
    }
  }

  private assertHospitalActive(status: string) {
    if (status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'HOSPITAL_NOT_ACTIVE',
        message: `The hospital is ${status.toLowerCase()}; receipts can only be handled for active hospitals`,
      });
    }
  }

  private async activeHospital(user: AuthUser, hospitalId: string) {
    const hospital = await this.prisma.hospital.findFirst({
      where: { id: hospitalId, organizationId: user.organizationId },
      select: { id: true, status: true, timezone: true },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    assertHospitalAccess(user, hospital.id);
    this.assertHospitalActive(hospital.status);
    return hospital;
  }

  private positiveAmount(value: string, field = 'amount'): Decimal {
    const amount = parseMoney(value, field);
    if (amount.lte(0)) {
      throw new BadRequestException({
        code: 'INVALID_MONEY',
        message: `${field} must be greater than zero`,
      });
    }
    return amount;
  }

  private pastOrToday(value: string, timeZone: string): Date {
    const date = parseDate(value, 'receiptDate');
    if (dateOnly(date) > dateInTimeZone(new Date(), timeZone)) {
      throw new UnprocessableEntityException({
        code: 'RECEIPT_DATE_IN_FUTURE',
        message: 'The receipt date cannot be in the future',
      });
    }
    return date;
  }

  private async lockPayment(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /** FR-AR-004: a repeated reference is blocked; same hospital/date/amount needs confirmation. */
  private async assertNotDuplicate(
    client: Client,
    input: {
      hospitalId: string;
      reference: string | null;
      receiptDate: Date;
      amount: Decimal;
      confirmed?: boolean;
      excludeId?: string;
    },
  ) {
    const exclude = input.excludeId ? { id: { not: input.excludeId } } : {};
    if (input.reference) {
      const sameReference = await client.payment.findFirst({
        where: {
          hospitalId: input.hospitalId,
          reference: { equals: input.reference, mode: 'insensitive' },
          status: { notIn: DEAD_STATUSES },
          ...exclude,
        },
        select: { id: true, status: true, receiptDate: true, amount: true },
      });
      if (sameReference) {
        throw new ConflictException({
          code: 'DUPLICATE_PAYMENT_REFERENCE',
          message: 'A receipt with this reference already exists for the hospital',
          details: [{ id: sameReference.id, status: sameReference.status }],
        });
      }
    }
    if (!input.confirmed) {
      const similar = await client.payment.findFirst({
        where: {
          hospitalId: input.hospitalId,
          receiptDate: input.receiptDate,
          amount: input.amount,
          status: { notIn: DEAD_STATUSES },
          ...exclude,
        },
        select: { id: true, status: true, reference: true },
      });
      if (similar) {
        throw new ConflictException({
          code: 'POSSIBLE_DUPLICATE_PAYMENT',
          message:
            'A receipt for the same hospital, date and amount already exists. Review it, then resubmit with confirmPossibleDuplicate=true if this is a different payment.',
          details: [{ id: similar.id, status: similar.status, reference: similar.reference }],
        });
      }
    }
  }

  private mapDuplicateReference(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException({
        code: 'DUPLICATE_PAYMENT_REFERENCE',
        message: 'A receipt with this reference already exists for the hospital',
      });
    }
    return error;
  }
}
