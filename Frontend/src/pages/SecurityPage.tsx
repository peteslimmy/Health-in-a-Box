import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useAuth, useUser } from '../auth/AuthContext';
import { MfaEnrolStep, RecoveryCodesStep } from '../components/MfaSteps';
import { Button, Card, ErrorNotice, Field, Input, Notice, PageHeader } from '../components/ui';
import { api } from '../lib/api';

type Step = { kind: 'idle' } | { kind: 'enrol'; token: string } | { kind: 'codes'; codes: string[] };

/** The signed-in person's own second factor: add an authenticator app, or replace recovery codes. */
export function SecurityPage() {
  const user = useUser();
  const { completeSession } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const begin = useMutation({
    mutationFn: () => api<{ mfaToken: string }>('/auth/mfa/begin', { method: 'POST', body: { password } }),
    onSuccess: (result) => { setPassword(''); setStep({ kind: 'enrol', token: result.mfaToken }); },
  });
  const regenerate = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { method: 'POST', body: { code: code.trim() } }),
    onSuccess: (result) => { setCode(''); setStep({ kind: 'codes', codes: result.recoveryCodes }); },
  });

  return (
    <div className="max-w-2xl">
      <PageHeader title="My sign-in security" subtitle="A code from an authenticator app protects your account even if your password is stolen." />
      <Card title="Two-step sign-in">
        {step.kind === 'codes' ? (
          <RecoveryCodesStep
            codes={step.codes}
            label="Done"
            onContinue={() => setStep({ kind: 'idle' })}
          />
        ) : step.kind === 'enrol' ? (
          <MfaEnrolStep
            token={step.token}
            onCancel={() => setStep({ kind: 'idle' })}
            onDone={(result) => {
              // Enrolling opens a fresh session; adopt it so the page shows the new state.
              setStep({ kind: 'codes', codes: result.recoveryCodes });
              void completeSession(result.accessToken);
            }}
          />
        ) : user.mfaEnabled ? (
          <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); regenerate.mutate(); }}>
            <Notice tone="good" title="Two-step sign-in is on" />
            <p className="text-sm text-slate-700">If you have used up or lost your recovery codes, enter the current code from your app to get a new set. The old codes stop working.</p>
            <Field label="Code from your app">
              {(id) => <Input id={id} autoComplete="one-time-code" inputMode="numeric" maxLength={7} required value={code} onChange={(event) => setCode(event.target.value)} />}
            </Field>
            <ErrorNotice error={regenerate.error} />
            <Button type="submit" loading={regenerate.isPending} disabled={!code.trim()}>Get new recovery codes</Button>
            <p className="text-xs text-slate-500">Lost your phone as well? Ask an administrator to reset your two-step sign-in.</p>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); begin.mutate(); }}>
            <Notice tone="warn" title="Two-step sign-in is off" />
            <p className="text-sm text-slate-700">Enter your password to start. Signing in will then also ask for a code from your phone.</p>
            <Field label="Your password">
              {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
            </Field>
            <ErrorNotice error={begin.error} />
            <Button type="submit" loading={begin.isPending} disabled={!password}>Set up an authenticator app</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
