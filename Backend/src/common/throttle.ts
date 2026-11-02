import { ThrottlerOptions } from '@nestjs/throttler';

const LOGIN_PATH = /\/auth\/login\/?$/;

/** Normalised email from a login request body, or '' when absent. */
export function emailOf(req: { body?: { email?: unknown } } | undefined): string {
  const email = req?.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
}

export function isLoginRequest(req: { method?: string; path?: string; url?: string }): boolean {
  return req.method === 'POST' && LOGIN_PATH.test(req.path ?? req.url ?? '');
}

/**
 * Two independent limits:
 *  - `default`: per client address, for every route;
 *  - `login-account`: per ACCOUNT on sign-in attempts, whatever the address, so one account cannot
 *    be guessed at from many addresses, while an office behind one address is not locked out by
 *    other people's attempts.
 */
export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'default', ttl: 60_000, limit: 300 },
  {
    name: 'login-account',
    ttl: 60_000,
    limit: 8,
    getTracker: (req) => `account:${emailOf(req)}`,
    skipIf: (context) => {
      const req = context.switchToHttp().getRequest();
      return !isLoginRequest(req) || emailOf(req) === '';
    },
  },
];
