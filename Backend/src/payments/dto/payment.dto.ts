import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

export class PaymentQueryDto {
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
  hospitalId?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  hospitalId!: string;

  @ApiProperty({ example: '2026-10-26' })
  @IsDateString()
  receiptDate!: string;

  @ApiProperty({ example: '250000.00', description: 'Decimal string, at most two decimals' })
  @Matches(MONEY, { message: 'amount must be a positive decimal with at most two decimals' })
  amount!: string;

  @ApiProperty({ example: 'BANK_TRANSFER' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  method!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  payerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Set true after reviewing a POSSIBLE_DUPLICATE_PAYMENT warning (same hospital, date and amount)',
  })
  @IsOptional()
  @IsBoolean()
  confirmPossibleDuplicate?: boolean;
}

export class UpdatePaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  receiptDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(MONEY, { message: 'amount must be a positive decimal with at most two decimals' })
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  payerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  confirmPossibleDuplicate?: boolean;
}

export class ReasonDto {
  @ApiProperty({ example: 'Remittance advice shows a different amount' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class AllocationItemDto {
  @ApiProperty()
  @IsUUID()
  receivableId!: string;

  @ApiProperty({ example: '150000.00' })
  @Matches(MONEY, { message: 'amount must be a positive decimal with at most two decimals' })
  amount!: string;
}

export class AllocatePaymentDto {
  @ApiProperty({ type: [AllocationItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique((item: AllocationItemDto) => item.receivableId)
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations!: AllocationItemDto[];

  @ApiPropertyOptional({ example: 'Hospital remittance advice specifies two periods' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
