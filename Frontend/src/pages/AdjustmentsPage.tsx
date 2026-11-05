import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { AdjustmentDialog, DisputeDialog, NoteDialog, OpeningBalanceDialog, REASON_LABEL } from '../components/AdjustmentDialogs';
import { Button, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, Pagination, Select, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import { can } from '../lib/permissions';
import type { AdjustmentItem, DisputeItem, OpeningBalanceItem, Page } from '../lib/types';

type Tab = 'adjustments' | 'disputes' | 'opening-balances';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'adjustments', label: 'Adjustments' },
  { id: 'disputes', label: 'Disputes' },
  { id: 'opening-balances', label: 'Opening balances' },
];

export function AdjustmentsPage() {
  const user = useUser();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'adjustments') as Tab;
  const status = params.get('status') ?? '';
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'adjustment' | 'dispute' | 'opening' | null>(null);
  const [reject, setReject] = useState<{ kind: 'adjustments' | 'opening-balances'; id: string } | null>(null);
  const [resolve, setResolve] = useState<DisputeItem | null>(null);
  const [outcome, setOutcome] = useState<'UPHELD' | 'REJECTED' | 'WITHDRAWN'>('UPHELD');
  const [proposeCredit, setProposeCredit] = useState(true);

  const list = useQuery({
    queryKey: [tab, status, page],
    queryFn: () => api<Page<AdjustmentItem | DisputeItem | OpeningBalanceItem>>(`/${tab}`, { query: { status, page, pageSize: 20 } }),
    enabled: can(user, tab === 'disputes' ? 'disputes.read' : 'adjustments.read'),
  });

  const refresh = () => {
    for (const key of ['adjustments', 'disputes', 'opening-balances', 'receivables', 'receivable', 'dashboard', 'ageing']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
  const approve = useMutation({
    mutationFn: (input: { kind: 'adjustments' | 'opening-balances'; id: string }) => api(`/${input.kind}/${input.id}/approve`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const decline = useMutation({
    mutationFn: (input: { kind: 'adjustments' | 'opening-balances'; id: string; note: string }) =>
      api(`/${input.kind}/${input.id}/reject`, { method: 'POST', body: { note: input.note } }),
    onSuccess: () => {
      refresh();
      setReject(null);
    },
  });
  const resolveDispute = useMutation({
    mutationFn: (input: { id: string; note: string }) =>
      api(`/disputes/${input.id}/resolve`, { method: 'POST', body: { outcome, note: input.note, proposeCredit: outcome === 'UPHELD' && proposeCredit } }),
    onSuccess: () => {
      refresh();
      setResolve(null);
    },
  });

  const canApprove = can(user, 'adjustments.approve');
  const statusOptions = tab === 'disputes' ? ['OPEN', 'UPHELD', 'REJECTED', 'WITHDRAWN'] : ['PENDING', 'APPROVED', 'REJECTED'];
  const select = (next: Tab) => {
    setPage(1);
    setParams(next === 'adjustments' ? {} : { tab: next }, { replace: true });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Adjustments, disputes and opening balances"
        subtitle="Changes to what a hospital owes, with a reason and a second person's approval. Nothing is edited or deleted: every change is a new ledger entry."
        actions={
          <>
            {tab === 'adjustments' && can(user, 'adjustments.create') && <Button onClick={() => setDialog('adjustment')}>Propose adjustment</Button>}
            {tab === 'disputes' && can(user, 'disputes.manage') && <Button onClick={() => setDialog('dispute')}>Raise dispute</Button>}
            {tab === 'opening-balances' && can(user, 'adjustments.create') && <Button onClick={() => setDialog('opening')}>Propose opening balance</Button>}
          </>
        }
      />

      <div role="tablist" aria-label="Sections" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => select(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto pb-1">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setPage(1);
              setParams({ ...(tab === 'adjustments' ? {} : { tab }), ...(event.target.value ? { status: event.target.value } : {}) }, { replace: true });
            }}
          >
            <option value="">All statuses</option>
            {statusOptions.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorNotice error={approve.error} />
      {tab === 'adjustments' && approve.isSuccess && <Notice tone="good">Approved and posted to the ledger.</Notice>}

      <Card>
        {list.isLoading && <Loading />}
        <ErrorNotice error={list.error} />
        {list.data && list.data.items.length === 0 && <EmptyState title="Nothing here yet" hint="Items proposed or raised will appear here." />}

        {list.data && list.data.items.length > 0 && tab === 'adjustments' && (
          <Table caption="Adjustments">
            <thead>
              <tr>
                <Th>Proposed</Th>
                <Th>Receivable</Th>
                <Th>Type</Th>
                <Th numeric>Amount</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(list.data.items as AdjustmentItem[]).map((item) => (
                <tr key={item.id}>
                  <Td>
                    {formatDate(item.createdAt)}
                    <div className="text-xs text-slate-500">{item.createdBy.fullName}</div>
                  </Td>
                  <Td>
                    <Link className="text-brand-700 hover:underline" to={`/receivables/${item.receivable.id}`}>
                      {item.receivable.reference}
                    </Link>
                    <div className="text-xs text-slate-500">{item.hospital.name} ({item.hospital.code})</div>
                  </Td>
                  <Td>
                    <StatusBadge status={item.type} />
                  </Td>
                  <Td numeric>{formatMoney(item.amount)}</Td>
                  <Td className="max-w-xs">
                    <span className="font-medium">{REASON_LABEL[item.reasonCode] ?? item.reasonCode}</span>
                    <div className="text-xs text-slate-600">{item.reason}</div>
                    {item.decisionNote && <div className="text-xs text-red-700">Rejected: {item.decisionNote}</div>}
                  </Td>
                  <Td>
                    <StatusBadge status={item.status} />
                    {item.decidedBy && <div className="text-xs text-slate-500">by {item.decidedBy.fullName}</div>}
                  </Td>
                  <Td>
                    {item.status === 'PENDING' && canApprove && item.createdBy.id !== user.id && (
                      <div className="flex gap-1">
                        <Button
                          loading={approve.isPending && approve.variables?.id === item.id}
                          onClick={() => approve.mutate({ kind: 'adjustments', id: item.id })}
                        >
                          Approve
                        </Button>
                        <Button variant="secondary" onClick={() => setReject({ kind: 'adjustments', id: item.id })}>
                          Reject
                        </Button>
                      </div>
                    )}
                    {item.status === 'PENDING' && item.createdBy.id === user.id && <span className="text-xs text-slate-500">Waiting for another approver</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {list.data && list.data.items.length > 0 && tab === 'disputes' && (
          <Table caption="Disputes">
            <thead>
              <tr>
                <Th>Raised</Th>
                <Th>Receivable</Th>
                <Th numeric>Amount in dispute</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(list.data.items as DisputeItem[]).map((item) => (
                <tr key={item.id}>
                  <Td>
                    {formatDate(item.raisedAt)}
                    <div className="text-xs text-slate-500">{item.raisedBy.fullName}</div>
                  </Td>
                  <Td>
                    <Link className="text-brand-700 hover:underline" to={`/receivables/${item.receivable.id}`}>
                      {item.receivable.reference}
                    </Link>
                    <div className="text-xs text-slate-500">{item.hospital.name} ({item.hospital.code})</div>
                  </Td>
                  <Td numeric>{formatMoney(item.amount)}</Td>
                  <Td className="max-w-xs">
                    {item.reason}
                    {item.resolutionNote && <div className="text-xs text-slate-600">Outcome: {item.resolutionNote}</div>}
                  </Td>
                  <Td>
                    <StatusBadge status={item.status === 'OPEN' ? 'PENDING' : item.status} />
                    <div className="text-xs text-slate-500">{item.status.toLowerCase()}</div>
                  </Td>
                  <Td>
                    {item.status === 'OPEN' && can(user, 'disputes.manage') && (
                      <Button variant="secondary" onClick={() => setResolve(item)}>
                        Resolve
                      </Button>
                    )}
                    {item.adjustmentId && (
                      <Link className="text-xs text-brand-700 underline" to="/adjustments">
                        Credit proposed
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {list.data && list.data.items.length > 0 && tab === 'opening-balances' && (
          <Table caption="Opening balances">
            <thead>
              <tr>
                <Th>As at</Th>
                <Th>Hospital</Th>
                <Th numeric>Amount</Th>
                <Th>Due</Th>
                <Th>Source</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(list.data.items as OpeningBalanceItem[]).map((item) => (
                <tr key={item.id}>
                  <Td>{formatDate(item.asAt)}</Td>
                  <Td>{item.hospital.name} <span className="text-xs text-slate-500">({item.hospital.code})</span></Td>
                  <Td numeric>{formatMoney(item.amount)}</Td>
                  <Td>{formatDate(item.dueDate)}</Td>
                  <Td className="max-w-xs text-xs text-slate-600">
                    {item.sourceNote}
                    <div className="text-slate-500">proposed by {item.createdBy.fullName}</div>
                    {item.decisionNote && <div className="text-red-700">Rejected: {item.decisionNote}</div>}
                  </Td>
                  <Td>
                    <StatusBadge status={item.status} />
                    {item.receivable && (
                      <div>
                        <Link className="text-xs text-brand-700 underline" to={`/receivables/${item.receivable.id}`}>
                          {item.receivable.reference}
                        </Link>
                      </div>
                    )}
                  </Td>
                  <Td>
                    {item.status === 'PENDING' && canApprove && item.createdBy.id !== user.id && (
                      <div className="flex gap-1">
                        <Button
                          loading={approve.isPending && approve.variables?.id === item.id}
                          onClick={() => approve.mutate({ kind: 'opening-balances', id: item.id })}
                        >
                          Approve
                        </Button>
                        <Button variant="secondary" onClick={() => setReject({ kind: 'opening-balances', id: item.id })}>
                          Reject
                        </Button>
                      </div>
                    )}
                    {item.status === 'PENDING' && item.createdBy.id === user.id && <span className="text-xs text-slate-500">Waiting for another approver</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />}
      </Card>

      {dialog === 'adjustment' && <AdjustmentDialog onClose={() => setDialog(null)} />}
      {dialog === 'dispute' && <DisputeDialog onClose={() => setDialog(null)} />}
      {dialog === 'opening' && <OpeningBalanceDialog onClose={() => setDialog(null)} />}

      {reject && (
        <NoteDialog
          title="Reject"
          label="Why is it rejected?"
          confirm="Reject"
          pending={decline.isPending}
          error={decline.error}
          onClose={() => setReject(null)}
          onSubmit={(note) => decline.mutate({ ...reject, note })}
        />
      )}
      {resolve && (
        <NoteDialog
          title={`Resolve dispute on ${resolve.receivable.reference}`}
          label="Outcome and reasoning"
          confirm="Resolve"
          pending={resolveDispute.isPending}
          error={resolveDispute.error}
          onClose={() => setResolve(null)}
          onSubmit={(note) => resolveDispute.mutate({ id: resolve.id, note })}
        >
          <label className="block text-sm font-medium text-slate-700">
            Outcome
            <Select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
              <option value="UPHELD">Upheld: the hospital is right</option>
              <option value="REJECTED">Rejected: the charge stands</option>
              <option value="WITHDRAWN">Withdrawn by the hospital</option>
            </Select>
          </label>
          {outcome === 'UPHELD' && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={proposeCredit} onChange={(event) => setProposeCredit(event.target.checked)} />
              <span>
                Also propose a credit of {formatMoney(resolve.amount)} for approval
                <span className="block text-xs text-slate-500">The balance changes only once a second person approves the credit.</span>
              </span>
            </label>
          )}
        </NoteDialog>
      )}
    </div>
  );
}
