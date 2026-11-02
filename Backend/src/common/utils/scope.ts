import { NotFoundException } from '@nestjs/common';
import { AuthUser } from '../types/auth-user';

export function assertCentreAccess(user: AuthUser, centreId: string): void {
  if (user.allCentres) return;
  if (!user.centreIds.includes(centreId)) {
    throw new NotFoundException('Centre not found');
  }
}

export function accessibleCentreIds(user: AuthUser): string[] | undefined {
  return user.allCentres ? undefined : user.centreIds;
}

export function centreWhere(user: AuthUser, requestedCentreId?: string) {
  if (requestedCentreId) {
    assertCentreAccess(user, requestedCentreId);
    return { centreId: requestedCentreId };
  }
  if (user.allCentres) return {};
  return { centreId: { in: user.centreIds } };
}

type Scope = { all: boolean; ids: Set<string> };

function scopeForPermission(user: AuthUser, permission: string): Scope | null {
  const holders = user.grants.filter((grant) => grant.permissions.includes(permission));
  if (holders.length === 0) return null;
  return {
    all: holders.some((grant) => grant.allCentres),
    ids: new Set(holders.flatMap((grant) => grant.centreIds)),
  };
}

function intersect(a: Scope, b: Scope): Scope {
  if (a.all && b.all) return { all: true, ids: new Set() };
  if (a.all) return { all: false, ids: new Set(b.ids) };
  if (b.all) return { all: false, ids: new Set(a.ids) };
  return { all: false, ids: new Set([...a.ids].filter((id) => b.ids.has(id))) };
}

/**
 * Returns a copy of the user whose centre scope is limited to what the *required permissions
 * themselves* allow, or null when the permissions are not held or no centre is in common.
 *
 * Each role assignment carries its own scope, so a write role on Centre A combined with a
 * read-only role on all centres must not grant write access to other centres.
 */
export function narrowUserScope(user: AuthUser, required: string[]): AuthUser | null {
  if (required.length === 0) return user;
  let combined: Scope | null = null;
  for (const permission of required) {
    const scope = scopeForPermission(user, permission);
    if (!scope) return null;
    combined = combined ? intersect(combined, scope) : scope;
  }
  if (!combined) return null;
  if (!combined.all && combined.ids.size === 0) return null;
  return { ...user, allCentres: combined.all, centreIds: [...combined.ids] };
}
