import { AuthUser, Grant } from '../common/types/auth-user';

/** Test-only helpers. Every amount, name and id here is a fixture, never real data. */
export function grant(roleCode: string, permissions: string[], scope: 'ALL' | string[]): Grant {
  return {
    roleCode,
    permissions,
    allHospitals: scope === 'ALL',
    hospitalIds: scope === 'ALL' ? [] : scope,
  };
}

export function makeUser(id: string, grants: Grant[]): AuthUser {
  return {
    id,
    organizationId: 'org-1',
    email: `${id}@test.local`,
    fullName: id,
    roleCodes: grants.map((g) => g.roleCode),
    permissions: [...new Set(grants.flatMap((g) => g.permissions))],
    allHospitals: grants.some((g) => g.allHospitals),
    hospitalIds: [...new Set(grants.flatMap((g) => g.hospitalIds))],
    grants,
  };
}

export function allHospitalsUser(id: string, permissions: string[] = []): AuthUser {
  return makeUser(id, [grant('TEST', permissions, 'ALL')]);
}

export function superAdminUser(id: string, permissions: string[] = []): AuthUser {
  return makeUser(id, [grant('SUPER_ADMIN', permissions, 'ALL')]);
}

export const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
