import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ChargeRule,
  ChargeRunStatus,
  Department,
  PaymentChannel,
  Prisma,
  ReportStatus,
} from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { addDays, dateInTimeZone, dateOnly, parseDate } from '../common/utils/dates';
import { money, roundMoney } from '../common/utils/money';
import { paged, pagination } from '../common/utils/pagination';
import { assertHospitalAccess } from '../common/utils/scope';
import { TOTAL_TOLERANCE } from '../imports/revenue-parser.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalculateChargeRunDto, ChargeRunQueryDto } from './dto/charge-run.dto';
import {
  buildRuleLookup,
  hasChannelRule,
  hasStraddlingRule,
  partitionRulesForPeriod,
  pickRule,
} from './rule-selection';

type RevenueReportWithLines = Prisma.RevenueReportGetPayload<{
  include: { lines: { include: { department: true } } };
}>;

type ChannelWithAliases = PaymentChannel & { aliases: { alias: string }[] };

type CalculationLine = {
  revenueLineId: string;
  reportId: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  paymentChannelId: string | null;
  paymentChannelCode: string | null;
  paymentChannelName: string | null;
  ruleId: string | null;
  ruleName: string | null;
  baseAmount: string;
  rate: string;
  chargeAmount: string;
  rounding: string;
  traceJson: Prisma.InputJsonValue;
};

type Calculation = {
  hospitalId: string;
  periodStart: Date;
  periodEnd: Date;
  asOf: Date;
  reports: RevenueReportWithLines[];
  lines: CalculationLine[];
  baseTotal: Decimal;
  chargeTotal: Decimal;
  rulesSnapshot: Prisma.InputJsonValue;
  warnings: string[];
};

