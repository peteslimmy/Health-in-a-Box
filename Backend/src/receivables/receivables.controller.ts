import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import { AgeingQueryDto, ReceivableQueryDto } from './dto/receivable.dto';
import { ReceivablesService } from './receivables.service';

@ApiTags('receivables')
@ApiBearerAuth()
@Controller('receivables')
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  @Permissions('receivables.read')
  @ApiOperation({ summary: 'List receivables with ageing bucket as at a date' })
  list(@CurrentUser() user: AuthUser, @Query() query: ReceivableQueryDto) {
    return this.receivables.list(user, query);
  }

  // Declared before ':id' so "ageing" is never captured as an id.
  @Get('ageing')
  @Permissions('receivables.read')
  @ApiOperation({ summary: 'Outstanding balances per ageing bucket, per hospital and in total' })
  ageing(@CurrentUser() user: AuthUser, @Query() query: AgeingQueryDto) {
    return this.receivables.ageing(user, query);
  }

  @Get(':id')
  @Permissions('receivables.read')
  @ApiOperation({ summary: 'Receivable with ledger history, allocations and a ledger cross-check' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('asAt') asAt?: string,
  ) {
    return this.receivables.get(user, id, asAt);
  }
}
