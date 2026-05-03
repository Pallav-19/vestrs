import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkBankDto {
  @ApiProperty({
    example: 'mock-public-token-abc123',
    description: 'Use "mock-fail-token" to force failure, "mock-zero-balance" / "mock-low-balance" for test balances',
  })
  @IsString()
  @IsNotEmpty()
  publicToken: string;

  @ApiProperty({ example: 'acct_001', description: 'Provider account identifier' })
  @IsString()
  @IsNotEmpty()
  accountId: string;
}
