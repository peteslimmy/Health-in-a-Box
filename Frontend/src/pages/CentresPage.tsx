import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { can } from '../lib/permissions';
import type { Centre, Page } from '../lib/types';

export function CentresPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const query = useQuery({
    queryKey: ['centres', status, params.get('search'), page],
    queryFn: () => api<Page<Centre>>('/centres', { query: { status, search: params.get('search'), page, pageSize: 20 } }),
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
        title="Centres"
        subtitle="Each centre has its own departments, payment channels, commercial agreement and charge rules. Only active centres can receive revenue reports, charges and receipts."
        actions={
          <div className="flex gap-2">
            {can(user, 'centres.onboard') && <Link to="/centres/setup"><Button>Set up from a report</Button></Link>}
            {can(user, 'centres.create') && <Link to="/centres/new"><Button variant={can(user, 'centres.onboard') ? 'secondary' : 'primary'}>New centre</Button></Link>}
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
        {query.data && query.data.items.length === 0 && <EmptyState title="No centres found" hint="Adjust the filters, or create a centre." />}
        {query.data && query.data.items.length > 0 && (
          <>
            <Table caption="Centres">
              <thead>
                <tr><Th>Name</Th><Th>Code</Th><Th>Status</Th><Th numeric>Departments</Th><Th numeric>Channels</Th><Th numeric>Receivables</Th><Th numeric>Payment terms</Th></tr>
              </thead>
              <tbody>
                {query.data.items.map((centre) => (
                  <tr key={centre.id} className="hover:bg-slate-50">
                    <Td><Link className="font-medium text-brand-700 hover:underline" to={`/centres/${centre.id}`}>{centre.name}</Link></Td>
                    <Td className="font-mono text-xs">{centre.code}</Td>
                    <Td><StatusBadge status={centre.status} /></Td>
                    <Td numeric>{centre._count?.departments ?? 0}</Td>
                    <Td numeric>{centre._count?.paymentChannels ?? 0}</Td>
                    <Td numeric>{centre._count?.receivables ?? 0}</Td>
                    <Td numeric>{centre.paymentTermsDays} days</Td>
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
