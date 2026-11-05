import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { HospitalStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsIanaTimeZone } from '../../common/validators/iana-time-zone';

export class CreateHospitalDto {
  @ApiProperty({ example: 'HNB-LAG-001' })
  @IsString()
  @Length(2, 20)
  code!: string;

  @ApiProperty({ example: 'Lekki Phase 1 Hospital' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @ApiPropertyOptional({ enum: HospitalStatus })
  @IsOptional()
  @IsEnum(HospitalStatus)
  status?: HospitalStatus;

  @ApiPropertyOptional({ example: 'Africa/Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  gracePeriodDays?: number;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  openedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateHospitalDto extends PartialType(CreateHospitalDto) {}

export class HospitalQueryDto {
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

  @ApiPropertyOptional({ enum: HospitalStatus })
  @IsOptional()
  @IsEnum(HospitalStatus)
  status?: HospitalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class DepartmentDto {
  @ApiProperty({ example: 'CONSULT' })
  @IsString()
  @Length(2, 30)
  code!: string;

  @ApiProperty({ example: 'Consultation' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  aliases?: string[];
}

export class UpdateDepartmentDto extends PartialType(DepartmentDto) {}

export class PaymentChannelDto {
  @ApiProperty({ example: 'CASH' })
  @IsString()
  @Length(2, 30)
  code!: string;

  @ApiProperty({ example: 'Cash' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  aliases?: string[];
}

export class UpdatePaymentChannelDto extends PartialType(PaymentChannelDto) {}
