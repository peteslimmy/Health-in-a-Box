import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useUser } from '../auth/AuthContext';
import { AdjustmentDialog, DisputeDialog } from '../components/AdjustmentDialogs';
import { can } from '../lib/permissions';
import { Button, Card, EmptyState, ErrorNotice, KeyValue, Loading, Notice, PageHeader, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { centreLabel, formatDate, formatDateTime, formatMoney, titleCase } from '../lib/format';
import type { ReceivableDetail } from '../lib/types';

export function ReceivableDetailPage() {
  const { id = '' } = useParams();
  const user = useUser();
  const [dialog, setDialog] = useState<'adjustment' | 'dispute' | null>(null);
  const query = useQuery({ queryKey: ['receivable', id], queryFn: () => api<ReceivableDetail>(`/receivables/${id}`) });
  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorNotice error={query.error} />;
  const r = query.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={r.reference}
        subtitle={
          <>
            <StatusBadge status={r.status} /> <StatusBadge status={r.ageingBucket} /> {r.description}
          </>
        }
        actions={
          Number(r.balance) > 0 && (
            <>
              {can(user, 'adjustments.create') && (
                <Button variant="secondary" onClick={() => setDialog('adjustment')}>
                  Propose adjustment
                </Button>
              )}
              {can(user, 'disputes.manage') && (
                <Button variant="secondary" onClick={() => setDialog('dispute')}>
                  Raise dispute
                </Button>
              )}
            </>
          )
        }
      />
      {r.ledger.consistent ? (
        <Notice tone="good" title="Ledger check passed">
          The balance recorded for this receivable ({formatMoney(r.ledger.storedBalance)}) equals debits minus credits in the ledger (
          {formatMoney(r.ledger.derivedBalance)}).
        </Notice>
      ) : (
        <Notice tone="bad" title="Ledger mismatch">
          The recorded balance {formatMoney(r.ledger.storedBalance)} differs from the ledger-derived balance {formatMoney(r.ledger.derivedBalance)}. Do not rely
          on this balance; report it to an administrator.
        </Notice>
      )}

      <Card title="Summary">
        <KeyValue
          items={[
            [
              'Centre',
              <Link key="c" className="text-brand-700 hover:underline" to={`/centres/${r.centre.id}`}>
                {centreLabel(r.centre)}
              </Link>,
            ],
            ['Due date', formatDate(r.dueDate)],
            ['Days overdue', r.daysOverdue > 0 ? `${r.daysOverdue} (as at ${formatDate(r.asAt)})` : 'Not overdue'],
            ['Original amount', formatMoney(r.originalAmount)],
            ...(r.adjustmentTotal && Number(r.adjustmentTotal) !== 0 ? [['Adjustments (net)', formatMoney(r.adjustmentTotal)] as [string, string]] : []),
            ['Allocated payments', formatMoney(r.amountPaid)],
            ['Balance', <strong key="b">{formatMoney(r.balance)}</strong>],
            [
              'Source',
              r.chargeRun ? (
                <Link key="s" className="text-brand-700 hover:underline" to={`/charge-runs/${r.chargeRun.id}`}>
                  Charge run {formatDate(r.chargeRun.periodStart)} – {formatDate(r.chargeRun.periodEnd)}
                </Link>
              ) : (
                'Earlier per-line posting'
              ),
            ],
          ]}
        />
      </Card>

      <Card title="Ledger">
        <Table caption="Ledger entries">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Description</Th>
              <Th numeric>Debit (owed)</Th>
              <Th numeric>Credit (reduces)</Th>
            </tr>
          </thead>
          <tbody>
            {r.ledgerEntries.map((entry) => (
              <tr key={entry.id}>
                <Td>{formatDateTime(entry.occurredAt)}</Td>
                <Td>{titleCase(entry.type)}</Td>
                <Td>{entry.description}</Td>
                <Td numeric>{Number(entry.debit) > 0 ? formatMoney(entry.debit) : ''}</Td>
                <Td numeric>{Number(entry.credit) > 0 ? formatMoney(entry.credit) : ''}</Td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <Td />
              <Td />
              <Td>Balance</Td>
              <Td numeric>{formatMoney(r.ledger.debit)}</Td>
              <Td numeric>{formatMoney(r.ledger.credit)}</Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Card title="Payments allocated to this receivable">
        {r.allocations.length === 0 ? (
          <EmptyState title="No payments allocated yet" />
        ) : (
          <Table caption="Allocations">
            <thead>
              <tr>
                <Th>Payment</Th>
                <Th>Receipt date</Th>
                <Th>Allocated</Th>
                <Th numeric>Amount</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {r.allocations.map((allocation) => (
                <tr key={allocation.id}>
                  <Td>
                    <Link className="text-brand-700 hover:underline" to={`/payments/${allocation.payment.id}`}>
                      {allocation.payment.reference ?? allocation.payment.id.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td>{formatDate(allocation.payment.receiptDate)}</Td>
                  <Td>{formatDateTime(allocation.allocatedAt)}</Td>
                  <Td numeric>{formatMoney(allocation.amount)}</Td>
                  <Td>{allocation.reversedAt ? <StatusBadge status="REVERSED" /> : <StatusBadge status="ACTIVE" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {dialog === 'adjustment' && (
        <AdjustmentDialog receivable={{ id: r.id, reference: r.reference, balance: r.balance, centreId: r.centre.id }} onClose={() => setDialog(null)} />
      )}
      {dialog === 'dispute' && (
        <DisputeDialog receivable={{ id: r.id, reference: r.reference, balance: r.balance, centreId: r.centre.id }} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
