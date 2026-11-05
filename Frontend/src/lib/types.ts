export type Page<T> = {
  items: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};

export type HospitalRef = { id: string; code: string; name: string };
export type UserRef = { id: string; fullName: string; email?: string };

export type Hospital = HospitalRef & {
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
  address?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  timezone: string;
  currency: string;
  paymentTermsDays: number;
  gracePeriodDays: number;
  notes?: string | null;
  _count?: { departments: number; paymentChannels: number; receivables: number };
};

export type Department = { id: string; code: string; name: string; aliases: Array<{ id: string; alias: string }> };
export type Channel = Department;

export type Agreement = {
  id: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  notes?: string | null;
  _count?: { chargeRules: number };
};

export type ChargeRule = {
  id: string;
  name: string;
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  isActive: boolean;
  isExempt?: boolean;
  department: { id: string; code: string; name: string } | null;
  paymentChannel: { id: string; code: string; name: string } | null;
};

export type HospitalDetail = Hospital & {
  departments: Department[];
  paymentChannels: Channel[];
  agreements: Agreement[];
};

export type ImportIssue = {
  row?: number;
  field?: string;
  code: string;
  message: string;
  missingFrom?: string;
  missingTo?: string;
  days?: number;
  requiresAcknowledgement?: boolean;
};

export type ImportBatch = {
  id: string;
  status: string;
  fileName: string | null;
  periodStart: string;
  periodEnd: string;
  rowCount: number;
  validRowCount: number;
  totalAmount: string | null;
  createdAt: string;
  createdById?: string;
  committedReportId: string | null;
  hospital: HospitalRef;
  createdBy: UserRef;
};

export type VarianceSummary = {
  printedGrandTotal: string;
  evidencedTotal: string;
  difference: string;
  linesWithDifference: Array<{ rowNumber: number | null; department: string; printed: string; channels: string; difference: string }>;
  findings: number;
  findingsByCode: Record<string, number>;
  accepted: string[];
};

export type ImportDetail = ImportBatch & {
  committedReport?: {
    id: string;
    varianceApprovedAt: string | null;
    varianceReason: string | null;
    varianceJson: VarianceSummary | null;
    varianceApprovedBy: { id: string; fullName: string } | null;
  } | null;
  errorCount: number;
  validationJson: {
    errors: ImportIssue[];
    warnings: ImportIssue[];
    flags?: ImportIssue[];
    grandTotal: string;
    channelTotal: string;
    source?: { kind: string; title: string | null; printDate: string | null; pages: number; ignoredLines: string[] } | null;
    setupAdded?: { departments: string[]; channels: string[] };
    trim?: {
      fileStart: string;
      fileEnd: string;
      takenStart: string;
      takenEnd: string;
      alreadyRecorded: Array<{ start: string; end: string; label: string }>;
      recordedTotal: string;
    } | null;
  } | null;
  normalizedJson: {
    lines: Array<{
      rowNumber: number;
      rawDepartment: string;
      departmentCode: string;
      reportedTotal: string;
      channelTotal: string;
      variance: string;
      amounts: Record<string, string>;
    }>;
  } | null;
};

export type ChargeLine = {
  id?: string | null;
  baseAmount: string;
  rate: string;
  chargeAmount: string;
  ruleName?: string | null;
  rule?: { id: string | null; name: string | null };
  department: { id: string; code: string; name: string };
  paymentChannel: { id: string; code: string; name: string } | null;
  rounding?: string;
};

export type ChargeRun = {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'CANCELLED';
  periodStart: string;
  periodEnd: string;
  baseTotal: string;
  chargeTotal: string;
  createdAt: string;
  createdById: string;
  approvedById: string | null;
  postedAt: string | null;
  hospital: HospitalRef & { currency?: string };
  createdBy?: UserRef;
  approvedBy?: UserRef | null;
  lines: Array<ChargeLine & { receivable?: { id: string; reference: string; status: string } | null }>;
  _count?: { lines: number };
};

export type ChargePreview = {
  hospital: HospitalRef;
  periodStart: string;
  periodEnd: string;
  baseTotal: string;
  chargeTotal: string;
  warnings: string[];
  lines: ChargeLine[];
};

export type Receivable = {
  id: string;
  reference: string;
  description: string;
  originalAmount: string;
  adjustmentTotal?: string;
  amountPaid: string;
  balance: string;
  dueDate: string;
  status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'DISPUTED';
  ageingBucket: string;
  daysOverdue: number;
  asAt: string;
  hospital: HospitalRef;
};

export type LedgerEntry = {
  id: string;
  type: string;
  debit: string;
  credit: string;
  description: string;
  occurredAt: string;
};

export type ReceivableDetail = Receivable & {
  ledgerEntries: LedgerEntry[];
  allocations: Array<{
    id: string;
    amount: string;
    allocatedAt: string;
    reversedAt: string | null;
    payment: { id: string; reference: string | null; receiptDate: string };
  }>;
  chargeRun: { id: string; periodStart: string; periodEnd: string; status: string } | null;
  ledger: { debit: string; credit: string; derivedBalance: string; storedBalance: string; consistent: boolean };
};

export type AgeingSummary = {
  asAt: string;
  total: Record<string, string>;
  hospitals: Array<Record<string, string> & { hospitalId: string; code: string; name: string }>;
};

export type PaymentStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'REJECTED' | 'REVERSED';

