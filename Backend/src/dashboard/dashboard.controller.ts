import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/types/auth-user';
import { DashboardService } from './dashboard.service';
import { InsightsService } from './insights.service';

export class DashboardQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  centreId?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Defaults to the first of this month',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class TrendQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  centreId?: string;

  @ApiPropertyOptional({ example: 12, description: 'Number of calendar months to show (3 to 24)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(24)
  months?: number;
}

export class CollectionQueryDto extends TrendQueryDto {
  @ApiPropertyOptional({
    example: 30,
    description: 'Days after the due date within which payment counts as on time (7 to 120)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(120)
  windowDays?: number;
}

export class ReportingStatusQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  centreId?: string;
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly insights: InsightsService,
  ) {}

  @Get('summary')
  @Permissions('dashboard.read')
  @ApiOperation({ summary: 'Headline measures, each with its own label and date basis' })
  summary(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.dashboard.summary(user, query);
  }

  @Get('trends')
  @Permissions('dashboard.read')
  @ApiOperation({ summary: 'Monthly charges, receipts, reported revenue and receivable balance' })
  trends(@CurrentUser() user: AuthUser, @Query() query: TrendQueryDto) {
    return this.dashboard.trends(user, query);
  }

  @Get('collection')
  @Permissions('dashboard.read', 'receivables.read')
  @ApiOperation({ summary: 'On-time collection rate by the month receivables fell due' })
  collection(@CurrentUser() user: AuthUser, @Query() query: CollectionQueryDto) {
    return this.dashboard.collection(user, query);
  }

  @Get('reporting-status')
  @Permissions('dashboard.read')
  @ApiOperation({ summary: 'When each active centre last reported, and which are late' })
  reportingStatus(@CurrentUser() user: AuthUser, @Query() query: ReportingStatusQueryDto) {
    return this.dashboard.reportingStatus(user, query);
  }

  @Get('insights')
  @Permissions('dashboard.read')
  @ApiOperation({ summary: 'Rule-based observations with the figures and periods behind each' })
  insightsList(@CurrentUser() user: AuthUser, @Query() query: ReportingStatusQueryDto) {
    return this.insights.insights(user, query);
  }
}
