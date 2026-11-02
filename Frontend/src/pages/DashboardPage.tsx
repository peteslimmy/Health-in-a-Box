import { useQuery } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { CentreSelect } from '../components/CentreSelect';
import { AGEING_RAMP, RankedBars, SegmentedBar, Sparkline, TimeChart, VIZ } from '../components/charts';
import { Card, ErrorNotice, Field, Input, Loading, Select } from '../components/ui';
import { api } from '../lib/api';
import { centreLabel, addMoney, compareMoney, firstOfMonthIso, formatDate, formatMoney, todayIso } from '../lib/format';
import { can } from '../lib/permissions';
import type {
  AgeingSummary,
  DashboardCollection,
  DashboardMeasure,
  DashboardSummary,
  DashboardTrends,
  InsightsResponse,
  ReportingStatusResponse,
  ReportSummary,
} from '../lib/types';

const BUCKETS = ['NOT_YET_DUE', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_91_120', 'OVER_120'] as const;
const BUCKET_LABEL: Record<(typeof BUCKETS)[number], string> = {
  NOT_YET_DUE: 'Not yet due',
  DAYS_1_30: '1–30 days',
  DAYS_31_60: '31–60 days',
  DAYS_61_90: '61–90 days',
  DAYS_91_120: '91–120 days',
  OVER_120: 'Over 120 days',
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(month: string, withYear: boolean) {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1].slice(0, 3);
  return withYear ? `${name} ’${month.slice(2, 4)}` : name;
}

function detailLabel(month: string, currentMonth?: string) {
  const full = `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  return month === currentMonth ? `${full} (to date)` : full;
}

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Percentage change between two money strings, for display only; null when the base is zero. */
function percentChange(now: string | undefined, before: string | undefined): number | null {
  if (now === undefined || before === undefined) return null;
  const base = Number(before);
  return base > 0 ? ((Number(now) - base) / base) * 100 : null;
}

/** First and last day of a YYYY-MM month; the last day never goes past today. */
function monthRange(month: string): { from: string; to: string } {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const today = todayIso();
  return { from: `${month}-01`, to: last > today ? today : last };
}

function dayBefore(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

const FIRST_DATE = '2020-01-01';

function addMonthsIso(iso: string, months: number): string {
  const date = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

/** Quick date ranges for the filters; "All time" is every report and receipt on record. */
function periodPresets(): Array<{ label: string; from: string; to: string }> {
  const today = todayIso();
  const thisMonth = firstOfMonthIso();
  const lastMonthStart = addMonthsIso(thisMonth, -1);
  return [
    { label: 'This month', from: thisMonth, to: today },
    { label: 'Last month', from: lastMonthStart, to: dayBefore(thisMonth) },
    { label: 'Last 3 months', from: addMonthsIso(thisMonth, -2), to: today },
    { label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
    { label: 'All time', from: FIRST_DATE, to: today },
  ];
}

type KpiProps = {
  measure: DashboardMeasure;
  trend?: string[];
  tone?: 'default' | 'bad' | 'good';
  accent: string;
  footnote?: ReactNode;
  size?: 'large' | 'small';
  /** Where the figure's records are; the whole card becomes a link when the user may open them. */
  to?: string;
};

function Kpi({ measure, trend, tone = 'default', accent, footnote, size = 'large', to }: KpiProps) {
  const figure = tone === 'bad' ? 'text-red-700' : 'text-slate-900';
  const card = (
    <div className="group relative h-full overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{measure.label}</p>
          <p className={`mt-2 font-semibold tabular-nums tracking-tight ${figure} ${size === 'large' ? 'text-3xl' : 'text-xl'}`}>
            {formatMoney(measure.amount)}
          </p>
        </div>
        {trend && trend.length > 1 && <Sparkline values={trend} color={accent} height={size === 'large' ? 40 : 32} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {footnote}
        <span>
          {measure.basis}
          {measure.count !== undefined ? ` · ${measure.count} item${measure.count === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      {to && (
        <p className="mt-2 text-xs font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Open the records →
        </p>
      )}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-xl" aria-label={`${measure.label}: open the records`}>
      {card}
    </Link>
  ) : (
    card
  );
}

type FlowTileProps = {
  step: number;
  caption: string;
  measure: DashboardMeasure;
  accent: string;
  trend?: string[];
  to?: string;
  /** The sign shown in the gap to the next tile ("→", "−" or "="). */
  operator?: string;
  footnote?: ReactNode;
  emphasis?: boolean;
  tone?: 'default' | 'good' | 'bad';
  children?: ReactNode;
};

/** One step of the money flow: what centres made, what is due, what was paid, what is still owing. */
function FlowTile({ step, caption, measure, accent, trend, to, operator, footnote, emphasis = false, tone = 'default', children }: FlowTileProps) {
  const figure = tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-emerald-700' : 'text-slate-900';
  const body = (
    <div
      className={`group relative h-full overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${emphasis ? 'border-slate-300 ring-1 ring-slate-900/5' : 'border-slate-200/80'}`}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: accent }}>
              {step}
            </span>
            {measure.label}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-700">{caption}</p>
        </div>
        {trend && trend.length > 1 && <Sparkline values={trend} color={accent} height={36} />}
      </div>
      <p className={`mt-3 font-semibold tabular-nums tracking-tight ${figure} ${emphasis ? 'text-4xl' : 'text-3xl'}`}>{formatMoney(measure.amount)}</p>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {footnote}
        <span>
          {measure.basis}
          {measure.count !== undefined ? ` · ${measure.count} item${measure.count === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      {to && (
        <p className="mt-2 text-xs font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Open the records →</p>
      )}
    </div>
  );
  return (
    <div className="relative">
      {to ? (
        <Link to={to} className="block h-full rounded-2xl" aria-label={`${measure.label}: open the records`}>
          {body}
        </Link>
      ) : (
        body
      )}
      {operator && (
        <span
          aria-hidden
          className="absolute -right-5 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-500 shadow-sm xl:flex"
        >
          {operator}
        </span>
      )}
    </div>
  );
}

function Chip({ tone, children }: { tone: 'good' | 'bad' | 'neutral'; children: ReactNode }) {
  const style = tone === 'good' ? 'bg-emerald-50 text-emerald-700' : tone === 'bad' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${style}`}>{children}</span>;
}

