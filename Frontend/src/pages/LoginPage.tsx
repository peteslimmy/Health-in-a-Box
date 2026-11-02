import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type SignInChallenge } from '../auth/AuthContext';
import { BrandMark, useBranding } from '../components/Branding';
import { MfaEnrolStep, MfaVerifyStep, RecoveryCodesStep } from '../components/MfaSteps';
import { PasswordInput } from '../components/PasswordInput';
import { Button, ErrorNotice, Field, Input, Loading, cx } from '../components/ui';
import { safeInternalPath } from '../lib/safePath';

const EMAIL_KEY = 'hnb.lastEmail';

// Browser storage can be blocked or missing; the page must work without it.
function readSavedEmail(): string {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveEmail(email: string | null) {
  try {
    if (email) window.localStorage.setItem(EMAIL_KEY, email);
    else window.localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-br from-brand-700 via-[#0b4f55] to-slate-900" aria-hidden="true">
      <div className="absolute -left-24 -top-24 h-[26rem] w-[26rem] animate-orb-a rounded-full bg-brand-500/60 blur-3xl" />
      <div className="absolute -bottom-32 -right-20 h-[30rem] w-[30rem] animate-orb-b rounded-full bg-sky-500/40 blur-3xl" />
      <div className="absolute left-1/2 top-1/3 h-72 w-72 animate-orb-c rounded-full bg-emerald-300/30 blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(2,18,24,0.45)_100%)]" />
    </div>
  );
}

export function LoginPage() {
  const auth = useAuth();
  const branding = useBranding();
  const navigate = useNavigate();
  const location = useLocation();
  const from = safeInternalPath((location.state as { from?: string } | null)?.from);
  const [email, setEmail] = useState(readSavedEmail);
  const [remember, setRemember] = useState(() => readSavedEmail() !== '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [shaking, setShaking] = useState(false);
  const [challenge, setChallenge] = useState<SignInChallenge | null>(null);
  const [recovery, setRecovery] = useState<{ accessToken: string; codes: string[] } | null>(null);

  // Replay the shake each time a new error arrives.
  useEffect(() => {
    if (error) setShaking(true);
  }, [error]);

  if (auth.status === 'loading') return <Loading label="Checking your session…" />;
  // The session is opened only after the recovery codes have been acknowledged.
  if (auth.status === 'signedIn' && !recovery) return <Navigate to={from} replace />;

  const reset = () => {
    setChallenge(null);
    setRecovery(null);
    setPassword('');
    setError(null);
  };
  async function finish(accessToken: string) {
    await auth.completeSession(accessToken);
    navigate(from, { replace: true });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = email.trim();
      const next = await auth.signIn(trimmed, password);
      saveEmail(remember ? trimmed : null);
      if (next) setChallenge(next);
      else navigate(from, { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const step = recovery ? 'recovery' : challenge?.stage === 'verify' ? 'verify' : challenge?.stage === 'enrol' ? 'enrol' : 'password';
  const heading = { password: 'Welcome back', verify: 'Check it’s you', enrol: 'Secure your account', recovery: 'You’re set up' }[step];
  const subheading = {
    password: 'Sign in with your staff account.',
    verify: 'One more step to protect the books.',
    enrol: 'Add an authenticator app to continue.',
    recovery: 'Keep your recovery codes safe.',
  }[step];

  return (
    <div className="login-scope relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <Backdrop />
      <main className="relative z-10 w-full max-w-md">
        <div
          className={cx('glass-card animate-rise rounded-2xl p-6 sm:p-8', shaking && 'animate-shake')}
          onAnimationEnd={(event) => {
            if (event.animationName === 'shake') setShaking(false);
          }}
        >
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-lg font-semibold leading-tight text-brand-700">{branding.appName}</p>
              <p className="text-xs text-slate-700">{branding.tagline ?? 'Service-charge management'}</p>
            </div>
          </div>

          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">{heading}</h1>
          <p className="mt-1 text-sm text-slate-700">{subheading}</p>

          {step === 'recovery' && recovery ? (
            <RecoveryCodesStep codes={recovery.codes} label="Continue to the app" onContinue={() => finish(recovery.accessToken)} />
          ) : step === 'verify' && challenge ? (
            <MfaVerifyStep token={challenge.token} onDone={finish} onCancel={reset} />
          ) : step === 'enrol' && challenge ? (
            <MfaEnrolStep required token={challenge.token} onDone={(result) => setRecovery({ accessToken: result.accessToken, codes: result.recoveryCodes })} onCancel={reset} />
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <Field label="Email">
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    autoComplete="username"
                    autoFocus={!email}
                    required
                    className="glass-field !py-2.5"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Password">
                {(id) => (
                  <PasswordInput
                    id={id}
                    autoComplete="current-password"
                    autoFocus={!!email}
                    required
                    showStrength
                    inputClassName="glass-field !py-2.5"
                    value={password}
                    onChange={setPassword}
                  />
                )}
              </Field>
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-brand-600" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                Remember my email on this device
              </label>
              <ErrorNotice error={error} />
              <Button
                type="submit"
                loading={busy}
                disabled={!email || !password}
                className="w-full !rounded-lg !py-2.5 !text-base bg-gradient-to-r from-brand-600 to-brand-700 shadow-lg shadow-brand-700/25 transition-all hover:-translate-y-px hover:shadow-xl hover:shadow-brand-700/30 active:translate-y-0 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
              >
                Sign in
              </Button>
            </form>
          )}
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-white/80">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Protected sign-in. Approvers and administrators also use an authenticator code.
        </p>
      </main>
    </div>
  );
}
