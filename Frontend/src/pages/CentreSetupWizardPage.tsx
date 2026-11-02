import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorNotice, Field, Input, Loading, Notice, PageHeader, cx } from '../components/ui';
import { api } from '../lib/api';
import { centreLabel, formatDate, formatMoney, firstOfMonthIso } from '../lib/format';

type Profile = {
  source: {
    fileName: string;
    kind: string;
    title: string | null;
    printedAt: string | null;
    printDate: string | null;
    period: { start: string; end: string } | null;
    pages: number | null;
    setAsideLines: string[];
  };
  centre: { suggestedName: string; suggestedCode: string; printedNumber: string | null };
  departments: Array<{ rowNumber: number; printedName: string; name: string; code: string; total: string }>;
  channels: Array<{ printedHeading: string; name: string; code: string; total: string; hasActivity: boolean }>;
  grandTotal: string;
  tally: { ok: boolean; problems: Array<{ row?: number; message: string }> };
  notes: string[];
};
type Analysis = {
  draftId: string;
  profile: Profile;
  existingMatches: Array<{ id: string; code: string; name: string; reason: string }>;
};
type OpenDraft = { id: string; fileName: string; createdAt: string; suggestedName: string; departments: number; channels: number };
type Item = { printedName: string; name: string; code: string; total: string; include: boolean; extra?: string };
type CommitResult = {
  centre: { id: string; code: string; name: string; status: string };
  counts: { departments: number; channels: number };
  termsCreated: boolean;
  import: { id: string; status: string } | null;
  importError: string | null;
};

const STEPS = ['Upload report', 'What was found', 'Centre', 'Departments', 'Payment channels', 'Service charge', 'Review and create'] as const;
const CENTRE_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,19}$/;
const ITEM_CODE = /^[A-Za-z0-9][A-Za-z0-9_]{1,25}$/;
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function titleCase(value: string): string {
  const small = new Set(['of', 'and', 'the', 'for', 'in', 'at']);
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (index > 0 && small.has(word)) return word;
      return word.replace(/(^|[(\-/&])([a-z])/g, (_m, lead: string, letter: string) => lead + letter.toUpperCase());
    })
    .join(' ');
}

