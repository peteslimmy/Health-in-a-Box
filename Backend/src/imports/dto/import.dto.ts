import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UploadImportDto {
  @ApiProperty()
  @IsUUID()
  centreId!: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Required for CSV/XLSX; read from a PDF report when omitted',
  })
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  reportDate?: string;

  @ApiPropertyOptional({
    description: 'Add departments and channels found in the file that the centre does not have yet',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  createMissing?: string;
}

export class CommitImportDto {
  @ApiPropertyOptional({
    description:
      'Why the flagged omitted days are acceptable; required when the import has gap flags',
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  acknowledgement?: string;
}

export class ApproveVarianceDto {
  @ApiProperty({
    description:
      "Why the differences are acceptable, in the approver's words (at least 20 characters). Kept with the report and in the audit trail",
  })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Also needed when the import has omitted days that need a reason',
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  acknowledgement?: string;
}

export class ImportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  centreId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  pageSize?: number;
}
