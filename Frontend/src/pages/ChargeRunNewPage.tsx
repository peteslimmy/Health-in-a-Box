import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HospitalSelect } from '../components/HospitalSelect';
import { Button, Card, ErrorNotice, Field, Input, Notice, PageHeader, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { ChargePreview, ChargeRun } from '../lib/types';

export function ChargeRunNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [hospitalId, setHospitalId] = useState(params.get('hospitalId') ?? '');
  const [periodStart, setPeriodStart] = useState(params.get('periodStart') ?? '');
  const [periodEnd, setPeriodEnd] = useState(params.get('periodEnd') ?? '');
  const body = { hospitalId, periodStart, periodEnd };

  const preview = useMutation({ mutationFn: () => api<ChargePreview>('/charge-runs/preview', { method: 'POST', body }) });
  const create = useMutation({
    mutationFn: () => api<ChargeRun>('/charge-runs', { method: 'POST', body }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['charge-runs'] });
      navigate(`/charge-runs/${run.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.reset();
    preview.mutate();
  }

  const result = preview.data;
  return (
    <div className="space-y-5">
      <PageHeader title="New charge run" subtitle="Preview first: you will see the rule, rate and amount behind every line. Committed revenue reports inside the period are used, and a revenue line can only be charged once." />
      <Card>
        <form onSubmit={submit} className="grid max-w-3xl gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3"><Field label="Hospital">{(id) => <HospitalSelect id={id} required value={hospitalId} onChange={setHospitalId} />}</Field></div>
          <Field label="Period start">{(id) => <Input id={id} type="date" required value={periodStart} max={periodEnd || undefined} onChange={(event) => setPeriodStart(event.target.value)} />}</Field>
          <Field label="Period end">{(id) => <Input id={id} type="date" required value={periodEnd} min={periodStart || undefined} onChange={(event) => setPeriodEnd(event.target.value)} />}</Field>
          <div className="flex items-end"><Button type="submit" loading={preview.isPending} disabled={!hospitalId || !periodStart || !periodEnd}>Preview charges</Button></div>
        </form>
      </Card>

      <ErrorNotice error={preview.error ?? create.error} />

      {result && (
        <Card
          title={`Preview — ${result.hospital.name}`}
          actions={<Button loading={create.isPending} onClick={() => create.mutate()}>Create draft run</Button>}
        >
          {result.warnings.length > 0 && (
            <div className="mb-3">
              <Notice tone="warn" title="Warnings">
                <ul className="list-disc pl-5">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </Notice>
            </div>
          )}
          <Table caption="Charge preview lines">
            <thead><tr><Th>Department</Th><Th>Channel</Th><Th>Rule</Th><Th numeric>Revenue</Th><Th numeric>Rate</Th><Th numeric>Service charge</Th></tr></thead>
            <tbody>
              {result.lines.map((line, index) => (
                <tr key={index}>
                  <Td>{line.department.name}</Td>
                  <Td>{line.paymentChannel?.name ?? 'All channels'}</Td>
                  <Td>{line.rule?.name ?? '—'}</Td>
                  <Td numeric>{formatMoney(line.baseAmount)}</Td>
                  <Td numeric>{line.rate}%</Td>
                  <Td numeric>{formatMoney(line.chargeAmount)}</Td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <Td>Total</Td><Td /><Td /><Td numeric>{formatMoney(result.baseTotal)}</Td><Td /><Td numeric>{formatMoney(result.chargeTotal)}</Td>
              </tr>
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-slate-500">Each charge line is rounded half-up to 2 decimals; the total is the sum of the rounded lines.</p>
        </Card>
      )}
    </div>
  );
}
