import type { SessionUser } from './api';

/**
 * UI-only convenience: hides actions the user could not perform. It is NOT authorization — the
 * API enforces every permission and hospital scope on each request.
 */
export function can(user: SessionUser | null | undefined, ...permissions: string[]): boolean {
  if (!user) return false;
  return permissions.every((permission) => user.permissions.includes(permission));
}
