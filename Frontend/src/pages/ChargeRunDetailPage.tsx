import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { Button, Card, ErrorNotice, KeyValue, Loading, Notice, PageHeader, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import { can } from '../lib/permissions';
import type { ChargeRun } from '../lib/types';

type RunDetail = ChargeRun & { receivable?: { id: string; reference: string; status: string; balance: string } | null; rulesSnapshot?: { warnings?: string[] } | null };

export function ChargeRunDetailPage() {
  const { id = '' } = useParams();
  const user = useUser();
  const queryClient = useQueryClient();
  const run = useQuery({ queryKey: ['charge-run', id], queryFn: () => api<RunDetail>(`/charge-runs/${id}`) });

  const act = useMutation({
    mutationFn: (action: 'recalculate' | 'submit-review' | 'approve' | 'post') => api(`/charge-runs/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['charge-run', id] });
      void queryClient.invalidateQueries({ queryKey: ['charge-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['receivables'] });
    },
  });

  if (run.isLoading) return <Loading />;
  if (run.error || !run.data) return <ErrorNotice error={run.error} />;
  const r = run.data;
  const isCreator = r.createdById === user.id;
  const warnings = r.rulesSnapshot?.warnings ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Charge run — ${r.centre.name}`}
        subtitle={<><StatusBadge status={r.status} /> {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</>}
        actions={
          <>
            {r.status === 'DRAFT' && can(user, 'charge_runs.create') && <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate('recalculate')}>Recalculate</Button>}
            {r.status === 'DRAFT' && can(user, 'charge_runs.submit') && <Button loading={act.isPending} onClick={() => act.mutate('submit-review')}>Submit for approval</Button>}
            {r.status === 'SUBMITTED' && can(user, 'charge_runs.approve') && !isCreator && <Button loading={act.isPending} onClick={() => act.mutate('approve')}>Approve</Button>}
            {r.status === 'APPROVED' && can(user, 'charge_runs.post') && !isCreator && <Button loading={act.isPending} onClick={() => act.mutate('post')}>Post to receivables</Button>}
          </>
        }
      />
      <ErrorNotice error={act.error} />
      {isCreator && (r.status === 'SUBMITTED' || r.status === 'APPROVED') && can(user, 'charge_runs.approve', 'charge_runs.post') && (
        <Notice tone="warn" title="You prepared this run">A different person must approve and post it.</Notice>
      )}
      {r.status === 'POSTED' && r.receivable && (
        <Notice tone="good" title="Posted">
          Receivable <Link className="underline" to={`/receivables/${r.receivable.id}`}>{r.receivable.reference}</Link> was created
          for {formatMoney(r.chargeTotal)}.
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice tone="warn" title="Warnings recorded at calculation">
          <ul className="list-disc pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </Notice>
      )}

      <Card title="Summary">
        <KeyValue
          items={[
            ['Eligible revenue', formatMoney(r.baseTotal)],
            ['Service charge', formatMoney(r.chargeTotal)],
            ['Prepared by', r.createdBy?.fullName],
            ['Approved by', r.approvedBy?.fullName],
            ['Created', formatDateTime(r.createdAt)],
            ['Posted', r.postedAt ? formatDateTime(r.postedAt) : '—'],
          ]}
        />
      </Card>

      <Card title="Why each amount">
        <Table caption="Charge lines with rule and rate">
          <thead><tr><Th>Department</Th><Th>Channel</Th><Th>Rule applied</Th><Th numeric>Revenue</Th><Th numeric>Rate</Th><Th numeric>Service charge</Th></tr></thead>
          <tbody>
            {r.lines.map((line, index) => (
              <tr key={line.id ?? index}>
                <Td>{line.department.name}</Td>
                <Td>{line.paymentChannel?.name ?? 'All channels'}</Td>
                <Td>{line.ruleName ?? line.rule?.name ?? '—'}</Td>
                <Td numeric>{formatMoney(line.baseAmount)}</Td>
                <Td numeric>{line.rate}%</Td>
                <Td numeric>{formatMoney(line.chargeAmount)}</Td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <Td>Total</Td><Td /><Td /><Td numeric>{formatMoney(r.baseTotal)}</Td><Td /><Td numeric>{formatMoney(r.chargeTotal)}</Td>
            </tr>
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