/** `2026-10-26T18:14` (local time as printed on the report) -> `26 Oct 2026, 6:14 pm`. */
function formatPrinted(value: string | null): string {
  if (!value) return 'Not printed on the report';
  const [date, time] = value.split('T');
  const [h, m] = time.split(':').map(Number);
  return `${formatDate(date)}, ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Problems with a list of departments or channels: bad or repeated codes and names. */
function listProblems(items: Item[], kind: string): string[] {
  const problems: string[] = [];
  const codes = new Map<string, number>();
  const names = new Map<string, number>();
  for (const item of items.filter((i) => i.include)) {
    if (!ITEM_CODE.test(item.code)) problems.push(`The ${kind} code "${item.code}" must be 2 to 26 letters, digits or underscores.`);
    if (!squash(item.name)) problems.push(`A ${kind} has no name.`);
    codes.set(item.code.toUpperCase(), (codes.get(item.code.toUpperCase()) ?? 0) + 1);
    names.set(squash(item.name), (names.get(squash(item.name)) ?? 0) + 1);
  }
  for (const [code, n] of codes) if (n > 1) problems.push(`The ${kind} code ${code} is used ${n} times.`);
  for (const [name, n] of names) if (n > 1 && name) problems.push(`"${name}" is listed ${n} times as a ${kind} name.`);
  return problems;
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2" aria-label="Set-up steps">
      {STEPS.map((label, index) => {
        const state = index < step ? 'done' : index === step ? 'current' : 'todo';
        return (
          <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-2 pr-3 text-sm">
            <span
              className={cx(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                state === 'done' && 'bg-emerald-600 text-white',
                state === 'current' && 'bg-brand-600 text-white ring-4 ring-brand-100',
                state === 'todo' && 'bg-slate-200 text-slate-600',
              )}
            >
              {state === 'done' ? '✓' : index + 1}
            </span>
            <span className={cx(state === 'current' ? 'font-semibold text-slate-900' : 'text-slate-500', state === 'todo' && 'hidden md:inline')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Fact({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function ItemTable({
  items,
  onChange,
  kind,
  showTotal,
  extraLabel,
}: {
  items: Item[];
  onChange: (items: Item[]) => void;
  kind: 'department' | 'channel';
  showTotal?: boolean;
  extraLabel?: string;
}) {
  const [filter, setFilter] = useState('');
  const set = (index: number, patch: Partial<Item>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const visible = items.map((item, index) => ({ item, index })).filter(({ item }) => !filter || squash(item.name + item.printedName + item.code).includes(squash(filter)));
  const included = items.filter((i) => i.include).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label={`Filter ${kind}s`} placeholder={`Filter ${kind}s…`} className="max-w-xs" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <Button variant="secondary" onClick={() => onChange(items.map((i) => ({ ...i, name: titleCase(i.name) })))}>
          Tidy capitalisation
        </Button>
        <Button variant="secondary" onClick={() => onChange(items.map((i) => ({ ...i, include: true })))}>
          Include all
        </Button>
        <span className="ml-auto text-sm text-slate-600">
          {included} of {items.length} included
        </span>
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <caption className="sr-only">{kind === 'department' ? 'Departments' : 'Payment channels'} found in the report</caption>
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Include</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Code</th>
              {showTotal && <th className="px-3 py-2 text-right">In this report</th>}
              {extraLabel && <th className="px-3 py-2">{extraLabel}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map(({ item, index }) => (
              <tr key={index} className={cx(!item.include && 'bg-slate-50 text-slate-400')}>
                <td className="px-3 py-1.5">
                  <input type="checkbox" aria-label={`Include ${item.printedName}`} checked={item.include} onChange={(event) => set(index, { include: event.target.checked })} />
                </td>
                <td className="px-3 py-1.5">
                  <Input aria-label={`Name of ${item.printedName}`} value={item.name} disabled={!item.include} onChange={(event) => set(index, { name: event.target.value })} />
                  {squash(item.name) !== squash(item.printedName) && <p className="mt-0.5 text-xs text-slate-500">Reports will also match “{item.printedName}”.</p>}
                </td>
                <td className="px-3 py-1.5">
                  <Input aria-label={`Code of ${item.printedName}`} className="font-mono" value={item.code} disabled={!item.include} onChange={(event) => set(index, { code: event.target.value.toUpperCase() })} />
                </td>
                {showTotal && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatMoney(item.total)}</td>}
                {extraLabel && <td className="px-3 py-1.5 text-xs">{item.extra}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CentreSetupWizardPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [centre, setCentre] = useState({ code: '', name: '', address: '', timezone: 'Africa/Lagos', paymentTermsDays: '30', gracePeriodDays: '0' });
  const [departments, setDepartments] = useState<Item[]>([]);
  const [channels, setChannels] = useState<Item[]>([]);
  const [terms, setTerms] = useState({ enabled: false, name: '', rate: '', from: '' });
  const [options, setOptions] = useState({ activate: true, importNow: true });
  const [result, setResult] = useState<CommitResult | null>(null);

  const open = useQuery({ queryKey: ['centre-setup-drafts'], queryFn: () => api<OpenDraft[]>('/centre-setup') });

  function adopt(next: Analysis) {
    const { profile } = next;
    setAnalysis(next);
    setCentre({ code: profile.centre.suggestedCode, name: profile.centre.suggestedName, address: '', timezone: 'Africa/Lagos', paymentTermsDays: '30', gracePeriodDays: '0' });
    setDepartments(profile.departments.map((d) => ({ printedName: d.printedName, name: d.name, code: d.code, total: d.total, include: true })));
    setChannels(
      profile.channels.map((c) => ({ printedName: c.printedHeading, name: c.name, code: c.code, total: c.total, include: true, extra: c.hasActivity ? '' : 'No amounts in this report' })),
    );
    setTerms({ enabled: false, name: `${(profile.source.period?.start ?? firstOfMonthIso()).slice(0, 4)} service agreement`, rate: '', from: profile.source.period?.start ?? firstOfMonthIso() });
    setStep(1);
  }

  const analyse = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set('file', file!);
      return api<Analysis>('/centre-setup/analyse', { method: 'POST', form });
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['centre-setup-drafts'] });
      adopt(data);
    },
  });
  const resume = useMutation({ mutationFn: (id: string) => api<Analysis>(`/centre-setup/${id}`), onSuccess: adopt });
  const discard = useMutation({
    mutationFn: (id: string) => api(`/centre-setup/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['centre-setup-drafts'] }),
  });
  const commit = useMutation({
    mutationFn: () =>
      api<CommitResult>(`/centre-setup/${analysis!.draftId}/commit`, {
        method: 'POST',
        body: {
          centre: {
            code: centre.code.trim(),
            name: centre.name.trim(),
            ...(centre.address.trim() && { address: centre.address.trim() }),
            timezone: centre.timezone.trim(),
            paymentTermsDays: Number(centre.paymentTermsDays),
            gracePeriodDays: Number(centre.gracePeriodDays),
          },
          departments: includedDepartments.map(({ printedName, name, code }) => ({ printedName, name: name.trim(), code })),
          channels: includedChannels.map(({ printedName, name, code }) => ({ printedName, name: name.trim(), code })),
          ...(terms.enabled && { terms: { agreementName: terms.name.trim(), ratePercent: Number(terms.rate), effectiveFrom: terms.from } }),
          activate: terms.enabled && options.activate,
          importNow: terms.enabled && options.activate && options.importNow,
        },
      }),
    onSuccess: (data) => {
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: ['centres'] });
      void queryClient.invalidateQueries({ queryKey: ['centre-setup-drafts'] });
    },
  });

  const includedDepartments = useMemo(() => departments.filter((d) => d.include), [departments]);
  const includedChannels = useMemo(() => channels.filter((c) => c.include), [channels]);

  const centreProblems: string[] = [];
  if (!CENTRE_CODE.test(centre.code.trim())) centreProblems.push('The centre code must be 2 to 20 letters, digits, dashes or underscores.');
  if (centre.name.trim().length < 2) centreProblems.push('The centre needs a name.');
  const days = (value: string, max: number) => /^\d+$/.test(value) && Number(value) <= max;
  if (!days(centre.paymentTermsDays, 365)) centreProblems.push('Payment terms must be a whole number of days, up to 365.');
  if (!days(centre.gracePeriodDays, 90)) centreProblems.push('The grace period must be a whole number of days, up to 90.');
  const departmentProblems = [...listProblems(departments, 'department'), ...(includedDepartments.length === 0 ? ['Include at least one department.'] : [])];
  const channelProblems = [...listProblems(channels, 'payment channel'), ...(includedChannels.length === 0 ? ['Include at least one payment channel.'] : [])];
  const termsProblems: string[] = [];
  if (terms.enabled) {
    const rate = Number(terms.rate);
    if (terms.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) termsProblems.push('Enter the service charge as a percentage between 0 and 100.');
    if (terms.name.trim().length < 2) termsProblems.push('Name the agreement.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(terms.from)) termsProblems.push('Choose the date the agreement starts.');
  }
  const blockers = [[], [], centreProblems, departmentProblems, channelProblems, termsProblems, []] as string[][];
  const canNext = step < STEPS.length - 1 && (blockers[step] ?? []).length === 0;

  function onUpload(event: FormEvent) {
    event.preventDefault();
    analyse.mutate();
  }

  if (result) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Centre created" />
        <Card>
          <Notice tone="good" title={`${centreLabel(result.centre)} is set up`}>
            {result.counts.departments} departments and {result.counts.channels} payment channels were created
            {result.termsCreated ? ', with its service-charge terms' : ''}. The centre is {result.centre.status === 'ACTIVE' ? 'active' : 'in draft until its terms are added and it is activated'}.
          </Notice>
          {result.import && (
            <Notice tone="info" title="The report was uploaded and checked">
              It is waiting for review before any figures are posted.{' '}
              <Link className="font-medium text-brand-700 underline" to={`/imports/${result.import.id}`}>
                Open the import
              </Link>
            </Notice>
          )}
          {result.importError && (
            <Notice tone="warn" title="The centre was created, but the report was not imported">
              {result.importError}. You can upload it from Revenue imports.
            </Notice>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={`/centres/${result.centre.id}`}><Button>Open the centre</Button></Link>
            <Button variant="secondary" onClick={() => { setResult(null); setAnalysis(null); setFile(null); setStep(0); }}>
              Set up another centre
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const profile = analysis?.profile;
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Set up a centre from a report"
        subtitle="Upload a revenue report and this wizard proposes the centre, its departments and payment channels. You review and adjust every step before anything is created. Only a super admin can use it."
      />
      <Card>
        <Stepper step={step} />
      </Card>

      {step === 0 && (
        <>
          <Card title="1. Upload a report from the centre">
            <form onSubmit={onUpload} className="space-y-4">
              <Field label="Report file" hint="PDF, CSV or XLSX, up to 15 MB. Nothing is created yet; the file is read and kept as a draft.">
                {(id) => <Input id={id} type="file" accept=".pdf,.csv,.xlsx,application/pdf,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
              </Field>
              <ErrorNotice error={analyse.error} />
              <Button type="submit" loading={analyse.isPending} disabled={!file}>
                Read the report
              </Button>
            </form>
          </Card>
          {open.isLoading && <Loading />}
          {open.data && open.data.length > 0 && (
            <Card title="Unfinished set-ups">
              <ul className="divide-y divide-slate-100">
                {open.data.map((draft) => (
                  <li key={draft.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="font-medium">{draft.suggestedName}</span>
                      <span className="block text-xs text-slate-500">
                        {draft.fileName} · {draft.departments} departments · {draft.channels} channels · read {formatDate(draft.createdAt)}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <Button variant="secondary" loading={resume.isPending && resume.variables === draft.id} onClick={() => resume.mutate(draft.id)}>Continue</Button>
                      <Button variant="ghost" onClick={() => discard.mutate(draft.id)}>Discard</Button>
                    </span>
                  </li>
                ))}
              </ul>
              <ErrorNotice error={resume.error ?? discard.error} />
            </Card>
          )}
        </>
      )}

      {step > 0 && profile && (
        <Card title={`${step + 1}. ${STEPS[step]}`}>
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Centre named on the report" value={profile.source.title ?? 'No title found'} />
                <Fact label="Centre number" value={profile.centre.printedNumber ?? 'None printed'} hint={profile.centre.printedNumber ? undefined : 'A code is suggested instead; you can change it.'} />
                <Fact label="Period covered" value={profile.source.period ? `${formatDate(profile.source.period.start)} – ${formatDate(profile.source.period.end)}` : 'Not stated'} />
                <Fact label="Report produced at the source" value={formatPrinted(profile.source.printedAt)} />
                <Fact label="Departments" value={profile.departments.length} />
                <Fact label="Payment channels" value={`${profile.channels.length} (${profile.channels.filter((c) => c.hasActivity).length} with amounts)`} />
                <Fact label="Grand total in the report" value={formatMoney(profile.grandTotal)} />
                <Fact label="File" value={profile.source.fileName} hint={`${profile.source.kind}${profile.source.pages ? `, ${profile.source.pages} pages` : ''}`} />
              </div>
              {analysis!.existingMatches.length > 0 && (
                <Notice tone="warn" title="A matching centre already exists">
                  {analysis!.existingMatches.map((m) => `${centreLabel(m)}: ${m.reason.toLowerCase()}`).join('; ')}. This wizard creates new centres. To add departments to an existing centre, upload the report as an import and tick “add missing departments and channels”.
                </Notice>
              )}
              {profile.tally.ok ? (
                <Notice tone="good" title="The report's totals add up">Every department and channel total agrees with the grand total.</Notice>
              ) : (
                <Notice tone="warn" title="The totals in this report do not add up">
                  <p>Setting up the centre does not depend on this, but the report cannot be imported until the centre sends a corrected one.</p>
                  <ul className="mt-1 list-disc pl-5">
                    {profile.tally.problems.slice(0, 6).map((p, i) => (
                      <li key={i}>{p.message}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              {profile.notes.map((note) => (
                <Notice key={note} tone="neutral">{note}</Notice>
              ))}
              {profile.source.setAsideLines.length > 0 && (
                <details className="text-sm text-slate-600">
                  <summary className="cursor-pointer">Text on the report that was set aside ({profile.source.setAsideLines.length})</summary>
                  <ul className="mt-1 list-disc pl-5">{profile.source.setAsideLines.map((line, i) => <li key={i}>{line}</li>)}</ul>
                </details>
              )}
            </div>
          )}

          {step === 2 && (
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
              <Field label="Centre code" hint={profile.centre.printedNumber ? 'The number printed on the report' : 'Suggested from the name; must be unique'}>
                {(id) => <Input id={id} className="font-mono uppercase" value={centre.code} onChange={(event) => setCentre({ ...centre, code: event.target.value.toUpperCase() })} />}
              </Field>
              <Field label="Centre name">{(id) => <Input id={id} value={centre.name} onChange={(event) => setCentre({ ...centre, name: event.target.value })} />}</Field>
              <Field label="Address (optional)">{(id) => <Input id={id} value={centre.address} onChange={(event) => setCentre({ ...centre, address: event.target.value })} />}</Field>
              <Field label="Time zone" hint="Decides the business day for dates">{(id) => <Input id={id} value={centre.timezone} onChange={(event) => setCentre({ ...centre, timezone: event.target.value })} />}</Field>
              <Field label="Payment terms (days)" hint="How long after a charge is posted it falls due">
                {(id) => <Input id={id} inputMode="numeric" value={centre.paymentTermsDays} onChange={(event) => setCentre({ ...centre, paymentTermsDays: event.target.value })} />}
              </Field>
              <Field label="Grace period (days)">{(id) => <Input id={id} inputMode="numeric" value={centre.gracePeriodDays} onChange={(event) => setCentre({ ...centre, gracePeriodDays: event.target.value })} />}</Field>
            </form>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Each department is remembered under the name printed on the report, so later reports match automatically. Untick any that should not be tracked.</p>
              <ItemTable kind="department" items={departments} onChange={setDepartments} showTotal />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">These are the payment methods the centre collects through. Channels with no amounts in this report are kept because they may be used in other months.</p>
              <ItemTable kind="channel" items={channels} onChange={setChannels} showTotal extraLabel="Note" />
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={terms.enabled} onChange={(event) => setTerms({ ...terms, enabled: event.target.checked })} />
                <span>
                  Set the service charge now
                  <span className="block text-xs text-slate-500">One percentage that applies to every department and channel from the start date. Exceptions can be added later on the centre page. If you skip this the centre stays in draft.</span>
                </span>
              </label>
              {terms.enabled && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Agreement name">{(id) => <Input id={id} value={terms.name} onChange={(event) => setTerms({ ...terms, name: event.target.value })} />}</Field>
                  <Field label="Service charge (% of reported revenue)" hint="From the signed agreement">
                    {(id) => <Input id={id} inputMode="decimal" value={terms.rate} onChange={(event) => setTerms({ ...terms, rate: event.target.value })} />}
                  </Field>
                  <Field label="Applies from">{(id) => <Input id={id} type="date" value={terms.from} onChange={(event) => setTerms({ ...terms, from: event.target.value })} />}</Field>
                </div>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Centre" value={centre.code.toUpperCase()} hint={centre.name} />
                <Fact label="Departments" value={includedDepartments.length} />
                <Fact label="Payment channels" value={includedChannels.length} />
                <Fact label="Service charge" value={terms.enabled ? `${terms.rate}%` : 'Not set'} hint={terms.enabled ? `from ${formatDate(terms.from)}` : 'Centre stays in draft'} />
              </div>
              {terms.enabled && (
                <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={options.activate} onChange={(event) => setOptions({ ...options, activate: event.target.checked, importNow: event.target.checked && options.importNow })} />
                    <span>Activate the centre now <span className="block text-xs text-slate-500">Active centres can receive revenue reports and charges.</span></span>
                  </label>
                  <label className={cx('flex items-start gap-2', !options.activate && 'opacity-50')}>
                    <input type="checkbox" className="mt-1" disabled={!options.activate} checked={options.activate && options.importNow} onChange={(event) => setOptions({ ...options, importNow: event.target.checked })} />
                    <span>Import this report now <span className="block text-xs text-slate-500">It is uploaded and checked; nothing is posted until someone else reviews and commits it.</span></span>
                  </label>
                </div>
              )}
              {!terms.enabled && <Notice tone="info">Without service-charge terms the centre is created in draft. Add its agreement on the centre page, then activate it.</Notice>}
              <ErrorNotice error={commit.error} />
              <Button loading={commit.isPending} onClick={() => commit.mutate()}>Create the centre</Button>
              <p className="text-xs text-slate-500">Everything is created together or not at all, and the set-up is recorded in the audit trail.</p>
            </div>
          )}

          {(blockers[step] ?? []).length > 0 && (
            <div role="alert" className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Fix this before continuing:</p>
              <ul className="mt-1 list-disc pl-5">{blockers[step].slice(0, 6).map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </div>
          )}

          <div className="mt-5 flex justify-between border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={step <= 1 || commit.isPending}>Back</Button>
            {step < STEPS.length - 1 && <Button onClick={() => setStep(step + 1)} disabled={!canNext}>Next</Button>}
          </div>
        </Card>
      )}
    </div>
  );
}
