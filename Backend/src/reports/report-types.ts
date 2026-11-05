import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';

export type ColumnType = 'text' | 'money' | 'date' | 'int' | 'percent';

export type ReportColumn = { key: string; label: string; type: ColumnType };

/** Money is carried as 2 dp strings, dates as YYYY-MM-DD, counts as numbers. */
export type ReportRow = Record<string, string | number | null>;

export type FilterKey = 'hospitalId' | 'from' | 'to' | 'status';

export type ReportFilters = {
  hospitalId?: string;
  from?: string;
  to?: string;
  status?: string;
};

export type ReportContext = {
  prisma: PrismaService;
  /** Already narrowed to the hospitals the caller may see for every permission the report needs. */
  user: AuthUser;
  filters: ReportFilters;
  /** Today in the organisation's business time zone (YYYY-MM-DD). */
  today: string;
};

export type ReportResult = {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Plain-language caveats shown with the report and kept in exports. */
  notes?: string[];
};

export type ReportCategory =
  | 'Receivables'
  | 'Payments'
  | 'Revenue'
  | 'Service charges'
  | 'Performance';

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  category: ReportCategory;
  /** The date the from/to filters apply to, stated so figures are never read on the wrong basis. */
  dateBasis?: string;
  filters: FilterKey[];
  /** Allowed values of the status filter, when the report has one. */
  statuses?: string[];
  /** The report is only meaningful for one hospital, so a hospital must be chosen. */
  requiresHospital?: boolean;
  /** Permissions needed in addition to reports.read; scope is narrowed to their intersection. */
  requires: string[];
  /** Columns whose values are summed in the totals row. */
  totals?: string[];
  run: (context: ReportContext) => Promise<ReportResult>;
};

/** Most rows a single report may return; larger requests must be narrowed with filters. */
export const MAX_REPORT_ROWS = 20_000;
