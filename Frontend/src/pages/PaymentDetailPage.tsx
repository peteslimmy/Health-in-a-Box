import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { Button, Card, EmptyState, ErrorNotice, Field, KeyValue, Loading, Modal, Notice, PageHeader, StatusBadge, Table, Td, Textarea, Th, Input, cx } from '../components/ui';
import { api, newIdempotencyKey } from '../lib/api';
import { centreLabel, addMoney, compareMoney, formatDate, formatDateTime, formatMoney, isValidAmount, subtractMoney } from '../lib/format';
import { can } from '../lib/permissions';
import type { AllocationPreview, PaymentDetail, PaymentStatus } from '../lib/types';

const STEPS: PaymentStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED'];

function Stepper({ status }: { status: PaymentStatus }) {
  const index = STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Receipt progress">
      {STEPS.map((step, position) => {
        const done = index >= 0 && position < index;
        const current = position === index;
        return (
          <li key={step} className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
            <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium', current ? 'bg-brand-600 text-white' : done ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500')}>
              {done ? '✓ ' : ''}{step.charAt(0) + step.slice(1).toLowerCase()}
            </span>
            {position < STEPS.length - 1 && <span aria-hidden className="text-slate-300">→</span>}
          </li>
        );
      })}
      {(status === 'REJECTED' || status === 'REVERSED') && <li><StatusBadge status={status} /></li>}
    </ol>
  );
}

function ReasonDialog({ title, label, confirmLabel, pending, error, onSubmit, onClose }: {
  title: string; label: string; confirmLabel: string; pending: boolean; error: unknown;
  onSubmit: (reason: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(reason.trim()); }}>
        <Field label={label} hint="At least 3 characters; recorded in the audit trail">
          {(id) => <Textarea id={id} rows={3} required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
        <ErrorNotice error={error} />
        <div className="flex gap-2"><Button type="submit" variant="danger" loading={pending} disabled={reason.trim().length < 3}>{confirmLabel}</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  );
}

