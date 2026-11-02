import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  assertNoRoleConflicts,
  assertWithinCeiling,
  findRoleConflicts,
  isWritePermission,
} from './role-policy';

describe('role administration policy', () => {
  describe('privilege ceiling', () => {
    it('allows granting only permissions the administrator holds', () => {
      expect(() => assertWithinCeiling(['a.read', 'b.manage'], ['a.read'])).not.toThrow();
    });

    it('blocks granting a permission the administrator does not hold', () => {
      expect(() => assertWithinCeiling(['a.read'], ['a.read', 'users.manage'])).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('role conflicts', () => {
    const auditor = { code: 'AUDITOR', permissions: ['reports.read', 'audit.read'] };
    const officer = { code: 'FINANCE_OFFICER', permissions: ['imports.manage', 'reports.read'] };
    const viewer = { code: 'VIEWER', permissions: ['reports.read'] };

    it('classifies .read as read-only and anything else as a write', () => {
      expect(isWritePermission('payments.read')).toBe(false);
      expect(isWritePermission('payments.allocate')).toBe(true);
    });

    it('blocks Auditor combined with a role that can change data', () => {
      expect(findRoleConflicts([auditor, officer])).toEqual(['FINANCE_OFFICER']);
      expect(() => assertNoRoleConflicts([auditor, officer])).toThrow(ConflictException);
    });

    it('allows Auditor with read-only roles, and write roles without Auditor', () => {
      expect(() => assertNoRoleConflicts([auditor, viewer])).not.toThrow();
      expect(() => assertNoRoleConflicts([officer, viewer])).not.toThrow();
    });
  });
});
