import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { parseDate } from '../common/utils/dates';
import { paged, pagination } from '../common/utils/pagination';
import { assertHospitalAccess } from '../common/utils/scope';
import { assertSuperAdmin } from '../common/utils/super-admin';
import { PrismaService } from '../prisma/prisma.service';
import {
  HospitalQueryDto,
  CreateHospitalDto,
  DepartmentDto,
  PaymentChannelDto,
  UpdateHospitalDto,
  UpdateDepartmentDto,
  UpdatePaymentChannelDto,
} from './dto/hospital.dto';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: HospitalQueryDto) {
    const { page, pageSize, skip, take } = pagination(query);
    const where: Prisma.HospitalWhereInput = {
      organizationId: user.organizationId,
      ...(user.allHospitals ? {} : { id: { in: user.hospitalIds } }),
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
      this.prisma.hospital.findMany({
        where,
        orderBy: { code: 'asc' },
        skip,
        take,
        include: {
          _count: { select: { departments: true, paymentChannels: true, receivables: true } },
        },
      }),
      this.prisma.hospital.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const hospital = await this.prisma.hospital.findFirst({
      // Match the requested id exactly, then check scope separately. (Spreading a scope filter
      // that also uses the `id` key would silently replace the requested id and return, or let
      // the caller modify, a different hospital.)
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
    if (!hospital) throw new NotFoundException('Hospital not found');
    assertHospitalAccess(user, hospital.id);
    return hospital;
  }

  async create(user: AuthUser, dto: CreateHospitalDto) {
    assertSuperAdmin(user);
    if (!user.allHospitals) {
      throw new ForbiddenException({
        code: 'ALL_HOSPITALS_REQUIRED',
        message: 'Only a super admin with access to all hospitals can create hospitals',
      });
    }
    const hospital = await this.prisma.hospital.create({
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
      hospitalId: hospital.id,
      action: 'HOSPITAL_CREATED',
      targetType: 'Hospital',
      targetId: hospital.id,
      summary: `Created hospital ${hospital.code}`,
      after: { code: hospital.code, name: hospital.name, status: hospital.status },
    });
    return hospital;
  }

  async update(user: AuthUser, id: string, dto: UpdateHospitalDto) {
    assertSuperAdmin(user);
    const existing = await this.get(user, id);
    const data: Prisma.HospitalUpdateInput = {
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

    const hospital = await this.prisma.hospital.update({ where: { id }, data });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      hospitalId: id,
      action: 'HOSPITAL_UPDATED',
      targetType: 'Hospital',
      targetId: id,
      summary: `Updated hospital ${hospital.code}`,
      before: { code: existing.code, name: existing.name, status: existing.status },
      after: { code: hospital.code, name: hospital.name, status: hospital.status },
    });
    return hospital;
  }

  async addDepartment(user: AuthUser, hospitalId: string, dto: DepartmentDto) {
    assertSuperAdmin(user);
    await this.get(user, hospitalId);
    const aliases = this.cleanAliases(dto.aliases);
    const department = await this.prisma.department.create({
      data: {
        hospitalId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        aliases: aliases.length ? { create: aliases.map((alias) => ({ alias })) } : undefined,
      },
      include: { aliases: true },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      hospitalId,
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
    hospitalId: string,
    departmentId: string,
    dto: UpdateDepartmentDto,
  ) {
    assertSuperAdmin(user);
    await this.get(user, hospitalId);
    const existing = await this.prisma.department.findFirst({
      where: { id: departmentId, hospitalId },
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
      hospitalId,
      action: 'DEPARTMENT_UPDATED',
      targetType: 'Department',
      targetId: departmentId,
      summary: `Updated department ${department.code}`,
      before: { code: existing.code, name: existing.name },
      after: { code: department.code, name: department.name },
    });
    return department;
  }

  async addChannel(user: AuthUser, hospitalId: string, dto: PaymentChannelDto) {
    assertSuperAdmin(user);
    await this.get(user, hospitalId);
    const aliases = this.cleanAliases(dto.aliases);
    const channel = await this.prisma.paymentChannel.create({
      data: {
        hospitalId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        aliases: aliases.length ? { create: aliases.map((alias) => ({ alias })) } : undefined,
      },
      include: { aliases: true },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      hospitalId,
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
    hospitalId: string,
    channelId: string,
    dto: UpdatePaymentChannelDto,
  ) {
    assertSuperAdmin(user);
    await this.get(user, hospitalId);
    const existing = await this.prisma.paymentChannel.findFirst({
      where: { id: channelId, hospitalId },
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
      hospitalId,
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
