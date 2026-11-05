import { ForbiddenException } from '@nestjs/common';
import { SUPER_ADMIN_ROLE } from '../../access/access-rules';
import { AuthUser } from '../types/auth-user';

/**
 * Hospital configuration is centralised: only the platform owner may change it, regardless of
 * how broad the caller's hospital scope happens to be.
 */
export function assertSuperAdmin(user: AuthUser): void {
  if (!user.roleCodes.includes(SUPER_ADMIN_ROLE)) {
    throw new ForbiddenException({
      code: 'SUPER_ADMIN_REQUIRED',
      message: 'Only a super admin can change hospital configuration',
    });
  }
}
