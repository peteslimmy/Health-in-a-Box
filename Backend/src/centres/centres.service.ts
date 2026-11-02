import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { parseDate } from '../common/utils/dates';
import { paged, pagination } from '../common/utils/pagination';
import { assertCentreAccess } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  CentreQueryDto,
  CreateCentreDto,
  DepartmentDto,
  PaymentChannelDto,
  UpdateCentreDto,
  UpdateDepartmentDto,
  UpdatePaymentChannelDto,
} from './dto/centre.dto';

@Injectable()
export class CentresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: CentreQueryDto) {
    const { page, pageSize, skip, take } = pagination(query);
    const where: Prisma.CentreWhereInput = {
      organizationId: user.organizationId,
      ...(user.allCentres ? {} : { id: { in: user.centreIds } }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.centre.findMany({
        where,
        orderBy: { code: 'asc' },
        skip,
        take,
        include: {
          _count: { select: { departments: true, paymentChannels: true, receivables: true } },
        },
      }),
      this.prisma.centre.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const centre = await this.prisma.centre.findFirst({
      // Match the requested id exactly, then check scope separately. (Spreading a scope filter
      // that also uses the `id` key would silently replace the requested id and return, or let
      // the caller modify, a different centre.)
      where: { id, organizationId: user.organizationId },
      include: {
        departments: { orderBy: { code: 'asc' }, include: { aliases: true } },
        paymentChannels: { orderBy: { code: 'asc' }, include: { aliases: true } },
        agreements: { orderBy: { effectiveFrom: 'desc' } },
        chargeRules: {
          where: { isActive: true },
          orderBy: [{ priority: 'desc' }, { effectiveFrom: 'desc' }],
          include: { department: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!centre) throw new NotFoundException('Centre not found');
    assertCentreAccess(user, centre.id);
    return centre;
  }

  async create(user: AuthUser, dto: CreateCentreDto) {
    // A new centre is an organisation-level resource, so it needs all-centres access.
    if (!user.allCentres) {
      throw new ForbiddenException({
        code: 'ALL_CENTRES_REQUIRED',
        message: 'Only users with access to all centres can create a centre',
      });
    }
    const centre = await this.prisma.centre.create({
      data: {
        organizationId: user.organizationId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        address: dto.address,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        status: dto.status,
        timezone: dto.timezone,
        currency: dto.currency?.toUpperCase(),
        paymentTermsDays: dto.paymentTermsDays,
        gracePeriodDays: dto.gracePeriodDays,
        openedAt: dto.openedAt ? parseDate(dto.openedAt, 'openedAt') : undefined,
        notes: dto.notes,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      centreId: centre.id,
      action: 'CENTRE_CREATED',
      targetType: 'Centre',
      targetId: centre.id,
      summary: `Created centre ${centre.code}`,
      after: { code: centre.code, name: centre.name, status: centre.status },
    });
    return centre;
  }

  async update(user: AuthUser, id: string, dto: UpdateCentreDto) {
    const existing = await this.get(user, id);
    const data: Prisma.CentreUpdateInput = {
      ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
      ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.timezone ? { timezone: dto.timezone } : {}),
      ...(dto.currency ? { currency: dto.currency.toUpperCase() } : {}),
      ...(dto.paymentTermsDays !== undefined ? { paymentTermsDays: dto.paymentTermsDays } : {}),
      ...(dto.gracePeriodDays !== undefined ? { gracePeriodDays: dto.gracePeriodDays } : {}),
      ...(dto.openedAt !== undefined
        ? { openedAt: dto.openedAt ? parseDate(dto.openedAt, 'openedAt') : null }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };
    if (Object.keys(data).length === 0) return existing;

    const centre = await this.prisma.centre.update({ where: { id }, data });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      centreId: id,
      action: 'CENTRE_UPDATED',
      targetType: 'Centre',
      targetId: id,
      summary: `Updated centre ${centre.code}`,
      before: { code: existing.code, name: existing.name, status: existing.status },
      after: { code: centre.code, name: centre.name, status: centre.status },
    });
    return centre;
  }

  async addDepartment(user: AuthUser, centreId: string, dto: DepartmentDto) {
    await this.get(user, centreId);
    const aliases = this.cleanAliases(dto.aliases);
    const department = await this.prisma.department.create({
      data: {
        centreId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        aliases: aliases.length ? { create: aliases.map((alias) => ({ alias })) } : undefined,
      },
      include: { aliases: true },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      centreId,
      action: 'DEPARTMENT_CREATED',
      targetType: 'Department',
      targetId: department.id,
      summary: `Added department ${department.code}`,
      after: { code: department.code, name: department.name },
    });
    return department;
  }

  async updateDepartment(
    user: AuthUser,
    centreId: string,
    departmentId: string,
    dto: UpdateDepartmentDto,
  ) {
    await this.get(user, centreId);
    const existing = await this.prisma.department.findFirst({
      where: { id: departmentId, centreId },
      include: { aliases: true },
    });
    if (!existing) throw new NotFoundException('Department not found');
    const aliases = this.cleanAliases(dto.aliases);
    const department = await this.prisma.$transaction(async (tx) => {
      if (dto.aliases !== undefined) {
        await tx.departmentAlias.deleteMany({ where: { departmentId } });
      }
      return tx.department.update({
        where: { id: departmentId },
        data: {
          ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.aliases !== undefined
            ? { aliases: { create: aliases.map((alias) => ({ alias })) } }
            : {}),
        },
        include: { aliases: true },
      });
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      centreId,
      action: 'DEPARTMENT_UPDATED',
      targetType: 'Department',
      targetId: departmentId,
      summary: `Updated department ${department.code}`,
      before: { code: existing.code, name: existing.name },
      after: { code: department.code, name: department.name },
    });
    return department;
  }

  async addChannel(user: AuthUser, centreId: string, dto: PaymentChannelDto) {
    await this.get(user, centreId);
    const aliases = this.cleanAliases(dto.aliases);
    const channel = await this.prisma.paymentChannel.create({
      data: {
        centreId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        aliases: aliases.length ? { create: aliases.map((alias) => ({ alias })) } : undefined,
      },
      include: { aliases: true },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      centreId,
      action: 'PAYMENT_CHANNEL_CREATED',
      targetType: 'PaymentChannel',
      targetId: channel.id,
      summary: `Added payment channel ${channel.code}`,
      after: { code: channel.code, name: channel.name },
    });
    return channel;
  }

  async updateChannel(
    user: AuthUser,
    centreId: string,
    channelId: string,
    dto: UpdatePaymentChannelDto,
  ) {
    await this.get(user, centreId);
    const existing = await this.prisma.paymentChannel.findFirst({
      where: { id: channelId, centreId },
    });
    if (!existing) throw new NotFoundException('Payment channel not found');
    const aliases = this.cleanAliases(dto.aliases);
    const channel = await this.prisma.$transaction(async (tx) => {
      if (dto.aliases !== undefined) {
        await tx.paymentChannelAlias.deleteMany({ where: { channelId } });
      }
      return tx.paymentChannel.update({
        where: { id: channelId },
        data: {
          ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.aliases !== undefined
            ? { aliases: { create: aliases.map((alias) => ({ alias })) } }
            : {}),
        },
        include: { aliases: true },
      });
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      centreId,
      action: 'PAYMENT_CHANNEL_UPDATED',
      targetType: 'PaymentChannel',
      targetId: channelId,
      summary: `Updated payment channel ${channel.code}`,
      before: { code: existing.code, name: existing.name },
      after: { code: channel.code, name: channel.name },
    });
    return channel;
  }

  private cleanAliases(aliases?: string[]): string[] {
    return [...new Set((aliases ?? []).map((alias) => alias.trim()).filter(Boolean))];
  }
}
