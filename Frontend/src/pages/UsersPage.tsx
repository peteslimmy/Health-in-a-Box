import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useUser } from '../auth/AuthContext';
import { CentreSelect } from '../components/CentreSelect';
import { PasswordInput } from '../components/PasswordInput';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Loading, Modal, Notice, PageHeader, Pagination, Select, StatusBadge, Table, Td, Th } from '../components/ui';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { can } from '../lib/permissions';
import type { AdminUser, Page, Role } from '../lib/types';

type Assignment = { roleId: string; centreId: string };

function AssignmentEditor({ value, onChange, roles }: { value: Assignment[]; onChange: (value: Assignment[]) => void; roles: Role[] }) {
  return (
    <div className="space-y-2">
      {value.map((assignment, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Select aria-label="Role" value={assignment.roleId} onChange={(event) => onChange(value.map((item, i) => (i === index ? { ...item, roleId: event.target.value } : item)))}>
            <option value="">Select a role…</option>
            {roles.filter((role) => role.isActive).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </Select>
          <CentreSelect allowAll value={assignment.centreId} onChange={(centreId) => onChange(value.map((item, i) => (i === index ? { ...item, centreId } : item)))} />
          <Button variant="ghost" onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove</Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...value, { roleId: '', centreId: '' }])}>Add role</Button>
      <p className="text-xs text-slate-500">“All centres” gives the role access to every centre. Each role applies only to the centre chosen beside it.</p>
    </div>
  );
}

const toBody = (assignments: Assignment[]) => assignments.filter((a) => a.roleId).map((a) => ({ roleId: a.roleId, ...(a.centreId && { centreId: a.centreId }) }));

export function UsersPage() {
  const me = useUser();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', password: '', assignments: [{ roleId: '', centreId: '' }] as Assignment[] });
  const [editAssignments, setEditAssignments] = useState<Assignment[]>([]);
  const [newPassword, setNewPassword] = useState('');
  const [resettingMfa, setResettingMfa] = useState<AdminUser | null>(null);
  const canManage = can(me, 'users.manage');

  const users = useQuery({ queryKey: ['admin-users', page], queryFn: () => api<Page<AdminUser>>('/users', { query: { page, pageSize: 20 } }) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const create = useMutation({
    mutationFn: () => api('/users', { method: 'POST', body: { email: form.email.trim(), fullName: form.fullName.trim(), password: form.password, assignments: toBody(form.assignments) } }),
    onSuccess: () => { setCreating(false); setForm({ email: '', fullName: '', password: '', assignments: [{ roleId: '', centreId: '' }] }); refresh(); },
  });
  const toggle = useMutation({ mutationFn: (user: AdminUser) => api(`/users/${user.id}`, { method: 'PATCH', body: { isActive: !user.isActive } }), onSuccess: refresh });
  const saveAssignments = useMutation({
    mutationFn: () => api(`/users/${editing!.id}/assignments`, { method: 'PATCH', body: { assignments: toBody(editAssignments) } }),
    onSuccess: () => { setEditing(null); refresh(); },
  });
  const resetMfa = useMutation({
    mutationFn: () => api(`/users/${resettingMfa!.id}/reset-mfa`, { method: 'POST' }),
    onSuccess: () => { setResettingMfa(null); refresh(); },
  });
  const reset = useMutation({
    mutationFn: () => api(`/users/${resetting!.id}/reset-password`, { method: 'POST', body: { password: newPassword } }),
    onSuccess: () => { setResetting(null); setNewPassword(''); },
  });

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Access comes from roles, each applied to all centres or to one centre. You can only grant permissions you hold yourself, and you cannot change your own access."
        actions={canManage && <Button onClick={() => setCreating(true)}>Add user</Button>}
      />
      <Card>
        {users.isLoading && <Loading />}
        <ErrorNotice error={users.error ?? toggle.error} />
        {users.data && users.data.items.length === 0 && <EmptyState title="No users" />}
        {users.data && users.data.items.length > 0 && (
          <>
            <Table caption="Users">
              <thead><tr><Th>Name</Th><Th>Email</Th><Th>Roles</Th><Th>Status</Th><Th>2-step</Th><Th>Last sign-in</Th><Th /></tr></thead>
              <tbody>
                {users.data.items.map((user) => (
                  <tr key={user.id}>
                    <Td className="font-medium">{user.fullName}</Td>
                    <Td>{user.email}</Td>
                    <Td>{user.roleAssignments.map((a) => `${a.role.name}${a.centre ? ` (${a.centre.code})` : ' (all centres)'}`).join('; ') || '—'}</Td>
                    <Td><StatusBadge status={user.isActive ? 'ACTIVE' : 'SUSPENDED'} /></Td>
                    <Td>{user.mfaEnabled ? 'On' : 'Off'}</Td>
                    <Td>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</Td>
                    <Td className="whitespace-nowrap">
                      {canManage && user.id !== me.id && (
                        <>
                          <Button variant="ghost" onClick={() => { setEditing(user); setEditAssignments(user.roleAssignments.map((a) => ({ roleId: a.role.id, centreId: a.centre?.id ?? '' }))); }}>Roles</Button>
                          <Button variant="ghost" onClick={() => toggle.mutate(user)}>{user.isActive ? 'Deactivate' : 'Activate'}</Button>
                          <Button variant="ghost" onClick={() => setResetting(user)}>Reset password</Button>
                          {user.mfaEnabled && <Button variant="ghost" onClick={() => setResettingMfa(user)}>Reset 2-step</Button>}
                        </>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={users.data.meta.page} totalPages={users.data.meta.totalPages} total={users.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>

      {creating && (
        <Modal title="Add user" onClose={() => setCreating(false)} wide>
          <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name">{(id) => <Input id={id} required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />}</Field>
              <Field label="Email" hint="Must be at an approved domain. Gmail is only for super admins.">{(id) => <Input id={id} type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
            </div>
            <Field label="Temporary password" hint="At least 10 characters with upper-case, lower-case and a number">
              {(id) => <PasswordInput id={id} autoComplete="new-password" required minLength={10} showStrength value={form.password} onChange={(password) => setForm({ ...form, password })} />}
            </Field>
            <p className="text-sm font-medium text-slate-700">Roles</p>
            <AssignmentEditor value={form.assignments} onChange={(assignments) => setForm({ ...form, assignments })} roles={roles.data ?? []} />
            <ErrorNotice error={create.error} />
            <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Create user</Button><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button></div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={`Roles for ${editing.fullName}`} onClose={() => setEditing(null)} wide>
          <div className="space-y-3">
            <AssignmentEditor value={editAssignments} onChange={setEditAssignments} roles={roles.data ?? []} />
            <Notice tone="neutral">The Auditor role cannot be combined with a role that changes data. Replacing the roles takes effect on the user's next request.</Notice>
            <ErrorNotice error={saveAssignments.error} />
            <div className="flex gap-2"><Button loading={saveAssignments.isPending} onClick={() => saveAssignments.mutate()}>Save roles</Button><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button></div>
          </div>
        </Modal>
      )}

      {resettingMfa && (
        <Modal title={`Reset 2-step sign-in for ${resettingMfa.fullName}`} onClose={() => setResettingMfa(null)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-700">Use this when the person has lost their phone and their recovery codes. Their authenticator and recovery codes are removed and they are signed out everywhere. At the next sign-in they set up the app again.</p>
            <p className="text-sm text-slate-700">Only do this after confirming it really is {resettingMfa.fullName}, for example by phone or in person.</p>
            <ErrorNotice error={resetMfa.error} />
            <div className="flex gap-2"><Button variant="danger" loading={resetMfa.isPending} onClick={() => resetMfa.mutate()}>Reset 2-step sign-in</Button><Button variant="secondary" onClick={() => setResettingMfa(null)}>Cancel</Button></div>
          </div>
        </Modal>
      )}

      {resetting && (
        <Modal title={`Reset password for ${resetting.fullName}`} onClose={() => setResetting(null)}>
          <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); reset.mutate(); }}>
            <Field label="New password" hint="Signs the user out everywhere">
              {(id) => <PasswordInput id={id} autoComplete="new-password" required minLength={10} showStrength value={newPassword} onChange={setNewPassword} />}
            </Field>
            <ErrorNotice error={reset.error} />
            <div className="flex gap-2"><Button type="submit" variant="danger" loading={reset.isPending}>Reset password</Button><Button variant="secondary" onClick={() => setResetting(null)}>Cancel</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