export type Payment = {
  id: string;
  status: PaymentStatus;
  receiptDate: string;
  amount: string;
  unallocatedAmount: string;
  method: string;
  reference: string | null;
  payerName: string | null;
  notes: string | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  createdById: string;
  hospital: HospitalRef & { status?: string };
  createdBy?: UserRef;
};

export type PaymentAllocation = {
  id: string;
  amount: string;
  allocatedAt: string;
  allocatedById: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  receivable: { id: string; reference: string; dueDate: string; balance: string };
};

export type PaymentDetail = Payment & { allocations: PaymentAllocation[] };

export type AllocationPreview = {
  payment: { id: string; amount: string; unallocatedAmount: string };
  receivables: Array<{ id: string; reference: string; description: string; dueDate: string; balance: string; status: string }>;
  suggestion: Array<{ receivableId: string; amount: string }>;
};

export type DashboardMeasure = { label: string; basis: string; amount: string; count?: number; percentPaid?: string | null; varianceReports?: number };

export type DashboardSummary = {
  currency: string;
  period: { from: string; to: string };
  asAt: string;
  measures: Record<
    | 'reportedRevenue'
    | 'expectedServiceCharge'
    | 'owedForPeriod'
    | 'chargesPosted'
    | 'paymentsReceived'
    | 'paymentsAllocated'
    | 'outstandingReceivables'
    | 'overdueReceivables'
    | 'unallocatedReceipts',
    DashboardMeasure
  >;
  awaitingAction: Record<string, number>;
};

export type AuditEvent = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  correlationId: string | null;
  createdAt: string;
  actor: UserRef | null;
  hospital: HospitalRef | null;
};

export type Role = {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
  permissions: Array<{ permission: { code: string; name: string; group: string } }>;
  _count?: { assignments: number };
};

export type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mfaEnabled?: boolean;
  lastLoginAt: string | null;
  roleAssignments: Array<{
    id: string;
    role: { id: string; code: string; name: string };
    hospital: HospitalRef | null;
  }>;
};

export type Permission = { id: string; code: string; name: string; group: string; description: string | null };

export type TrendPoint = {
  month: string;
  reportedRevenue: string;
  chargesPosted: string;
  paymentsReceived: string;
  outstanding: string;
  collectionRate: string | null;
};

export type DashboardTrends = { currency: string; asAt: string; currentMonth: string; series: TrendPoint[] };

export type ReportColumn = { key: string; label: string; type: 'text' | 'money' | 'date' | 'int' | 'percent' };
export type ReportRow = Record<string, string | number | null>;

export type ReportSummary = {
  id: string;
  title: string;
  description: string;
  category: string;
  dateBasis: string | null;
  filters: Array<'hospitalId' | 'from' | 'to' | 'status'>;
  requiresHospital?: boolean;
  statuses: string[] | null;
  canExport: boolean;
};

export type ReportResult = Page<ReportRow> & {
  report: { id: string; title: string; dateBasis: string | null };
  columns: ReportColumn[];
  notes: string[];
  totals: ReportRow | null;
  generatedAt: string;
};

export type CollectionPoint = {
  month: string;
  due: string;
  settledWithinWindow: string;
  settledToDate: string;
  mature: boolean;
  rateWithinWindow: string | null;
  rateToDate: string | null;
};
export type DashboardCollection = { windowDays: number; asAt: string; series: CollectionPoint[] };

export type ReportingStatusEntry = {
  hospitalId: string;
  code: string;
  name: string;
  lastReportEnd: string | null;
  daysSince: number | null;
  late: boolean;
};
export type ReportingStatusResponse = { asAt: string; lateAfterDays: number; lateCount: number; hospitals: ReportingStatusEntry[] };

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AdjustmentItem = {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: string;
  reasonCode: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  hospital: HospitalRef;
  receivable: { id: string; reference: string; balance: string };
  createdBy: UserRef;
  decidedBy: UserRef | null;
};

export type DisputeItem = {
  id: string;
  amount: string;
  reason: string;
  status: 'OPEN' | 'UPHELD' | 'REJECTED' | 'WITHDRAWN';
  raisedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  adjustmentId: string | null;
  hospital: HospitalRef;
  receivable: { id: string; reference: string; balance: string };
  raisedBy: UserRef;
  resolvedBy: UserRef | null;
};

export type OpeningBalanceItem = {
  id: string;
  asAt: string;
  amount: string;
  dueDate: string;
  sourceNote: string;
  status: ApprovalStatus;
  createdAt: string;
  decisionNote: string | null;
  hospital: HospitalRef;
  receivable: { id: string; reference: string } | null;
  createdBy: UserRef;
  decidedBy: UserRef | null;
};

export type WorkItem = {
  key: string;
  kind: string;
  action: string;
  title: string;
  hospital: string | null;
  ageDays: number;
  severity: 'info' | 'attention' | 'urgent';
  link: string;
};
export type WorkQueue = { asAt: string; total: number; urgent: number; counts: Record<string, number>; items: WorkItem[] };

export type InsightItem = {
  id: string;
  area: string;
  severity: 'info' | 'attention' | 'urgent';
  title: string;
  detail: string;
  evidence: Array<{ label: string; value: string }>;
  hospitalId: string | null;
  link: string;
};
export type InsightsResponse = { asAt: string; comparedMonths: { previous: string; latest: string }; count: number; items: InsightItem[] };
