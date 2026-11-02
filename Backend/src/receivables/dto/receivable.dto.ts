import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReceivableStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ReceivableQueryDto {
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

  @ApiPropertyOptional({ enum: ReceivableStatus })
  @IsOptional()
  @IsEnum(ReceivableStatus)
  status?: ReceivableStatus;

  @ApiPropertyOptional({ description: 'Only receivables with an open balance' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  openOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only receivables overdue at the as-at date' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional({ example: '2026-10-27', description: 'Defaults to today in Africa/Lagos' })
  @IsOptional()
  @IsDateString()
  asAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AgeingQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  centreId?: string;

  @ApiPropertyOptional({ example: '2026-10-27', description: 'Defaults to today in Africa/Lagos' })
  @IsOptional()
  @IsDateString()
  asAt?: string;
}
