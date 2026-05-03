import { IsString, IsNotEmpty, IsNumber, IsPositive, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInvestmentDto {
  @ApiProperty({ example: 'uuid-of-linked-bank-account' })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;

  @ApiProperty({ example: 5000, minimum: 10, description: 'Amount in account currency, max 2 decimal places' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(10)
  amount: number;

  @ApiProperty({ example: 'ESCROW-FUND-001' })
  @IsString()
  @IsNotEmpty()
  destinationAccount: string;
}
