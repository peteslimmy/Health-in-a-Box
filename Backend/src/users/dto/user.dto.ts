import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

function booleanValue(value: unknown) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}

export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

export class AssignmentDto {
  @ApiProperty()
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({ description: 'Null grants access to all centres' })
  @IsOptional()
  @IsUUID()
  centreId?: string;
}

export class CreateUserDto {
  @ApiProperty()
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
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain upper-case, lower-case and numeric characters',
  })
  password!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [AssignmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments!: AssignmentDto[];
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain upper-case, lower-case and numeric characters',
  })
  password!: string;
}

export class ReplaceAssignmentsDto {
  @ApiProperty({ type: [AssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments!: AssignmentDto[];
}

export class UserQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => booleanValue(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  pageSize?: number;
}

export class CreateRoleDto {
  @ApiProperty({ example: 'FINANCE_MANAGER' })
  @IsString()
  @Length(2, 40)
  code!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  permissionCodes!: string[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
