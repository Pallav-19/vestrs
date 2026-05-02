import { IsString, IsNotEmpty, IsNumber, IsPositive, Min } from 'class-validator';

export class CreateInvestmentDto {
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(10)
  amount: number;

  @IsString()
  @IsNotEmpty()
  destinationAccount: string;
}
