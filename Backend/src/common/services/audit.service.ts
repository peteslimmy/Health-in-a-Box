import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { currentCorrelationId } from '../request-context';

export type AuditInput = {
  organizationId: string;
  actorId?: string | null;
  centreId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  correlationId?: string | null;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an audit event. Pass the transaction client of the financial change so the audit
   * event commits (or rolls back) together with it.
   */
  async record(input: AuditInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.auditEvent.create({
      data: { ...input, correlationId: input.correlationId ?? currentCorrelationId() ?? null },
    });
  }

  async list(params: {
    organizationId: string;
    /** Undefined = all centres. Scoped users never see organisation-level (centre-less) events. */
    centreIds?: string[];
    centreId?: string;
    action?: string;
    targetType?: string;
    from?: Date;
    to?: Date;
    skip: number;
    take: number;
  }) {
    const where: Prisma.AuditEventWhereInput = {
      organizationId: params.organizationId,
      ...(params.centreId
        ? { centreId: params.centreId }
        : params.centreIds
          ? { centreId: { in: params.centreIds } }
          : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.targetType ? { targetType: params.targetType } : {}),
      ...(params.from || params.to
        ? {
            createdAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        include: {
          actor: { select: { id: true, fullName: true, email: true } },
          centre: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { items, total };
  }
}
