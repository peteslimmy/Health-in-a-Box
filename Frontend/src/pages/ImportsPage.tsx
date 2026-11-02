import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { CentreSelect } from '../components/CentreSelect';
import { Button, Card, EmptyState, ErrorNotice, Field, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import { can } from '../lib/permissions';
import type { ImportBatch, Page } from '../lib/types';

const STATUSES = ['NEEDS_REVIEW', 'READY_TO_COMMIT', 'COMMITTED', 'FAILED'];

export function ImportsPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const centreId = params.get('centreId') ?? '';
  const page = Number(params.get('page') ?? 1);

  const query = useQuery({
    queryKey: ['imports', status, centreId, page],
    queryFn: () => api<Page<ImportBatch>>('/imports', { query: { status, centreId, page, pageSize: 20 } }),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  return (
    <div>
      <PageHeader
        title="Revenue imports"
        subtitle="Upload a centre's revenue report (CSV or Excel). Totals are checked, errors are listed row by row, and a different person must commit a clean import before charges can be calculated."
        actions={can(user, 'imports.manage') && <Link to="/imports/new"><Button>New import</Button></Link>}
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Centre">{(id) => <CentreSelect id={id} allowAll value={centreId} onChange={(value) => setParam('centreId', value)} />}</Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={status} onChange={(event) => setParam('status', event.target.value)}>
                <option value="">All</option>
                {STATUSES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ').toLowerCase()}</option>)}
              </Select>
            )}
          </Field>
        </div>
        {query.isLoading && <Loading />}
        <ErrorNotice error={query.error} />
        {query.data && query.data.items.length === 0 && <EmptyState title="No imports found" />}
        {query.data && query.data.items.length > 0 && (
          <>
            <Table caption="Revenue imports">
              <thead><tr><Th>File</Th><Th>Centre</Th><Th>Period</Th><Th numeric>Rows</Th><Th numeric>Reported total</Th><Th>Status</Th><Th>Uploaded by</Th><Th>Uploaded</Th></tr></thead>
              <tbody>
                {query.data.items.map((batch) => (
                  <tr key={batch.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" to={`/imports/${batch.id}`}>{batch.fileName ?? batch.id.slice(0, 8)}</Link></Td>
                    <Td><div>{batch.centre.name}</div><div className="text-xs text-slate-500">{batch.centre.code}</div></Td>
                    <Td>{formatDate(batch.periodStart)} – {formatDate(batch.periodEnd)}</Td>
                    <Td numeric>{batch.rowCount}</Td>
                    <Td numeric>{formatMoney(batch.totalAmount)}</Td>
                    <Td><StatusBadge status={batch.status} /></Td>
                    <Td>{batch.createdBy.fullName}</Td>
                    <Td>{formatDateTime(batch.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={query.data.meta.page} totalPages={query.data.meta.totalPages} total={query.data.meta.total} onPage={(next) => setParam('page', String(next))} />
          </>
        )}
      </Card>
    </div>
  );
}
