import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import {
  CreateRoleDto,
  CreateUserDto,
  ReplaceAssignmentsDto,
  ResetPasswordDto,
  UpdateRoleDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions('users.read')
  list(@CurrentUser() user: AuthUser, @Query() query: UserQueryDto) {
    return this.users.list(user.organizationId, query);
  }

  @Get(':id')
  @Permissions('users.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(user.organizationId, id);
  }

  @Post()
  @Permissions('users.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user, dto);
  }

  @Patch(':id')
  @Permissions('users.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(user, id, dto);
  }

  @Patch(':id/assignments')
  @Permissions('users.manage')
  replaceAssignments(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceAssignmentsDto,
  ) {
    return this.users.replaceAssignments(user, id, dto.assignments);
  }

  @Post(':id/reset-mfa')
  @Permissions('users.manage')
  resetMfa(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.resetMfa(user, id);
  }

  @Post(':id/reset-password')
  @Permissions('users.manage')
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.users.resetPassword(user, id, dto);
  }
}

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions('roles.read')
  list(@CurrentUser() user: AuthUser) {
    return this.users.listRoles(user.organizationId);
  }

  @Get('permissions')
  @Permissions('roles.read')
  permissions() {
    return this.users.listPermissions();
  }

  @Post()
  @Permissions('roles.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.users.createRole(user, dto);
  }

  @Patch(':id')
  @Permissions('roles.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.users.updateRole(user, id, dto);
  }
}
