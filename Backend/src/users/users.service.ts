import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AccessPolicyService } from '../access/access-policy.service';
import { SUPER_ADMIN_ROLE } from '../access/access-rules';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { paged, pagination } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { assertNoRoleConflicts, assertWithinCeiling } from './role-policy';
import {
  AssignmentDto,
  CreateRoleDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateRoleDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';

const assignmentInclude = {
  role: { select: { id: true, code: true, name: true, isActive: true } },
  centre: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserRoleAssignmentInclude;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessPolicyService,
  ) {}

  async list(organizationId: string, query: UserQueryDto) {
    const { page, pageSize, skip, take } = pagination(query);
    const where: Prisma.UserWhereInput = {
      organizationId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { fullName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { email: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          email: true,
          fullName: true,
          isActive: true,
          mfaEnabled: true,
          lastLoginAt: true,
          createdAt: true,
          roleAssignments: { include: assignmentInclude },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return paged(items, total, page, pageSize);
  }

  async get(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        roleAssignments: { include: assignmentInclude },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(user: AuthUser, dto: CreateUserDto) {
    const roleCodes = await this.validateAssignments(user, dto.assignments);
    // Gmail is only for registered super admins; everyone else needs an approved domain.
    await this.access.assert(user.organizationId, dto.email, roleCodes.includes(SUPER_ADMIN_ROLE));
    const passwordHash = await argon2.hash(dto.password);
    const created = await this.prisma.user.create({
      data: {
        organizationId: user.organizationId,
        email: dto.email.trim().toLowerCase(),
        fullName: dto.fullName.trim(),
        passwordHash,
        isActive: dto.isActive ?? true,
        roleAssignments: {
          create: dto.assignments.map((assignment) => ({
            organizationId: user.organizationId,
            roleId: assignment.roleId,
            centreId: assignment.centreId ?? null,
          })),
        },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        createdAt: true,
        roleAssignments: { include: assignmentInclude },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'USER_CREATED',
      targetType: 'User',
      targetId: created.id,
      summary: `Created user ${created.email}`,
      after: { email: created.email, fullName: created.fullName },
    });
    return created;
  }

  async update(user: AuthUser, id: string, dto: UpdateUserDto) {
    const existing = await this.get(user.organizationId, id);
    await this.assertCanAdminister(user, id);
    if (id === user.id && dto.isActive === false) {
      throw new ForbiddenException({
        code: 'SELF_DEACTIVATION_FORBIDDEN',
        message: 'You cannot deactivate your own account',
      });
    }
    if (dto.email) {
      await this.access.assert(
        user.organizationId,
        dto.email,
        existing.roleAssignments.some((a) => a.role.code === SUPER_ADMIN_ROLE),
      );
    }
    if (
      dto.isActive === false &&
      existing.roleAssignments.some((a) => a.role.code === SUPER_ADMIN_ROLE)
    ) {
      // The platform must always keep someone who can manage it.
      const others = await this.prisma.user.count({
        where: {
          organizationId: user.organizationId,
          isActive: true,
          id: { not: id },
          roleAssignments: { some: { role: { code: SUPER_ADMIN_ROLE } } },
        },
      });
      if (others === 0) {
        throw new ConflictException({
          code: 'LAST_SUPER_ADMIN',
          message: 'This is the only active super admin; register another before deactivating it',
        });
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email ? { email: dto.email.trim().toLowerCase() } : {}),
        ...(dto.fullName ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: { id: true, email: true, fullName: true, isActive: true, updatedAt: true },
    });
    if (dto.isActive === false) {
      await this.prisma.refreshSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'USER_UPDATED',
      targetType: 'User',
      targetId: id,
      summary: `Updated user ${updated.email}`,
      before: { email: existing.email, fullName: existing.fullName, isActive: existing.isActive },
      after: { email: updated.email, fullName: updated.fullName, isActive: updated.isActive },
    });
    return updated;
  }

  async replaceAssignments(user: AuthUser, id: string, assignments: AssignmentDto[]) {
    const before = await this.get(user.organizationId, id);
    await this.assertCanAdminister(user, id);
    if (id === user.id) {
      throw new ForbiddenException({
        code: 'SELF_ASSIGNMENT_FORBIDDEN',
        message: 'You cannot change your own role assignments',
      });
    }
    const roleCodes = await this.validateAssignments(user, assignments);
    // The role decides which rule applies to this address (a Gmail account must stay a super admin).
    await this.access.assert(
      user.organizationId,
      before.email,
      roleCodes.includes(SUPER_ADMIN_ROLE),
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.deleteMany({ where: { userId: id } });
      await tx.userRoleAssignment.createMany({
        data: assignments.map((assignment) => ({
          organizationId: user.organizationId,
          userId: id,
          roleId: assignment.roleId,
          centreId: assignment.centreId ?? null,
        })),
      });
      return tx.user.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          email: true,
          fullName: true,
          isActive: true,
          roleAssignments: { include: assignmentInclude },
        },
      });
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'USER_ROLES_UPDATED',
      targetType: 'User',
      targetId: id,
      summary: `Updated role assignments for ${updated.email}`,
      before: { assignments: this.assignmentSummary(before.roleAssignments) },
      after: { assignments: this.assignmentSummary(updated.roleAssignments) },
    });
    return updated;
  }

  async resetPassword(user: AuthUser, id: string, dto: ResetPasswordDto) {
    const existing = await this.get(user.organizationId, id);
    await this.assertCanAdminister(user, id);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await argon2.hash(dto.password) },
    });
    await this.prisma.refreshSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'USER_PASSWORD_RESET',
      targetType: 'User',
      targetId: id,
      summary: `Reset password for ${existing.email}`,
    });
    return { success: true };
  }

  /**
   * Lost phone: removes the authenticator and recovery codes and ends every session. At the next
   * sign-in the person must set up a new authenticator (when their access requires one).
   */
  async resetMfa(user: AuthUser, id: string) {
    const existing = await this.get(user.organizationId, id);
    await this.assertCanAdminister(user, id);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          mfaEnabled: false,
          mfaSecretEnc: null,
          mfaPendingSecretEnc: null,
          mfaEnrolledAt: null,
          mfaLastStep: null,
          mfaFailedAttempts: 0,
          mfaLockedUntil: null,
        },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: id } }),
      this.prisma.refreshSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'USER_MFA_RESET',
      targetType: 'User',
      targetId: id,
      summary: `Reset the second factor for ${existing.email}`,
    });
    return { success: true };
  }

  async listRoles(organizationId: string) {
    return this.prisma.role.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: {
        permissions: {
          include: { permission: { select: { code: true, name: true, group: true } } },
        },
        _count: { select: { assignments: true } },
      },
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { code: 'asc' }],
    });
  }

  async createRole(user: AuthUser, dto: CreateRoleDto) {
    assertWithinCeiling(user.permissions, dto.permissionCodes);
    const permissionIds = await this.resolvePermissions(dto.permissionCodes);
    const role = await this.prisma.role.create({
      data: {
        organizationId: user.organizationId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'ROLE_CREATED',
      targetType: 'Role',
      targetId: role.id,
      summary: `Created role ${role.code}`,
      after: {
        code: role.code,
        name: role.name,
        permissions: role.permissions.map((p) => p.permission.code).sort(),
      },
    });
    return role;
  }

  async updateRole(user: AuthUser, id: string, dto: UpdateRoleDto) {
    const existing = await this.prisma.role.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem) {
      throw new ConflictException({
        code: 'SYSTEM_ROLE_PROTECTED',
        message: 'Built-in roles cannot be edited; create a custom role instead',
      });
    }
    if (dto.permissionCodes !== undefined) {
      assertWithinCeiling(user.permissions, dto.permissionCodes);
    }
    const permissionIds =
      dto.permissionCodes !== undefined
        ? await this.resolvePermissions(dto.permissionCodes)
        : undefined;
    const role = await this.prisma.$transaction(async (tx) => {
      if (permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
      }
      return tx.role.update({
        where: { id },
        data: {
          ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(permissionIds
            ? { permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) } }
            : {}),
        },
        include: { permissions: { include: { permission: true } } },
      });
    });
    await this.audit.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'ROLE_UPDATED',
      targetType: 'Role',
      targetId: id,
      summary: `Updated role ${role.code}`,
      before: {
        code: existing.code,
        name: existing.name,
        permissions: existing.permissions.map((p) => p.permission.code).sort(),
      },
      after: {
        code: role.code,
        name: role.name,
        permissions: role.permissions.map((p) => p.permission.code).sort(),
      },
    });
    return role;
  }

  /**
   * Account takeover guard: resetting a password, changing the email or replacing the roles of
   * another user is only allowed when the administrator already holds every permission that
   * user holds. Otherwise a narrow "manage users" role could be used to sign in as an Admin.
   */
  private async assertCanAdminister(actor: AuthUser, targetId: string) {
    if (targetId === actor.id) return;
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId: targetId, organizationId: actor.organizationId, role: { isActive: true } },
      select: {
        centreId: true,
        role: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
      },
    });
    const held = new Set(actor.permissions);
    const above = [
      ...new Set(
        assignments.flatMap((assignment) =>
          assignment.role.permissions.map((p) => p.permission.code),
        ),
      ),
    ].filter((code) => !held.has(code));
    // A centre-scoped administrator may only administer users who work entirely inside their own
    // centres; otherwise replacing or resetting would reach access they do not control.
    const outsideScope =
      !actor.allCentres &&
      assignments.some((a) => !a.centreId || !actor.centreIds.includes(a.centreId));
    if (above.length > 0 || outsideScope) {
      throw new ForbiddenException({
        code: 'ACCOUNT_OUTRANKS_YOU',
        message: 'You cannot administer an account that holds permissions you do not hold yourself',
      });
    }
  }

  private assignmentSummary(
    assignments: Array<{ role: { code: string }; centre: { code: string } | null }>,
  ): Prisma.InputJsonValue {
    return assignments.map((assignment) => ({
      role: assignment.role.code,
      centre: assignment.centre?.code ?? null,
    }));
  }

  private async validateAssignments(
    actor: AuthUser,
    assignments: AssignmentDto[],
  ): Promise<string[]> {
    const organizationId = actor.organizationId;
    const roleIds = [...new Set(assignments.map((assignment) => assignment.roleId))];
    const centreIds = [
      ...new Set(
        assignments.map((assignment) => assignment.centreId).filter((id): id is string => !!id),
      ),
    ];
    const [roles, centres] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where: { organizationId, id: { in: roleIds }, isActive: true },
        include: { permissions: { include: { permission: { select: { code: true } } } } },
      }),
      this.prisma.centre.count({ where: { organizationId, id: { in: centreIds } } }),
    ]);
    if (roles.length !== roleIds.length)
      throw new BadRequestException('One or more roles are invalid');
    if (centres !== centreIds.length)
      throw new BadRequestException('One or more centres are invalid');

    const rolePermissions = roles.map((role) => ({
      code: role.code,
      permissions: role.permissions.map((p) => p.permission.code),
    }));
    // ...and only for centres they can access themselves (no all-centres grants from a scoped admin).
    if (!actor.allCentres) {
      const outside = assignments.filter(
        (a) => !a.centreId || !actor.centreIds.includes(a.centreId),
      );
      if (outside.length > 0) {
        throw new ForbiddenException({
          code: 'CENTRE_SCOPE_EXCEEDED',
          message: 'You can only grant access to centres you have access to yourself',
        });
      }
    }
    // An administrator can only hand out roles whose permissions they hold themselves.
    assertWithinCeiling(
      actor.permissions,
      rolePermissions.flatMap((role) => role.permissions),
    );
    assertNoRoleConflicts(rolePermissions);
    // A super admin works across the whole organisation, never for one centre.
    const superAdminRole = roles.find((role) => role.code === SUPER_ADMIN_ROLE);
    if (superAdminRole && assignments.some((a) => a.roleId === superAdminRole.id && a.centreId)) {
      throw new BadRequestException({
        code: 'SUPER_ADMIN_ALL_CENTRES',
        message: 'The super admin role applies to all centres',
      });
    }
    return roles.map((role) => role.code);
  }

  private async resolvePermissions(codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: unique } },
      select: { id: true, code: true },
    });
    if (permissions.length !== unique.length) {
      throw new BadRequestException('One or more permission codes are invalid');
    }
    return permissions.map((permission) => permission.id);
  }
}
