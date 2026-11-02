import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { parseDate } from '../common/utils/dates';
import { paged, pagination } from '../common/utils/pagination';
import { assertCentreAccess } from '../common/utils/scope';

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  centreId?: string;

  @ApiPropertyOptional({ example: 'CHARGE_RUN_POSTED' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ example: 'ChargeRun' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetType?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Permissions('audit.read')
  @ApiOperation({ summary: "List audit events within the caller's centre scope" })
  async list(@CurrentUser() user: AuthUser, @Query() query: AuditQueryDto) {
    if (query.centreId) assertCentreAccess(user, query.centreId);
    const { page, pageSize, skip, take } = pagination(query);
    const { items, total } = await this.audit.list({
      organizationId: user.organizationId,
      centreIds: user.allCentres ? undefined : user.centreIds,
      centreId: query.centreId,
      action: query.action,
      targetType: query.targetType,
      from: query.from ? parseDate(query.from, 'from') : undefined,
      to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
      skip,
      take,
    });
    return paged(items, total, page, pageSize);
  }
}
