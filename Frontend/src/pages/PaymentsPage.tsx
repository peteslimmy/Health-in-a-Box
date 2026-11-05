import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { HospitalSelect } from '../components/HospitalSelect';
import { Button, Card, EmptyState, ErrorNotice, Field, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td, Th, cx } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import { can } from '../lib/permissions';
import type { Page, Payment } from '../lib/types';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED', 'REVERSED'];

export function PaymentsPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const hospitalId = params.get('hospitalId') ?? '';
  const view = params.get('view') === 'unallocated' ? 'unallocated' : 'all';
  const page = Number(params.get('page') ?? 1);
  const query = useQuery({
    queryKey: ['payments', view, status, hospitalId, page],
    queryFn: () =>
      api<Page<Payment>>(view === 'unallocated' ? '/payments/unallocated' : '/payments', {
        query: { hospitalId, status: view === 'all' ? status : undefined, page, pageSize: 20 },
      }),
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
        title="Payments received"
        subtitle="Service-charge money paid to the operator by hospitals. A receipt is recorded, approved and posted by different people, then allocated to receivables."
        actions={can(user, 'payments.create') && <Link to="/payments/new"><Button>Record receipt</Button></Link>}
      />
      <Card>
        <div role="tablist" aria-label="Payment views" className="mb-4 flex gap-2 border-b border-slate-200">
          {[['all', 'All receipts'], ['unallocated', 'Unallocated cash worklist']].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              type="button"
              className={cx('-mb-px border-b-2 px-3 py-2 text-sm', view === key ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-slate-600')}
              onClick={() => setParam('view', key === 'all' ? '' : key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Hospital">{(id) => <HospitalSelect id={id} allowAll value={hospitalId} onChange={(value) => setParam('hospitalId', value)} />}</Field>
          {view === 'all' && (
            <Field label="Status">
              {(id) => (
                <Select id={id} value={status} onChange={(event) => setParam('status', event.target.value)}>
                  <option value="">All</option>
                  {STATUSES.map((item) => <option key={item} value={item}>{item.toLowerCase()}</option>)}
                </Select>
              )}
            </Field>
          )}
        </div>
        {query.isLoading && <Loading />}
        <ErrorNotice error={query.error} />
        {query.data && query.data.items.length === 0 && <EmptyState title={view === 'unallocated' ? 'All posted cash has been allocated' : 'No receipts found'} />}
        {query.data && query.data.items.length > 0 && (
          <>
            <Table caption="Payments">
              <thead><tr><Th>Reference</Th><Th>Hospital</Th><Th>Receipt date</Th><Th>Method</Th><Th>Status</Th><Th numeric>Amount</Th><Th numeric>Unallocated</Th></tr></thead>
              <tbody>
                {query.data.items.map((payment) => (
                  <tr key={payment.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" to={`/payments/${payment.id}`}>{payment.reference ?? payment.id.slice(0, 8)}</Link></Td>
                    <Td><div>{payment.hospital.name}</div><div className="text-xs text-slate-500">{payment.hospital.code}</div></Td>
                    <Td>{formatDate(payment.receiptDate)}</Td>
                    <Td>{payment.method.replaceAll('_', ' ').toLowerCase()}</Td>
                    <Td><StatusBadge status={payment.status} /></Td>
                    <Td numeric>{formatMoney(payment.amount)}</Td>
                    <Td numeric>{payment.status === 'POSTED' ? formatMoney(payment.unallocatedAmount) : '—'}</Td>
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
