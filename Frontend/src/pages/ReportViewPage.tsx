import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CentreSelect } from '../components/CentreSelect';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Loading, Notice, PageHeader, Pagination, Select, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatMoney, titleCase } from '../lib/format';
import type { ReportColumn, ReportResult, ReportRow, ReportSummary } from '../lib/types';

function cell(column: ReportColumn, row: ReportRow) {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return '—';
  switch (column.type) {
    case 'money':
      return formatMoney(String(value));
    case 'date':
      return formatDate(String(value));
    case 'percent':
      return `${value}%`;
    case 'int':
      return String(value);
    default:
      return String(value);
  }
}

const isNumeric = (column: ReportColumn) => column.type !== 'text' && column.type !== 'date';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportViewPage() {
  const { id = '' } = useParams();
  // Links from the dashboard open a report already filtered to the figure that was clicked.
  const [params] = useSearchParams();
  const [centreId, setCentreId] = useState(params.get('centreId') ?? '');
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [page, setPage] = useState(1);

  const catalogue = useQuery({ queryKey: ['reports'], queryFn: () => api<ReportSummary[]>('/reports') });
  const summary = catalogue.data?.find((report) => report.id === id);

  const filters = { centreId, from, to, status };
  const result = useQuery({
    queryKey: ['report', id, filters, page],
    queryFn: () => api<ReportResult>(`/reports/${id}`, { query: { ...filters, page, pageSize: 50 } }),
    enabled: !!summary && (!summary.requiresCentre || !!centreId),
  });

  const exportFile = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      const blob = await api<Blob>(`/reports/${id}/export`, { query: { ...filters, format }, blob: true });
      download(blob, `${id}-${new Date().toISOString().slice(0, 10)}.${format}`);
    },
  });

  if (catalogue.isLoading) return <Loading />;
  if (catalogue.error) return <ErrorNotice error={catalogue.error} />;
  if (!summary) {
    return (
      <EmptyState
        title="Report not found"
        hint={
          <>
            It may not exist or you may not have access to its data.{' '}
            <Link className="text-brand-700 underline" to="/reports">
              Back to reports
            </Link>
          </>
        }
      />
    );
  }

  const reset = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const data = result.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={summary.title}
        subtitle={summary.description}
        actions={
          <>
            <Link className="text-sm text-brand-700 underline" to="/reports">
              All reports
            </Link>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            {summary.canExport && (
              <>
                <Button variant="secondary" loading={exportFile.isPending && exportFile.variables === 'csv'} onClick={() => exportFile.mutate('csv')}>
                  Export CSV
                </Button>
                <Button variant="secondary" loading={exportFile.isPending && exportFile.variables === 'xlsx'} onClick={() => exportFile.mutate('xlsx')}>
                  Export Excel
                </Button>
              </>
            )}
          </>
        }
      />
      <ErrorNotice error={exportFile.error} />

      {summary.filters.length > 0 && (
        <Card className="print:hidden">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summary.filters.includes('centreId') && (
              <Field label="Centre">
                {(fieldId) => (
                  <CentreSelect id={fieldId} allowAll={!summary.requiresCentre} value={centreId} onChange={(value) => reset(() => setCentreId(value))} />
                )}
              </Field>
            )}
            {summary.filters.includes('from') && (
              <Field label={`From${summary.dateBasis ? ` (${summary.dateBasis.toLowerCase()})` : ''}`}>
                {(fieldId) => (
                  <Input id={fieldId} type="date" value={from} max={to || undefined} onChange={(event) => reset(() => setFrom(event.target.value))} />
                )}
              </Field>
            )}
            {summary.filters.includes('to') && (
              <Field label="To">
                {(fieldId) => (
                  <Input id={fieldId} type="date" value={to} min={from || undefined} onChange={(event) => reset(() => setTo(event.target.value))} />
                )}
              </Field>
            )}
            {summary.filters.includes('status') && summary.statuses && (
              <Field label="Status">
                {(fieldId) => (
                  <Select id={fieldId} value={status} onChange={(event) => reset(() => setStatus(event.target.value))}>
                    <option value="">Default ({titleCase(summary.statuses![0])})</option>
                    {summary.statuses!.map((value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
        </Card>
      )}

      {summary.requiresCentre && !centreId && <Notice tone="info">Choose a centre to produce this report.</Notice>}
      {result.isLoading && <Loading />}
      <ErrorNotice error={result.error} />

      {data && (
        <>
          {data.notes.length > 0 && (
            <Notice tone="info">
              <ul className="list-disc space-y-0.5 pl-5">
                {data.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Notice>
          )}
          <Card>
            {data.items.length === 0 ? (
              <EmptyState title="No records match these filters" hint="Widen the dates or choose all centres." />
            ) : (
              <>
                <Table caption={summary.title}>
                  <thead>
                    <tr>
                      {data.columns.map((column) => (
                        <Th key={column.key} numeric={isNumeric(column)}>
                          {column.label}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row, index) => (
                      <tr key={index}>
                        {data.columns.map((column) => (
                          <Td
                            key={column.key}
                            numeric={isNumeric(column)}
                            className={String(row[column.key] ?? '').length <= 48 ? 'whitespace-nowrap' : undefined}
                          >
                            {cell(column, row)}
                          </Td>
                        ))}
                      </tr>
                    ))}
                    {data.totals && (
                      <tr className="bg-slate-50 font-semibold">
                        {data.columns.map((column) => (
                          <Td key={column.key} numeric={isNumeric(column)}>
                            {data.totals![column.key] === undefined ? '' : cell(column, data.totals as ReportRow)}
                          </Td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </Table>
                <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
                <p className="mt-2 text-xs text-slate-500">
                  The totals row covers all {data.meta.total} records, not just this page. Generated {new Date(data.generatedAt).toLocaleString('en-GB')}.
                </p>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
