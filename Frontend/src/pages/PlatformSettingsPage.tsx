import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Loading, Modal, Notice, PageHeader, Select, StatusBadge, Table, Td, Th, cx } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';

type Preset = { id: string; label: string; host: string; port: number; secure: boolean; userHint: string; keyHint: string };
type Asset = { kind: string; fileName: string; contentType: string; sizeBytes: number; sha256: string; updatedAt: string } | null;
type Settings = {
  profile: { appName: string; tagline: string | null; supportEmail: string | null };
  smtp: {
    configured: boolean;
    host: string | null;
    port: number | null;
    secure: boolean;
    user: string | null;
    hasPassword: boolean;
    fromName: string | null;
    fromEmail: string | null;
    replyTo: string | null;
    updatedAt: string | null;
    lastTest: { at: string; ok: boolean | null; note: string | null } | null;
  };
  presets: Preset[];
  branding: { logo: Asset; favicon: Asset };
};
type Domains = {
  domains: Array<{ id: string; domain: string; note: string | null; isActive: boolean; createdAt: string; accounts: number }>;
  blockedAccounts: Array<{ id: string; email: string; fullName: string; reason: string }>;
  rule: string;
};
type SuperAdmins = {
  superAdmins: Array<{ id: string; email: string; fullName: string; isActive: boolean; mfaEnabled: boolean; lastLoginAt: string | null }>;
  rule: string;
};

const TABS = [
  { id: 'email', label: 'Email (SMTP)' },
  { id: 'branding', label: 'Profile and branding' },
  { id: 'domains', label: 'Approved domains' },
  { id: 'admins', label: 'Super admins' },
] as const;

