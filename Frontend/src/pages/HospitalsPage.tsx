import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { can } from '../lib/permissions';
import type { Hospital, Page } from '../lib/types';

export function HospitalsPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const query = useQuery({
    queryKey: ['hospitals', status, params.get('search'), page],
    queryFn: () => api<Page<Hospital>>('/hospitals', { query: { status, search: params.get('search'), page, pageSize: 20 } }),
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
        title="Hospitals"
        subtitle="Each hospital has its own departments, payment channels, commercial agreement and charge rules. Only active hospitals can receive revenue reports, charges and receipts."
        actions={
          <div className="flex gap-2">
            {can(user, 'hospitals.onboard') && <Link to="/hospitals/setup"><Button>Set up from a report</Button></Link>}
            {can(user, 'hospitals.create') && <Link to="/hospitals/new"><Button variant={can(user, 'hospitals.onboard') ? 'secondary' : 'primary'}>New hospital</Button></Link>}
          </div>
        }
      />
      <Card>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            setParam('search', search.trim());
          }}
        >
          <Field label="Search">{(id) => <Input id={id} value={search} placeholder="Code or name" onChange={(event) => setSearch(event.target.value)} />}</Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={status} onChange={(event) => setParam('status', event.target.value)}>
                <option value="">All</option>
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </Select>
            )}
          </Field>
          <div className="flex items-end"><Button type="submit" variant="secondary">Search</Button></div>
        </form>

        {query.isLoading && <Loading />}
        <ErrorNotice error={query.error} />
        {query.data && query.data.items.length === 0 && <EmptyState title="No hospitals found" hint="Adjust the filters, or create a hospital." />}
        {query.data && query.data.items.length > 0 && (
          <>
            <Table caption="Hospitals">
              <thead>
                <tr><Th>Name</Th><Th>Code</Th><Th>Status</Th><Th numeric>Departments</Th><Th numeric>Channels</Th><Th numeric>Receivables</Th><Th numeric>Payment terms</Th></tr>
              </thead>
              <tbody>
                {query.data.items.map((hospital) => (
                  <tr key={hospital.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" to={`/hospitals/${hospital.id}`}>{hospital.name}</Link></Td>
                    <Td className="font-mono text-xs">{hospital.code}</Td>
                    <Td><StatusBadge status={hospital.status} /></Td>
                    <Td numeric>{hospital._count?.departments ?? 0}</Td>
                    <Td numeric>{hospital._count?.paymentChannels ?? 0}</Td>
                    <Td numeric>{hospital._count?.receivables ?? 0}</Td>
                    <Td numeric>{hospital.paymentTermsDays} days</Td>
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
