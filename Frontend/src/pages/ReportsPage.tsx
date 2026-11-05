import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import type { ReportSummary } from '../lib/types';

export function ReportsPage() {
  const list = useQuery({ queryKey: ['reports'], queryFn: () => api<ReportSummary[]>('/reports') });

  if (list.isLoading) return <Loading />;
  if (list.error || !list.data) return <ErrorNotice error={list.error} />;

  const groups = list.data.reduce<Record<string, ReportSummary[]>>((acc, report) => {
    (acc[report.category] ??= []).push(report);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Every report states the date it is based on, shows its totals, and can be downloaded as CSV or Excel if you have export permission. Each download is recorded in the audit trail."
      />
      {list.data.length === 0 && <EmptyState title="No reports are available to you" hint="Ask an administrator for report access." />}
      {Object.entries(groups).map(([category, reports]) => (
        <section key={category} aria-labelledby={`cat-${category}`}>
          <h2 id={`cat-${category}`} className="mb-2 text-sm font-semibold text-slate-700">
            {category}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((report) => (
              <Link
                key={report.id}
                to={`/reports/${report.id}`}
                className="group rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <p className="font-semibold text-slate-900 group-hover:text-brand-700">{report.title}</p>
                <p className="mt-1 text-sm text-slate-600">{report.description}</p>
                <p className="mt-3 flex flex-wrap gap-x-3 text-xs text-slate-500">
                  {report.dateBasis && <span>By {report.dateBasis.toLowerCase()}</span>}
                  <span>{report.canExport ? 'Export: CSV, Excel' : 'View only'}</span>
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <Card title="About these reports">
        <p className="text-sm text-slate-600">
          Reports describe what hospitals reported and what the ledger holds. Reported revenue is not verified against patient-level records or bank deposits.
          Receipts received in a period are not payments against that period&apos;s charges.
        </p>
      </Card>
    </div>
  );
}
