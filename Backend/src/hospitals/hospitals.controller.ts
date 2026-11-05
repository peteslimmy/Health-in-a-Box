import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import { HospitalsService } from './hospitals.service';
import {
  HospitalQueryDto,
  CreateHospitalDto,
  DepartmentDto,
  PaymentChannelDto,
  UpdateHospitalDto,
  UpdateDepartmentDto,
  UpdatePaymentChannelDto,
} from './dto/hospital.dto';

@ApiTags('hospitals')
@ApiBearerAuth()
@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitals: HospitalsService) {}

  @Get()
  @Permissions('hospitals.read')
  list(@CurrentUser() user: AuthUser, @Query() query: HospitalQueryDto) {
    return this.hospitals.list(user, query);
  }

  @Get(':id')
  @Permissions('hospitals.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.hospitals.get(user, id);
  }

  @Post()
  @Permissions('hospitals.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateHospitalDto) {
    return this.hospitals.create(user, dto);
  }

  @Patch(':id')
  @Permissions('hospitals.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHospitalDto,
  ) {
    return this.hospitals.update(user, id, dto);
  }

  @Post(':id/departments')
  @Permissions('hospitals.update')
  addDepartment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepartmentDto,
  ) {
    return this.hospitals.addDepartment(user, id, dto);
  }

  @Patch(':id/departments/:departmentId')
  @Permissions('hospitals.update')
  updateDepartment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.hospitals.updateDepartment(user, id, departmentId, dto);
  }

  @Post(':id/channels')
  @Permissions('hospitals.update')
  addChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaymentChannelDto,
  ) {
    return this.hospitals.addChannel(user, id, dto);
  }

  @Patch(':id/channels/:channelId')
  @Permissions('hospitals.update')
  updateChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: UpdatePaymentChannelDto,
  ) {
    return this.hospitals.updateChannel(user, id, channelId, dto);
  }
}
