import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsIanaTimeZone } from '../../common/validators/iana-time-zone';

export class SetupHospitalDto {
  @ApiProperty({ example: 'UATH' })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,19}$/, {
    message: 'The hospital code must be 2 to 20 letters, digits, dashes or underscores',
  })
  code!: string;

  @ApiProperty({ example: 'University of Abuja Teaching Hospital, Gwagwalada' })
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

  @ApiPropertyOptional({ example: 'Africa/Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @IsIanaTimeZone()
  timezone?: string;

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
}

const ITEM_CODE = /^[A-Za-z0-9][A-Za-z0-9_]{1,25}$/;

export class SetupItemDto {
  @ApiProperty({ description: 'Name or heading exactly as printed in the report' })
  @IsString()
  @Length(1, 160)
  printedName!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 160)
  name!: string;

  @ApiProperty({ example: 'PHARMACY' })
  @IsString()
  @Matches(ITEM_CODE, { message: 'Codes are 2 to 26 letters, digits or underscores' })
  code!: string;
}

export class SetupTermsDto {
  @ApiProperty({ example: '2026 service agreement' })
  @IsString()
  @Length(2, 160)
  agreementName!: string;

  @ApiProperty({ example: 7.5, description: 'Service charge as a percentage of reported revenue' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  ratePercent!: number;

  @ApiProperty({ example: '2026-09-25' })
  @IsDateString()
  effectiveFrom!: string;
}

export class CommitSetupDto {
  @ValidateNested()
  @Type(() => SetupHospitalDto)
  hospital!: SetupHospitalDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SetupItemDto)
  departments!: SetupItemDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SetupItemDto)
  channels!: SetupItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => SetupTermsDto)
  terms?: SetupTermsDto;

  @ApiPropertyOptional({ description: 'Open the hospital for imports and charging (needs terms)' })
  @IsOptional()
  @IsBoolean()
  activate?: boolean;

  @ApiPropertyOptional({ description: 'Also import the uploaded report (needs activation)' })
  @IsOptional()
  @IsBoolean()
  importNow?: boolean;
}
