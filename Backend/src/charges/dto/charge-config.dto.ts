import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RoundingMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const AGREEMENT_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;
export const RULE_BASES = ['PERCENTAGE'] as const;

export class CreateAgreementDto {
  @ApiProperty({ example: '2026 Commercial Agreement' })
  @IsString()
  @Length(2, 160)
  name!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional({ enum: AGREEMENT_STATUSES, default: 'ACTIVE' })
  @IsOptional()
  @IsIn(AGREEMENT_STATUSES)
  status?: (typeof AGREEMENT_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateAgreementDto extends PartialType(CreateAgreementDto) {}

export class AgreementQueryDto {
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

  @ApiPropertyOptional({ enum: AGREEMENT_STATUSES })
  @IsOptional()
  @IsIn(AGREEMENT_STATUSES)
  status?: (typeof AGREEMENT_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
}

export class CreateChargeRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentChannelId?: string;

  @ApiProperty({ example: 'Consultation service charge' })
  @IsString()
  @Length(2, 160)
  name!: string;

  @ApiPropertyOptional({ enum: RULE_BASES, default: 'PERCENTAGE' })
  @IsOptional()
  @IsIn(RULE_BASES)
  basis?: (typeof RULE_BASES)[number];

  @ApiProperty({ example: 7.5 })
  @Type(() => Number)
  rate!: number;

  @ApiPropertyOptional({
    description: 'The department or channel is exempt from the service charge (rate must be 0)',
  })
  @IsOptional()
  @IsBoolean()
  isExempt?: boolean;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional({ default: 0, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({ enum: RoundingMode, default: RoundingMode.HALF_UP })
  @IsOptional()
  @IsEnum(RoundingMode)
  rounding?: RoundingMode;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateChargeRuleDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  paymentChannelId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 160)
  name?: string;

  @ApiPropertyOptional({ enum: RULE_BASES })
  @IsOptional()
  @IsIn(RULE_BASES)
  basis?: (typeof RULE_BASES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  rate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isExempt?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({ enum: RoundingMode })
  @IsOptional()
  @IsEnum(RoundingMode)
  rounding?: RoundingMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
export class ChargeRuleQueryDto {
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
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentChannelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