const compactNaira = (v: number) => `₦${new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}`;

export function DashboardPage() {
  const user = useUser();
  // Filters live in the address, so a view can be shared, refreshed and reached with the back button.
  const [params, setParams] = useSearchParams();
  const centreId = params.get('centreId') ?? '';
  const from = params.get('from') ?? firstOfMonthIso();
  const to = params.get('to') ?? todayIso();
  const months = params.get('months') ?? '12';
  const windowDays = params.get('windowDays') ?? '30';
  const setParam = (changes: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  const filtered = params.has('centreId') || params.has('from') || params.has('to');

  const allowed = can(user, 'dashboard.read');
  const summary = useQuery({
    queryKey: ['dashboard', centreId, from, to],
    queryFn: () => api<DashboardSummary>('/dashboard/summary', { query: { centreId, from, to } }),
    enabled: allowed,
  });
  const trends = useQuery({
    queryKey: ['dashboard-trends', centreId, months],
    queryFn: () => api<DashboardTrends>('/dashboard/trends', { query: { centreId, months } }),
    enabled: allowed,
  });
  const collection = useQuery({
    queryKey: ['dashboard-collection', centreId, months, windowDays],
    queryFn: () => api<DashboardCollection>('/dashboard/collection', { query: { centreId, months, windowDays } }),
    enabled: allowed && can(user, 'receivables.read'),
  });
  const reporting = useQuery({
    queryKey: ['dashboard-reporting', centreId],
    queryFn: () => api<ReportingStatusResponse>('/dashboard/reporting-status', { query: { centreId } }),
    enabled: allowed,
  });
  const insights = useQuery({
    queryKey: ['dashboard-insights', centreId],
    queryFn: () => api<InsightsResponse>('/dashboard/insights', { query: { centreId } }),
    enabled: allowed,
  });
  const composition = (id: string) => ({
    queryKey: ['dashboard-composition', id, centreId, from, to],
    queryFn: () => api<{ items: Array<Record<string, string>> }>(`/reports/${id}`, { query: { centreId, from, to, pageSize: 8 } }),
    enabled: allowed && can(user, 'reports.read'),
  });
  const departments = useQuery(composition('department-revenue'));
  const channelMix = useQuery(composition('channel-revenue'));
  const ageing = useQuery({
    queryKey: ['ageing', centreId],
    queryFn: () => api<AgeingSummary>('/receivables/ageing', { query: { centreId } }),
    enabled: can(user, 'receivables.read'),
  });
  const catalogue = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<ReportSummary[]>('/reports'),
    enabled: can(user, 'reports.read'),
  });

  if (!allowed) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-500 p-6 text-white shadow-sm">
        <h1 className="text-2xl font-semibold">Welcome, {user.fullName.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-white/80">Use the menu to open the areas you have access to.</p>
      </div>
    );
  }

  /** A link to a report, only when the user may run it, carrying the dashboard's own filters. */
  const available = new Set((catalogue.data ?? []).map((report) => report.id));
  const reportLink = (id: string, extra: Record<string, string | undefined> = {}) => {
    if (!available.has(id)) return undefined;
    const query = new URLSearchParams();
    const merged = { centreId, ...extra };
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
    const text = query.toString();
    return `/reports/${id}${text ? `?${text}` : ''}`;
  };
  const periodQuery = { from, to };
  const asAt = summary.data?.asAt;

  const m = summary.data?.measures;
  const awaiting = summary.data?.awaitingAction;
  const todo: Array<{ label: string; count: number; to: string }> = awaiting
    ? [
        { label: 'Imports ready to commit', count: awaiting.importsReadyToCommit, to: '/imports?status=READY_TO_COMMIT' },
        { label: 'Imports needing review', count: awaiting.importsNeedingReview, to: '/imports?status=NEEDS_REVIEW' },
        { label: 'Charge runs to approve', count: awaiting.chargeRunsToApprove, to: '/charge-runs?status=SUBMITTED' },
        { label: 'Charge runs to post', count: awaiting.chargeRunsToPost, to: '/charge-runs?status=APPROVED' },
        { label: 'Receipts to approve', count: awaiting.receiptsToApprove, to: '/payments?status=SUBMITTED' },
        { label: 'Receipts to post', count: awaiting.receiptsToPost, to: '/payments?status=APPROVED' },
        { label: 'Centres still in draft', count: awaiting.draftCentres, to: '/centres?status=DRAFT' },
      ].filter((item) => item.count > 0)
    : [];

  const series = trends.data?.series ?? [];
  const spansYears = series.length > 0 && series[0].month.slice(0, 4) !== series[series.length - 1].month.slice(0, 4);
  const labels = series.map((point) => monthLabel(point.month, spansYears));
  const detailLabels = series.map((point) => detailLabel(point.month, trends.data?.currentMonth));
  const column = (pick: (point: DashboardTrends['series'][number]) => string) => series.map(pick);
  const outstandingNow = m?.outstandingReceivables.amount;
  const lastMonthEnd = series.length >= 2 ? series[series.length - 2].outstanding : undefined;
  const balanceChange = percentChange(outstandingNow, lastMonthEnd);
  const overduePct =
    m && Number(m.outstandingReceivables.amount) > 0 ? (Number(m.overdueReceivables.amount) / Number(m.outstandingReceivables.amount)) * 100 : null;
  const monthFormat = (raw: string) => formatMoney(raw);
  const percentFormat = (raw: string) => `${raw}%`;
  const hasTrendData = series.some(
    (p) => Number(p.chargesPosted) > 0 || Number(p.paymentsReceived) > 0 || Number(p.reportedRevenue) > 0 || Number(p.outstanding) > 0,
  );

  const collectionSeries = collection.data?.series ?? [];
  const collectionLabels = collectionSeries.map((point) => monthLabel(point.month, spansYears));
  const collectionDetails = collectionSeries.map((point) => detailLabel(point.month, trends.data?.currentMonth));
  const hasCollection = collectionSeries.some((point) => Number(point.due) > 0);

  const ageingRows = ageing.data?.centres ?? [];
  const byCentre = [...ageingRows].sort((a, b) => Number(b.outstanding) - Number(a.outstanding)).slice(0, 8);
  const centreName = (id: string) => {
    const found = user.centres?.find((centre) => centre.id === id);
    return found ? centreLabel(found) : 'selected centre';
  };

  /** What a click on a month offers: focus every figure on that month, and open its records. */
  const monthActions = (index: number, report?: { id: string; label: string }) => {
    const month = series[index]?.month;
    if (!month) return null;
    const range = monthRange(month);
    const link = report ? reportLink(report.id, range) : undefined;
    return (
      <>
        <button type="button" className="text-brand-700 underline" onClick={() => setParam({ from: range.from, to: range.to })}>
          Focus the dashboard on this month
        </button>
        {link && (
          <Link className="text-brand-700 underline" to={link}>
            {report?.label}
          </Link>
        )}
      </>
    );
  };

  const late = reporting.data?.centres.filter((centre) => centre.late) ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-5 text-white shadow-sm sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-white/75">
              {greeting()}, {user.fullName.split(' ')[0]}
            </p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Receivables overview</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/80">
              Read left to right: what the centres made, what is due to you as service charge, what they have paid, and what they still owe (due less paid), for the period you choose.
            </p>
          </div>
          {summary.data && (
            <p className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">Balances as at {formatDate(summary.data.asAt)}</p>
          )}
        </div>
        <div className="mt-5 grid gap-3 rounded-xl bg-white p-3 text-slate-900 shadow-sm sm:grid-cols-4">
          <Field label="Centre">{(id) => <CentreSelect id={id} allowAll value={centreId} onChange={(value) => setParam({ centreId: value || null })} />}</Field>
          <Field label="Period from">
            {(id) => <Input id={id} type="date" value={from} max={to} onChange={(event) => setParam({ from: event.target.value || null })} />}
          </Field>
          <Field label="Period to">
            {(id) => <Input id={id} type="date" value={to} min={from} onChange={(event) => setParam({ to: event.target.value || null })} />}
          </Field>
          <Field label="Trend window">
            {(id) => (
              <Select id={id} value={months} onChange={(event) => setParam({ months: event.target.value === '12' ? null : event.target.value })}>
                <option value="6">Last 6 months</option>
                <option value="12">Last 12 months</option>
                <option value="24">Last 24 months</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Quick periods">
          <span className="text-white/75">Period:</span>
          {periodPresets().map((preset) => {
            const active = preset.from === from && preset.to === to;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                onClick={() => setParam({ from: preset.from, to: preset.to })}
                className={`rounded-full px-2.5 py-1 font-medium transition-colors ${active ? 'bg-white text-brand-700' : 'bg-white/15 text-white hover:bg-white/25'}`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        {filtered && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-white/75">Showing:</span>
            {centreId && <span className="rounded-full bg-white/20 px-2.5 py-1 font-medium">{centreName(centreId)}</span>}
            <span className="rounded-full bg-white/20 px-2.5 py-1 font-medium">
              {formatDate(from)} – {formatDate(to)}
            </span>
            <button type="button" className="rounded-full bg-white px-2.5 py-1 font-medium text-brand-700" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </button>
          </div>
        )}
      </section>

      {summary.isLoading && <Loading />}
      <ErrorNotice error={summary.error} />

      {m && summary.data && (
        <>
          <section aria-label="Money flow" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FlowTile
              step={1}
              caption="What the centres made"
              measure={m.reportedRevenue}
              trend={column((p) => p.reportedRevenue)}
              accent="#64748b"
              operator="→"
              to={reportLink('department-channel-matrix', periodQuery)}
              footnote={
                (m.reportedRevenue.varianceReports ?? 0) > 0 && (
                  <Chip tone="neutral">{m.reportedRevenue.varianceReports} with approved differences</Chip>
                )
              }
            />
            <FlowTile
              step={2}
              caption="What is due to you (service charge)"
              measure={m.expectedServiceCharge}
              trend={column((p) => p.chargesPosted)}
              accent={VIZ.blue}
              operator="−"
              to={reportLink('expected-service-charges', periodQuery)}
              footnote={
                Number(m.reportedRevenue.amount) > 0 && (
                  <Chip tone="neutral">{((Number(m.expectedServiceCharge.amount) / Number(m.reportedRevenue.amount)) * 100).toFixed(1)}% of what they made</Chip>
                )
              }
            />
            <FlowTile
              step={3}
              caption="What the centres have paid you"
              measure={m.paymentsReceived}
              trend={column((p) => p.paymentsReceived)}
              accent={VIZ.aqua}
              operator="="
              to={reportLink('payment-register', periodQuery)}
              footnote={m.owedForPeriod.percentPaid != null && <Chip tone="good">{m.owedForPeriod.percentPaid}% of what is due</Chip>}
            />
            <FlowTile
              step={4}
              emphasis
              caption="What they still owe you (due − paid)"
              measure={{ ...m.owedForPeriod, label: Number(m.owedForPeriod.amount) < 0 ? 'Paid ahead' : m.owedForPeriod.label }}
              accent={Number(m.owedForPeriod.amount) > 0 ? '#dc2626' : '#059669'}
              tone={Number(m.owedForPeriod.amount) > 0 ? 'bad' : 'good'}
              to={reportLink('centre-comparison', periodQuery)}
            >
              {m.owedForPeriod.percentPaid != null && (
                <div className="mt-3" role="img" aria-label={`${m.owedForPeriod.percentPaid}% of the expected charge has been paid`}>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-700 ease-out motion-reduce:transition-none"
                      style={{ width: `${Math.min(100, Number(m.owedForPeriod.percentPaid))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{Math.min(100, Number(m.owedForPeriod.percentPaid)).toFixed(1)}% of the due amount paid</p>
                </div>
              )}
              {m.owedForPeriod.percentPaid == null && <p className="mt-3 text-xs text-slate-500">No service charge was posted in this period.</p>}
            </FlowTile>
          </section>

          <section aria-label="Balances and allocation" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi
              size="small"
              measure={{ ...m.outstandingReceivables, label: 'Open ledger balance' }}
              trend={column((p) => p.outstanding)}
              accent={VIZ.blue}
              to={reportLink('outstanding-receivables')}
              footnote={
                balanceChange !== null && (
                  <Chip tone={balanceChange > 0 ? 'bad' : 'good'}>
                    {balanceChange > 0 ? '▲' : balanceChange < 0 ? '▼' : '■'} {Math.abs(balanceChange).toFixed(1)}% vs last month-end
                  </Chip>
                )
              }
            />
            <Kpi
              size="small"
              measure={m.overdueReceivables}
              tone="bad"
              accent="#dc2626"
              to={asAt ? reportLink('outstanding-receivables', { to: dayBefore(asAt) }) : undefined}
              footnote={overduePct !== null && <Chip tone={overduePct > 0 ? 'bad' : 'good'}>{overduePct.toFixed(1)}% of outstanding</Chip>}
            />
            <Kpi size="small" measure={m.unallocatedReceipts} accent="#64748b" to={reportLink('unallocated-receipts')} />
            <Kpi size="small" measure={m.paymentsAllocated} accent="#64748b" to={reportLink('payment-allocations', { ...periodQuery, status: 'ACTIVE' })} />
            <Kpi size="small" measure={m.chargesPosted} trend={column((p) => p.chargesPosted)} accent={VIZ.orange} to={reportLink('receivables-ledger', periodQuery)} />
          </section>
        </>
      )}

      {insights.data && insights.data.items.length > 0 && (
        <Card title={`Worth a look (${insights.data.items.length})`}>
          <ul className="divide-y divide-slate-100">
            {insights.data.items.slice(0, 6).map((item) => (
              <li key={item.id} className="py-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <span
                    className={`mt-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${item.severity === 'urgent' ? 'bg-red-50 text-red-700' : item.severity === 'attention' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {item.area}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link to={item.link} className="text-sm font-medium text-slate-900 hover:text-brand-700 hover:underline">
                      {item.title}
                    </Link>
                    <p className="text-sm text-slate-600">{item.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Rule-based observations from posted figures, comparing {monthLabel(insights.data.comparedMonths.latest, false)} with{' '}
            {monthLabel(insights.data.comparedMonths.previous, false)} where relevant. Each links to the records behind it.
          </p>
        </Card>
      )}

      <ErrorNotice error={trends.error} />
      {trends.isLoading && <Loading label="Loading trends…" />}
      {trends.data && !hasTrendData && (
        <Card title="Trends">
          <p className="text-sm text-slate-500">No posted charges, receipts or committed reports in this window yet. Trends appear as activity is posted.</p>
        </Card>
      )}

      {trends.data && hasTrendData && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Billing and collections by month" className="lg:col-span-2">
            <TimeChart
              title="Charges posted and payments received by month"
              labels={labels}
              detailLabels={detailLabels}
              format={monthFormat}
              tick={compactNaira}
              drill={(index) => monthActions(index, { id: 'receivables-ledger', label: 'Open the ledger for this month' })}
              series={[
                { key: 'charges', label: 'Charges posted', color: VIZ.blue, values: column((p) => p.chargesPosted) },
                { key: 'payments', label: 'Payments received', color: VIZ.orange, values: column((p) => p.paymentsReceived) },
              ]}
            />
            <p className="mt-2 text-xs text-slate-500">
              Charges by posting date; payments are posted receipts by receipt date. The latest month is month to date.
            </p>
          </Card>

          <Card title="Outstanding receivables at month-end">
            <TimeChart
              title="Receivable balance at the end of each month"
              labels={labels}
              detailLabels={detailLabels}
              format={monthFormat}
              tick={compactNaira}
              drill={(index) => monthActions(index)}
              series={[{ key: 'outstanding', label: 'Outstanding balance', color: VIZ.blue, values: column((p) => p.outstanding) }]}
            />
          </Card>

          <Card title="Cash received vs charges posted">
            <TimeChart
              title="Payments received as a percentage of charges posted, by month"
              labels={labels}
              detailLabels={detailLabels}
              format={percentFormat}
              tick={(v) => `${v}%`}
              drill={(index) => monthActions(index, { id: 'payment-register', label: 'Open the receipts for this month' })}
              series={[{ key: 'rate', label: 'Received ÷ charged', color: VIZ.aqua, values: series.map((p) => p.collectionRate) }]}
            />
            <p className="mt-2 text-xs text-slate-500">
              Cash received in a month divided by charges posted in the same month. Centres may be paying older balances, so this is not a collection rate; see
              the next chart.
            </p>
          </Card>

          {can(user, 'receivables.read') && (
            <Card
              title="Collection rate: settled on time"
              className="lg:col-span-2"
              actions={
                <label className="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap text-xs text-slate-600">
                  On time means within
                  <Select
                    aria-label="On-time window in days"
                    value={windowDays}
                    onChange={(event) => setParam({ windowDays: event.target.value === '30' ? null : event.target.value })}
                  >
                    {['14', '30', '45', '60', '90'].map((days) => (
                      <option key={days} value={days}>
                        {days} days
                      </option>
                    ))}
                  </Select>
                  of the due date
                </label>
              }
            >
              {collection.isLoading && <Loading />}
              <ErrorNotice error={collection.error} />
              {collection.data && !hasCollection && <p className="text-sm text-slate-500">No receivables fell due in this window.</p>}
              {collection.data && hasCollection && (
                <>
                  <TimeChart
                    title={`Share of receivables due each month that was settled within ${collection.data.windowDays} days of the due date`}
                    labels={collectionLabels}
                    detailLabels={collectionDetails}
                    format={percentFormat}
                    tick={(v) => `${v}%`}
                    series={[
                      {
                        key: 'ontime',
                        label: `Settled within ${collection.data.windowDays} days (final months only)`,
                        color: VIZ.blue,
                        values: collectionSeries.map((p) => p.rateWithinWindow),
                      },
                      { key: 'sofar', label: 'Settled so far', color: VIZ.aqua, values: collectionSeries.map((p) => p.rateToDate) },
                    ]}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Of the receivables that fell due in each month, the share settled within {collection.data.windowDays} days after the due date. A month is
                    final only once {collection.data.windowDays} days have passed after it ends; until then only &ldquo;settled so far&rdquo; is shown. The
                    window is chosen here; a saved organisation-wide setting comes with system configuration.
                  </p>
                </>
              )}
            </Card>
          )}

          <Card title="Reported revenue by month" className="lg:col-span-2">
            <TimeChart
              kind="bar"
              title="Committed report revenue by month"
              labels={labels}
              detailLabels={detailLabels}
              format={monthFormat}
              tick={compactNaira}
              drill={(index) => monthActions(index, { id: 'department-channel-matrix', label: 'Open the department and channel matrix' })}
              series={[{ key: 'revenue', label: 'Reported revenue', color: VIZ.blue, values: column((p) => p.reportedRevenue) }]}
            />
            <p className="mt-2 text-xs text-slate-500">
              Committed centre reports by the month their period ends. This is the base for service charges, not money received.
            </p>
          </Card>
        </div>
      )}

      {((departments.data?.items.length ?? 0) > 0 || (channelMix.data?.items.length ?? 0) > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Reported revenue by department">
            <RankedBars
              format={monthFormat}
              color={VIZ.blue}
              items={(departments.data?.items ?? []).map((row) => ({
                key: row.department,
                label: row.department,
                value: row.revenue,
                secondary: row.share ? `${row.share}% of total` : undefined,
              }))}
              secondaryLabel=""
            />
            <p className="mt-3 text-xs text-slate-500">
              Top 8 departments for the selected period, by committed reports wholly inside it.{' '}
              <Link className="text-brand-700 underline" to={reportLink('department-revenue', periodQuery) ?? '/reports'}>
                Open the full report
              </Link>
            </p>
          </Card>
          <Card title="Reported revenue by payment channel">
            <RankedBars
              format={monthFormat}
              color={VIZ.aqua}
              items={(channelMix.data?.items ?? []).map((row) => ({
                key: row.channel,
                label: row.channel,
                value: row.revenue,
                secondary: row.share ? `${row.share}% of total` : undefined,
              }))}
              secondaryLabel=""
            />
            <p className="mt-3 text-xs text-slate-500">
              Reported by centres, not verified against bank deposits.{' '}
              <Link className="text-brand-700 underline" to={reportLink('channel-revenue', periodQuery) ?? '/reports'}>
                Open the full report
              </Link>
            </p>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Awaiting action">
          {todo.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing is waiting for action.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {todo.map((item) => (
                <li key={item.label}>
                  <Link to={item.to} className="flex items-center justify-between py-2.5 text-sm text-slate-700 hover:text-brand-700">
                    <span>{item.label}</span>
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{item.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Report submission"
          actions={
            reportLink('reporting-status') && (
              <Link className="text-xs text-brand-700 underline" to={reportLink('reporting-status') as string}>
                All centres
              </Link>
            )
          }
        >
          {reporting.isLoading && <Loading />}
          <ErrorNotice error={reporting.error} />
          {reporting.data && late.length === 0 && (
            <p className="text-sm text-slate-500">
              {reporting.data.centres.length === 0
                ? 'No active centres.'
                : `Every active centre has reported within the last ${reporting.data.lateAfterDays} days.`}
            </p>
          )}
          {late.length > 0 && (
            <>
              <p className="mb-2 text-sm text-red-700">
                {late.length} centre{late.length === 1 ? ' is' : 's are'} late: no report ending in the last {reporting.data?.lateAfterDays} days.
              </p>
              <ul className="divide-y divide-slate-100">
                {late.slice(0, 6).map((centre) => (
                  <li key={centre.centreId} className="flex items-center justify-between py-2 text-sm">
                    <Link className="text-slate-700 hover:text-brand-700 hover:underline" to={`/imports?centreId=${centre.centreId}`}>
                      {centreLabel(centre)}
                    </Link>
                    <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                      {centre.daysSince === null ? 'never reported' : `${centre.daysSince} days`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card title={`Receivables ageing${ageing.data ? ` as at ${formatDate(ageing.data.asAt)}` : ''}`}>
        {ageing.isLoading && <Loading />}
        <ErrorNotice error={ageing.error} />
        {ageing.data && ageingRows.length === 0 && <p className="text-sm text-slate-500">No open receivables.</p>}
        {ageing.data && ageingRows.length > 0 && (
          <>
            <SegmentedBar
              total={ageing.data.total.outstanding}
              format={monthFormat}
              segments={BUCKETS.map((bucket, i) => ({ key: bucket, label: BUCKET_LABEL[bucket], value: ageing.data.total[bucket], color: AGEING_RAMP[i] }))}
            />
            {reportLink('receivables-ageing') && (
              <Link className="mt-3 inline-block text-sm text-brand-700 underline" to={reportLink('receivables-ageing') as string}>
                Open the ageing report
              </Link>
            )}
          </>
        )}
      </Card>

      {ageing.data && byCentre.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`Outstanding by centre${ageingRows.length > byCentre.length ? ` (top ${byCentre.length})` : ''}`}>
            <RankedBars
              format={monthFormat}
              color={VIZ.blue}
              items={byCentre.map((row) => ({
                key: row.centreId,
                label: (
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      className="truncate text-left hover:text-brand-700 hover:underline"
                      title="Focus the whole dashboard on this centre"
                      onClick={() => setParam({ centreId: row.centreId })}
                    >
                      {centreLabel(row)}
                    </button>
                    <Link className="shrink-0 text-xs text-brand-700 underline" to={`/receivables?centreId=${row.centreId}&openOnly=true`}>
                      records
                    </Link>
                  </span>
                ),
                value: row.outstanding,
              }))}
            />
            <p className="mt-3 text-xs text-slate-500">Click a centre to focus every figure and chart on it.</p>
          </Card>
          <Card title="Overdue (past 30 days) by centre">
            <RankedBars
              format={monthFormat}
              color="#dc2626"
              items={[...ageingRows]
                .map((row) => ({
                  row,
                  value: (['DAYS_31_60', 'DAYS_61_90', 'DAYS_91_120', 'OVER_120'] as const).reduce((acc, bucket) => addMoney(acc, row[bucket]), '0.00'),
                }))
                .sort((a, b) => compareMoney(b.value, a.value))
                .slice(0, 8)
                .map(({ row, value }) => ({ key: row.centreId, label: centreLabel(row), value }))}
            />
            <p className="mt-3 text-xs text-slate-500">Balances more than 30 days past due, summed from the ageing buckets.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