@Injectable()
export class ChargeRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: ChargeRunQueryDto) {
    const { page, pageSize, skip, take } = pagination(query);
    const from = query.from ? parseDate(query.from, 'from') : undefined;
    const to = query.to ? parseDate(query.to, 'to') : undefined;
    const where: Prisma.ChargeRunWhereInput = {
      organizationId: user.organizationId,
      ...(user.allHospitals ? {} : { hospitalId: { in: user.hospitalIds } }),
      ...(query.hospitalId ? { hospitalId: query.hospitalId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(from || to
        ? {
            periodStart: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    if (query.hospitalId) assertHospitalAccess(user, query.hospitalId);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.chargeRun.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take,
        include: {
          hospital: { select: { id: true, code: true, name: true, currency: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
          approvedBy: { select: { id: true, fullName: true, email: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.chargeRun.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const run = await this.prisma.chargeRun.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        ...(user.allHospitals ? {} : { hospitalId: { in: user.hospitalIds } }),
      },
      include: {
        hospital: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
        receivable: { select: { id: true, reference: true, status: true, balance: true } },
        lines: {
          orderBy: { createdAt: 'asc' },
          include: {
            department: { select: { id: true, code: true, name: true } },
            paymentChannel: { select: { id: true, code: true, name: true } },
            revenueLine: {
              select: {
                id: true,
                reportId: true,
                report: {
                  select: {
                    id: true,
                    periodStart: true,
                    periodEnd: true,
                    sourceFileName: true,
                  },
                },
              },
            },
            receivable: { select: { id: true, reference: true, status: true } },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Charge run not found');
    assertHospitalAccess(user, run.hospitalId);
    return run;
  }

  async preview(user: AuthUser, dto: CalculateChargeRunDto) {
    const calculation = await this.calculate(user, dto);
    return this.toPreview(calculation);
  }

  /** FR-CEN-009: only an active hospital may receive financial records. */
  private assertHospitalActive(status: string) {
    if (status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'HOSPITAL_NOT_ACTIVE',
        message: `The hospital is ${status.toLowerCase()}; activate it before creating or posting charges`,
      });
    }
  }

  async create(user: AuthUser, dto: CalculateChargeRunDto) {
    const calculation = await this.calculate(user, dto);
    const hospital = await this.prisma.hospital.findUnique({
      where: { id: calculation.hospitalId },
      select: { status: true },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    this.assertHospitalActive(hospital.status);

    const run = await this.prisma.$transaction(
      async (tx) => {
        await this.assertNoUsedLines(
          calculation.lines.map((line) => line.revenueLineId),
          tx,
        );
        const created = await tx.chargeRun.create({
          data: {
            organizationId: user.organizationId,
            hospitalId: calculation.hospitalId,
            periodStart: calculation.periodStart,
            periodEnd: calculation.periodEnd,
            asOf: calculation.asOf,
            status: ChargeRunStatus.DRAFT,
            baseTotal: money(calculation.baseTotal),
            chargeTotal: money(calculation.chargeTotal),
            rulesSnapshot: calculation.rulesSnapshot,
            createdById: user.id,
            lines: {
              create: calculation.lines.map((line) => ({
                revenueLineId: line.revenueLineId,
                departmentId: line.departmentId,
                paymentChannelId: line.paymentChannelId,
                ruleId: line.ruleId,
                baseAmount: line.baseAmount,
                rate: line.rate,
                chargeAmount: line.chargeAmount,
                ruleName: line.ruleName,
                traceJson: line.traceJson,
              })),
            },
          },
          include: {
            hospital: true,
            lines: {
              include: {
                department: { select: { id: true, code: true, name: true } },
                paymentChannel: { select: { id: true, code: true, name: true } },
              },
            },
          },
        });
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            hospitalId: created.hospitalId,
            action: 'CHARGE_RUN_CREATED',
            targetType: 'ChargeRun',
            targetId: created.id,
            summary: `Created charge run for ${dateOnly(created.periodStart)} to ${dateOnly(
              created.periodEnd,
            )}`,
            after: {
              status: created.status,
              baseTotal: created.baseTotal.toString(),
              chargeTotal: created.chargeTotal.toString(),
              lineCount: created.lines.length,
            },
          },
          tx,
        );
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return run;
  }

  async recalculate(user: AuthUser, id: string) {
    const existing = await this.get(user, id);
    if (existing.status !== ChargeRunStatus.DRAFT) {
      throw new ConflictException({
        code: 'INVALID_CHARGE_RUN_STATUS',
        message: 'Only draft charge runs can be recalculated',
      });
    }
    const reportIds = this.sourceReportIds(existing.rulesSnapshot);
    if (reportIds.length === 0) {
      throw new ConflictException({
        code: 'CHARGE_RUN_SOURCES_MISSING',
        message: 'This charge run has no source reports to recalculate from',
      });
    }
    const calculation = await this.calculate(
      user,
      {
        hospitalId: existing.hospitalId,
        periodStart: dateOnly(existing.periodStart),
        periodEnd: dateOnly(existing.periodEnd),
        calculationAsOfDate: dateOnly(existing.asOf),
        reportIds,
      },
      id,
    );

    const run = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.chargeRun.updateMany({
        where: { id, status: ChargeRunStatus.DRAFT },
        data: {
          baseTotal: money(calculation.baseTotal),
          chargeTotal: money(calculation.chargeTotal),
          rulesSnapshot: calculation.rulesSnapshot,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'INVALID_CHARGE_RUN_STATUS',
          message: 'Charge run is no longer a draft',
        });
      }
      await tx.chargeLine.deleteMany({ where: { chargeRunId: id } });
      await tx.chargeLine.createMany({
        data: calculation.lines.map((line) => ({
          chargeRunId: id,
          revenueLineId: line.revenueLineId,
          departmentId: line.departmentId,
          paymentChannelId: line.paymentChannelId,
          ruleId: line.ruleId,
          baseAmount: line.baseAmount,
          rate: line.rate,
          chargeAmount: line.chargeAmount,
          ruleName: line.ruleName,
          traceJson: line.traceJson,
        })),
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: existing.hospitalId,
          action: 'CHARGE_RUN_RECALCULATED',
          targetType: 'ChargeRun',
          targetId: id,
          summary: 'Recalculated draft charge run',
          before: {
            baseTotal: existing.baseTotal.toString(),
            chargeTotal: existing.chargeTotal.toString(),
            lineCount: existing.lines.length,
          },
          after: {
            baseTotal: calculation.baseTotal.toFixed(2),
            chargeTotal: calculation.chargeTotal.toFixed(2),
            lineCount: calculation.lines.length,
          },
        },
        tx,
      );
      return tx.chargeRun.findUnique({ where: { id } });
    });
    return run;
  }

  async submit(user: AuthUser, id: string) {
    const existing = await this.get(user, id);
    if (existing.status !== ChargeRunStatus.DRAFT) {
      throw new ConflictException({
        code: 'INVALID_CHARGE_RUN_STATUS',
        message: 'Only draft charge runs can be submitted',
      });
    }
    if (existing.lines.length === 0) {
      throw new ConflictException({
        code: 'CHARGE_RUN_EMPTY',
        message: 'Charge run has no charge lines',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.chargeRun.updateMany({
        where: { id, status: ChargeRunStatus.DRAFT },
        data: { status: ChargeRunStatus.SUBMITTED, submittedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'INVALID_CHARGE_RUN_STATUS',
          message: 'Charge run is no longer a draft',
        });
      }
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: existing.hospitalId,
          action: 'CHARGE_RUN_SUBMITTED',
          targetType: 'ChargeRun',
          targetId: id,
          summary: 'Submitted charge run for review',
          before: { status: existing.status },
          after: { status: ChargeRunStatus.SUBMITTED },
        },
        tx,
      );
    });
    return this.get(user, id);
  }

  async approve(user: AuthUser, id: string) {
    const existing = await this.get(user, id);
    if (existing.createdById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The creator of a charge run cannot approve it',
      });
    }
    if (existing.status !== ChargeRunStatus.SUBMITTED) {
      throw new ConflictException({
        code: 'INVALID_CHARGE_RUN_STATUS',
        message: 'Only submitted charge runs can be approved',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.chargeRun.updateMany({
        where: { id, status: ChargeRunStatus.SUBMITTED },
        data: {
          status: ChargeRunStatus.APPROVED,
          approvedById: user.id,
          approvedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'INVALID_CHARGE_RUN_STATUS',
          message: 'Charge run is no longer awaiting approval',
        });
      }
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: existing.hospitalId,
          action: 'CHARGE_RUN_APPROVED',
          targetType: 'ChargeRun',
          targetId: id,
          summary: 'Approved charge run',
          before: { status: existing.status },
          after: { status: ChargeRunStatus.APPROVED },
        },
        tx,
      );
    });
    return this.get(user, id);
  }

  async post(user: AuthUser, id: string) {
    const existing = await this.get(user, id);
    // Idempotent: repeating a post that already succeeded returns the original outcome and
    // never creates a second set of receivables.
    if (existing.status === ChargeRunStatus.POSTED) return existing;
    if (existing.createdById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The creator of a charge run cannot post it',
      });
    }
    if (existing.status !== ChargeRunStatus.APPROVED) {
      throw new ConflictException({
        code: 'INVALID_CHARGE_RUN_STATUS',
        message: 'Only approved charge runs can be posted',
      });
    }
    this.assertHospitalActive(existing.hospital.status);
    const postedAt = new Date();
    // D-006/D-016: the posting day and the due date follow the hospital's business time zone.
    const postedLocalDate = dateInTimeZone(postedAt, existing.hospital.timezone);
    const dueDate = addDays(parseDate(postedLocalDate), existing.hospital.paymentTermsDays);

    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.chargeRun.updateMany({
          where: { id, status: ChargeRunStatus.APPROVED },
          data: { status: ChargeRunStatus.POSTED, postedAt },
        });
        if (claimed.count === 0) {
          throw new ConflictException({
            code: 'INVALID_CHARGE_RUN_STATUS',
            message: 'Charge run is no longer approved',
          });
        }

        // P-016: one receivable item per charge run (hospital x period). The individual charge
        // lines stay traceable through the run; zero-amount lines add nothing.
        const postedTotal = existing.lines.reduce(
          (sum, line) => sum.plus(new Decimal(line.chargeAmount.toString())),
          new Decimal(0),
        );
        let receivableCount = 0;
        if (postedTotal.gt(0)) {
          const reference = `RCV-${existing.hospital.code}-${postedLocalDate.slice(0, 7)}-${id
            .replace(/-/g, '')
            .slice(0, 8)
            .toUpperCase()}`;
          const description = `${existing.hospital.code} service charge ${dateOnly(
            existing.periodStart,
          )} to ${dateOnly(existing.periodEnd)}`;
          const receivable = await tx.receivable.create({
            data: {
              organizationId: user.organizationId,
              hospitalId: existing.hospitalId,
              chargeRunId: id,
              reference,
              description,
              originalAmount: postedTotal,
              balance: postedTotal,
              dueDate,
              status: 'OPEN',
            },
          });
          await tx.ledgerEntry.create({
            data: {
              organizationId: user.organizationId,
              hospitalId: existing.hospitalId,
              receivableId: receivable.id,
              type: 'CHARGE',
              debit: postedTotal,
              credit: 0,
              description,
              occurredAt: postedAt,
              createdById: user.id,
              sourceType: 'ChargeRun',
              sourceId: id,
            },
          });
          receivableCount = 1;
        }
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            hospitalId: existing.hospitalId,
            action: 'CHARGE_RUN_POSTED',
            targetType: 'ChargeRun',
            targetId: id,
            summary: `Posted charge run with ${receivableCount} receivable(s)`,
            before: { status: existing.status },
            after: {
              status: ChargeRunStatus.POSTED,
              receivableCount,
              postedTotal: postedTotal.toFixed(2),
            },
          },
          tx,
        );
        return { receivableCount, postedTotal };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.get(user, id);
  }

  private async calculate(
    user: AuthUser,
    dto: CalculateChargeRunDto,
    excludeRunId?: string,
  ): Promise<Calculation> {
    const reports = await this.loadReports(user, dto);
    const hospitalId = reports[0].hospitalId;
    const periodStart = new Date(
      Math.min(...reports.map((report) => report.periodStart.getTime())),
    );
    const periodEnd = new Date(Math.max(...reports.map((report) => report.periodEnd.getTime())));
    // The applicable rate is decided by each report's own period, never by a caller-supplied
    // "as-of" date: a user must not be able to choose a rate by choosing a date. The stored
    // as-of is therefore always the end of the charged period.
    const asOf = periodEnd;

    const [channels, rules] = await Promise.all([
      this.prisma.paymentChannel.findMany({
        where: { hospitalId },
        include: { aliases: true },
      }),
      this.prisma.chargeRule.findMany({
        where: {
          hospitalId,
          isActive: true,
          effectiveFrom: { lte: periodEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
        },
        include: { department: true, paymentChannel: true },
        orderBy: [{ priority: 'desc' }, { effectiveFrom: 'desc' }],
      }),
    ]);

    const channelLookup = this.channelLookup(channels);
    const usedRules = new Map<string, ChargeRule>();
    const lines: CalculationLine[] = [];
    const warnings: string[] = [];
    const missingRules: { field: string; code: string; message: string }[] = [];
    const blockedVariances: { field: string; code: string; message: string }[] = [];

    await this.assertNoUsedLines(
      reports.flatMap((report) => report.lines.map((line) => line.id)),
      this.prisma,
      excludeRunId,
    );

    for (const report of reports) {
      // Only rules effective for the whole of this report's period are usable (INV-005/012).
      const { covering, straddling } = partitionRulesForPeriod(
        rules,
        report.periodStart,
        report.periodEnd,
      );
      const ruleLookup = buildRuleLookup(covering);
      const missingMessage = (scope: string, channelId: string | null, departmentId: string) =>
        `No active rule for ${scope} covering ${dateOnly(report.periodStart)} to ${dateOnly(
          report.periodEnd,
        )}${
          hasStraddlingRule(straddling, departmentId, channelId)
            ? ' (a rule changes inside this period; split the report by period)'
            : ''
        }`;

      for (const revenueLine of report.lines) {
        const department = revenueLine.department;
        // A report committed with approved variance is charged on its channel amounts (what its
        // rows evidence); the printed totals are kept for the record only.
        const approvedVariance = !!report.varianceApprovedAt;
        const lineVariance = money(revenueLine.reportedTotal)
          .minus(money(revenueLine.channelTotal))
          .abs();
        if (!approvedVariance && lineVariance.gt(TOTAL_TOLERANCE)) {
          blockedVariances.push({
            field: 'revenueLine',
            code: 'REVENUE_LINE_VARIANCE',
            message: `${department.code}: reported total differs from channel total by ${lineVariance.toFixed(
              2,
            )}`,
          });
          continue;
        }
        const amounts = this.amounts(revenueLine.amountsJson);
        const channelEntries = Object.entries(amounts)
          .map(([code, value]) => ({
            code,
            amount: new Decimal(value),
            channel: channelLookup.get(this.normalize(code)),
          }))
          .filter((entry) => entry.amount.gt(0));

        const usesChannels =
          channelEntries.length > 0 &&
          channelEntries.some((entry) =>
            hasChannelRule(ruleLookup, department.id, entry.channel?.id),
          );

        if (usesChannels) {
          let channelTotal = new Decimal(0);
          for (const entry of channelEntries) {
            if (!entry.channel) {
              throw new UnprocessableEntityException({
                code: 'CHANNEL_NOT_CONFIGURED',
                message: `Payment channel ${entry.code} is not configured for this hospital`,
                details: [{ field: 'amountsJson', code: 'CHANNEL_NOT_CONFIGURED' }],
              });
            }
            const rule = pickRule(ruleLookup, department.id, entry.channel.id);
            if (!rule) {
              missingRules.push({
                field: 'rules',
                code: 'RULE_MISSING',
                message: missingMessage(
                  `${department.code} / ${entry.channel.code}`,
                  entry.channel.id,
                  department.id,
                ),
              });
              continue;
            }
            usedRules.set(rule.id, rule);
            const base = money(entry.amount);
            const charge = roundMoney(base.mul(rule.rate).div(100), 'HALF_UP');
            lines.push(
              this.makeLine({
                report,
                revenueLine,
                department,
                channel: entry.channel,
                rule,
                base,
                charge,
                traceJson: {
                  mode: 'CHANNEL_SPLIT',
                  channelCode: entry.channel.code,
                  reportedTotal: money(revenueLine.reportedTotal).toFixed(2),
                  channelTotal: null,
                  variance: null,
                  ruleScope: this.ruleScope(rule),
                  rounding: 'HALF_UP',
                },
              }),
            );
            channelTotal = channelTotal.plus(base);
          }
          const reportedTotal = money(revenueLine.reportedTotal);
          const variance = reportedTotal.minus(channelTotal);
          if (!approvedVariance && variance.abs().gt('0.01')) {
            warnings.push(
              `${department.code}: channel total ${channelTotal.toFixed(
                2,
              )} differs from reported total ${reportedTotal.toFixed(2)}`,
            );
          }
        } else {
          const reportedTotal = approvedVariance
            ? money(revenueLine.channelTotal)
            : money(revenueLine.reportedTotal);
          if (reportedTotal.lte(0)) continue;
          const rule = pickRule(ruleLookup, department.id, null);
          if (!rule) {
            missingRules.push({
              field: 'rules',
              code: 'RULE_MISSING',
              message: missingMessage(`${department.code} (default)`, null, department.id),
            });
            continue;
          }
          usedRules.set(rule.id, rule);
          const base = reportedTotal;
          const charge = roundMoney(base.mul(rule.rate).div(100), 'HALF_UP');
          lines.push(
            this.makeLine({
              report,
              revenueLine,
              department,
              channel: null,
              rule,
              base,
              charge,
              traceJson: {
                mode: 'AGGREGATE',
                channelCode: null,
                reportedTotal: base.toFixed(2),
                channelTotal: null,
                variance: null,
                ruleScope: this.ruleScope(rule),
                rounding: 'HALF_UP',
              },
            }),
          );
        }
      }
    }

    if (blockedVariances.length > 0) {
      throw new UnprocessableEntityException({
        code: 'REVENUE_LINE_VARIANCE',
        message: 'Some revenue lines have a reported total that differs from their channel sum',
        details: blockedVariances,
      });
    }
    if (missingRules.length > 0) {
      throw new UnprocessableEntityException({
        code: 'RULE_MISSING',
        message: 'No eligible charge rule could be resolved for all revenue lines',
        details: missingRules,
      });
    }
    if (lines.length === 0) {
      throw new UnprocessableEntityException({
        code: 'NO_CHARGEABLE_LINES',
        message: 'The selected reports produced no chargeable revenue lines',
      });
    }

    const baseTotal = lines.reduce((total, line) => total.plus(line.baseAmount), new Decimal(0));
    const chargeTotal = lines.reduce(
      (total, line) => total.plus(line.chargeAmount),
      new Decimal(0),
    );
    const rulesSnapshot: Prisma.InputJsonValue = {
      version: 1,
      calculatedAt: new Date().toISOString(),
      calculationAsOfDate: dateOnly(asOf),
      sourceReportIds: reports.map((report) => report.id),
      precedence: ['department+channel', 'department', 'channel', 'default'],
      rounding: 'LINE_HALF_UP',
      reports: reports.map((report) => ({
        id: report.id,
        periodStart: dateOnly(report.periodStart),
        periodEnd: dateOnly(report.periodEnd),
        reportDate: dateOnly(report.reportDate),
        sourceFileName: report.sourceFileName,
        grandTotal: report.grandTotal.toString(),
        channelTotal: report.channelTotal.toString(),
      })),
      rules: [...usedRules.values()].map((rule) => ({
        id: rule.id,
        name: rule.name,
        rate: rule.rate.toString(),
        scope: this.ruleScope(rule),
        effectiveFrom: dateOnly(rule.effectiveFrom),
        effectiveTo: rule.effectiveTo ? dateOnly(rule.effectiveTo) : null,
        priority: rule.priority,
        rounding: 'HALF_UP',
      })),
      warnings,
    };

    return {
      hospitalId,
      periodStart,
      periodEnd,
      asOf,
      reports,
      lines,
      baseTotal,
      chargeTotal,
      rulesSnapshot,
      warnings,
    };
  }

  private async loadReports(
    user: AuthUser,
    dto: CalculateChargeRunDto,
  ): Promise<RevenueReportWithLines[]> {
    if (dto.reportIds?.length) {
      const reports = await this.prisma.revenueReport.findMany({
        where: {
          id: { in: dto.reportIds },
          organizationId: user.organizationId,
          status: ReportStatus.COMMITTED,
        },
        include: { lines: { include: { department: true } } },
      });
      if (reports.length !== dto.reportIds.length) {
        throw new NotFoundException({
          code: 'REPORT_NOT_FOUND',
          message: 'One or more committed reports were not found',
        });
      }
      const hospitals = [...new Set(reports.map((report) => report.hospitalId))];
      if (hospitals.length > 1) {
        throw new BadRequestException({
          code: 'MIXED_HOSPITALS',
          message: 'A charge run can only include reports from one hospital',
        });
      }
      if (dto.hospitalId && dto.hospitalId !== hospitals[0]) {
        throw new BadRequestException({
          code: 'HOSPITAL_MISMATCH',
          message: 'Selected reports do not belong to the requested hospital',
        });
      }
      assertHospitalAccess(user, hospitals[0]);
      if (dto.periodStart) {
        const requested = parseDate(dto.periodStart, 'periodStart');
        if (reports.some((report) => report.periodStart.getTime() < requested.getTime())) {
          throw new BadRequestException({
            code: 'REPORT_OUTSIDE_PERIOD',
            message: 'A selected report starts before the charge run period',
          });
        }
      }
      if (dto.periodEnd) {
        const requested = parseDate(dto.periodEnd, 'periodEnd');
        if (reports.some((report) => report.periodEnd.getTime() > requested.getTime())) {
          throw new BadRequestException({
            code: 'REPORT_OUTSIDE_PERIOD',
            message: 'A selected report ends after the charge run period',
          });
        }
      }
      return reports;
    }

    if (!dto.hospitalId || !dto.periodStart || !dto.periodEnd) {
      throw new BadRequestException({
        code: 'SELECTION_REQUIRED',
        message: 'Provide reportIds or hospitalId with periodStart and periodEnd',
      });
    }
    assertHospitalAccess(user, dto.hospitalId);
    const hospital = await this.prisma.hospital.findFirst({
      where: { id: dto.hospitalId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    const periodStart = parseDate(dto.periodStart, 'periodStart');
    const periodEnd = parseDate(dto.periodEnd, 'periodEnd');
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_PERIOD',
        message: 'periodEnd cannot be before periodStart',
      });
    }
    const reports = await this.prisma.revenueReport.findMany({
      where: {
        organizationId: user.organizationId,
        hospitalId: dto.hospitalId,
        status: ReportStatus.COMMITTED,
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
      },
      include: { lines: { include: { department: true } } },
      orderBy: [{ periodStart: 'asc' }, { createdAt: 'asc' }],
    });
    if (reports.length === 0) {
      throw new UnprocessableEntityException({
        code: 'NO_REVENUE_REPORTS',
        message: 'No committed revenue reports were found for this hospital and period',
      });
    }
    return reports;
  }

  private async assertNoUsedLines(
    revenueLineIds: string[],
    tx: Prisma.TransactionClient | PrismaService,
    excludeRunId?: string,
  ) {
    if (revenueLineIds.length === 0) return;
    const used = await tx.chargeLine.findFirst({
      where: {
        revenueLineId: { in: revenueLineIds },
        chargeRun: {
          status: { not: ChargeRunStatus.CANCELLED },
          ...(excludeRunId ? { id: { not: excludeRunId } } : {}),
        },
      },
      select: {
        revenueLineId: true,
        chargeRun: { select: { id: true, status: true } },
      },
    });
    if (used) {
      throw new ConflictException({
        code: 'REVENUE_ALREADY_CHARGED',
        message: 'One or more selected revenue lines already belong to a charge run',
        details: [
          {
            field: 'reportIds',
            code: 'REVENUE_ALREADY_CHARGED',
            message: `Charge run ${used.chargeRun.id} is ${used.chargeRun.status}`,
          },
        ],
      });
    }
  }

  private sourceReportIds(snapshot: Prisma.JsonValue | null): string[] {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return [];
    }
    const ids = (snapshot as { sourceReportIds?: unknown }).sourceReportIds;
    return Array.isArray(ids)
      ? ids.filter((value): value is string => typeof value === 'string')
      : [];
  }

  private makeLine(input: {
    report: RevenueReportWithLines;
    revenueLine: RevenueReportWithLines['lines'][number];
    department: Department;
    channel: PaymentChannel | null;
    rule: ChargeRule;
    base: Decimal;
    charge: Decimal;
    traceJson: Prisma.InputJsonValue;
  }): CalculationLine {
    return {
      revenueLineId: input.revenueLine.id,
      reportId: input.report.id,
      departmentId: input.department.id,
      departmentCode: input.department.code,
      departmentName: input.department.name,
      paymentChannelId: input.channel?.id ?? null,
      paymentChannelCode: input.channel?.code ?? null,
      paymentChannelName: input.channel?.name ?? null,
      ruleId: input.rule.id,
      ruleName: input.rule.name,
      baseAmount: input.base.toFixed(2),
      rate: input.rule.rate.toString(),
      chargeAmount: input.charge.toFixed(2),
      rounding: 'HALF_UP',
      traceJson: { ...(input.traceJson as Record<string, unknown>), exempt: input.rule.isExempt },
    };
  }

  private toPreview(calculation: Calculation) {
    const hospitalId = calculation.hospitalId;
    return this.prisma.hospital
      .findUnique({
        where: { id: hospitalId },
        select: {
          id: true,
          code: true,
          name: true,
          currency: true,
          paymentTermsDays: true,
          gracePeriodDays: true,
        },
      })
      .then((hospital) => ({
        hospital,
        periodStart: dateOnly(calculation.periodStart),
        periodEnd: dateOnly(calculation.periodEnd),
        calculationAsOfDate: dateOnly(calculation.asOf),
        status: 'PREVIEW',
        reports: calculation.reports.map((report) => ({
          id: report.id,
          periodStart: dateOnly(report.periodStart),
          periodEnd: dateOnly(report.periodEnd),
          reportDate: dateOnly(report.reportDate),
          sourceFileName: report.sourceFileName,
          grandTotal: report.grandTotal.toFixed(2),
          channelTotal: report.channelTotal.toFixed(2),
        })),
        lines: calculation.lines.map((line) => ({
          id: null,
          revenueLineId: line.revenueLineId,
          reportId: line.reportId,
          department: {
            id: line.departmentId,
            code: line.departmentCode,
            name: line.departmentName,
          },
          paymentChannel: line.paymentChannelId
            ? {
                id: line.paymentChannelId,
                code: line.paymentChannelCode,
                name: line.paymentChannelName,
              }
            : null,
          rule: { id: line.ruleId, name: line.ruleName },
          baseAmount: line.baseAmount,
          rate: line.rate,
          chargeAmount: line.chargeAmount,
          rounding: line.rounding,
          trace: line.traceJson,
        })),
        baseTotal: calculation.baseTotal.toFixed(2),
        chargeTotal: calculation.chargeTotal.toFixed(2),
        warnings: calculation.warnings,
        rulesSnapshot: calculation.rulesSnapshot,
      }));
  }

  private amounts(value: Prisma.JsonValue): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const amounts: Record<string, string> = {};
    for (const [code, amount] of Object.entries(value)) {
      if (typeof amount === 'string') amounts[code] = amount;
      else if (typeof amount === 'number') amounts[code] = amount.toString();
    }
    return amounts;
  }

  private channelLookup(channels: ChannelWithAliases[]) {
    const lookup = new Map<string, ChannelWithAliases>();
    for (const channel of channels) {
      lookup.set(this.normalize(channel.code), channel);
      for (const alias of channel.aliases) {
        lookup.set(this.normalize(alias.alias), channel);
      }
    }
    return lookup;
  }

  private ruleScope(rule: ChargeRule) {
    return {
      departmentId: rule.departmentId,
      paymentChannelId: rule.paymentChannelId,
    };
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
