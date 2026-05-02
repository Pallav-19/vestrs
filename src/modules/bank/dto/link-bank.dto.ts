import { IsString, IsNotEmpty } from 'class-validator';

export class LinkBankDto {
  @IsString()
  @IsNotEmpty()
  publicToken: string;

  @IsString()
  @IsNotEmpty()
  accountId: string;
}
