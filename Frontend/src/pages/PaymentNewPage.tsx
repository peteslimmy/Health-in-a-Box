import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CentreSelect } from '../components/CentreSelect';
import { Button, Card, ErrorNotice, Field, Input, Notice, PageHeader, Select, Textarea } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { isValidAmount, todayIso } from '../lib/format';
import type { Payment } from '../lib/types';

const METHODS = ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'POS', 'OTHER'];

export function PaymentNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ centreId: '', receiptDate: todayIso(), amount: '', method: 'BANK_TRANSFER', reference: '', payerName: '', notes: '' });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm((value) => ({ ...value, [key]: event.target.value }));
  };
  const amountOk = isValidAmount(form.amount);

  const create = useMutation({
    // confirm is passed per call, so a retry after the duplicate warning is never stale.
    mutationFn: (confirm: boolean) =>
      api<Payment>('/payments', {
        method: 'POST',
        body: {
          centreId: form.centreId,
          receiptDate: form.receiptDate,
          amount: form.amount.trim(),
          method: form.method,
          ...(form.reference.trim() && { reference: form.reference.trim() }),
          ...(form.payerName.trim() && { payerName: form.payerName.trim() }),
          ...(form.notes.trim() && { notes: form.notes.trim() }),
          ...(confirm && { confirmPossibleDuplicate: true }),
        },
      }),
    onSuccess: (payment) => {
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      navigate(`/payments/${payment.id}`);
    },
  });

  const possibleDuplicate = create.error instanceof ApiError && create.error.code === 'POSSIBLE_DUPLICATE_PAYMENT';

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(false);
  }

  return (
    <div>
      <PageHeader title="Record a receipt" subtitle="Record money actually received from a centre toward its service charge. It starts as a draft; you submit it, and a different person approves and posts it." />
      <Card>
        <form onSubmit={submit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Paying centre">{(id) => <CentreSelect id={id} required value={form.centreId} onChange={(value) => set('centreId')({ target: { value } })} />}</Field></div>
          <Field label="Receipt date" hint="The day the money was received; cannot be in the future">{(id) => <Input id={id} type="date" required max={todayIso()} value={form.receiptDate} onChange={set('receiptDate')} />}</Field>
          <Field label="Amount (NGN)" error={form.amount && !amountOk ? 'Enter a positive amount with at most two decimals.' : undefined}>
            {(id) => <Input id={id} inputMode="decimal" required placeholder="250000.00" value={form.amount} onChange={set('amount')} />}
          </Field>
          <Field label="Method">{(id) => <Select id={id} value={form.method} onChange={set('method')}>{METHODS.map((method) => <option key={method} value={method}>{method.replaceAll('_', ' ').toLowerCase()}</option>)}</Select>}</Field>
          <Field label="Bank or payment reference" hint="A repeated reference for the same centre is blocked">{(id) => <Input id={id} value={form.reference} onChange={set('reference')} />}</Field>
          <div className="sm:col-span-2"><Field label="Payer name">{(id) => <Input id={id} value={form.payerName} onChange={set('payerName')} />}</Field></div>
          <div className="sm:col-span-2"><Field label="Notes">{(id) => <Textarea id={id} rows={3} value={form.notes} onChange={set('notes')} />}</Field></div>
          <div className="space-y-3 sm:col-span-2">
            {possibleDuplicate ? (
              <Notice tone="warn" title="This may be a duplicate">
                A receipt for the same centre, date and amount already exists. If this is a different payment, confirm and record it anyway.
                <div className="mt-2"><Button variant="secondary" onClick={() => create.mutate(true)}>It is a different payment — record it</Button></div>
              </Notice>
            ) : (
              <ErrorNotice error={create.error} />
            )}
            <div className="flex gap-2">
              <Button type="submit" loading={create.isPending} disabled={!form.centreId || !amountOk}>Save draft receipt</Button>
              <Button variant="secondary" onClick={() => navigate('/payments')}>Cancel</Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
