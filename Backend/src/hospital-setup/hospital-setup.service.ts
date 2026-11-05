import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuthUser } from '../common/types/auth-user';
import { AuditService } from '../common/services/audit.service';
import { StorageService } from '../common/services/storage.service';
import { parseDate } from '../common/utils/dates';
import { assertSuperAdmin } from '../common/utils/super-admin';
import { extractFile } from '../imports/file-extractor';
import { ImportsService, MAX_UPLOAD_BYTES, UNSAFE_XLSX_MARKERS } from '../imports/imports.service';
import { normalize } from '../imports/revenue-parser.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommitSetupDto, SetupItemDto } from './dto/hospital-setup.dto';
import { ReportProfile, profileReport } from './report-profile';

export type ExistingMatch = { id: string; code: string; name: string; reason: string };
type StoredAnalysis = { profile: ReportProfile; existingMatches: ExistingMatch[] };

const CONTENT_TYPES = {
  PDF: 'application/pdf',
  CSV: 'text/csv',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class HospitalSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly imports: ImportsService,
  ) {}

  /** The wizard creates whole hospitals, so beyond the permission it needs organisation-wide access. */
  private assertOwner(user: AuthUser) {
    assertSuperAdmin(user);
    if (!user.allHospitals) {
      throw new ForbiddenException({
        code: 'ALL_HOSPITALS_REQUIRED',
        message: 'Only a super admin with access to all hospitals can set up hospitals',
      });
    }
  }

  /** Reads the report and keeps the file and the findings as an open draft. Creates no hospital. */
  async analyse(user: AuthUser, file: Express.Multer.File | undefined) {
    this.assertOwner(user);
    if (!file?.buffer?.length) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'A file is required' });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'The file exceeds the 15 MB upload limit',
      });
    }
    const name = file.originalname || 'report';
    const lower = name.toLowerCase();
    const kind = lower.endsWith('.pdf')
      ? 'PDF'
      : lower.endsWith('.csv')
        ? 'CSV'
        : lower.endsWith('.xlsx')
          ? 'XLSX'
          : null;
    if (!kind) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: 'Only PDF, CSV and XLSX files are supported',
      });
    }
    const head = file.buffer.subarray(0, 5);
    if (
      (kind === 'PDF' && head.toString('latin1') !== '%PDF-') ||
      (kind === 'XLSX' &&
        !file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) ||
      (kind === 'CSV' && file.buffer.includes(0))
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_FILE_CONTENT',
        message: `The file is not a valid ${kind} document`,
      });
    }
    if (kind === 'XLSX' && UNSAFE_XLSX_MARKERS.some((marker) => file.buffer.includes(marker))) {
      throw new UnprocessableEntityException({
        code: 'UNSAFE_FILE_CONTENT',
        message: 'Workbooks containing macros, embedded objects or external links are not accepted',
      });
    }

    let extracted;
    try {
      extracted = await extractFile(kind === 'PDF' ? 'pdf' : 'table', file.buffer, name);
    } catch (error) {
      throw new UnprocessableEntityException({
        code: 'IMPORT_PARSE_FAILED',
        message: (error as Error).message,
      });
    }
    const profile = profileReport({
      fileName: name,
      kind,
      rows: extracted.rows,
      pdf: extracted.pdf,
    });
    if (profile.departments.length === 0 || profile.channels.length === 0) {
      throw new UnprocessableEntityException({
        code: 'NOTHING_TO_SET_UP',
        message:
          'No departments and payment channels could be read from this file. A report needs a "Revenue Department" column and one column per payment channel',
        details: profile.tally.problems.map((p) => ({ message: p.message })),
      });
    }

    const existingMatches = await this.findExisting(
      user.organizationId,
      profile.hospital.suggestedName,
      profile.hospital.suggestedCode,
    );
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const fileKey = await this.storage.put(file.buffer, name, CONTENT_TYPES[kind]);
    const draft = await this.prisma.hospitalSetupDraft.create({
      data: {
        organizationId: user.organizationId,
        createdById: user.id,
        fileName: name,
        fileHash,
        fileKey,
        contentType: CONTENT_TYPES[kind],
        analysisJson: asJson({ profile, existingMatches } satisfies StoredAnalysis),
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'HOSPITAL_SETUP_STARTED',
      targetType: 'HospitalSetupDraft',
      targetId: draft.id,
      summary: `Read ${name} for hospital set-up: ${profile.departments.length} departments, ${profile.channels.length} payment channels`,
    });
    return { draftId: draft.id, profile, existingMatches, createdAt: draft.createdAt };
  }

  private async findExisting(organizationId: string, name: string, code: string) {
    const hospitals = await this.prisma.hospital.findMany({
      where: { organizationId },
      select: { id: true, code: true, name: true },
      take: 1000,
    });
    const wanted = normalize(name);
    const matches: ExistingMatch[] = [];
    for (const hospital of hospitals) {
      if (hospital.code.toUpperCase() === code.toUpperCase()) {
        matches.push({ ...hospital, reason: 'Same hospital code' });
      } else if (normalize(hospital.name) === wanted) {
        matches.push({ ...hospital, reason: 'Same hospital name' });
      }
    }
    return matches;
  }

  async listOpen(user: AuthUser) {
    this.assertOwner(user);
    const drafts = await this.prisma.hospitalSetupDraft.findMany({
      where: { organizationId: user.organizationId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return drafts.map((draft) => {
      const analysis = draft.analysisJson as unknown as StoredAnalysis;
      return {
        id: draft.id,
        fileName: draft.fileName,
        createdAt: draft.createdAt,
        suggestedName: analysis.profile.hospital.suggestedName,
        departments: analysis.profile.departments.length,
        channels: analysis.profile.channels.length,
      };
    });
  }

  async get(user: AuthUser, id: string) {
    this.assertOwner(user);
    const draft = await this.loadDraft(user, id);
    const analysis = draft.analysisJson as unknown as StoredAnalysis;
    // The codes already taken may have changed since the file was read.
    const existingMatches = await this.findExisting(
      user.organizationId,
      analysis.profile.hospital.suggestedName,
      analysis.profile.hospital.suggestedCode,
    );
    return {
      draftId: draft.id,
      status: draft.status,
      profile: analysis.profile,
      existingMatches,
      createdAt: draft.createdAt,
    };
  }

  async cancel(user: AuthUser, id: string) {
    this.assertOwner(user);
    const draft = await this.loadDraft(user, id);
    await this.prisma.hospitalSetupDraft.update({
      where: { id: draft.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'HOSPITAL_SETUP_CANCELLED',
      targetType: 'HospitalSetupDraft',
      targetId: draft.id,
      summary: `Cancelled hospital set-up from ${draft.fileName}`,
    });
    return { success: true };
  }

  private async loadDraft(user: AuthUser, id: string) {
    const draft = await this.prisma.hospitalSetupDraft.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!draft) throw new NotFoundException('Set-up not found');
    if (draft.status !== 'OPEN') {
      throw new ConflictException({
        code: 'SETUP_NOT_OPEN',
        message: `This set-up is already ${draft.status.toLowerCase()}`,
      });
    }
    return draft;
  }

  private assertItems(kind: 'department' | 'channel', items: SetupItemDto[]) {
    const codes = new Set<string>();
    const names = new Set<string>();
    for (const item of items) {
      const code = item.code.toUpperCase();
      const name = normalize(item.name);
      if (!name) {
        throw new BadRequestException({
          code: 'SETUP_INVALID',
          message: `A ${kind} has a name with no letters or digits`,
        });
      }
      if (codes.has(code)) {
        throw new BadRequestException({
          code: 'SETUP_DUPLICATE_CODE',
          message: `The ${kind} code ${code} is used more than once`,
        });
      }
      if (names.has(name)) {
        throw new BadRequestException({
          code: 'SETUP_DUPLICATE_NAME',
          message: `The ${kind} "${item.name.trim()}" is listed more than once`,
        });
      }
      codes.add(code);
      names.add(name);
    }
  }

  /**
   * Creates the hospital, its departments and payment channels (each remembering the name printed in
   * the report, so the next report matches), and optionally the service-charge terms. All or nothing.
   */
  async commit(user: AuthUser, draftId: string, dto: CommitSetupDto) {
    this.assertOwner(user);
    const draft = await this.loadDraft(user, draftId);
    this.assertItems('department', dto.departments);
    this.assertItems('channel', dto.channels);
    if (dto.activate && !dto.terms) {
      throw new BadRequestException({
        code: 'TERMS_REQUIRED',
        message: 'A hospital can only be activated once its service-charge terms are set',
      });
    }
    if (dto.importNow && !dto.activate) {
      throw new BadRequestException({
        code: 'ACTIVATION_REQUIRED',
        message: 'The report can only be imported once the hospital is active',
      });
    }

    const code = dto.hospital.code.trim().toUpperCase();
    const name = dto.hospital.name.trim();
    const clash = await this.prisma.hospital.findFirst({
      where: {
        organizationId: user.organizationId,
        OR: [{ code }, { name: { equals: name, mode: 'insensitive' } }],
      },
      select: { code: true, name: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'HOSPITAL_EXISTS',
        message: `A hospital with this ${clash.code === code ? 'code' : 'name'} already exists (${clash.code}, ${clash.name})`,
      });
    }
    const effectiveFrom = dto.terms ? parseDate(dto.terms.effectiveFrom, 'effectiveFrom') : null;

    const hospital = await this.prisma.$transaction(async (tx) => {
      const created = await tx.hospital.create({
        data: {
          organizationId: user.organizationId,
          code,
          name,
          address: dto.hospital.address,
          contactName: dto.hospital.contactName,
          contactEmail: dto.hospital.contactEmail,
          timezone: dto.hospital.timezone,
          paymentTermsDays: dto.hospital.paymentTermsDays,
          gracePeriodDays: dto.hospital.gracePeriodDays,
          status: dto.activate ? 'ACTIVE' : 'DRAFT',
        },
      });
      const aliasFor = (item: SetupItemDto) =>
        normalize(item.printedName) !== normalize(item.name) ? [item.printedName.trim()] : [];
      for (const item of dto.departments) {
        await tx.department.create({
          data: {
            hospitalId: created.id,
            code: item.code.toUpperCase(),
            name: item.name.trim(),
            aliases: { create: aliasFor(item).map((alias) => ({ alias })) },
          },
        });
      }
      for (const item of dto.channels) {
        await tx.paymentChannel.create({
          data: {
            hospitalId: created.id,
            code: item.code.toUpperCase(),
            name: item.name.trim(),
            aliases: { create: aliasFor(item).map((alias) => ({ alias })) },
          },
        });
      }
      let agreementId: string | null = null;
      if (dto.terms && effectiveFrom) {
        const agreement = await tx.commercialAgreement.create({
          data: {
            hospitalId: created.id,
            name: dto.terms.agreementName.trim(),
            effectiveFrom,
            status: 'ACTIVE',
          },
        });
        agreementId = agreement.id;
        await tx.chargeRule.create({
          data: {
            hospitalId: created.id,
            agreementId,
            name: 'Service charge (hospital default)',
            basis: 'PERCENTAGE',
            rate: new Prisma.Decimal(dto.terms.ratePercent),
            effectiveFrom,
            priority: 0,
            rounding: 'HALF_UP',
            isActive: true,
          },
        });
      }
      await this.audit.record(
        {
          organizationId: user.organizationId,
          actorId: user.id,
          hospitalId: created.id,
          action: 'HOSPITAL_CREATED',
          targetType: 'Hospital',
          targetId: created.id,
          summary: `Created hospital ${created.code} with the set-up wizard from ${draft.fileName}`,
          after: {
            code: created.code,
            name: created.name,
            status: created.status,
            departments: dto.departments.map((d) => d.code.toUpperCase()),
            channels: dto.channels.map((c) => c.code.toUpperCase()),
            serviceChargePercent: dto.terms?.ratePercent ?? null,
          },
        },
        tx,
      );
      await tx.hospitalSetupDraft.update({
        where: { id: draft.id },
        data: { status: 'COMPLETED', hospitalId: created.id, completedAt: new Date() },
      });
      return created;
    });

    let importResult: { id: string; status: string } | null = null;
    let importError: string | null = null;
    if (dto.importNow) {
      try {
        const buffer = await this.storage.get(draft.fileKey);
        const result = await this.imports.upload(
          user,
          { buffer, size: buffer.length, originalname: draft.fileName } as Express.Multer.File,
          { hospitalId: hospital.id } as never,
        );
        importResult = { id: result.id, status: String(result.status) };
      } catch (error) {
        const body = (error as { response?: { message?: string } }).response;
        importError = body?.message ?? (error as Error).message;
      }
    }

    return {
      hospital: {
        id: hospital.id,
        code: hospital.code,
        name: hospital.name,
        status: hospital.status,
      },
      counts: { departments: dto.departments.length, channels: dto.channels.length },
      termsCreated: !!dto.terms,
      import: importResult,
      importError,
    };
  }
}
