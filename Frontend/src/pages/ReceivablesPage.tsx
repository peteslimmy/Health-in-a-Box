import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HospitalSelect } from '../components/HospitalSelect';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import type { Page, Receivable } from '../lib/types';

export function ReceivablesPage() {
  const [params, setParams] = useSearchParams();
  const hospitalId = params.get('hospitalId') ?? '';
  const status = params.get('status') ?? '';
  const openOnly = params.get('openOnly') === 'true';
  const overdueOnly = params.get('overdueOnly') === 'true';
  const asAt = params.get('asAt') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const query = useQuery({
    queryKey: ['receivables', hospitalId, status, openOnly, overdueOnly, asAt, params.get('search'), page],
    queryFn: () =>
      api<Page<Receivable>>('/receivables', {
        query: { hospitalId, status, openOnly: openOnly || undefined, overdueOnly: overdueOnly || undefined, asAt, search: params.get('search'), page, pageSize: 20 },
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
      <PageHeader title="Receivables" subtitle="One receivable per posted charge run. Cash received only reduces a receivable once it has been explicitly allocated to it." />
      <Card>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            setParam('search', search.trim());
          }}
        >
          <Field label="Hospital">{(id) => <HospitalSelect id={id} allowAll value={hospitalId} onChange={(value) => setParam('hospitalId', value)} />}</Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={status} onChange={(event) => setParam('status', event.target.value)}>
                <option value="">All</option>
                <option value="OPEN">Open</option>
                <option value="PARTIALLY_PAID">Partially paid</option>
                <option value="PAID">Paid</option>
                <option value="DISPUTED">Disputed</option>
              </Select>
            )}
          </Field>
          <Field label="As at" hint="Used for overdue and ageing">{(id) => <Input id={id} type="date" value={asAt} onChange={(event) => setParam('asAt', event.target.value)} />}</Field>
          <Field label="Search">{(id) => <Input id={id} value={search} placeholder="Reference or description" onChange={(event) => setSearch(event.target.value)} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={(event) => setParam('openOnly', event.target.checked ? 'true' : '')} /> Open balances only</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overdueOnly} onChange={(event) => setParam('overdueOnly', event.target.checked ? 'true' : '')} /> Overdue only</label>
          <div><Button type="submit" variant="secondary">Search</Button></div>
        </form>

        {query.isLoading && <Loading />}
        <ErrorNotice error={query.error} />
        {query.data && query.data.items.length === 0 && <EmptyState title="No receivables found" />}
        {query.data && query.data.items.length > 0 && (
          <>
            <Table caption="Receivables">
              <thead><tr><Th>Reference</Th><Th>Hospital</Th><Th>Due</Th><Th>Ageing</Th><Th>Status</Th><Th numeric>Original</Th><Th numeric>Paid</Th><Th numeric>Balance</Th></tr></thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" to={`/receivables/${item.id}`}>{item.reference}</Link></Td>
                    <Td><div>{item.hospital.name}</div><div className="text-xs text-slate-500">{item.hospital.code}</div></Td>
                    <Td>{formatDate(item.dueDate)}</Td>
                    <Td><StatusBadge status={item.ageingBucket} />{item.daysOverdue > 0 && <span className="ml-1 text-xs text-slate-500">{item.daysOverdue}d</span>}</Td>
                    <Td><StatusBadge status={item.status} /></Td>
                    <Td numeric>{formatMoney(item.originalAmount)}</Td>
                    <Td numeric>{formatMoney(item.amountPaid)}</Td>
                    <Td numeric className="font-semibold">{formatMoney(item.balance)}</Td>
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
