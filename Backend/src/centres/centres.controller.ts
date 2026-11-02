import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CentresService } from './centres.service';
import {
  CentreQueryDto,
  CreateCentreDto,
  DepartmentDto,
  PaymentChannelDto,
  UpdateCentreDto,
  UpdateDepartmentDto,
  UpdatePaymentChannelDto,
} from './dto/centre.dto';

@ApiTags('centres')
@ApiBearerAuth()
@Controller('centres')
export class CentresController {
  constructor(private readonly centres: CentresService) {}

  @Get()
  @Permissions('centres.read')
  list(@CurrentUser() user: AuthUser, @Query() query: CentreQueryDto) {
    return this.centres.list(user, query);
  }

  @Get(':id')
  @Permissions('centres.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.centres.get(user, id);
  }

  @Post()
  @Permissions('centres.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCentreDto) {
    return this.centres.create(user, dto);
  }

  @Patch(':id')
  @Permissions('centres.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCentreDto,
  ) {
    return this.centres.update(user, id, dto);
  }

  @Post(':id/departments')
  @Permissions('centres.update')
  addDepartment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepartmentDto,
  ) {
    return this.centres.addDepartment(user, id, dto);
  }

  @Patch(':id/departments/:departmentId')
  @Permissions('centres.update')
  updateDepartment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.centres.updateDepartment(user, id, departmentId, dto);
  }

  @Post(':id/channels')
  @Permissions('centres.update')
  addChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaymentChannelDto,
  ) {
    return this.centres.addChannel(user, id, dto);
  }

  @Patch(':id/channels/:channelId')
  @Permissions('centres.update')
  updateChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: UpdatePaymentChannelDto,
  ) {
    return this.centres.updateChannel(user, id, channelId, dto);
  }
}
