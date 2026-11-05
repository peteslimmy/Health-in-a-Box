import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HospitalSelect } from '../components/HospitalSelect';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Loading, PageHeader, Pagination, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { AuditEvent, Page } from '../lib/types';

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const hospitalId = params.get('hospitalId') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [action, setAction] = useState(params.get('action') ?? '');
  const [targetType, setTargetType] = useState(params.get('targetType') ?? '');

  const query = useQuery({
    queryKey: ['audit', hospitalId, from, to, params.get('action'), params.get('targetType'), page],
    queryFn: () =>
      api<Page<AuditEvent>>('/audit-events', { query: { hospitalId, from, to, action: params.get('action'), targetType: params.get('targetType'), page, pageSize: 25 } }),
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
      <PageHeader title="Audit trail" subtitle="Every financial, access and configuration change, with who did it, when, and what changed. Entries cannot be edited or deleted." />
      <Card>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(event) => {
            event.preventDefault();
            const next = new URLSearchParams(params);
            action.trim() ? next.set('action', action.trim()) : next.delete('action');
            targetType.trim() ? next.set('targetType', targetType.trim()) : next.delete('targetType');
            next.delete('page');
            setParams(next);
          }}
        >
          <Field label="Hospital">{(id) => <HospitalSelect id={id} allowAll value={hospitalId} onChange={(value) => setParam('hospitalId', value)} />}</Field>
          <Field label="From">{(id) => <Input id={id} type="date" value={from} onChange={(event) => setParam('from', event.target.value)} />}</Field>
          <Field label="To">{(id) => <Input id={id} type="date" value={to} onChange={(event) => setParam('to', event.target.value)} />}</Field>
          <Field label="Action" hint="e.g. PAYMENT_POSTED">{(id) => <Input id={id} value={action} onChange={(event) => setAction(event.target.value)} />}</Field>
          <Field label="Record type" hint="e.g. Payment">{(id) => <Input id={id} value={targetType} onChange={(event) => setTargetType(event.target.value)} />}</Field>
          <div><Button type="submit" variant="secondary">Apply filters</Button></div>
        </form>
        {query.isLoading && <Loading />}
        <ErrorNotice error={query.error} />
        {query.data && query.data.items.length === 0 && <EmptyState title="No audit events match" />}
        {query.data && query.data.items.length > 0 && (
          <>
            <Table caption="Audit events">
              <thead><tr><Th>When</Th><Th>Who</Th><Th>Hospital</Th><Th>Action</Th><Th>What happened</Th><Th>Detail</Th></tr></thead>
              <tbody>
                {query.data.items.map((event) => (
                  <tr key={event.id}>
                    <Td>{formatDateTime(event.createdAt)}</Td>
                    <Td>{event.actor?.fullName ?? 'System'}</Td>
                    <Td>{event.hospital?.code ?? '—'}</Td>
                    <Td className="font-mono text-xs">{event.action}</Td>
                    <Td>{event.summary}</Td>
                    <Td>
                      <details>
                        <summary className="cursor-pointer text-brand-700">View</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                          {JSON.stringify({ before: event.before, after: event.after, reference: event.correlationId }, null, 2)}
                        </pre>
                      </details>
                    </Td>
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
