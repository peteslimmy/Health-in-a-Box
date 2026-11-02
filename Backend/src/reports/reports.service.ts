import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { dateInTimeZone, parseDate } from '../common/utils/dates';
import { moneyString } from '../common/utils/money';
import { paged } from '../common/utils/pagination';
import { narrowUserScope } from '../common/utils/scope';
import { PrismaService } from '../prisma/prisma.service';
import { REPORT_DEFINITIONS } from './report-registry';
import { toCsv, toXlsx } from './report-export';
import {
  FilterKey,
  ReportColumn,
  ReportDefinition,
  ReportFilters,
  ReportResult,
  ReportRow,
} from './report-types';

const BUSINESS_TIME_ZONE = 'Africa/Lagos';
const FILTER_KEYS: FilterKey[] = ['centreId', 'from', 'to', 'status'];

export type ReportQuery = ReportFilters & { page?: number; pageSize?: number };
export type ExportFormat = 'csv' | 'xlsx';

/** Adds the money and count columns the report asked to total. Never uses floating point for money. */
export function totalsRow(
  definition: Pick<ReportDefinition, 'totals'>,
  columns: ReportColumn[],
  rows: ReportRow[],
): ReportRow | null {
  if (!definition.totals || rows.length === 0) return null;
  const wanted = definition.totals.includes('*')
    ? columns.filter((column) => column.type === 'money').map((column) => column.key)
    : definition.totals;
  const result: ReportRow = {};
  const first = columns.find((column) => column.type === 'text');
  if (first) result[first.key] = 'Total';
  for (const key of wanted) {
    const column = columns.find((c) => c.key === key);
    if (!column) continue;
    let sum = new Decimal(0);
    for (const row of rows) {
      const value = row[key];
      if (value !== null && value !== undefined && value !== '') sum = sum.plus(String(value));
    }
    result[key] = column.type === 'money' ? moneyString(sum) : sum.toNumber();
  }
  return result;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private find(id: string): ReportDefinition {
    const definition = REPORT_DEFINITIONS.find((report) => report.id === id);
    if (!definition)
      throw new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Unknown report' });
    return definition;
  }

  /** The caller, limited to the centres where they hold every permission the report relies on. */
  private scoped(user: AuthUser, definition: ReportDefinition, base: string[]): AuthUser {
    const narrowed = narrowUserScope(user, [...base, ...definition.requires]);
    if (!narrowed) {
      throw new ForbiddenException({
        code: 'REPORT_NOT_PERMITTED',
        message: 'You do not have access to the data this report uses',
      });
    }
    return narrowed;
  }

  /** Keeps only the filters the report declares, and checks them. */
  private cleanFilters(definition: ReportDefinition, query: ReportFilters): ReportFilters {
    const filters: ReportFilters = {};
    for (const key of FILTER_KEYS) {
      if (definition.filters.includes(key) && query[key]) filters[key] = query[key];
    }
    if (definition.requiresCentre && !filters.centreId) {
      throw new BadRequestException({
        code: 'CENTRE_REQUIRED',
        message: 'Choose a centre for this report',
      });
    }
    if (filters.from) parseDate(filters.from, 'from');
    if (filters.to) parseDate(filters.to, 'to');
    if (filters.from && filters.to && filters.to < filters.from) {
      throw new BadRequestException({
        code: 'INVALID_PERIOD',
        message: 'The end date cannot be before the start date',
      });
    }
    if (filters.status && !definition.statuses?.includes(filters.status)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: `Status must be one of ${definition.statuses?.join(', ')}`,
      });
    }
    return filters;
  }

  list(user: AuthUser) {
    return REPORT_DEFINITIONS.filter(
      (definition) => narrowUserScope(user, ['reports.read', ...definition.requires]) !== null,
    ).map((definition) => ({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      dateBasis: definition.dateBasis ?? null,
      filters: definition.filters,
      requiresCentre: definition.requiresCentre ?? false,
      statuses: definition.statuses ?? null,
      canExport:
        narrowUserScope(user, ['reports.export', 'reports.read', ...definition.requires]) !== null,
    }));
  }

  private async execute(
    user: AuthUser,
    definition: ReportDefinition,
    filters: ReportFilters,
  ): Promise<ReportResult> {
    return definition.run({
      prisma: this.prisma,
      user,
      filters,
      today: dateInTimeZone(new Date(), BUSINESS_TIME_ZONE),
    });
  }

  async run(user: AuthUser, id: string, query: ReportQuery) {
    const definition = this.find(id);
    const scoped = this.scoped(user, definition, ['reports.read']);
    const filters = this.cleanFilters(definition, query);
    const result = await this.execute(scoped, definition, filters);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 50) || 50));
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const slice = result.rows.slice((page - 1) * pageSize, page * pageSize);
    return {
      report: {
        id: definition.id,
        title: definition.title,
        dateBasis: definition.dateBasis ?? null,
      },
      filters,
      columns: result.columns,
      notes: result.notes ?? [],
      totals: totalsRow(definition, result.columns, result.rows),
      generatedAt: new Date().toISOString(),
      ...paged(slice, result.rows.length, page, pageSize),
    };
  }

  /** Builds the file and records the export before any data leaves the server. */
  async export(user: AuthUser, id: string, query: ReportFilters, format: ExportFormat) {
    const definition = this.find(id);
    const scoped = this.scoped(user, definition, ['reports.export', 'reports.read']);
    const filters = this.cleanFilters(definition, query);
    const result = await this.execute(scoped, definition, filters);
    const generatedAt = new Date().toISOString();
    const description = Object.entries(filters)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    const meta = {
      title: definition.title,
      generatedAt,
      generatedBy: user.email,
      filters: description,
      notes: result.notes ?? [],
    };
    const totals = totalsRow(definition, result.columns, result.rows);
    const content =
      format === 'xlsx'
        ? toXlsx(result.columns, result.rows, totals, meta)
        : toCsv(result.columns, result.rows, totals, meta);

    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      centreId: filters.centreId ?? null,
      action: 'REPORT_EXPORTED',
      targetType: 'Report',
      summary: `Exported "${definition.title}" as ${format.toUpperCase()} (${result.rows.length} rows)`,
      after: { report: definition.id, format, rows: result.rows.length, filters: { ...filters } },
    });

    return {
      content,
      fileName: `${definition.id}-${generatedAt.slice(0, 10)}.${format}`,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
    };
  }
}
