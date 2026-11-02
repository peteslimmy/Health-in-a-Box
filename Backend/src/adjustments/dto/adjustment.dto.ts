import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ADJUSTMENT_REASONS } from '../adjustment-math';

const MONEY = /^(?!0+(\.0+)?$)\d{1,16}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'amount must be a positive decimal with at most two decimals';

export class ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  centreId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  receivableId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @ApiPropertyOptional({ enum: ['CREDIT', 'DEBIT'] })
  @IsOptional()
  @IsIn(['CREDIT', 'DEBIT'])
  type?: 'CREDIT' | 'DEBIT';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateAdjustmentDto {
  @ApiProperty()
  @IsUUID()
  receivableId!: string;

  @ApiProperty({ enum: ['CREDIT', 'DEBIT'] })
  @IsIn(['CREDIT', 'DEBIT'])
  type!: 'CREDIT' | 'DEBIT';

  @ApiProperty({ example: '25000.00' })
  @Matches(MONEY, { message: MONEY_MESSAGE })
  amount!: string;

  @ApiProperty({ enum: ADJUSTMENT_REASONS })
  @IsIn([...ADJUSTMENT_REASONS])
  reasonCode!: string;

  @ApiProperty({ description: 'Why the adjustment is needed (10 to 1000 characters)' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class DecisionDto {
  @ApiPropertyOptional({ description: 'Required when rejecting' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note?: string;
}

export class RaiseDisputeDto {
  @ApiProperty()
  @IsUUID()
  receivableId!: string;

  @ApiProperty({ example: '10000.00', description: 'The part of the balance in dispute' })
  @Matches(MONEY, { message: MONEY_MESSAGE })
  amount!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: ['UPHELD', 'REJECTED', 'WITHDRAWN'] })
  @IsIn(['UPHELD', 'REJECTED', 'WITHDRAWN'])
  outcome!: 'UPHELD' | 'REJECTED' | 'WITHDRAWN';

  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  note!: string;

  @ApiPropertyOptional({
    description:
      'When upheld, also propose a credit adjustment for the disputed amount (needs approval)',
  })
  @IsOptional()
  @IsBoolean()
  proposeCredit?: boolean;
}

export class CreateOpeningBalanceDto {
  @ApiProperty()
  @IsUUID()
  centreId!: string;

  @ApiProperty({ example: '2026-08-31', description: 'The date the balance is stated as at' })
  @IsDateString()
  asAt!: string;

  @ApiProperty({ example: '1500000.00' })
  @Matches(MONEY, { message: MONEY_MESSAGE })
  amount!: string;

  @ApiProperty({ example: '2026-11-30' })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({
    description:
      'Where the figure comes from, e.g. the signed statement or ledger it was taken from',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  sourceNote!: string;
}
