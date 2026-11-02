import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@hnb.local' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'HnbDemo#2026' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
