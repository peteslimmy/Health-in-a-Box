import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import {
  AllocatePaymentDto,
  CreatePaymentDto,
  PaymentQueryDto,
  ReasonDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @Permissions('payments.read')
  @ApiOperation({ summary: "List receipts within the caller's centre scope" })
  list(@CurrentUser() user: AuthUser, @Query() query: PaymentQueryDto) {
    return this.payments.list(user, query);
  }

  // Declared before ':id' so "unallocated" is never captured as an id.
  @Get('unallocated')
  @Permissions('payments.read')
  @ApiOperation({ summary: 'Worklist of posted receipts with cash not yet allocated' })
  unallocated(@CurrentUser() user: AuthUser, @Query() query: PaymentQueryDto) {
    return this.payments.unallocated(user, query);
  }

  @Get(':id')
  @Permissions('payments.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(user, id);
  }

  @Post()
  @Permissions('payments.create')
  @ApiOperation({ summary: 'Record a draft receipt (duplicate references are blocked)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.payments.create(user, dto);
  }

  @Patch(':id')
  @Permissions('payments.create')
  @ApiOperation({ summary: 'Edit a draft or rejected receipt (recorder only)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.payments.update(user, id, dto);
  }

  @Post(':id/submit')
  @Permissions('payments.create')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.submit(user, id);
  }

  @Post(':id/approve')
  @Permissions('payments.approve')
  @ApiOperation({ summary: 'Approve a submitted receipt (cannot be the recorder)' })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.approve(user, id);
  }

  @Post(':id/reject')
  @Permissions('payments.approve')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payments.reject(user, id, dto.reason);
  }

  @Post(':id/post')
  @Permissions('payments.post')
  @ApiOperation({ summary: 'Post an approved receipt as received funds (cannot be the recorder)' })
  post(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.post(user, id);
  }

  @Post(':id/reverse')
  @Permissions('payments.reverse')
  @ApiOperation({ summary: 'Reverse a posted receipt that has no active allocations' })
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payments.reverse(user, id, dto.reason);
  }

  @Post(':id/allocation-preview')
  @Permissions('payments.allocate')
  @ApiOperation({ summary: 'Open receivables and an oldest-first suggestion; commits nothing' })
  preview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.allocationPreview(user, id);
  }

  @Post(':id/allocations')
  @Permissions('payments.allocate')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Allocate a posted receipt to receivables (all-or-nothing)' })
  allocate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AllocatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.allocate(user, id, dto, idempotencyKey);
  }
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payment-allocations')
export class PaymentAllocationsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/reverse')
  @Permissions('payments.reverse')
  @ApiOperation({ summary: 'Reverse an allocation (cannot be the person who made it)' })
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payments.reverseAllocation(user, id, dto.reason);
  }
}