function Tabs({ current, onChange }: { current: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Platform settings" className="flex flex-wrap gap-1 border-b border-slate-200">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          id={`tab-${tab.id}`}
          aria-selected={current === tab.id}
          aria-controls={`panel-${tab.id}`}
          onClick={() => onChange(tab.id)}
          className={cx('-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors', current === tab.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900')}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function EmailTab({ settings }: { settings: Settings }) {
  const user = useUser();
  const queryClient = useQueryClient();
  const s = settings.smtp;
  const [preset, setPreset] = useState('');
  const [form, setForm] = useState({
    host: s.host ?? '',
    port: String(s.port ?? 587),
    secure: s.secure,
    user: s.user ?? '',
    password: '',
    fromName: s.fromName ?? settings.profile.appName,
    fromEmail: s.fromEmail ?? '',
    replyTo: s.replyTo ?? '',
  });
  const [to, setTo] = useState(user.email);
  const chosen = settings.presets.find((p) => p.id === preset);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['platform'] });

  const save = useMutation({
    mutationFn: () =>
      api('/platform/smtp', {
        method: 'PUT',
        body: {
          host: form.host.trim(),
          port: Number(form.port),
          secure: form.secure,
          ...(form.user.trim() && { user: form.user.trim() }),
          ...(form.password && { password: form.password }),
          fromName: form.fromName.trim(),
          fromEmail: form.fromEmail.trim(),
          ...(form.replyTo.trim() && { replyTo: form.replyTo.trim() }),
        },
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, password: '' }));
      refresh();
    },
  });
  const clear = useMutation({ mutationFn: () => api('/platform/smtp', { method: 'DELETE' }), onSuccess: refresh });
  const test = useMutation({ mutationFn: () => api<{ ok: boolean; note: string }>('/platform/smtp/test', { method: 'POST', body: { to: to.trim() } }), onSuccess: refresh });

  function applyPreset(id: string) {
    setPreset(id);
    const p = settings.presets.find((item) => item.id === id);
    if (p) setForm((f) => ({ ...f, host: p.host, port: String(p.port), secure: p.secure }));
  }

  return (
    <div className="space-y-5">
      <Notice tone="info" title="How outgoing email is protected">
        <ul className="mt-1 list-disc pl-5">
          <li>The password or API key is stored encrypted and is never shown again, here or in the audit trail.</li>
          <li>Mail is always sent over an encrypted connection.</li>
          <li>The mail server must be a public address, not one inside your network.</li>
        </ul>
      </Notice>

      <Card title="Mail server">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Provider (optional)" hint="Fills in the server and port for you. You still enter your own user and key.">
            {(id) => (
              <Select id={id} value={preset} onChange={(event) => applyPreset(event.target.value)}>
                <option value="">Other / my own server</option>
                {settings.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div />
          <Field label="SMTP server" hint="For example smtp.sendgrid.net">
            {(id) => <Input id={id} required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} />}
          </Field>
          <Field label="Port">
            {(id) => (
              <Select id={id} value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })}>
                <option value="587">587 (STARTTLS, most common)</option>
                <option value="465">465 (SSL/TLS)</option>
                <option value="2525">2525 (alternative)</option>
                <option value="25">25 (server to server)</option>
              </Select>
            )}
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-slate-700">Encryption</legend>
            <div className="mt-1 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="secure" checked={!form.secure} onChange={() => setForm({ ...form, secure: false })} /> Upgrade with STARTTLS (usually port 587)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="secure" checked={form.secure} onChange={() => setForm({ ...form, secure: true })} /> Encrypted from the start, SSL/TLS (usually port 465)
              </label>
            </div>
          </fieldset>
          <Field label="SMTP user name" hint={chosen ? `For ${chosen.label}: ${chosen.userHint}` : 'Leave empty if the server needs no login'}>
            {(id) => <Input id={id} autoComplete="off" value={form.user} onChange={(event) => setForm({ ...form, user: event.target.value })} />}
          </Field>
          <Field label="SMTP password or API key" hint={s.hasPassword ? 'A password is saved. Leave blank to keep it, or type a new one to replace it.' : chosen ? chosen.keyHint : 'Stored encrypted'}>
            {(id) => <PasswordInput id={id} autoComplete="new-password" value={form.password} onChange={(password) => setForm({ ...form, password })} />}
          </Field>
          <Field label="From name">{(id) => <Input id={id} required value={form.fromName} onChange={(event) => setForm({ ...form, fromName: event.target.value })} />}</Field>
          <Field label="From email address" hint="Must be allowed by your provider, usually a verified sender or domain">
            {(id) => <Input id={id} type="email" required value={form.fromEmail} onChange={(event) => setForm({ ...form, fromEmail: event.target.value })} />}
          </Field>
          <Field label="Reply-to address (optional)">{(id) => <Input id={id} type="email" value={form.replyTo} onChange={(event) => setForm({ ...form, replyTo: event.target.value })} />}</Field>
          <div className="space-y-2 sm:col-span-2">
            <ErrorNotice error={save.error ?? clear.error} />
            {save.isSuccess && !save.isPending && <Notice tone="good">Saved. Send a test email to check it works.</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={save.isPending}>
                Save email settings
              </Button>
              {s.configured && (
                <Button variant="danger" loading={clear.isPending} onClick={() => clear.mutate()}>
                  Remove email settings
                </Button>
              )}
            </div>
          </div>
        </form>
      </Card>

      <Card title="Test it">
        {!s.configured ? (
          <p className="text-sm text-slate-600">Save the settings above first.</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              test.mutate();
            }}
          >
            <Field label="Send a test message to">{(id) => <Input id={id} type="email" required value={to} onChange={(event) => setTo(event.target.value)} />}</Field>
            <ErrorNotice error={test.error} />
            <Button type="submit" loading={test.isPending} disabled={!to.trim()}>
              Send test email
            </Button>
            {s.lastTest && (
              <Notice tone={s.lastTest.ok ? 'good' : 'bad'} title={s.lastTest.ok ? 'The last test worked' : 'The last test failed'}>
                {formatDateTime(s.lastTest.at)}: {s.lastTest.note}
              </Notice>
            )}
            {!s.lastTest && <p className="text-xs text-slate-500">These settings have not been tested yet.</p>}
          </form>
        )}
      </Card>
    </div>
  );
}

