import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { HospitalSelect } from '../components/HospitalSelect';
import { Button, Card, EmptyState, ErrorNotice, Field, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import { can } from '../lib/permissions';
import type { ChargeRun, Page } from '../lib/types';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED'];

export function ChargeRunsPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const hospitalId = params.get('hospitalId') ?? '';
  const page = Number(params.get('page') ?? 1);
  const query = useQuery({
    queryKey: ['charge-runs', status, hospitalId, page],
    queryFn: () => api<Page<ChargeRun>>('/charge-runs', { query: { status, hospitalId, page, pageSize: 20 } }),
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
        title="Service charges"
        subtitle="A charge run applies the hospital's charge rules to committed revenue. It is reviewed and approved by a different person, then posted to create the receivable."
        actions={can(user, 'charge_runs.create') && <Link to="/charge-runs/new"><Button>New charge run</Button></Link>}
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Hospital">{(id) => <HospitalSelect id={id} allowAll value={hospitalId} onChange={(value) => setParam('hospitalId', value)} />}</Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={status} onChange={(event) => setParam('status', event.target.value)}>
                <option value="">All</option>
                {STATUSES.map((item) => <option key={item} value={item}>{item.toLowerCase()}</option>)}
              </Select>
            )}
          </Field>
        </div>
        {query.isLoading && <Loading />}
        <ErrorNotice error={query.error} />
        {query.data && query.data.items.length === 0 && <EmptyState title="No charge runs found" />}
        {query.data && query.data.items.length > 0 && (
          <>
            <Table caption="Charge runs">
              <thead><tr><Th>Hospital</Th><Th>Period</Th><Th>Status</Th><Th numeric>Lines</Th><Th numeric>Eligible revenue</Th><Th numeric>Service charge</Th><Th>Prepared by</Th><Th>Approved by</Th></tr></thead>
              <tbody>
                {query.data.items.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" to={`/charge-runs/${run.id}`}>{run.hospital.name}</Link><div className="text-xs text-slate-500">{run.hospital.code}</div></Td>
                    <Td>{formatDate(run.periodStart)} – {formatDate(run.periodEnd)}</Td>
                    <Td><StatusBadge status={run.status} /></Td>
                    <Td numeric>{run._count?.lines ?? 0}</Td>
                    <Td numeric>{formatMoney(run.baseTotal)}</Td>
                    <Td numeric className="font-semibold">{formatMoney(run.chargeTotal)}</Td>
                    <Td>{run.createdBy?.fullName ?? '—'}</Td>
                    <Td>{run.approvedBy?.fullName ?? '—'}</Td>
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
