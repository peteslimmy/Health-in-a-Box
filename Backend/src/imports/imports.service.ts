import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImportStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import { AuditService } from '../common/services/audit.service';
import { StorageService } from '../common/services/storage.service';
import { AuthUser } from '../common/types/auth-user';
import { dateInTimeZone, parseDate } from '../common/utils/dates';
import { moneyString } from '../common/utils/money';
import { paged, pagination } from '../common/utils/pagination';
import { assertHospitalAccess, hospitalWhere, narrowUserScope } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import { CoveredPeriod, assessCoverage, planTrim, range, readableDate } from './coverage';
import {
  ApproveVarianceDto,
  CommitImportDto,
  ImportQueryDto,
  UploadImportDto,
} from './dto/import.dto';
import { extractFile } from './file-extractor';
import {
  assessVariance,
  summariseVariance,
  type ValidationIssue,
  type VarianceSummary,
} from './variance';
import type { PdfReportData } from './pdf-report-reader';
import { subtractRecorded } from './trim';
import { fingerprintReport } from './report-fingerprint';
import { ParseResult, RevenueParserService } from './revenue-parser.service';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const COMMITABLE: ImportStatus[] = [ImportStatus.READY_TO_COMMIT];
/** States in which a batch "owns" its content; a NEEDS_REVIEW or FAILED batch does not. */
const DUPLICATE_STATES: ImportStatus[] = [
  ImportStatus.READY_TO_COMMIT,
  ImportStatus.PROCESSING,
  ImportStatus.COMMITTED,
];
/** Parts of an XLSX package that carry macros or external workbook links. */
export const UNSAFE_XLSX_MARKERS = ['vbaProject.bin', 'externalLinks/', 'oleObject'];

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: RevenueParserService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: ImportQueryDto) {
    const { page, pageSize, skip, take } = pagination(query);
    const status = query.status ? this.status(query.status) : undefined;
    const where: Prisma.ImportBatchWhereInput = {
      organizationId: user.organizationId,
      ...hospitalWhere(user, query.hospitalId),
      ...(status ? { status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.importBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          hospitalId: true,
          status: true,
          kind: true,
          fileName: true,
          periodStart: true,
          periodEnd: true,
          rowCount: true,
          validRowCount: true,
          totalAmount: true,
          committedReportId: true,
          createdAt: true,
          hospital: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.importBatch.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  async get(user: AuthUser, id: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, organizationId: user.organizationId },
      // Storage keys and the raw uploaded rows are internal; the API never returns them.
      omit: { fileKey: true, rowsJson: true },
      include: {
        hospital: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        committedReport: {
          select: {
            id: true,
            varianceApprovedAt: true,
            varianceReason: true,
            varianceJson: true,
            varianceApprovedBy: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    assertHospitalAccess(user, batch.hospitalId);
    const validation = batch.validationJson as Record<string, unknown> | null;
    const errorCount = Array.isArray(validation?.errors) ? validation.errors.length : 0;
    return { ...batch, errorCount };
  }

  async upload(user: AuthUser, file: Express.Multer.File | undefined, dto: UploadImportDto) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'A file is required' });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'The file exceeds the 15 MB upload limit',
      });
    }
    const lower = (file.originalname || '').toLowerCase();
    const isCsv = lower.endsWith('.csv');
    const isXlsx = lower.endsWith('.xlsx');
    const isPdf = lower.endsWith('.pdf');
    if (!isCsv && !isXlsx && !isPdf) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: 'Only PDF, CSV and XLSX files are supported',
      });
    }
    if (isPdf && file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new UnprocessableEntityException({
        code: 'INVALID_FILE_CONTENT',
        message: 'The file is not a valid PDF document',
      });
    }
    if (isXlsx && !file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new UnprocessableEntityException({
        code: 'INVALID_FILE_CONTENT',
        message: 'The file is not a valid XLSX workbook',
      });
    }
    if (isXlsx && UNSAFE_XLSX_MARKERS.some((marker) => file.buffer.includes(marker))) {
      throw new UnprocessableEntityException({
        code: 'UNSAFE_FILE_CONTENT',
        message: 'Workbooks containing macros, embedded objects or external links are not accepted',
      });
    }
    if (isCsv && file.buffer.includes(0)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_FILE_CONTENT',
        message: 'The file is not a valid CSV document',
      });
    }

    const hospital = await this.prisma.hospital.findFirst({
      where: { id: dto.hospitalId, organizationId: user.organizationId },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    assertHospitalAccess(user, hospital.id);
    // FR-CEN-009: a draft, suspended or archived hospital cannot receive revenue reports.
    if (hospital.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'HOSPITAL_NOT_ACTIVE',
        message: `The hospital is ${hospital.status.toLowerCase()}; activate it before importing revenue`,
      });
    }

    // The file is read in a separate, resource-limited process (never inside the API); only plain
    // rows come back. A PDF also states the period it covers and which text was set aside.
    let pdf: PdfReportData | null = null;
    let tableRows: unknown[][];
    try {
      const extracted = await extractFile(isPdf ? 'pdf' : 'table', file.buffer, file.originalname);
      pdf = extracted.pdf;
      tableRows = extracted.rows;
    } catch (error) {
      throw new UnprocessableEntityException({
        code: 'IMPORT_PARSE_FAILED',
        message: isPdf
          ? (error as Error).message
          : `The file could not be parsed: ${(error as Error).message}`,
      });
    }
    const startText = dto.periodStart ?? pdf?.period?.start;
    const endText = dto.periodEnd ?? pdf?.period?.end;
    if (!startText || !endText) {
      throw new BadRequestException({
        code: 'PERIOD_REQUIRED',
        message: isPdf
          ? 'The PDF does not state the period it covers (a "Between ... and ..." line); enter the period'
          : 'The period start and end dates are required',
      });
    }
    if (pdf?.period && (pdf.period.start !== startText || pdf.period.end !== endText)) {
      throw new UnprocessableEntityException({
        code: 'PERIOD_MISMATCH',
        message: `The PDF says it covers ${readableDate(pdf.period.start)} to ${readableDate(pdf.period.end)}, but ${readableDate(startText)} to ${readableDate(endText)} was entered. Leave the dates blank to use the PDF's own period`,
      });
    }
    const periodStart = parseDate(startText, 'periodStart');
    const periodEnd = parseDate(endText, 'periodEnd');
    if (periodEnd < periodStart) {
      throw new BadRequestException({
        code: 'INVALID_PERIOD',
        message: 'periodEnd cannot be before periodStart',
      });
    }
    const reportDate = dto.reportDate ? parseDate(dto.reportDate, 'reportDate') : periodEnd;

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.prisma.importBatch.findFirst({
      where: {
        organizationId: user.organizationId,
        hospitalId: hospital.id,
        fileHash,
        status: { in: DUPLICATE_STATES },
      },
      select: { id: true, status: true, createdAt: true, fileName: true },
    });
    if (duplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_FILE',
        message: 'This exact file was already uploaded for the hospital',
        details: [duplicate],
      });
    }

    const loadSetup = () =>
      this.prisma.$transaction([
        this.prisma.department.findMany({
          where: { hospitalId: hospital.id },
          include: { aliases: true },
          orderBy: { code: 'asc' },
        }),
        this.prisma.paymentChannel.findMany({
          where: { hospitalId: hospital.id, isActive: true },
          include: { aliases: true },
          orderBy: { code: 'asc' },
        }),
      ]);
    const parse = (
      departments: Awaited<ReturnType<typeof loadSetup>>[0],
      channels: Awaited<ReturnType<typeof loadSetup>>[1],
    ): ParseResult => {
      try {
        return this.parser.parseRows(tableRows, departments, channels);
      } catch (error) {
        throw new UnprocessableEntityException({
          code: 'IMPORT_PARSE_FAILED',
          message: `The file could not be parsed: ${(error as Error).message}`,
        });
      }
    };

    let [departments, channels] = await loadSetup();
    const setupAdded: { departments: string[]; channels: string[] } = {
      departments: [],
      channels: [],
    };
    if (dto.createMissing === 'true') {
      const preview = parse(departments, channels);
      const { unmatched } = preview;
      if (unmatched.departments.length > 0 || unmatched.channels.length > 0) {
        const allowed = narrowUserScope(user, ['hospitals.update']);
        if (!allowed) {
          throw new ForbiddenException({
            code: 'SETUP_NOT_PERMITTED',
            message: 'Adding departments and channels needs the hospital-update permission',
          });
        }
        assertHospitalAccess(allowed, hospital.id);
        await this.addMissingSetup(user, hospital.id, unmatched, departments, channels, setupAdded);
        [departments, channels] = await loadSetup();
      }
    }
    if (departments.length === 0) {
      throw new BadRequestException({
        code: 'HOSPITAL_NOT_CONFIGURED',
        message:
          'The hospital has no departments yet. Add them in the hospital setup, or upload again with "add missing departments and channels" ticked',
      });
    }
    if (channels.length === 0) {
      throw new BadRequestException({
        code: 'HOSPITAL_NOT_CONFIGURED',
        message:
          'The hospital has no payment channels yet. Add them in the hospital setup, or upload again with "add missing departments and channels" ticked',
      });
    }

    const result = parse(departments, channels);

    // Coverage controls: days already reported are never overwritten or double counted, and
    // days skipped between reports are flagged for acknowledgement.
    const [committedReports, pendingBatches] = await this.prisma.$transaction([
      this.prisma.revenueReport.findMany({
        where: {
          organizationId: user.organizationId,
          hospitalId: hospital.id,
          status: 'COMMITTED',
        },
        select: { periodStart: true, periodEnd: true, sourceFileName: true, id: true },
        orderBy: { periodStart: 'asc' },
        take: 2000,
      }),
      this.prisma.importBatch.findMany({
        where: {
          organizationId: user.organizationId,
          hospitalId: hospital.id,
          status: { in: [ImportStatus.READY_TO_COMMIT, ImportStatus.PROCESSING] },
        },
        select: { periodStart: true, periodEnd: true, fileName: true, id: true },
        take: 200,
      }),
    ]);
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const existing: CoveredPeriod[] = [
      ...committedReports.map((report) => ({
        id: report.id,
        start: iso(report.periodStart),
        end: iso(report.periodEnd),
        state: 'COMMITTED' as const,
        label: report.sourceFileName ?? `report ${report.id.slice(0, 8)}`,
      })),
      ...pendingBatches.map((batch) => ({
        start: iso(batch.periodStart),
        end: iso(batch.periodEnd),
        state: 'PENDING' as const,
        label: batch.fileName ?? `upload ${batch.id.slice(0, 8)}`,
      })),
    ];

    // A file that repeats days already reported, where the earlier reports sit wholly inside its
    // period, contributes only the new days: its totals minus what is already recorded.
    let takenStart = periodStart;
    let takenEnd = periodEnd;
    let trim: Record<string, unknown> | null = null;
    let coverageExisting = existing;
    const trimPlan = planTrim({ start: iso(periodStart), end: iso(periodEnd), existing });
    if (trimPlan.plan) {
      const plan = trimPlan.plan;
      coverageExisting = existing.filter((period) => !plan.covered.includes(period));
      const note = `${range(iso(periodStart), iso(periodEnd))} was uploaded; ${plan.covered
        .map((period) => `${range(period.start, period.end)} (${period.label})`)
        .join(
          ', ',
        )} ${plan.covered.length === 1 ? 'is' : 'are'} already in the system and left untouched. Only ${range(plan.start, plan.end)} will be taken`;
      if (result.errors.length === 0) {
        const recorded = await this.prisma.revenueLine.findMany({
          where: { reportId: { in: plan.covered.map((period) => period.id as string) } },
          select: {
            departmentId: true,
            reportedTotal: true,
            channelTotal: true,
            amountsJson: true,
          },
        });
        const taken = subtractRecorded(
          result.lines,
          recorded.map((line) => ({
            departmentId: line.departmentId,
            reportedTotal: line.reportedTotal.toString(),
            channelTotal: line.channelTotal.toString(),
            amounts: (line.amountsJson ?? {}) as Record<string, string>,
          })),
        );
        if (taken.errors.length > 0) {
          result.errors.push(...taken.errors);
        } else {
          result.lines = taken.lines;
          result.grandTotal = taken.grandTotal;
          result.channelTotal = taken.channelTotal;
          takenStart = parseDate(plan.start, 'periodStart');
          takenEnd = parseDate(plan.end, 'periodEnd');
          trim = {
            fileStart: iso(periodStart),
            fileEnd: iso(periodEnd),
            takenStart: plan.start,
            takenEnd: plan.end,
            alreadyRecorded: plan.covered.map((period) => ({
              start: period.start,
              end: period.end,
              label: period.label,
            })),
            recordedTotal: taken.recordedTotal,
          };
          result.warnings.push({ code: 'ONLY_NEW_DAYS_TAKEN', message: note });
        }
      } else {
        result.warnings.push({
          code: 'ONLY_NEW_DAYS_WILL_BE_TAKEN',
          message: `${note}, once the errors in this file are fixed`,
        });
      }
    }

    // Content fingerprint: the same figures for the same hospital and period are the same report,
    // however the file is named or formatted.
    const contentFingerprint = fingerprintReport(
      hospital.id,
      iso(takenStart),
      iso(takenEnd),
      result.lines,
    );
    const sameContent = await this.prisma.importBatch.findFirst({
      where: {
        organizationId: user.organizationId,
        hospitalId: hospital.id,
        contentFingerprint,
        periodStart: takenStart,
        periodEnd: takenEnd,
        status: { in: DUPLICATE_STATES },
      },
      select: { id: true, status: true, createdAt: true, fileName: true },
    });
    if (sameContent) {
      throw new ConflictException({
        code: 'DUPLICATE_REPORT',
        message:
          'A report with identical figures for this hospital and period already exists. Submit a correction instead of re-uploading it.',
        details: [sameContent],
      });
    }

    const coverage = assessCoverage({
      start: iso(takenStart),
      end: iso(takenEnd),
      today: dateInTimeZone(new Date(), hospital.timezone),
      existing: coverageExisting,
    });
    for (const error of coverage.errors) {
      if (error.code === 'PERIOD_ALREADY_UPLOADED' && trimPlan.blocked) {
        error.message = `${error.message}. ${trimPlan.blocked}`;
      }
    }
    result.errors.push(...coverage.errors);
    result.warnings.push(...coverage.warnings);
    const flags = coverage.flags;

    const source: Record<string, unknown> | null = pdf
      ? {
          kind: 'PDF',
          title: pdf.title,
          printDate: pdf.printDate,
          period: pdf.period,
          pages: pdf.pages,
          departmentRows: result.lines.length,
          ignoredLines: pdf.ignoredLines,
        }
      : null;
    if (pdf) {
      if (pdf.printDate && pdf.printDate < iso(periodEnd)) {
        result.errors.push({
          code: 'PRINTED_BEFORE_PERIOD_END',
          message: `The report was printed on ${readableDate(pdf.printDate)}, before the period ends (${readableDate(iso(periodEnd))}); it cannot include the final days`,
        });
      }
      const words = hospital.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3);
      const title = (pdf.title ?? '').toLowerCase();
      if (words.length > 0 && !words.some((word) => title.includes(word))) {
        result.warnings.push({
          code: 'TITLE_HOSPITAL_MISMATCH',
          message: `The report is titled "${pdf.title ?? 'unknown'}", which does not mention "${hospital.name}". Confirm it belongs to this hospital`,
        });
      }
    }

    const fileKey = await this.storage.put(
      file.buffer,
      file.originalname,
      isPdf
        ? 'application/pdf'
        : isCsv
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const status =
      result.errors.length === 0 ? ImportStatus.READY_TO_COMMIT : ImportStatus.NEEDS_REVIEW;

    let batch;
    try {
      batch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.importBatch.create({
          data: {
            organizationId: user.organizationId,
            hospitalId: hospital.id,
            kind: 'REVENUE_REPORT',
            status,
            fileName: file.originalname,
            fileKey,
            fileHash,
            contentFingerprint,
            periodStart: takenStart,
            periodEnd: takenEnd,
            rowsJson: json({
              columns: result.channelColumns,
              ignoredColumns: result.ignoredColumns,
              rows: result.rows,
            }),
            normalizedJson: json({
              reportDate: reportDate.toISOString().slice(0, 10),
              lines: result.lines,
            }),
            validationJson: json({
              errors: result.errors,
              warnings: result.warnings,
              grandTotal: result.grandTotal,
              channelTotal: result.channelTotal,
              ignoredColumns: result.ignoredColumns,
              flags,
              trim,
              source,
              setupAdded,
              checks: {
                departmentRows: result.lines.length,
                channelColumns: result.channelColumns.length,
                rowsWithMismatch: result.errors.filter((e) => e.code === 'ROW_TOTAL_MISMATCH')
                  .length,
              },
            }),
            rowCount: result.lines.length,
            validRowCount:
              result.errors.length === 0
                ? result.lines.length
                : Math.max(0, result.lines.length - this.affectedRows(result)),
            totalAmount: result.grandTotal,
            createdById: user.id,
          },
          include: { hospital: { select: { id: true, code: true, name: true } } },
        });
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            hospitalId: hospital.id,
            action: 'IMPORT_UPLOADED',
            targetType: 'ImportBatch',
            targetId: created.id,
            summary: `Uploaded revenue report ${file.originalname} (${status})`,
            after: {
              status,
              errors: result.errors.length,
              warnings: result.warnings.length,
              flags: flags.map((flag) => flag.code),
              grandTotal: result.grandTotal,
              period: `${iso(takenStart)} to ${iso(takenEnd)}`,
              trimmed: trim !== null,
              addedDepartments: setupAdded.departments.length,
              addedChannels: setupAdded.channels.length,
            },
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      throw this.mapDuplicate(error);
    }

    return batch;
  }

  /** Creates the departments and channels named in a file that the hospital does not have yet. */
  private async addMissingSetup(
    user: AuthUser,
    hospitalId: string,
    unmatched: { departments: string[]; channels: string[] },
    departments: Array<{ code: string }>,
    channels: Array<{ code: string }>,
    added: { departments: string[]; channels: string[] },
  ) {
    const makeCode = (name: string, taken: Set<string>) => {
      const base =
        name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 26) || 'ITEM';
      let code = base.length < 2 ? `${base}_` : base;
      for (let n = 2; taken.has(code); n += 1) code = `${base.slice(0, 24)}_${n}`;
      taken.add(code);
      return code;
    };
    const takenDepartments = new Set(departments.map((d) => d.code));
    const takenChannels = new Set(channels.map((c) => c.code));
    await this.prisma.$transaction(async (tx) => {
      for (const name of unmatched.departments.slice(0, 500)) {
        const created = await tx.department.create({
          data: { hospitalId, code: makeCode(name, takenDepartments), name },
        });
        added.departments.push(created.name);
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            hospitalId,
            action: 'DEPARTMENT_CREATED',
            targetType: 'Department',
            targetId: created.id,
            summary: `Added department ${created.code} from an uploaded report`,
            after: { code: created.code, name: created.name },
          },
          tx,
        );
      }
      for (const name of unmatched.channels.slice(0, 50)) {
        const created = await tx.paymentChannel.create({
          data: { hospitalId, code: makeCode(name, takenChannels), name },
        });
        added.channels.push(created.name);
        await this.audit.record(
          {
            organizationId: user.organizationId,
            actorId: user.id,
            hospitalId,
            action: 'PAYMENT_CHANNEL_CREATED',
            targetType: 'PaymentChannel',
            targetId: created.id,
            summary: `Added payment channel ${created.code} from an uploaded report`,
            after: { code: created.code, name: created.name },
          },
          tx,
        );
      }
    });
  }

  async commit(user: AuthUser, id: string, dto: CommitImportDto = {}) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    assertHospitalAccess(user, batch.hospitalId);
    if (batch.status === ImportStatus.COMMITTED && batch.committedReportId) {
      return { status: batch.status, reportId: batch.committedReportId, alreadyCommitted: true };
    }
    // Maker-checker: the person who prepared the import cannot be the one who commits it.
    if (batch.createdById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The person who uploaded an import cannot commit it; ask a reviewer',
      });
    }

    const validation = (batch.validationJson ?? {}) as Record<string, unknown>;
    const errors = Array.isArray(validation.errors) ? validation.errors : [];
    if (!COMMITABLE.includes(batch.status)) {
      throw new BadRequestException({
        code: 'IMPORT_NOT_READY',
        message:
          batch.status === ImportStatus.NEEDS_REVIEW
            ? 'Resolve validation errors before committing this import'
            : `Import cannot be committed from status ${batch.status}`,
        details: batch.status === ImportStatus.NEEDS_REVIEW ? errors.slice(0, 50) : [],
      });
    }
    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'IMPORT_NOT_READY',
        message: 'Resolve validation errors before committing this import',
        details: errors.slice(0, 50),
      });
    }
    const flags = (Array.isArray(validation.flags) ? validation.flags : []) as Array<{
      code: string;
      message: string;
      requiresAcknowledgement?: boolean;
    }>;
    const needsAcknowledgement = flags.filter((flag) => flag.requiresAcknowledgement);
    const acknowledgement = dto.acknowledgement?.trim();
    if (needsAcknowledgement.length > 0 && !acknowledgement) {
      throw new BadRequestException({
        code: 'ACKNOWLEDGEMENT_REQUIRED',
        message:
          'This import has omitted days. State why this is acceptable (at least 10 characters) to commit it',
        details: needsAcknowledgement,
      });
    }
    await this.assertPeriodStillFree(user, batch);
    const normalized = (batch.normalizedJson ?? {}) as {
      reportDate?: string;
      lines?: Array<{
        departmentId: string;
        reportedTotal: string;
        channelTotal: string;
        variance: string;
        amounts: Record<string, string>;
      }>;
    };
    if (!normalized.lines?.length) {
      throw new BadRequestException({
        code: 'IMPORT_NOT_READY',
        message: 'The import contains no normalized lines',
      });
    }
    const lines = normalized.lines;
    // Defence in depth for batches validated before variance became blocking (INV-001).
    const mismatched = lines.filter((line) => new Decimal(line.variance).abs().gt('0.01'));
    if (mismatched.length > 0) {
      throw new BadRequestException({
        code: 'IMPORT_NOT_READY',
        message: 'Some rows have a reported total that differs from their channel sum',
        details: mismatched.slice(0, 50).map((line) => ({
          field: 'total',
          code: 'ROW_TOTAL_MISMATCH',
          message: `Department ${line.departmentId}: variance ${line.variance}`,
        })),
      });
    }
    const reportDate = normalized.reportDate
      ? parseDate(normalized.reportDate, 'reportDate')
      : batch.periodEnd;
    const grandTotal =
      typeof validation.grandTotal === 'string'
        ? validation.grandTotal
        : lines.reduce((total, line) => total.plus(line.reportedTotal), new Decimal(0)).toFixed(2);
    const channelTotal =
      typeof validation.channelTotal === 'string'
        ? validation.channelTotal
        : lines.reduce((total, line) => total.plus(line.channelTotal), new Decimal(0)).toFixed(2);

    let report;
    try {
      report = await this.commitInTransaction(user, batch, {
        lines,
        reportDate,
        grandTotal,
        channelTotal,
        acknowledgement: needsAcknowledgement.length > 0 ? acknowledgement : undefined,
        acknowledgedFlags: needsAcknowledgement.map((flag) => flag.message),
      });
    } catch (error) {
      throw this.mapDuplicate(error);
    }

    return {
      status: ImportStatus.COMMITTED,
      reportId: report.id,
      alreadyCommitted: false,
      grandTotal: moneyString(report.grandTotal),
    };
  }

  /** Days may have been reported by another upload since this one was checked; existing records are never overwritten. */
  private async assertPeriodStillFree(
    user: AuthUser,
    batch: { hospitalId: string; periodStart: Date; periodEnd: Date },
  ) {
    const alreadyReported = await this.prisma.revenueReport.findFirst({
      where: {
        organizationId: user.organizationId,
        hospitalId: batch.hospitalId,
        status: 'COMMITTED',
        periodStart: { lte: batch.periodEnd },
        periodEnd: { gte: batch.periodStart },
      },
      select: { periodStart: true, periodEnd: true, sourceFileName: true },
    });
    if (alreadyReported) {
      throw new ConflictException({
        code: 'PERIOD_ALREADY_UPLOADED',
        message: `Days in this import (${readableDate(alreadyReported.periodStart.toISOString().slice(0, 10))} to ${readableDate(alreadyReported.periodEnd.toISOString().slice(0, 10))}) are already in the system${alreadyReported.sourceFileName ? ` (${alreadyReported.sourceFileName})` : ''}; existing records are not overwritten`,
      });
    }
  }

  /**
   * Commits a held report although its printed totals do not add up. Only differences between the
   * totals and the figures beneath them can be accepted; any other finding still blocks. The
   * approver must hold `imports.approve_variance`, cannot be the uploader, and gives a written
   * reason. The report is stored with the channel amounts as its figures (printed totals and
   * every difference are kept), and charges are later calculated on those channel amounts.
   */
  async commitWithVariance(user: AuthUser, id: string, dto: ApproveVarianceDto) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    assertHospitalAccess(user, batch.hospitalId);
    if (batch.status === ImportStatus.COMMITTED && batch.committedReportId) {
      return {
        status: batch.status,
        reportId: batch.committedReportId,
        alreadyCommitted: true,
        withVariance: true,
      };
    }
    if (batch.createdById === user.id) {
      throw new ForbiddenException({
        code: 'MAKER_CHECKER_VIOLATION',
        message: 'The person who uploaded an import cannot approve its differences; ask a reviewer',
      });
    }
    if (batch.status !== ImportStatus.NEEDS_REVIEW) {
      throw new BadRequestException({
        code: 'VARIANCE_NOT_APPLICABLE',
        message:
          batch.status === ImportStatus.READY_TO_COMMIT
            ? 'This import has no differences to approve; commit it normally'
            : `An import in status ${batch.status} cannot be committed with approved differences`,
      });
    }
    const validation = (batch.validationJson ?? {}) as Record<string, unknown>;
    const errors = (Array.isArray(validation.errors) ? validation.errors : []) as ValidationIssue[];
    const assessment = assessVariance(errors);
    if (!assessment.eligible) {
      throw new UnprocessableEntityException({
        code: 'VARIANCE_NOT_ALLOWED',
        message:
          assessment.blockers.length > 0
            ? 'Only differences between the printed totals and the figures can be approved. Other problems in this file still have to be fixed by uploading a corrected report'
            : 'There are no total differences to approve',
        details: assessment.blockers.slice(0, 50),
      });
    }
    const flags = (Array.isArray(validation.flags) ? validation.flags : []) as Array<{
      message: string;
      requiresAcknowledgement?: boolean;
    }>;
    const needsAcknowledgement = flags.filter((flag) => flag.requiresAcknowledgement);
    const acknowledgement = dto.acknowledgement?.trim();
    if (needsAcknowledgement.length > 0 && !acknowledgement) {
      throw new BadRequestException({
        code: 'ACKNOWLEDGEMENT_REQUIRED',
        message:
          'This import also has omitted days. State why this is acceptable (at least 10 characters) to commit it',
        details: needsAcknowledgement,
      });
    }
    await this.assertPeriodStillFree(user, batch);

    const normalized = (batch.normalizedJson ?? {}) as {
      reportDate?: string;
      lines?: Array<{
        rowNumber?: number;
        rawDepartment?: string;
        departmentId: string;
        reportedTotal: string;
        channelTotal: string;
        variance: string;
        amounts: Record<string, string>;
      }>;
    };
    const lines = normalized.lines ?? [];
    if (lines.length === 0) {
      throw new BadRequestException({
        code: 'IMPORT_NOT_READY',
        message: 'The import contains no readable department rows',
      });
    }
    const printedGrandTotal =
      typeof validation.grandTotal === 'string'
        ? validation.grandTotal
        : lines.reduce((total, line) => total.plus(line.reportedTotal), new Decimal(0)).toFixed(2);
    const summary = summariseVariance({ errors, printedGrandTotal, lines });
    const reportDate = normalized.reportDate
      ? parseDate(normalized.reportDate, 'reportDate')
      : batch.periodEnd;

    let report;
    try {
      report = await this.commitInTransaction(user, batch, {
        lines,
        reportDate,
        // The report's figures are what its rows evidence: the sum of the channel amounts.
        grandTotal: summary.evidencedTotal,
        channelTotal: summary.evidencedTotal,
        acknowledgement: needsAcknowledgement.length > 0 ? acknowledgement : undefined,
        acknowledgedFlags: needsAcknowledgement.map((flag) => flag.message),
        variance: {
          reason: dto.reason.trim(),
          summary,
        },
      });
    } catch (error) {
      throw this.mapDuplicate(error);
    }
    return {
      status: ImportStatus.COMMITTED,
      reportId: report.id,
      alreadyCommitted: false,
      withVariance: true,
      grandTotal: moneyString(report.grandTotal),
      printedGrandTotal: summary.printedGrandTotal,
      difference: summary.difference,
    };
  }

  private async commitInTransaction(
    user: AuthUser,
    batch: {
      id: string;
      hospitalId: string;
      periodStart: Date;
      periodEnd: Date;
      fileName: string | null;
      fileHash: string | null;
      contentFingerprint: string | null;
    },
    input: {
      lines: Array<{
        departmentId: string;
        reportedTotal: string;
        channelTotal: string;
        variance: string;
        amounts: Record<string, string>;
      }>;
      reportDate: Date;
      grandTotal: string;
      channelTotal: string;
      acknowledgement?: string;
      acknowledgedFlags?: string[];
      /** Present when a held report is committed although its totals did not add up. */
      variance?: { reason: string; summary: VarianceSummary };
    },
  ) {
    const { lines, reportDate, grandTotal, channelTotal } = input;
    const id = batch.id;
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.importBatch.updateMany({
        where: {
          id,
          status: input.variance ? ImportStatus.NEEDS_REVIEW : ImportStatus.READY_TO_COMMIT,
        },
        data: { status: ImportStatus.PROCESSING },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'IMPORT_COMMIT_CONFLICT',
          message: 'This import is already being committed',
        });
      }
      const created = await tx.revenueReport.create({
        data: {
          organizationId: user.organizationId,
          hospitalId: batch.hospitalId,
          periodStart: batch.periodStart,
          periodEnd: batch.periodEnd,
          reportDate,
          status: 'COMMITTED',
          grandTotal,
          channelTotal,
          sourceFileName: batch.fileName,
          sourceFileHash: batch.fileHash,
          contentFingerprint: batch.contentFingerprint,
          importBatchId: batch.id,
          createdById: user.id,
          ...(input.variance
            ? {
                varianceApprovedById: user.id,
                varianceApprovedAt: new Date(),
                varianceReason: input.variance.reason,
                varianceJson: input.variance.summary as unknown as Prisma.InputJsonValue,
              }
            : {}),
          lines: {
            create: lines.map((line) => ({
              departmentId: line.departmentId,
              reportedTotal: line.reportedTotal,
              channelTotal: line.channelTotal,
              variance: line.variance,
              amountsJson: line.amounts,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.importBatch.update({
        where: { id },
        data: { status: ImportStatus.COMMITTED, committedReportId: created.id },
      });
      // The audit event commits (or rolls back) together with the financial change.
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: batch.hospitalId,
          action: input.variance ? 'IMPORT_COMMITTED_WITH_VARIANCE' : 'IMPORT_COMMITTED',
          targetType: 'ImportBatch',
          targetId: batch.id,
          summary: input.variance
            ? `Committed revenue report for ${batch.periodStart.toISOString().slice(0, 10)} with approved variance`
            : `Committed revenue report for ${batch.periodStart.toISOString().slice(0, 10)}`,
          after: {
            reportId: created.id,
            grandTotal: moneyString(created.grandTotal),
            lines: created.lines.length,
            acknowledgement: input.acknowledgement,
            acknowledgedFlags: input.acknowledgedFlags,
            ...(input.variance
              ? {
                  varianceReason: input.variance.reason,
                  printedGrandTotal: input.variance.summary.printedGrandTotal,
                  evidencedTotal: input.variance.summary.evidencedTotal,
                  difference: input.variance.summary.difference,
                  findings: input.variance.summary.findings,
                  findingsByCode: input.variance.summary.findingsByCode,
                }
              : {}),
          },
        },
        tx,
      );
      return created;
    });
  }

  /** The file exactly as uploaded, for review against the parsed figures. Every download is audited. */
  async downloadSource(user: AuthUser, id: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true, hospitalId: true, fileKey: true, fileName: true },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    assertHospitalAccess(user, batch.hospitalId);
    if (!batch.fileKey) {
      throw new NotFoundException({
        code: 'FILE_NOT_STORED',
        message: 'The original file is not available',
      });
    }
    const content = await this.storage.get(batch.fileKey);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      hospitalId: batch.hospitalId,
      action: 'IMPORT_SOURCE_DOWNLOADED',
      targetType: 'ImportBatch',
      targetId: batch.id,
      summary: `Downloaded the original file ${batch.fileName ?? batch.id}`,
    });
    const name = (batch.fileName ?? 'report').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
    const lower = name.toLowerCase();
    const contentType = lower.endsWith('.pdf')
      ? 'application/pdf'
      : lower.endsWith('.csv')
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return { content, fileName: name, contentType };
  }

  async template(user: AuthUser, hospitalId: string) {
    const hospital = await this.prisma.hospital.findFirst({
      where: { id: hospitalId, organizationId: user.organizationId },
      include: {
        departments: { orderBy: { code: 'asc' } },
        paymentChannels: { where: { isActive: true }, orderBy: { code: 'asc' } },
      },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    assertHospitalAccess(user, hospital.id);
    // Neutralise spreadsheet formula injection: cells starting with = + - @ are prefixed.
    const escape = (raw: string) => {
      const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    };
    const header = [
      'Department',
      ...hospital.paymentChannels.map((channel) => channel.name),
      'Total Amount',
    ];
    const rows = hospital.departments.map((department) => [
      department.name,
      ...hospital.paymentChannels.map(() => '0.00'),
      '0.00',
    ]);
    const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
    return {
      // The hospital code is user-entered: keep only filename-safe characters (no header injection).
      fileName: `revenue-template-${hospital.code.replace(/[^A-Za-z0-9_-]/g, '_')}.csv`,
      content: `${csv}\r\n`,
    };
  }

  /** Turns the database's duplicate-report unique violation into a clear conflict. */
  private mapDuplicate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException({
        code: 'DUPLICATE_REPORT',
        message: 'A report with identical figures for this hospital and period already exists',
      });
    }
    return error;
  }

  private status(value: string): ImportStatus {
    if (!(Object.values(ImportStatus) as string[]).includes(value)) {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: 'Unknown import status' });
    }
    return value as ImportStatus;
  }

  private affectedRows(result: ParseResult): number {
    return new Set(
      result.errors
        .map((error) => error.row)
        .filter((row): row is number => typeof row === 'number'),
    ).size;
  }
}
