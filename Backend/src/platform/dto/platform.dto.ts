import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SMTP_PORTS } from '../smtp-rules';

export class ProfileDto {
  @ApiProperty({ example: 'HNB Receivables' })
  @IsString()
  @Length(2, 80)
  appName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  tagline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  supportEmail?: string;
}

export class SmtpDto {
  @ApiProperty({ example: 'smtp.sendgrid.net' })
  @IsString()
  @Length(3, 253)
  host!: string;

  @ApiProperty({ example: 587, enum: SMTP_PORTS })
  @Type(() => Number)
  @IsInt()
  @IsIn([...SMTP_PORTS])
  port!: number;

  @ApiProperty({
    description:
      'true: encrypted from the start (usually port 465). false: upgraded with STARTTLS (usually 587). Mail is never sent unencrypted',
  })
  @IsBoolean()
  secure!: boolean;

  @ApiPropertyOptional({ example: 'apikey' })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  user?: string;

  @ApiPropertyOptional({
    description: 'The SMTP password or API key. Leave out to keep the saved one',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password?: string;

  @ApiProperty({ example: 'HNB Receivables' })
  @IsString()
  @Length(1, 80)
  fromName!: string;

  @ApiProperty({ example: 'no-reply@4coretech.com' })
  @IsEmail()
  @MaxLength(254)
  fromEmail!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  replyTo?: string;
}

export class TestMailDto {
  @ApiProperty({ example: 'peter@4coretech.com' })
  @IsEmail()
  @MaxLength(254)
  to!: string;
}

export class DomainDto {
  @ApiProperty({ example: '4coretech.com' })
  @IsString()
  @Length(3, 253)
  domain!: string;

  @ApiPropertyOptional({ example: 'Our staff' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  note?: string;
}

export class UpdateDomainDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  note?: string;
}

export class SuperAdminDto {
  @ApiProperty({ example: 'owner@gmail.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'password must contain upper-case, lower-case and numeric characters',
  })
  password!: string;
}
