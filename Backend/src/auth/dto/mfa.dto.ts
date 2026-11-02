import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const SIX_DIGITS = /^\s*\d{3}\s?\d{3}\s*$/;
const SIX_DIGITS_MESSAGE = 'Enter the 6-digit code from the app';

export class MfaTokenDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  mfaToken!: string;
}

export class MfaConfirmDto extends MfaTokenDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(SIX_DIGITS, { message: SIX_DIGITS_MESSAGE })
  code!: string;
}

export class MfaVerifyDto extends MfaTokenDto {
  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  @Matches(SIX_DIGITS, { message: SIX_DIGITS_MESSAGE })
  code?: string;

  @ApiPropertyOptional({ example: 'AB12C-D34EF' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(14)
  recoveryCode?: string;
}

export class MfaBeginDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class MfaCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(SIX_DIGITS, { message: SIX_DIGITS_MESSAGE })
  code!: string;
}