function AllocateDialog({ payment, onClose, onDone }: { payment: PaymentDetail; onClose: () => void; onDone: () => void }) {
  // One key per dialog: a retry after a network failure cannot allocate twice.
  const key = useRef(newIdempotencyKey());
  const [amounts, setAmounts] = useState<Record<string, string> | null>(null);
  const preview = useQuery({
    queryKey: ['allocation-preview', payment.id],
    queryFn: async () => {
      const result = await api<AllocationPreview>(`/payments/${payment.id}/allocation-preview`, { method: 'POST' });
      setAmounts((current) => current ?? Object.fromEntries(result.suggestion.map((item) => [item.receivableId, item.amount])));
      return result;
    },
    staleTime: 0,
    gcTime: 0,
  });
  const allocate = useMutation({
    mutationFn: () =>
      api(`/payments/${payment.id}/allocations`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: {
          allocations: Object.entries(amounts ?? {}).filter(([, amount]) => amount.trim() !== '').map(([receivableId, amount]) => ({ receivableId, amount: amount.trim() })),
        },
      }),
    onSuccess: onDone,
  });

  const unallocated = payment.unallocatedAmount;
  const rows = preview.data?.receivables ?? [];
  let total = '0.00';
  const problems: Record<string, string> = {};
  for (const receivable of rows) {
    const value = (amounts?.[receivable.id] ?? '').trim();
    if (!value) continue;
    if (!isValidAmount(value)) problems[receivable.id] = 'Enter a positive amount, up to 2 decimals';
    else if (compareMoney(value, receivable.balance) > 0) problems[receivable.id] = `More than the balance (${formatMoney(receivable.balance)})`;
    else total = addMoney(total, value);
  }
  const over = compareMoney(total, unallocated) > 0;
  const remaining = subtractMoney(unallocated, total);
  const canSubmit = Object.keys(problems).length === 0 && !over && compareMoney(total, '0.00') > 0;

  return (
    <Modal title="Allocate receipt to receivables" onClose={onClose} wide>
      <div className="space-y-3">
        <Notice tone="neutral">
          Receipt {formatMoney(payment.amount)} · available to allocate <strong>{formatMoney(unallocated)}</strong>. The oldest due dates are suggested; change any amount. Only what you allocate reduces a receivable.
        </Notice>
        {preview.isLoading && <Loading />}
        <ErrorNotice error={preview.error} />
        {preview.data && rows.length === 0 && <EmptyState title="This centre has no open receivables" hint="The cash stays unallocated until a charge is posted." />}
        {rows.length > 0 && (
          <Table caption="Open receivables for this centre">
            <thead><tr><Th>Receivable</Th><Th>Due</Th><Th numeric>Balance</Th><Th numeric>Allocate</Th></tr></thead>
            <tbody>
              {rows.map((receivable) => (
                <tr key={receivable.id}>
                  <Td>{receivable.reference}</Td>
                  <Td>{formatDate(receivable.dueDate)}</Td>
                  <Td numeric>{formatMoney(receivable.balance)}</Td>
                  <Td numeric>
                    <Input
                      aria-label={`Amount to allocate to ${receivable.reference}`}
                      inputMode="decimal"
                      className="w-36 text-right"
                      aria-invalid={!!problems[receivable.id]}
                      value={amounts?.[receivable.id] ?? ''}
                      onChange={(event) => setAmounts({ ...(amounts ?? {}), [receivable.id]: event.target.value })}
                    />
                    {problems[receivable.id] && <p className="mt-0.5 text-xs text-red-700" role="alert">{problems[receivable.id]}</p>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex flex-wrap justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <span>Allocating <strong className="tabular-nums">{formatMoney(total)}</strong></span>
          <span className={over ? 'font-semibold text-red-700' : ''}>{over ? `Over by ${formatMoney(subtractMoney(total, unallocated))}` : `Left unallocated: ${formatMoney(remaining)}`}</span>
        </div>
        <ErrorNotice error={allocate.error} />
        <div className="flex gap-2">
          <Button loading={allocate.isPending} disabled={!canSubmit} onClick={() => allocate.mutate()}>Confirm allocation</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

type Dialog = null | 'allocate' | 'reject' | 'reverse' | { reverseAllocation: string };

export function PaymentDetailPage() {
  const { id = '' } = useParams();
  const user = useUser();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const query = useQuery({ queryKey: ['payment', id], queryFn: () => api<PaymentDetail>(`/payments/${id}`) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['payment', id] });
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
    void queryClient.invalidateQueries({ queryKey: ['receivables'] });
    void queryClient.invalidateQueries({ queryKey: ['receivable'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['ageing'] });
  };
  const act = useMutation({
    mutationFn: (action: 'submit' | 'approve' | 'post') => api(`/payments/${id}/${action}`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const withReason = useMutation({
    mutationFn: ({ path, reason }: { path: string; reason: string }) => api(path, { method: 'POST', body: { reason } }),
    onSuccess: () => { setDialog(null); refresh(); },
  });

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorNotice error={query.error} />;
  const p = query.data;
  const isOwner = p.createdById === user.id;
  const activeAllocations = p.allocations.filter((allocation) => !allocation.reversedAt);
  const hasUnallocated = compareMoney(p.unallocatedAmount, '0.00') > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Receipt ${p.reference ?? p.id.slice(0, 8)}`}
        subtitle={<><StatusBadge status={p.status} /> {centreLabel(p.centre)}</>}
        actions={
          <>
            {p.status === 'DRAFT' && isOwner && can(user, 'payments.create') && <Button loading={act.isPending} onClick={() => act.mutate('submit')}>Submit for approval</Button>}
            {p.status === 'SUBMITTED' && can(user, 'payments.approve') && !isOwner && (
              <>
                <Button loading={act.isPending} onClick={() => act.mutate('approve')}>Approve</Button>
                <Button variant="secondary" onClick={() => setDialog('reject')}>Reject</Button>
              </>
            )}
            {p.status === 'APPROVED' && can(user, 'payments.post') && !isOwner && <Button loading={act.isPending} onClick={() => act.mutate('post')}>Post as received</Button>}
            {p.status === 'POSTED' && hasUnallocated && can(user, 'payments.allocate') && <Button onClick={() => setDialog('allocate')}>Allocate to receivables</Button>}
            {p.status === 'POSTED' && activeAllocations.length === 0 && can(user, 'payments.reverse') && !isOwner && <Button variant="danger" onClick={() => setDialog('reverse')}>Reverse receipt</Button>}
          </>
        }
      />
      <Stepper status={p.status} />
      <ErrorNotice error={act.error} />
      {isOwner && ['SUBMITTED', 'APPROVED'].includes(p.status) && <Notice tone="warn" title="You recorded this receipt">A different person must approve and post it.</Notice>}
      {p.status === 'REJECTED' && <Notice tone="bad" title="Rejected">{p.rejectionReason}. Record a corrected receipt; its reference is free to reuse.</Notice>}
      {p.status === 'REVERSED' && <Notice tone="bad" title="Reversed">{p.reversalReason}</Notice>}

      <Card title="Details">
        <KeyValue
          items={[
            ['Amount received', <strong key="a">{formatMoney(p.amount)}</strong>],
            ['Receipt date', formatDate(p.receiptDate)],
            ['Method', p.method.replaceAll('_', ' ').toLowerCase()],
            ['Payer', p.payerName],
            ['Recorded by', p.createdBy?.fullName],
            ['Notes', p.notes],
            ['Unallocated cash', p.status === 'POSTED' ? <strong key="u">{formatMoney(p.unallocatedAmount)}</strong> : '—'],
          ]}
        />
      </Card>

      <Card title="Allocations">
        {p.allocations.length === 0 ? (
          <EmptyState title="Nothing allocated" hint={p.status === 'POSTED' ? 'Unallocated cash stays separate and does not reduce any receivable.' : 'A receipt can be allocated once it is posted.'} />
        ) : (
          <Table caption="Allocations of this receipt">
            <thead><tr><Th>Receivable</Th><Th>Due</Th><Th>Allocated</Th><Th numeric>Amount</Th><Th>State</Th><Th /></tr></thead>
            <tbody>
              {p.allocations.map((allocation) => (
                <tr key={allocation.id}>
                  <Td><Link className="text-brand-700 hover:underline" to={`/receivables/${allocation.receivable.id}`}>{allocation.receivable.reference}</Link></Td>
                  <Td>{formatDate(allocation.receivable.dueDate)}</Td>
                  <Td>{formatDateTime(allocation.allocatedAt)}</Td>
                  <Td numeric>{formatMoney(allocation.amount)}</Td>
                  <Td>{allocation.reversedAt ? <StatusBadge status="REVERSED" /> : <StatusBadge status="ACTIVE" />}</Td>
                  <Td>
                    {!allocation.reversedAt && can(user, 'payments.reverse') && allocation.allocatedById !== user.id && (
                      <Button variant="ghost" onClick={() => setDialog({ reverseAllocation: allocation.id })}>Reverse</Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {dialog === 'allocate' && <AllocateDialog payment={p} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'reject' && (
        <ReasonDialog title="Reject receipt" label="Reason for rejecting" confirmLabel="Reject receipt" pending={withReason.isPending} error={withReason.error}
          onSubmit={(reason) => withReason.mutate({ path: `/payments/${id}/reject`, reason })} onClose={() => setDialog(null)} />
      )}
      {dialog === 'reverse' && (
        <ReasonDialog title="Reverse receipt" label="Why is the receipt being reversed (for example returned or bounced)?" confirmLabel="Reverse receipt" pending={withReason.isPending} error={withReason.error}
          onSubmit={(reason) => withReason.mutate({ path: `/payments/${id}/reverse`, reason })} onClose={() => setDialog(null)} />
      )}
      {typeof dialog === 'object' && dialog !== null && (
        <ReasonDialog title="Reverse allocation" label="Why is this allocation being reversed?" confirmLabel="Reverse allocation" pending={withReason.isPending} error={withReason.error}
          onSubmit={(reason) => withReason.mutate({ path: `/payment-allocations/${dialog.reverseAllocation}/reverse`, reason })} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
