import { ConflictException, ForbiddenException } from '@nestjs/common';

export const AUDITOR_ROLE_CODE = 'AUDITOR';

export type RolePermissions = { code: string; permissions: string[] };

/** Read-only permissions end in `.read`; anything else can change data. */
export function isWritePermission(permission: string): boolean {
  return !permission.endsWith('.read');
}

/**
 * Privilege ceiling: an administrator may only grant permissions they hold themselves, so
 * role administration can never be used to escalate beyond the administrator's own access.
 */
export function assertWithinCeiling(actorPermissions: string[], requested: string[]): void {
  const held = new Set(actorPermissions);
  const above = [...new Set(requested)].filter((permission) => !held.has(permission));
  if (above.length > 0) {
    throw new ForbiddenException({
      code: 'PRIVILEGE_CEILING_EXCEEDED',
      message: 'You cannot grant permissions that you do not hold yourself',
      details: above.map((permission) => ({ field: 'permissions', code: permission })),
    });
  }
}

/**
 * Role-conflict rule: the Auditor role must stay independent, so it cannot be combined with
 * any role that can change data.
 */
export function findRoleConflicts(roles: RolePermissions[]): string[] {
  const hasAuditor = roles.some((role) => role.code === AUDITOR_ROLE_CODE);
  if (!hasAuditor) return [];
  return roles
    .filter((role) => role.code !== AUDITOR_ROLE_CODE)
    .filter((role) => role.permissions.some(isWritePermission))
    .map((role) => role.code);
}

export function assertNoRoleConflicts(roles: RolePermissions[]): void {
  const conflicts = findRoleConflicts(roles);
  if (conflicts.length > 0) {
    throw new ConflictException({
      code: 'ROLE_CONFLICT',
      message: 'The Auditor role cannot be combined with roles that can change data',
      details: conflicts.map((code) => ({ field: 'assignments', code, message: code })),
    });
  }
}
