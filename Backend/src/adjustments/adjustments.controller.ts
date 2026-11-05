import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import { AdjustmentsService } from './adjustments.service';
import {
  CreateAdjustmentDto,
  CreateOpeningBalanceDto,
  DecisionDto,
  ListQueryDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
} from './dto/adjustment.dto';
import { OpeningBalancesService } from './opening-balances.service';

@ApiTags('adjustments')
@ApiBearerAuth()
@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  @Get()
  @Permissions('adjustments.read')
  @ApiOperation({ summary: 'List credit and debit adjustments' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.adjustments.listAdjustments(user, query);
  }

  @Post()
  @Permissions('adjustments.create')
  @ApiOperation({
    summary: 'Propose a credit or debit adjustment (needs a second person to approve)',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAdjustmentDto) {
    return this.adjustments.createAdjustment(user, dto);
  }

  @Post(':id/approve')
  @Permissions('adjustments.approve')
  @ApiOperation({ summary: 'Approve and post an adjustment (not the proposer)' })
  approve(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.adjustments.approveAdjustment(user, id);
  }

  @Post(':id/reject')
  @Permissions('adjustments.approve')
  @ApiOperation({ summary: 'Reject a proposed adjustment with a reason' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.adjustments.rejectAdjustment(user, id, dto);
  }
}

@ApiTags('disputes')
@ApiBearerAuth()
@Controller('disputes')
export class DisputesController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  @Get()
  @Permissions('disputes.read')
  @ApiOperation({ summary: 'List disputes raised against receivables' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.adjustments.listDisputes(user, query);
  }

  @Post()
  @Permissions('disputes.manage')
  @ApiOperation({ summary: 'Raise a dispute on part of a receivable (flags it as disputed)' })
  raise(@CurrentUser() user: AuthUser, @Body() dto: RaiseDisputeDto) {
    return this.adjustments.raiseDispute(user, dto);
  }

  @Post(':id/resolve')
  @Permissions('disputes.manage')
  @ApiOperation({ summary: 'Resolve a dispute; an upheld one can propose a credit for approval' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.adjustments.resolveDispute(user, id, dto);
  }
}

@ApiTags('opening-balances')
@ApiBearerAuth()
@Controller('opening-balances')
export class OpeningBalancesController {
  constructor(private readonly openingBalances: OpeningBalancesService) {}

  @Get()
  @Permissions('adjustments.read')
  @ApiOperation({ summary: 'List opening balances' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.openingBalances.list(user, query);
  }

  @Post()
  @Permissions('adjustments.create')
  @ApiOperation({ summary: 'Propose an opening balance for a hospital (needs approval)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOpeningBalanceDto) {
    return this.openingBalances.create(user, dto);
  }

  @Post(':id/approve')
  @Permissions('adjustments.approve')
  @ApiOperation({
    summary: 'Approve an opening balance and create its receivable (not the proposer)',
  })
  approve(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.openingBalances.approve(user, id);
  }

  @Post(':id/reject')
  @Permissions('adjustments.approve')
  @ApiOperation({ summary: 'Reject a proposed opening balance with a reason' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.openingBalances.reject(user, id, dto);
  }
}
