import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useUser } from '../auth/AuthContext';
import { Button, Card, ErrorNotice, Field, Input, Loading, Modal, Notice, PageHeader, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { can } from '../lib/permissions';
import type { Permission, Role } from '../lib/types';

function groupBy<T>(items: T[], key: (item: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return [...map.entries()];
}

export function RolesPage() {
  const me = useUser();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const permissions = useQuery({ queryKey: ['permissions'], queryFn: () => api<Permission[]>('/roles/permissions') });
  const canManage = can(me, 'roles.manage');

  const create = useMutation({
    mutationFn: () =>
      api('/roles', { method: 'POST', body: { code: form.code.trim(), name: form.name.trim(), description: form.description.trim() || undefined, permissionCodes: [...selected] } }),
    onSuccess: () => {
      setCreating(false);
      setSelected(new Set());
      setForm({ code: '', name: '', description: '' });
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  // You can only grant permissions you hold yourself (the API enforces this too).
  const grantable = (permissions.data ?? []).filter((permission) => me.permissions.includes(permission.code));

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  return (
    <div>
      <PageHeader
        title="Roles"
        subtitle="Built-in roles cannot be edited. Create a custom role from the permissions you hold, then assign it to users."
        actions={canManage && <Button onClick={() => setCreating(true)}>New custom role</Button>}
      />
      {roles.isLoading && <Loading />}
      <ErrorNotice error={roles.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.data?.map((role) => (
          <Card key={role.id} title={`${role.name}${role.isSystem ? ' (built-in)' : ''}`} actions={<span className="text-xs text-slate-500">{role._count?.assignments ?? 0} assignment(s)</span>}>
            <p className="mb-2 font-mono text-xs text-slate-500">{role.code}</p>
            {groupBy(role.permissions.map((item) => item.permission), (permission) => permission.group).map(([group, items]) => (
              <p key={group} className="mb-1 text-sm"><span className="font-medium">{group}: </span>{items.map((item) => item.code.split('.')[1]).join(', ')}</p>
            ))}
          </Card>
        ))}
      </div>

      {creating && (
        <Modal title="New custom role" onClose={() => setCreating(false)} wide>
          <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" hint="Upper-case letters and underscores">{(id) => <Input id={id} required minLength={2} maxLength={40} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />}</Field>
              <Field label="Name">{(id) => <Input id={id} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
            </div>
            <Field label="Description">{(id) => <Textarea id={id} rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />}</Field>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">Permissions ({selected.size} selected)</legend>
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-slate-200 p-3">
                {groupBy(grantable, (permission) => permission.group).map(([group, items]) => (
                  <div key={group}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</p>
                    {items.map((permission) => (
                      <label key={permission.code} className="flex items-start gap-2 py-0.5 text-sm">
                        <input type="checkbox" className="mt-1" checked={selected.has(permission.code)} onChange={() => toggle(permission.code)} />
                        <span>{permission.name} <span className="text-xs text-slate-500">— {permission.description}</span></span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </fieldset>
            <Notice tone="neutral">Sensitive permissions (approve, post, reverse, manage) should be split between different people so one person cannot prepare and approve the same item.</Notice>
            <ErrorNotice error={create.error} />
            <div className="flex gap-2"><Button type="submit" loading={create.isPending} disabled={selected.size === 0}>Create role</Button><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
