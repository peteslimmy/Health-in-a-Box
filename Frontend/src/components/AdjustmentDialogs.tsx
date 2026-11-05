import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { Page, Receivable } from '../lib/types';
import { HospitalSelect } from './HospitalSelect';
import { Button, ErrorNotice, Field, Input, Modal, Select, Textarea } from './ui';

export const REASON_LABEL: Record<string, string> = {
  BILLING_ERROR: 'Billing error',
  REVENUE_CORRECTION: 'Revenue report corrected',
  AGREED_DISCOUNT: 'Agreed discount',
  WRITE_OFF: 'Write-off',
  LATE_CHARGE: 'Late charge',
  DISPUTE_UPHELD: 'Dispute upheld',
  OTHER: 'Other',
};

export type ReceivableTarget = { id: string; reference: string; balance: string; hospitalId: string };

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['adjustments', 'disputes', 'opening-balances', 'receivable', 'receivables', 'dashboard', 'ageing']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** Picks one open receivable of a hospital. */
function ReceivablePicker({ hospitalId, value, onChange }: { hospitalId: string; value: string; onChange: (id: string, balance: string) => void }) {
  const list = useQuery({
    queryKey: ['receivables', 'picker', hospitalId],
    queryFn: () => api<Page<Receivable>>('/receivables', { query: { hospitalId, openOnly: true, pageSize: 100 } }),
    enabled: !!hospitalId,
  });
  return (
    <Field label="Receivable">
      {(id) => (
        <Select
          id={id}
          required
          value={value}
          disabled={!hospitalId}
          onChange={(event) => onChange(event.target.value, list.data?.items.find((r) => r.id === event.target.value)?.balance ?? '0')}
        >
          <option value="">{hospitalId ? (list.isLoading ? 'Loading…' : 'Select a receivable…') : 'Choose a hospital first'}</option>
          {list.data?.items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.reference} · balance {formatMoney(r.balance)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function useTarget(fixed?: ReceivableTarget) {
  const [hospitalId, setHospitalId] = useState(fixed?.hospitalId ?? '');
  const [receivableId, setReceivableId] = useState(fixed?.id ?? '');
  const [balance, setBalance] = useState(fixed?.balance ?? '0');
  return { hospitalId, receivableId, balance, setHospitalId, setReceivableId, setBalance, fixed };
}

function TargetFields({ target }: { target: ReturnType<typeof useTarget> }) {
  if (target.fixed) {
    return (
      <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {target.fixed.reference} · current balance <strong>{formatMoney(target.fixed.balance)}</strong>
      </p>
    );
  }
  return (
    <>
      <Field label="Hospital">
        {(id) => (
          <HospitalSelect
            id={id}
            required
            value={target.hospitalId}
            onChange={(value) => {
              target.setHospitalId(value);
              target.setReceivableId('');
            }}
          />
        )}
      </Field>
      <ReceivablePicker
        hospitalId={target.hospitalId}
        value={target.receivableId}
        onChange={(id, balance) => {
          target.setReceivableId(id);
          target.setBalance(balance);
        }}
      />
    </>
  );
}

export function AdjustmentDialog({ receivable, onClose }: { receivable?: ReceivableTarget; onClose: () => void }) {
  const refresh = useRefresh();
  const target = useTarget(receivable);
  const [type, setType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('');
  const [reasonCode, setReasonCode] = useState('BILLING_ERROR');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api('/adjustments', { method: 'POST', body: { receivableId: target.receivableId, type, amount, reasonCode, reason } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <Modal title="Propose an adjustment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <TargetFields target={target} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" hint={type === 'CREDIT' ? 'Reduces what the hospital owes' : 'Increases what the hospital owes'}>
            {(id) => (
              <Select id={id} value={type} onChange={(event) => setType(event.target.value as 'CREDIT' | 'DEBIT')}>
                <option value="CREDIT">Credit (reduce)</option>
                <option value="DEBIT">Debit (increase)</option>
              </Select>
            )}
          </Field>
          <Field label="Amount (₦)">
            {(id) => <Input id={id} required inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />}
          </Field>
        </div>
        <Field label="Reason category">
          {(id) => (
            <Select id={id} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
              {Object.entries(REASON_LABEL)
                .filter(([code]) => code !== 'DISPUTE_UPHELD')
                .map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Explanation" hint="At least 10 characters. A second person reads this before approving.">
          {(id) => <Textarea id={id} required minLength={10} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
        <ErrorNotice error={save.error} />
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending} disabled={!target.receivableId || !amount || reason.trim().length < 10}>
            Propose
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-slate-500">Nothing changes the balance until someone else approves it.</p>
      </form>
    </Modal>
  );
}

export function DisputeDialog({ receivable, onClose }: { receivable?: ReceivableTarget; onClose: () => void }) {
  const refresh = useRefresh();
  const target = useTarget(receivable);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api('/disputes', { method: 'POST', body: { receivableId: target.receivableId, amount, reason } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Modal title="Raise a dispute" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
        className="space-y-3"
      >
        <TargetFields target={target} />
        <Field label="Amount in dispute (₦)" hint="The part of the balance the hospital challenges">
          {(id) => <Input id={id} required inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />}
        </Field>
        <Field label="What the hospital says" hint="At least 10 characters">
          {(id) => <Textarea id={id} required minLength={10} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
        <ErrorNotice error={save.error} />
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending} disabled={!target.receivableId || !amount || reason.trim().length < 10}>
            Raise dispute
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-slate-500">The receivable is flagged as disputed until the dispute is resolved. It still counts as owed.</p>
      </form>
    </Modal>
  );
}

export function OpeningBalanceDialog({ onClose }: { onClose: () => void }) {
  const refresh = useRefresh();
  const [hospitalId, setHospitalId] = useState('');
  const [asAt, setAsAt] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const save = useMutation({
    mutationFn: () => api('/opening-balances', { method: 'POST', body: { hospitalId, asAt, amount, dueDate, sourceNote } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Modal title="Propose an opening balance" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
        className="space-y-3"
      >
        <Field label="Hospital">{(id) => <HospitalSelect id={id} required value={hospitalId} onChange={setHospitalId} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stated as at" hint="Must be before the platform's first charge for this hospital">
            {(id) => <Input id={id} type="date" required value={asAt} onChange={(event) => setAsAt(event.target.value)} />}
          </Field>
          <Field label="Due date">
            {(id) => <Input id={id} type="date" required value={dueDate} min={asAt || undefined} onChange={(event) => setDueDate(event.target.value)} />}
          </Field>
        </div>
        <Field label="Amount owed (₦)">
          {(id) => <Input id={id} required inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />}
        </Field>
        <Field label="Source of the figure" hint="For example the signed statement or ledger it was taken from (10+ characters)">
          {(id) => (
            <Textarea id={id} required minLength={10} maxLength={1000} rows={2} value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} />
          )}
        </Field>
        <ErrorNotice error={save.error} />
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending} disabled={!hospitalId || !asAt || !dueDate || !amount || sourceNote.trim().length < 10}>
            Propose
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Asks for a written reason, then runs the action (reject, resolve and similar). */
export function NoteDialog({
  title,
  label,
  confirm,
  onSubmit,
  onClose,
  error,
  pending,
  children,
}: {
  title: string;
  label: string;
  confirm: string;
  onSubmit: (note: string) => void;
  onClose: () => void;
  error?: unknown;
  pending?: boolean;
  children?: React.ReactNode;
}) {
  const [note, setNote] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(note.trim());
        }}
        className="space-y-3"
      >
        {children}
        <Field label={label} hint="At least 5 characters; kept in the audit trail">
          {(id) => <Textarea id={id} required minLength={5} maxLength={1000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />}
        </Field>
        <ErrorNotice error={error} />
        <div className="flex gap-2">
          <Button type="submit" loading={pending} disabled={note.trim().length < 5}>
            {confirm}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
