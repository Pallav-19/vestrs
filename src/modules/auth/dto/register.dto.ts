import { IsEmail, IsString, MinLength, MaxLength, Matches, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;

  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be in E.164 format (e.g. +14155552671)',
  })
  phone: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/, {
    message: 'password must contain at least one uppercase letter, one number, and one special character',
  })
  password: string;

  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => (value as string).toUpperCase())
  nationality: string;

  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => (value as string).toUpperCase())
  domicile: string;
}
