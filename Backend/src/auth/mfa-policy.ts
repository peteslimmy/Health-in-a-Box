import { AuthUser } from '../common/types/auth-user';

/** Permissions that change who can act, how money is calculated, or that approve and post money. */
export const PRIVILEGED_PERMISSIONS = [
  'users.manage',
  'roles.manage',
  'settings.manage',
  'hospitals.onboard',
  'platform.manage',
  'charge_rules.manage',
  'charge_runs.approve',
  'charge_runs.post',
  'payments.approve',
  'payments.post',
  'payments.reverse',
  'adjustments.approve',
  'imports.commit',
  'imports.approve_variance',
  'reports.void',
] as const;

export type MfaEnforcement = 'off' | 'privileged' | 'all';

export function parseEnforcement(value: string | undefined, production: boolean): MfaEnforcement {
  if (value === 'off' || value === 'privileged' || value === 'all') return value;
  return production ? 'privileged' : 'off';
}

export function isPrivileged(user: Pick<AuthUser, 'permissions'>): boolean {
  return user.permissions.some((code) =>
    (PRIVILEGED_PERMISSIONS as readonly string[]).includes(code),
  );
}

/** Whether this person must sign in with a second factor. Anyone who has enrolled always does. */
export function mfaRequired(
  user: Pick<AuthUser, 'permissions'>,
  enrolled: boolean,
  enforcement: MfaEnforcement,
): boolean {
  if (enrolled) return true;
  if (enforcement === 'all') return true;
  return enforcement === 'privileged' && isPrivileged(user);
}
