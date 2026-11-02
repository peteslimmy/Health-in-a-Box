import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ChargeRunsService } from './charge-runs.service';
import { CalculateChargeRunDto, ChargeRunQueryDto } from './dto/charge-run.dto';

@ApiTags('charge-runs')
@ApiBearerAuth()
@Controller('charge-runs')
export class ChargeRunsController {
  constructor(private readonly runs: ChargeRunsService) {}

  @Get()
  @Permissions('charge_runs.read')
  list(@CurrentUser() user: AuthUser, @Query() query: ChargeRunQueryDto) {
    return this.runs.list(user, query);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Permissions('charge_runs.create')
  preview(@CurrentUser() user: AuthUser, @Body() dto: CalculateChargeRunDto) {
    return this.runs.preview(user, dto);
  }

  @Post()
  @Permissions('charge_runs.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CalculateChargeRunDto) {
    return this.runs.create(user, dto);
  }

  @Get(':id')
  @Permissions('charge_runs.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.get(user, id);
  }

  @Post(':id/recalculate')
  @HttpCode(HttpStatus.OK)
  @Permissions('charge_runs.create')
  recalculate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.recalculate(user, id);
  }

  @Post(':id/submit-review')
  @HttpCode(HttpStatus.OK)
  @Permissions('charge_runs.submit')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.submit(user, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('charge_runs.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.approve(user, id);
  }

  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @Permissions('charge_runs.post')
  post(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.post(user, id);
  }
}
