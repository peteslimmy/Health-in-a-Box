import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorNotice, Field, Input, Loading, Notice } from './ui';
import { api } from '../lib/api';

export type MfaChallenge = { stage: 'verify' | 'enrol'; token: string };
export type Enrolled = { accessToken: string; recoveryCodes: string[] };

const groupKey = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/** Enter the 6-digit code (or a recovery code) to finish signing in. */
export function MfaVerifyStep({ token, onDone, onCancel }: { token: string; onDone: (accessToken: string, remaining?: number) => Promise<void>; onCancel: () => void }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = useRecovery ? { mfaToken: token, recoveryCode: value.trim() } : { mfaToken: token, code: value.trim() };
      const result = await api<{ accessToken: string; recoveryCodesRemaining?: number }>('/auth/mfa/verify', { method: 'POST', body });
      await onDone(result.accessToken, result.recoveryCodesRemaining);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
      <p className="text-sm text-slate-600">
        {useRecovery ? 'Enter one of your recovery codes. Each works once.' : 'Open your authenticator app and enter the 6-digit code for HNB Receivables.'}
      </p>
      <Field label={useRecovery ? 'Recovery code' : 'Authentication code'}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            maxLength={useRecovery ? 14 : 7}
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </Field>
      <ErrorNotice error={error} />
      <Button type="submit" loading={busy} disabled={!value.trim()} className="w-full">
        Verify
      </Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-brand-700 underline" onClick={() => { setUseRecovery(!useRecovery); setValue(''); setError(null); }}>
          {useRecovery ? 'Use the app instead' : 'Use a recovery code'}
        </button>
        <button type="button" className="text-slate-600 underline" onClick={onCancel}>
          Start over
        </button>
      </div>
    </form>
  );
}

/** Shows the key to add to an authenticator app and confirms the first code. */
export function MfaEnrolStep({ token, required, onDone, onCancel }: { token: string; required?: boolean; onDone: (result: Enrolled) => void; onCancel?: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ secret: string; otpauthUri: string }>('/auth/mfa/enrol/start', { method: 'POST', body: { mfaToken: token } })
      .then((result) => !cancelled && setSetup(result))
      .catch((caught) => !cancelled && setError(caught));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<Enrolled>('/auth/mfa/enrol/confirm', { method: 'POST', body: { mfaToken: token, code: code.trim() } });
      onDone(result);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
      {required && (
        <Notice tone="info" title="Extra protection is required for your access">
          Your role can approve or change money, so sign-in needs a code from an authenticator app as well as your password.
        </Notice>
      )}
      {!setup && !error && <Loading label="Preparing your key…" />}
      {setup && (
        <>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Install an authenticator app on your phone (for example Google Authenticator, Microsoft Authenticator or Authy).</li>
            <li>
              In the app choose “Enter a setup key” and type this key:
              <p className="mt-1 select-all break-all rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-sm tracking-wide" data-testid="mfa-secret">
                {groupKey(setup.secret)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                On the phone itself you can <a className="text-brand-700 underline" href={setup.otpauthUri}>open the key in your app</a>. Choose “time based”.
              </p>
            </li>
            <li>Type the 6-digit code the app now shows.</li>
          </ol>
          <Field label="6-digit code">
            {(id) => <Input id={id} autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={7} required value={code} onChange={(event) => setCode(event.target.value)} />}
          </Field>
        </>
      )}
      <ErrorNotice error={error} />
      <Button type="submit" loading={busy} disabled={!setup || !code.trim()} className="w-full">
        Confirm and continue
      </Button>
      {onCancel && (
        <button type="button" className="text-sm text-slate-600 underline" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

/** The one-time list of recovery codes; the person must confirm they have kept them. */
export function RecoveryCodesStep({ codes, onContinue, label = 'Continue' }: { codes: string[]; onContinue: () => void | Promise<void>; label?: string }) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-5 space-y-4">
      <Notice tone="warn" title="Keep these recovery codes somewhere safe">
        If you lose your phone, each code lets you sign in once. They are shown only now.
      </Notice>
      <ul className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-slate-50 p-3 font-mono text-sm" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code} className="select-all">{code}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
          Copy
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        <span>I have saved these recovery codes</span>
      </label>
      <Button
        className="w-full"
        disabled={!saved}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onContinue();
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
    </div>
  );
}
