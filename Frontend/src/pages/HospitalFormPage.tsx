import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorNotice, Field, Input, Notice, PageHeader, Textarea } from '../components/ui';
import { api } from '../lib/api';
import type { Hospital } from '../lib/types';

export function HospitalFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: '',
    name: '',
    address: '',
    contactName: '',
    contactEmail: '',
    paymentTermsDays: '30',
    timezone: 'Africa/Lagos',
    notes: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((value) => ({ ...value, [key]: event.target.value }));

  const create = useMutation({
    mutationFn: () =>
      api<Hospital>('/hospitals', {
        method: 'POST',
        body: {
          code: form.code.trim(),
          name: form.name.trim(),
          ...(form.address.trim() && { address: form.address.trim() }),
          ...(form.contactName.trim() && { contactName: form.contactName.trim() }),
          ...(form.contactEmail.trim() && { contactEmail: form.contactEmail.trim() }),
          ...(form.notes.trim() && { notes: form.notes.trim() }),
          timezone: form.timezone.trim(),
          paymentTermsDays: Number(form.paymentTermsDays),
          status: 'DRAFT',
        },
      }),
    onSuccess: (hospital) => {
      void queryClient.invalidateQueries({ queryKey: ['hospitals'] });
      navigate(`/hospitals/${hospital.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div>
      <PageHeader title="New hospital" subtitle="The hospital is created as a draft. Add its departments, payment channels and charge rules, then activate it." />
      <Card>
        <form onSubmit={submit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field label="Code" hint="Unique, e.g. HNB-LAG-001">{(id) => <Input id={id} required minLength={2} maxLength={20} value={form.code} onChange={set('code')} />}</Field>
          <Field label="Name">{(id) => <Input id={id} required minLength={2} maxLength={120} value={form.name} onChange={set('name')} />}</Field>
          <Field label="Contact name">{(id) => <Input id={id} value={form.contactName} onChange={set('contactName')} />}</Field>
          <Field label="Contact email">{(id) => <Input id={id} type="email" value={form.contactEmail} onChange={set('contactEmail')} />}</Field>
          <Field label="Payment terms (days)" hint="Due date = posting date + this many days">
            {(id) => <Input id={id} type="number" min={0} max={365} required value={form.paymentTermsDays} onChange={set('paymentTermsDays')} />}
          </Field>
          <Field label="Time zone" hint="Business day used for dates">{(id) => <Input id={id} required value={form.timezone} onChange={set('timezone')} />}</Field>
          <div className="sm:col-span-2"><Field label="Address">{(id) => <Input id={id} value={form.address} onChange={set('address')} />}</Field></div>
          <div className="sm:col-span-2"><Field label="Notes">{(id) => <Textarea id={id} rows={3} value={form.notes} onChange={set('notes')} />}</Field></div>
          <div className="space-y-3 sm:col-span-2">
            <ErrorNotice error={create.error} />
            <Notice tone="neutral">Rates and agreements are added after the hospital is created, from the hospital page.</Notice>
            <div className="flex gap-2">
              <Button type="submit" loading={create.isPending}>Create hospital</Button>
              <Button variant="secondary" onClick={() => navigate('/hospitals')}>Cancel</Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
