import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoundingMode } from '@prisma/client';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { dateOnly, parseDate } from '../common/utils/dates';
import { parseRate } from '../common/utils/money';
import { paged, pagination } from '../common/utils/pagination';
import { assertHospitalAccess } from '../common/utils/scope';
import { assertSuperAdmin } from '../common/utils/super-admin';
import { PrismaService } from '../prisma/prisma.service';
import {
  AgreementQueryDto,
  ChargeRuleQueryDto,
  CreateAgreementDto,
  CreateChargeRuleDto,
  UpdateAgreementDto,
  UpdateChargeRuleDto,
} from './dto/charge-config.dto';

type RuleShape = {
  name: string;
  rate: { toString(): string };
  isExempt?: boolean;
  basis: string;
  departmentId: string | null;
  paymentChannelId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  priority: number;
  rounding: RoundingMode;
  isActive: boolean;
};

@Injectable()
export class ChargeConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listAgreements(user: AuthUser, hospitalId: string, query: AgreementQueryDto) {
    await this.assertHospital(user, hospitalId);
    const { page, pageSize, skip, take } = pagination(query);
    const where: Prisma.CommercialAgreementWhereInput = {
      hospitalId,
      hospital: { organizationId: user.organizationId },
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commercialAgreement.findMany({
        where,
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          _count: { select: { chargeRules: true } },
        },
      }),
      this.prisma.commercialAgreement.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  async createAgreement(user: AuthUser, hospitalId: string, dto: CreateAgreementDto) {
    assertSuperAdmin(user);
    await this.assertHospital(user, hospitalId);
    const effectiveFrom = parseDate(dto.effectiveFrom, 'effectiveFrom');
    const effectiveTo = dto.effectiveTo ? parseDate(dto.effectiveTo, 'effectiveTo') : null;
    this.assertDateRange(effectiveFrom, effectiveTo);
    const status = dto.status ?? 'ACTIVE';

    const agreement = await this.prisma.commercialAgreement.create({
      data: {
        hospitalId,
        name: dto.name.trim(),
        effectiveFrom,
        effectiveTo,
        status,
        notes: dto.notes,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      hospitalId,
      action: 'AGREEMENT_CREATED',
      targetType: 'CommercialAgreement',
      targetId: agreement.id,
      summary: `Created agreement ${agreement.name}`,
      after: this.auditAgreement(agreement),
    });
    return agreement;
  }

  async updateAgreement(user: AuthUser, id: string, dto: UpdateAgreementDto) {
    assertSuperAdmin(user);
    const existing = await this.getAgreement(user, id);
    const effectiveFrom = dto.effectiveFrom
      ? parseDate(dto.effectiveFrom, 'effectiveFrom')
      : existing.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo === undefined
        ? existing.effectiveTo
        : dto.effectiveTo
          ? parseDate(dto.effectiveTo, 'effectiveTo')
          : null;
    this.assertDateRange(effectiveFrom, effectiveTo);

    if (effectiveFrom.getTime() !== existing.effectiveFrom.getTime()) {
      const outside = await this.prisma.chargeRule.count({
        where: { agreementId: id, effectiveFrom: { lt: effectiveFrom } },
      });
      if (outside > 0) {
        throw new ConflictException({
          code: 'AGREEMENT_DATE_CONFLICT',
          message: 'Agreement dates cannot exclude existing charge rules',
        });
      }
    }
    if (effectiveTo && effectiveTo.getTime() !== existing.effectiveTo?.getTime()) {
      const outside = await this.prisma.chargeRule.count({
        where: {
          agreementId: id,
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveTo } }],
        },
      });
      if (outside > 0) {
        throw new ConflictException({
          code: 'AGREEMENT_DATE_CONFLICT',
          message: 'Agreement dates cannot exclude existing charge rules',
        });
      }
    }

    const agreement = await this.prisma.commercialAgreement.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.effectiveFrom !== undefined ? { effectiveFrom } : {}),
        ...(dto.effectiveTo !== undefined ? { effectiveTo } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      hospitalId: agreement.hospitalId,
      action: 'AGREEMENT_UPDATED',
      targetType: 'CommercialAgreement',
      targetId: agreement.id,
      summary: `Updated agreement ${agreement.name}`,
      before: this.auditAgreement(existing),
      after: this.auditAgreement(agreement),
    });
    return agreement;
  }

  async listRules(user: AuthUser, agreementId: string, query: ChargeRuleQueryDto) {
    const agreement = await this.getAgreement(user, agreementId);
    const { page, pageSize, skip, take } = pagination(query);
    const where: Prisma.ChargeRuleWhereInput = {
      hospitalId: agreement.hospitalId,
      agreementId,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.paymentChannelId ? { paymentChannelId: query.paymentChannelId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.chargeRule.findMany({
        where,
        orderBy: [
          { isActive: 'desc' },
          { effectiveFrom: 'desc' },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take,
        include: {
          department: { select: { id: true, code: true, name: true } },
          paymentChannel: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.chargeRule.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  async addRule(user: AuthUser, agreementId: string, dto: CreateChargeRuleDto) {
    assertSuperAdmin(user);
    const agreement = await this.getAgreement(user, agreementId);
    const effectiveFrom = parseDate(dto.effectiveFrom, 'effectiveFrom');
    const effectiveTo = dto.effectiveTo ? parseDate(dto.effectiveTo, 'effectiveTo') : null;
    this.assertDateRange(effectiveFrom, effectiveTo);
    this.assertRuleInsideAgreement(agreement, effectiveFrom, effectiveTo);
    await this.assertScope(agreement.hospitalId, dto.departmentId, dto.paymentChannelId);
    const rate = parseRate(dto.rate);
    const isExempt = dto.isExempt ?? false;
    this.assertExemptRate(isExempt, rate);
    this.assertRoundingAllowed(dto.rounding);
    const scope = {
      departmentId: dto.departmentId ?? null,
      paymentChannelId: dto.paymentChannelId ?? null,
    };
    await this.assertNoRuleConflict(agreement.hospitalId, scope, effectiveFrom, effectiveTo);

    const rule = await this.prisma.chargeRule.create({
      data: {
        hospitalId: agreement.hospitalId,
        agreementId,
        ...scope,
        name: dto.name.trim(),
        basis: dto.basis ?? 'PERCENTAGE',
        rate,
        isExempt,
        effectiveFrom,
        effectiveTo,
        priority: dto.priority ?? 0,
        rounding: dto.rounding ?? RoundingMode.HALF_UP,
        isActive: dto.isActive ?? true,
      },
      include: {
        department: { select: { id: true, code: true, name: true } },
        paymentChannel: { select: { id: true, code: true, name: true } },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      hospitalId: agreement.hospitalId,
      action: 'CHARGE_RULE_CREATED',
      targetType: 'ChargeRule',
      targetId: rule.id,
      summary: `Created charge rule ${rule.name}`,
      after: this.auditRule(rule),
    });
    return rule;
  }

  async updateRule(user: AuthUser, id: string, dto: UpdateChargeRuleDto) {
    assertSuperAdmin(user);
    const existing = await this.prisma.chargeRule.findFirst({
      where: {
        id,
        hospital: { organizationId: user.organizationId },
      },
      include: { agreement: true },
    });
    if (!existing) throw new NotFoundException('Charge rule not found');
    assertHospitalAccess(user, existing.hospitalId);
    const agreement =
      existing.agreement ??
      (existing.agreementId
        ? await this.prisma.commercialAgreement.findUnique({
            where: { id: existing.agreementId },
          })
        : null);
    if (!agreement) {
      throw new ConflictException({
        code: 'RULE_WITHOUT_AGREEMENT',
        message: 'This charge rule has no commercial agreement',
      });
    }

    const departmentId = dto.departmentId === undefined ? existing.departmentId : dto.departmentId;
    const paymentChannelId =
      dto.paymentChannelId === undefined ? existing.paymentChannelId : dto.paymentChannelId;
    const effectiveFrom = dto.effectiveFrom
      ? parseDate(dto.effectiveFrom, 'effectiveFrom')
      : existing.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo === undefined
        ? existing.effectiveTo
        : dto.effectiveTo
          ? parseDate(dto.effectiveTo, 'effectiveTo')
          : null;
    this.assertDateRange(effectiveFrom, effectiveTo);
    this.assertRuleInsideAgreement(agreement, effectiveFrom, effectiveTo);
    await this.assertScope(
      existing.hospitalId,
      departmentId ?? undefined,
      paymentChannelId ?? undefined,
    );
    const rate = dto.rate !== undefined ? parseRate(dto.rate) : existing.rate;
    const isExempt = dto.isExempt ?? existing.isExempt;
    this.assertExemptRate(isExempt, rate);
    this.assertRoundingAllowed(dto.rounding);
    const basis = dto.basis ?? existing.basis;
    if (basis !== 'PERCENTAGE') {
      throw new BadRequestException({
        code: 'RULE_BASIS_UNSUPPORTED',
        message: 'Only percentage charge rules are supported',
      });
    }
    const isActive = dto.isActive ?? existing.isActive;
    if (isActive) {
      await this.assertNoRuleConflict(
        existing.hospitalId,
        { departmentId, paymentChannelId },
        effectiveFrom,
        effectiveTo,
        id,
      );
    }

    const rule = await this.prisma.chargeRule.update({
      where: { id },
      data: {
        departmentId,
        paymentChannelId,
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.basis !== undefined ? { basis } : {}),
        rate,
        isExempt,
        effectiveFrom,
        effectiveTo,
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.rounding !== undefined ? { rounding: dto.rounding } : {}),
        isActive,
      },
      include: {
        department: { select: { id: true, code: true, name: true } },
        paymentChannel: { select: { id: true, code: true, name: true } },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      hospitalId: rule.hospitalId,
      action: 'CHARGE_RULE_UPDATED',
      targetType: 'ChargeRule',
      targetId: rule.id,
      summary: `Updated charge rule ${rule.name}`,
      before: this.auditRule(existing),
      after: this.auditRule(rule),
    });
    return rule;
  }

  /** Confirmed decision D-004: round half-up to 2 dp once per charge line; no other mode. */
  private assertRoundingAllowed(rounding?: RoundingMode) {
    if (rounding !== undefined && rounding !== RoundingMode.HALF_UP) {
      throw new BadRequestException({
        code: 'ROUNDING_NOT_PERMITTED',
        message: 'Only HALF_UP rounding is permitted for charge rules',
        details: [{ field: 'rounding', code: 'ROUNDING_NOT_PERMITTED' }],
      });
    }
  }

  private async getAgreement(user: AuthUser, id: string) {
    const agreement = await this.prisma.commercialAgreement.findFirst({
      where: {
        id,
        hospital: { organizationId: user.organizationId },
      },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    assertHospitalAccess(user, agreement.hospitalId);
    return agreement;
  }

  private async assertHospital(user: AuthUser, hospitalId: string) {
    const hospital = await this.prisma.hospital.findFirst({
      where: { id: hospitalId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    assertHospitalAccess(user, hospitalId);
  }

  private assertDateRange(from: Date, to: Date | null) {
    if (to && to.getTime() < from.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'effectiveTo cannot be before effectiveFrom',
      });
    }
  }

  private assertRuleInsideAgreement(
    agreement: { effectiveFrom: Date; effectiveTo: Date | null },
    from: Date,
    to: Date | null,
  ) {
    if (from.getTime() < agreement.effectiveFrom.getTime()) {
      throw new ConflictException({
        code: 'RULE_OUTSIDE_AGREEMENT',
        message: 'Rule effectiveFrom is before the agreement start date',
      });
    }
    if (agreement.effectiveTo && (!to || to.getTime() > agreement.effectiveTo.getTime())) {
      throw new ConflictException({
        code: 'RULE_OUTSIDE_AGREEMENT',
        message: 'Rule effectiveTo is after the agreement end date',
      });
    }
  }

  private async assertScope(hospitalId: string, departmentId?: string, paymentChannelId?: string) {
    if (departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, hospitalId },
        select: { id: true },
      });
      if (!department) {
        throw new BadRequestException({
          code: 'RULE_SCOPE_INVALID',
          message: 'Department does not belong to this hospital',
        });
      }
    }
    if (paymentChannelId) {
      const channel = await this.prisma.paymentChannel.findFirst({
        where: { id: paymentChannelId, hospitalId },
        select: { id: true },
      });
      if (!channel) {
        throw new BadRequestException({
          code: 'RULE_SCOPE_INVALID',
          message: 'Payment channel does not belong to this hospital',
        });
      }
    }
  }

  private async assertNoRuleConflict(
    hospitalId: string,
    scope: { departmentId: string | null; paymentChannelId: string | null },
    from: Date,
    to: Date | null,
    excludeId?: string,
  ) {
    const existing = await this.prisma.chargeRule.findFirst({
      where: {
        hospitalId,
        departmentId: scope.departmentId,
        paymentChannelId: scope.paymentChannelId,
        isActive: true,
        effectiveFrom: { lte: to ?? new Date('9999-12-31T00:00:00.000Z') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
        name: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });
    if (existing) {
      throw new ConflictException({
        code: 'RULE_CONFLICT',
        message: `An active rule for the same scope already applies (${existing.name})`,
        details: [
          {
            field: 'effectiveFrom',
            code: 'RULE_CONFLICT',
            message: `${dateOnly(existing.effectiveFrom)} to ${
              existing.effectiveTo ? dateOnly(existing.effectiveTo) : 'open'
            }`,
          },
        ],
      });
    }
  }

  private auditAgreement(agreement: {
    name: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    status: string;
  }): Prisma.InputJsonValue {
    return {
      name: agreement.name,
      effectiveFrom: dateOnly(agreement.effectiveFrom),
      effectiveTo: agreement.effectiveTo ? dateOnly(agreement.effectiveTo) : null,
      status: agreement.status,
    };
  }

  /** An exemption never carries a charge: its rate must be zero, so it cannot be mistaken for a rate. */
  private assertExemptRate(isExempt: boolean, rate: { toString(): string }) {
    if (isExempt && Number(rate.toString()) !== 0) {
      throw new BadRequestException({
        code: 'EXEMPT_RATE_MUST_BE_ZERO',
        message: 'An exempt rule must have a rate of 0',
      });
    }
  }

  private auditRule(rule: RuleShape): Prisma.InputJsonValue {
    return {
      name: rule.name,
      rate: rule.rate.toString(),
      isExempt: rule.isExempt ?? false,
      basis: rule.basis,
      departmentId: rule.departmentId,
      paymentChannelId: rule.paymentChannelId,
      effectiveFrom: dateOnly(rule.effectiveFrom),
      effectiveTo: rule.effectiveTo ? dateOnly(rule.effectiveTo) : null,
      priority: rule.priority,
      rounding: rule.rounding,
      isActive: rule.isActive,
    };
  }
}
