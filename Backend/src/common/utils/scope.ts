import { NotFoundException } from '@nestjs/common';
import { AuthUser } from '../types/auth-user';

export function assertHospitalAccess(user: AuthUser, hospitalId: string): void {
  if (user.allHospitals) return;
  if (!user.hospitalIds.includes(hospitalId)) {
    throw new NotFoundException('Hospital not found');
  }
}

export function accessibleHospitalIds(user: AuthUser): string[] | undefined {
  return user.allHospitals ? undefined : user.hospitalIds;
}

export function hospitalWhere(user: AuthUser, requestedHospitalId?: string) {
  if (requestedHospitalId) {
    assertHospitalAccess(user, requestedHospitalId);
    return { hospitalId: requestedHospitalId };
  }
  if (user.allHospitals) return {};
  return { hospitalId: { in: user.hospitalIds } };
}

type Scope = { all: boolean; ids: Set<string> };

function scopeForPermission(user: AuthUser, permission: string): Scope | null {
  const holders = user.grants.filter((grant) => grant.permissions.includes(permission));
  if (holders.length === 0) return null;
  return {
    all: holders.some((grant) => grant.allHospitals),
    ids: new Set(holders.flatMap((grant) => grant.hospitalIds)),
  };
}

function intersect(a: Scope, b: Scope): Scope {
  if (a.all && b.all) return { all: true, ids: new Set() };
  if (a.all) return { all: false, ids: new Set(b.ids) };
  if (b.all) return { all: false, ids: new Set(a.ids) };
  return { all: false, ids: new Set([...a.ids].filter((id) => b.ids.has(id))) };
}

/**
 * Returns a copy of the user whose hospital scope is limited to what the *required permissions
 * themselves* allow, or null when the permissions are not held or no hospital is in common.
 *
 * Each role assignment carries its own scope, so a write role on Hospital A combined with a
 * read-only role on all hospitals must not grant write access to other hospitals.
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
  return { ...user, allHospitals: combined.all, hospitalIds: [...combined.ids] };
}
