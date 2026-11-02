import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setSessionLostHandler, type SessionUser } from '../lib/api';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signedOut'; user: null }
  | { status: 'signedIn'; user: SessionUser };

/** Returned when the password was right but a second step is still needed. */
export type SignInChallenge = { stage: 'verify' | 'enrol'; token: string };

type AuthContextValue = AuthState & {
  /** Resolves to null when signed in, or to the second step the person must still complete. */
  signIn: (email: string, password: string) => Promise<SignInChallenge | null>;
  /** Opens the app with an access token obtained from the second step. */
  completeSession: (accessToken: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(): Promise<SessionUser> {
  return api<SessionUser>('/auth/me');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const queryClient = useQueryClient();

  const lose = useCallback(() => {
    setAccessToken(null);
    queryClient.clear();
    setState({ status: 'signedOut', user: null });
  }, [queryClient]);

  // Restore an existing session from the httpOnly refresh cookie.
  useEffect(() => {
    setSessionLostHandler(lose);
    let cancelled = false;
    (async () => {
      const session = await refreshSession();
      if (cancelled) return;
      if (!session) return setState({ status: 'signedOut', user: null });
      try {
        const user = await loadProfile();
        if (!cancelled) setState({ status: 'signedIn', user });
      } catch {
        if (!cancelled) setState({ status: 'signedOut', user: null });
      }
    })();
    return () => {
      cancelled = true;
      setSessionLostHandler(null);
    };
  }, [lose]);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await api<{ accessToken?: string; mfa?: SignInChallenge }>('/auth/login', { method: 'POST', body: { email, password } });
    if (session.mfa) return session.mfa;
    setAccessToken(session.accessToken ?? null);
    const user = await loadProfile();
    setState({ status: 'signedIn', user });
    return null;
  }, []);

  const completeSession = useCallback(async (accessToken: string) => {
    setAccessToken(accessToken);
    const user = await loadProfile();
    setState({ status: 'signedIn', user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      lose();
    }
  }, [lose]);

  const value = useMemo<AuthContextValue>(() => ({ ...state, signIn, completeSession, signOut }), [state, signIn, completeSession, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** The signed-in user; only call below a route guard. */
export function useUser(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error('No signed-in user');
  return user;
}
