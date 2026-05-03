import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({ description: 'JWT refresh token' })
  @IsString()
  refresh_token: string;
}
