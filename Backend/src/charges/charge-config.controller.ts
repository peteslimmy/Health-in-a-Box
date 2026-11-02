import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ChargeConfigService } from './charge-config.service';
import {
  AgreementQueryDto,
  ChargeRuleQueryDto,
  CreateAgreementDto,
  CreateChargeRuleDto,
  UpdateAgreementDto,
  UpdateChargeRuleDto,
} from './dto/charge-config.dto';

@ApiTags('charge-config')
@ApiBearerAuth()
@Controller()
export class ChargeConfigController {
  constructor(private readonly config: ChargeConfigService) {}

  @Get('centres/:centreId/agreements')
  @Permissions('charge_rules.read')
  listAgreements(
    @CurrentUser() user: AuthUser,
    @Param('centreId', ParseUUIDPipe) centreId: string,
    @Query() query: AgreementQueryDto,
  ) {
    return this.config.listAgreements(user, centreId, query);
  }

  @Post('centres/:centreId/agreements')
  @Permissions('charge_rules.manage')
  createAgreement(
    @CurrentUser() user: AuthUser,
    @Param('centreId', ParseUUIDPipe) centreId: string,
    @Body() dto: CreateAgreementDto,
  ) {
    return this.config.createAgreement(user, centreId, dto);
  }

  @Patch('agreements/:id')
  @Permissions('charge_rules.manage')
  updateAgreement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgreementDto,
  ) {
    return this.config.updateAgreement(user, id, dto);
  }

  @Get('agreements/:agreementId/charge-rules')
  @Permissions('charge_rules.read')
  listRules(
    @CurrentUser() user: AuthUser,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Query() query: ChargeRuleQueryDto,
  ) {
    return this.config.listRules(user, agreementId, query);
  }

  @Post('agreements/:agreementId/charge-rules')
  @Permissions('charge_rules.manage')
  createRule(
    @CurrentUser() user: AuthUser,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: CreateChargeRuleDto,
  ) {
    return this.config.addRule(user, agreementId, dto);
  }

  @Patch('charge-rules/:id')
  @Permissions('charge_rules.manage')
  updateRule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChargeRuleDto,
  ) {
    return this.config.updateRule(user, id, dto);
  }
}
