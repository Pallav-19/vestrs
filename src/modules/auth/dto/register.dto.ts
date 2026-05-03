import { IsEmail, IsString, MinLength, MaxLength, Matches, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Jane Doe', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;

  @ApiProperty({ example: '+14155552671', description: 'E.164 format' })
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be in E.164 format (e.g. +14155552671)',
  })
  phone: string;

  @ApiProperty({ example: 'Secret@123', minLength: 8, description: 'Min 8 chars, 1 upper, 1 number, 1 special' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/, {
    message: 'password must contain at least one uppercase letter, one number, and one special character',
  })
  password: string;

  @ApiProperty({ example: 'US', description: 'ISO 3166-1 alpha-2' })
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => (value as string).toUpperCase())
  nationality: string;

  @ApiProperty({ example: 'US', description: 'ISO 3166-1 alpha-2' })
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => (value as string).toUpperCase())
  domicile: string;
}