function ImageSlot({ kind, title, hint, accept, asset }: { kind: 'logo' | 'favicon'; title: string; hint: string; accept: string; asset: Asset }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform'] });
    void queryClient.invalidateQueries({ queryKey: ['branding'] });
  };
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set('file', file!);
      return api(`/platform/branding/${kind}`, { method: 'POST', form });
    },
    onSuccess: () => {
      setFile(null);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => api(`/platform/branding/${kind}`, { method: 'DELETE' }), onSuccess: refresh });
  return (
    <Card title={title}>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex h-24 w-40 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
          {asset ? (
            <img src={`/api/v1/branding/${kind}?v=${asset.sha256.slice(0, 12)}`} alt={`Current ${kind}`} className="max-h-20 max-w-36 object-contain" />
          ) : (
            <span className="px-2 text-center text-xs text-slate-500">No {kind} uploaded</span>
          )}
        </div>
        <div className="min-w-64 flex-1 space-y-3">
          <p className="text-sm text-slate-600">{hint}</p>
          {asset && (
            <p className="text-xs text-slate-500">
              {asset.fileName} · {Math.max(1, Math.round(asset.sizeBytes / 1024))} KB · {formatDateTime(asset.updatedAt)}
            </p>
          )}
          <Field label={asset ? `Replace the ${kind}` : `Upload the ${kind}`}>
            {(id) => <Input id={id} type="file" accept={accept} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
          </Field>
          <ErrorNotice error={upload.error ?? remove.error} />
          <div className="flex gap-2">
            <Button loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>
              Upload
            </Button>
            {asset && (
              <Button variant="secondary" loading={remove.isPending} onClick={() => remove.mutate()}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function BrandingTab({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ appName: settings.profile.appName, tagline: settings.profile.tagline ?? '', supportEmail: settings.profile.supportEmail ?? '' });
  const save = useMutation({
    mutationFn: () =>
      api('/platform/profile', {
        method: 'PUT',
        body: { appName: form.appName.trim(), ...(form.tagline.trim() && { tagline: form.tagline.trim() }), ...(form.supportEmail.trim() && { supportEmail: form.supportEmail.trim() }) },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
      void queryClient.invalidateQueries({ queryKey: ['branding'] });
    },
  });
  return (
    <div className="space-y-5">
      <Card title="Product profile">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Product name" hint="Shown on the sign-in page, in the menu and in the browser tab">
            {(id) => <Input id={id} required value={form.appName} onChange={(event) => setForm({ ...form, appName: event.target.value })} />}
          </Field>
          <Field label="Support email (optional)">{(id) => <Input id={id} type="email" value={form.supportEmail} onChange={(event) => setForm({ ...form, supportEmail: event.target.value })} />}</Field>
          <div className="sm:col-span-2">
            <Field label="Tagline (optional)">{(id) => <Input id={id} value={form.tagline} onChange={(event) => setForm({ ...form, tagline: event.target.value })} />}</Field>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <ErrorNotice error={save.error} />
            {save.isSuccess && !save.isPending && <Notice tone="good">Saved.</Notice>}
            <Button type="submit" loading={save.isPending}>
              Save profile
            </Button>
          </div>
        </form>
      </Card>
      <ImageSlot kind="logo" title="Logo" hint="PNG, JPEG or WebP, up to 1 MB. A transparent PNG about 400 pixels wide works well. SVG is not accepted." accept="image/png,image/jpeg,image/webp" asset={settings.branding.logo} />
      <ImageSlot kind="favicon" title="Favicon" hint="The small icon in the browser tab: a square PNG (64 by 64 pixels or larger) or an ICO file, up to 256 KB." accept="image/png,image/x-icon,.ico" asset={settings.branding.favicon} />
    </div>
  );
}

function DomainsTab() {
  const queryClient = useQueryClient();
  const domains = useQuery({ queryKey: ['platform-domains'], queryFn: () => api<Domains>('/platform/domains') });
  const [form, setForm] = useState({ domain: '', note: '' });
  const [removing, setRemoving] = useState<Domains['domains'][number] | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['platform-domains'] });
  const add = useMutation({
    mutationFn: () => api('/platform/domains', { method: 'POST', body: { domain: form.domain.trim(), ...(form.note.trim() && { note: form.note.trim() }) } }),
    onSuccess: () => {
      setForm({ domain: '', note: '' });
      refresh();
    },
  });
  const toggle = useMutation({ mutationFn: (d: { id: string; isActive: boolean }) => api(`/platform/domains/${d.id}`, { method: 'PATCH', body: { isActive: d.isActive } }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/platform/domains/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });
  return (
    <div className="space-y-5">
      <Notice tone="info" title="Who can sign in">
        <ul className="mt-1 list-disc pl-5">
          <li>People need an email address at one of the approved domains below.</li>
          <li>
            <strong>Gmail is blocked for everyone except registered super admins.</strong> It cannot be added to this list.
          </li>
          <li>Removing or switching off a domain stops everyone at that domain from using the application straight away, including people already signed in.</li>
        </ul>
      </Notice>

      <Card title="Add an approved domain">
        <form
          className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Domain" hint="For example 4coretech.com. Only this exact domain, not its sub-domains.">
            {(id) => <Input id={id} required value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} />}
          </Field>
          <Field label="Note (optional)">{(id) => <Input id={id} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />}</Field>
          <Button type="submit" loading={add.isPending} disabled={!form.domain.trim()}>
            Approve domain
          </Button>
        </form>
        <div className="mt-3">
          <ErrorNotice error={add.error ?? toggle.error ?? remove.error} />
        </div>
      </Card>

      <Card title="Approved domains">
        {domains.isLoading && <Loading />}
        <ErrorNotice error={domains.error} />
        {domains.data && domains.data.domains.length === 0 && (
          <EmptyState title="No domains approved yet" hint="Until you approve one, only registered super admins can sign in." />
        )}
        {domains.data && domains.data.domains.length > 0 && (
          <Table caption="Approved email domains">
            <thead>
              <tr>
                <Th>Domain</Th>
                <Th>Note</Th>
                <Th numeric>Active accounts</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {domains.data.domains.map((d) => (
                <tr key={d.id}>
                  <Td className="font-mono">{d.domain}</Td>
                  <Td>{d.note ?? '—'}</Td>
                  <Td numeric>{d.accounts}</Td>
                  <Td>
                    <StatusBadge status={d.isActive ? 'ACTIVE' : 'SUSPENDED'} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Button variant="ghost" onClick={() => toggle.mutate({ id: d.id, isActive: !d.isActive })}>
                      {d.isActive ? 'Switch off' : 'Switch on'}
                    </Button>
                    <Button variant="ghost" onClick={() => setRemoving(d)}>
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {domains.data && domains.data.blockedAccounts.length > 0 && (
        <Card title="Accounts the rules currently block">
          <p className="mb-2 text-sm text-slate-600">These accounts exist but cannot sign in. Approve their domain, change their email on the Users screen, or deactivate them.</p>
          <Table caption="Blocked accounts">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Why</Th>
              </tr>
            </thead>
            <tbody>
              {domains.data.blockedAccounts.map((account) => (
                <tr key={account.id}>
                  <Td>{account.fullName}</Td>
                  <Td>{account.email}</Td>
                  <Td>{account.reason}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {removing && (
        <Modal title={`Remove ${removing.domain}?`} onClose={() => setRemoving(null)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              {removing.accounts > 0
                ? `${removing.accounts} active account${removing.accounts === 1 ? '' : 's'} at this domain will be blocked immediately, including anyone signed in.`
                : 'No active accounts use this domain.'}
            </p>
            <ErrorNotice error={remove.error} />
            <div className="flex gap-2">
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(removing.id)}>
                Remove domain
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AdminsTab() {
  const queryClient = useQueryClient();
  const admins = useQuery({ queryKey: ['platform-superadmins'], queryFn: () => api<SuperAdmins>('/platform/super-admins') });
  const [form, setForm] = useState({ email: '', fullName: '', password: '' });
  const add = useMutation({
    mutationFn: () => api('/platform/super-admins', { method: 'POST', body: { email: form.email.trim(), fullName: form.fullName.trim(), password: form.password } }),
    onSuccess: () => {
      setForm({ email: '', fullName: '', password: '' });
      void queryClient.invalidateQueries({ queryKey: ['platform-superadmins'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-domains'] });
    },
  });
  return (
    <div className="space-y-5">
      <Notice tone="info" title="Registered super admins">
        Super admins use a Gmail address, and only they may. They can manage email, branding, approved domains and set up hospitals. Other accounts are created on the Users screen with an address at an approved domain.
      </Notice>
      <Card title="Register a super admin">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Gmail address" hint="Must end in @gmail.com or @googlemail.com">
            {(id) => <Input id={id} type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}
          </Field>
          <Field label="Full name">{(id) => <Input id={id} required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />}</Field>
          <div className="sm:col-span-2">
            <Field label="Password" hint="At least 10 characters with upper-case, lower-case and a number">
              {(id) => <PasswordInput id={id} autoComplete="new-password" required minLength={10} showStrength value={form.password} onChange={(password) => setForm({ ...form, password })} />}
            </Field>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <ErrorNotice error={add.error} />
            {add.isSuccess && !add.isPending && <Notice tone="good">Registered.</Notice>}
            <Button type="submit" loading={add.isPending} disabled={!form.email.trim() || !form.fullName.trim() || form.password.length < 10}>
              Register super admin
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Registered super admins">
        {admins.isLoading && <Loading />}
        <ErrorNotice error={admins.error} />
        {admins.data && (
          <Table caption="Registered super admins">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th>2-step</Th>
                <Th>Last sign-in</Th>
              </tr>
            </thead>
            <tbody>
              {admins.data.superAdmins.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">{a.fullName}</Td>
                  <Td>{a.email}</Td>
                  <Td>
                    <StatusBadge status={a.isActive ? 'ACTIVE' : 'SUSPENDED'} />
                  </Td>
                  <Td>{a.mfaEnabled ? 'On' : 'Off'}</Td>
                  <Td>{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'Never'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export function PlatformSettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as string) : 'email';
  const settings = useQuery({ queryKey: ['platform'], queryFn: () => api<Settings>('/platform/settings') });

  let body: ReactNode = <Loading />;
  if (settings.data) {
    // The form state starts from what is saved; a new key re-creates it after each save.
    const key = `${settings.data.smtp.updatedAt ?? 'none'}-${settings.data.profile.appName}`;
    body = tab === 'email' ? <EmailTab key={key} settings={settings.data} /> : tab === 'branding' ? <BrandingTab key={key} settings={settings.data} /> : tab === 'domains' ? <DomainsTab /> : <AdminsTab />;
  }
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Platform settings" subtitle="Outgoing email, your logo and favicon, who may sign in, and the registered super admins. Only a super admin can see this page." />
      <Tabs current={tab} onChange={(id) => setParams({ tab: id }, { replace: true })} />
      <ErrorNotice error={settings.error} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {body}
      </div>
    </div>
  );
}
