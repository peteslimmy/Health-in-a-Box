import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  KeyValue,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Td,
  Th,
} from '../components/ui';
import { api } from '../lib/api';
import { centreLabel, formatDate } from '../lib/format';
import { can } from '../lib/permissions';
import type { Agreement, CentreDetail, ChargeRule, Department, Page } from '../lib/types';

type Kind = 'departments' | 'channels';

function CodeNameTable({ kind, items, canEdit, centreId }: { kind: Kind; items: Department[]; canEdit: boolean; centreId: string }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', aliases: '' });
  const noun = kind === 'departments' ? 'department' : 'payment channel';

  const add = useMutation({
    mutationFn: () =>
      api(`/centres/${centreId}/${kind}`, {
        method: 'POST',
        body: {
          code: form.code.trim(),
          name: form.name.trim(),
          aliases: form.aliases
            .split(',')
            .map((alias) => alias.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['centre', centreId] });
      setAdding(false);
      setForm({ code: '', name: '', aliases: '' });
    },
  });

  return (
    <Card
      title={kind === 'departments' ? 'Departments (revenue services)' : 'Payment channels (how the centre collected revenue)'}
      actions={
        canEdit && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add {noun}
          </Button>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState title={`No ${kind} yet`} hint="Imports need at least one department and one channel." />
      ) : (
        <Table caption={kind}>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Names used in reports</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td className="font-mono text-xs">{item.code}</Td>
                <Td>{item.name}</Td>
                <Td>{item.aliases.map((alias) => alias.alias).join(', ') || '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && (
        <Modal title={`Add ${noun}`} onClose={() => setAdding(false)}>
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              add.mutate();
            }}
          >
            <Field label="Code">
              {(id) => (
                <Input id={id} required minLength={2} maxLength={30} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
              )}
            </Field>
            <Field label="Name">
              {(id) => <Input id={id} required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
            </Field>
            <Field label="Other names used in reports" hint="Comma separated, e.g. X-Ray, Imaging">
              {(id) => <Input id={id} value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} />}
            </Field>
            <ErrorNotice error={add.error} />
            <div className="flex gap-2">
              <Button type="submit" loading={add.isPending}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

function RulesPanel({ agreement, centre, canManage }: { agreement: Agreement; centre: CentreDetail; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: '',
    departmentId: '',
    paymentChannelId: '',
    rate: '',
    exempt: false,
    effectiveFrom: agreement.effectiveFrom.slice(0, 10),
    effectiveTo: '',
  });
  const rules = useQuery({
    queryKey: ['rules', agreement.id],
    queryFn: () => api<Page<ChargeRule>>(`/agreements/${agreement.id}/charge-rules`, { query: { pageSize: 100 } }),
  });
  const add = useMutation({
    mutationFn: () =>
      api(`/agreements/${agreement.id}/charge-rules`, {
        method: 'POST',
        body: {
          name: form.name.trim(),
          rate: form.exempt ? 0 : Number(form.rate),
          ...(form.exempt && { isExempt: true }),
          effectiveFrom: form.effectiveFrom,
          ...(form.effectiveTo && { effectiveTo: form.effectiveTo }),
          ...(form.departmentId && { departmentId: form.departmentId }),
          ...(form.paymentChannelId && { paymentChannelId: form.paymentChannelId }),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules', agreement.id] });
      setAdding(false);
    },
  });

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">Charge rules</h3>
        {canManage && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add rule
          </Button>
        )}
      </div>
      {rules.isLoading && <Loading />}
      <ErrorNotice error={rules.error} />
      {rules.data && rules.data.items.length === 0 && (
        <EmptyState title="No rules" hint="A revenue line with no applicable rule blocks charge calculation; it is never charged as zero." />
      )}
      {rules.data && rules.data.items.length > 0 && (
        <Table caption="Charge rules">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Applies to</Th>
              <Th numeric>Rate</Th>
              <Th>Effective</Th>
              <Th>Active</Th>
            </tr>
          </thead>
          <tbody>
            {rules.data.items.map((rule) => (
              <tr key={rule.id}>
                <Td>{rule.name}</Td>
                <Td>
                  {rule.department ? rule.department.name : 'Any department'}
                  {' · '}
                  {rule.paymentChannel ? rule.paymentChannel.name : 'any channel'}
                </Td>
                <Td numeric>
                  {rule.isExempt ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">Exempt</span> : `${rule.rate}%`}
                </Td>
                <Td>
                  {formatDate(rule.effectiveFrom)} – {rule.effectiveTo ? formatDate(rule.effectiveTo) : 'open'}
                </Td>
                <Td>{rule.isActive ? 'Yes' : 'No'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && (
        <Modal title="Add charge rule" onClose={() => setAdding(false)}>
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              add.mutate();
            }}
          >
            <Field label="Name">
              {(id) => <Input id={id} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Department" hint="Leave blank for all departments">
                {(id) => (
                  <Select id={id} value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}>
                    <option value="">Any department</option>
                    {centre.departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Payment channel" hint="Leave blank for all channels">
                {(id) => (
                  <Select id={id} value={form.paymentChannelId} onChange={(event) => setForm({ ...form, paymentChannelId: event.target.value })}>
                    <option value="">Any channel</option>
                    {centre.paymentChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Rate (%)" hint={form.exempt ? 'An exempt rule has no rate' : '0 to 100, up to 6 decimals'}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    step="0.000001"
                    min={0}
                    max={100}
                    required={!form.exempt}
                    disabled={form.exempt}
                    value={form.exempt ? '0' : form.rate}
                    onChange={(event) => setForm({ ...form, rate: event.target.value })}
                  />
                )}
              </Field>
              <label className="flex items-start gap-2 self-end pb-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" checked={form.exempt} onChange={(event) => setForm({ ...form, exempt: event.target.checked })} />
                <span>
                  Exempt from the service charge
                  <span className="block text-xs text-slate-500">Revenue covered by this rule is left out of the charge.</span>
                </span>
              </label>
              <Field label="Effective from">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    required
                    value={form.effectiveFrom}
                    onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Effective to" hint="Optional">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    min={form.effectiveFrom}
                    value={form.effectiveTo}
                    onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <Notice tone="neutral">
              The most specific rule wins: department + channel, then department, then channel, then the centre default. Two active rules for the same scope
              cannot overlap.
            </Notice>
            <ErrorNotice error={add.error} />
            <div className="flex gap-2">
              <Button type="submit" loading={add.isPending}>
                Save rule
              </Button>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function CentreDetailPage() {
  const { id = '' } = useParams();
  const user = useUser();
  const queryClient = useQueryClient();
  const centre = useQuery({ queryKey: ['centre', id], queryFn: () => api<CentreDetail>(`/centres/${id}`) });
  const [selectedAgreement, setSelectedAgreement] = useState<string>('');
  const [addingAgreement, setAddingAgreement] = useState(false);
  const [agreementForm, setAgreementForm] = useState({ name: '', effectiveFrom: '', effectiveTo: '' });

  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/centres/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['centre', id] });
      void queryClient.invalidateQueries({ queryKey: ['centres'] });
    },
  });
  const addAgreement = useMutation({
    mutationFn: () =>
      api(`/centres/${id}/agreements`, {
        method: 'POST',
        body: {
          name: agreementForm.name.trim(),
          effectiveFrom: agreementForm.effectiveFrom,
          ...(agreementForm.effectiveTo && { effectiveTo: agreementForm.effectiveTo }),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['centre', id] });
      setAddingAgreement(false);
    },
  });

  if (centre.isLoading) return <Loading />;
  if (centre.error || !centre.data) return <ErrorNotice error={centre.error} />;
  const c = centre.data;
  const canUpdate = can(user, 'centres.update');
  const canManageRules = can(user, 'charge_rules.manage');
  const agreement = c.agreements.find((item) => item.id === (selectedAgreement || c.agreements[0]?.id));
  const readiness: string[] = [];
  if (c.departments.length === 0) readiness.push('Add at least one department.');
  if (c.paymentChannels.length === 0) readiness.push('Add at least one payment channel.');
  if (c.agreements.length === 0) readiness.push('Add a commercial agreement with charge rules.');

  return (
    <div className="space-y-5">
      <PageHeader
        title={centreLabel(c)}
        subtitle={
          <>
            <StatusBadge status={c.status} /> {c.address}
          </>
        }
        actions={
          canUpdate && (
            <>
              {c.status !== 'ACTIVE' && (
                <Button loading={setStatus.isPending} disabled={readiness.length > 0} onClick={() => setStatus.mutate('ACTIVE')}>
                  Activate
                </Button>
              )}
              {c.status === 'ACTIVE' && (
                <Button variant="secondary" loading={setStatus.isPending} onClick={() => setStatus.mutate('SUSPENDED')}>
                  Suspend
                </Button>
              )}
            </>
          )
        }
      />
      <ErrorNotice error={setStatus.error} />
      {c.status !== 'ACTIVE' && (
        <Notice tone="warn" title={`This centre is ${c.status.toLowerCase()}`}>
          Revenue reports, charge runs and receipts cannot be created for it until it is active.
          {readiness.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {readiness.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <Card title="Profile">
        <KeyValue
          items={[
            ['Contact', [c.contactName, c.contactEmail].filter(Boolean).join(' · ') || '—'],
            ['Payment terms', `${c.paymentTermsDays} days from posting`],
            ['Time zone', c.timezone],
            ['Currency', c.currency],
            ['Notes', c.notes],
          ]}
        />
        <p className="mt-3 text-sm">
          <Link className="text-brand-700 hover:underline" to={`/receivables?centreId=${c.id}`}>
            View receivables
          </Link>{' '}
          ·{' '}
          <Link className="text-brand-700 hover:underline" to={`/payments?centreId=${c.id}`}>
            View payments
          </Link>
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <CodeNameTable kind="departments" items={c.departments} canEdit={canUpdate} centreId={c.id} />
        <CodeNameTable kind="channels" items={c.paymentChannels} canEdit={canUpdate} centreId={c.id} />
      </div>

      <Card
        title="Commercial agreement and charge rules"
        actions={
          canManageRules && (
            <Button variant="secondary" onClick={() => setAddingAgreement(true)}>
              Add agreement
            </Button>
          )
        }
      >
        {c.agreements.length === 0 ? (
          <EmptyState title="No agreement yet" hint="Add the agreement first, then its charge rules." />
        ) : (
          <>
            <div className="max-w-md">
              <Field label="Agreement">
                {(fieldId) => (
                  <Select id={fieldId} value={agreement?.id ?? ''} onChange={(event) => setSelectedAgreement(event.target.value)}>
                    {c.agreements.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({formatDate(item.effectiveFrom)} – {item.effectiveTo ? formatDate(item.effectiveTo) : 'open'})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {agreement && <RulesPanel key={agreement.id} agreement={agreement} centre={c} canManage={canManageRules} />}
          </>
        )}
        {addingAgreement && (
          <Modal title="Add commercial agreement" onClose={() => setAddingAgreement(false)}>
            <form
              className="space-y-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                addAgreement.mutate();
              }}
            >
              <Field label="Name">
                {(fieldId) => (
                  <Input
                    id={fieldId}
                    required
                    value={agreementForm.name}
                    onChange={(event) => setAgreementForm({ ...agreementForm, name: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Effective from">
                {(fieldId) => (
                  <Input
                    id={fieldId}
                    type="date"
                    required
                    value={agreementForm.effectiveFrom}
                    onChange={(event) => setAgreementForm({ ...agreementForm, effectiveFrom: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Effective to" hint="Optional">
                {(fieldId) => (
                  <Input
                    id={fieldId}
                    type="date"
                    value={agreementForm.effectiveTo}
                    onChange={(event) => setAgreementForm({ ...agreementForm, effectiveTo: event.target.value })}
                  />
                )}
              </Field>
              <ErrorNotice error={addAgreement.error} />
              <div className="flex gap-2">
                <Button type="submit" loading={addAgreement.isPending}>
                  Save
                </Button>
                <Button variant="secondary" onClick={() => setAddingAgreement(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Modal>
        )}
      </Card>
    </div>
  );
}
