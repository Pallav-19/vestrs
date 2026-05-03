import { IsString, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScenarioProvider, ScenarioOutcome } from '../scenarios/scenario-store.service';

export class SetScenarioDto {
  @ApiProperty({ example: 'uuid-of-user' })
  @IsString()
  userId: string;

  @ApiProperty({ enum: ['ckyc', 'identity', 'aml', 'accreditation', 'bank'] })
  @IsIn(['ckyc', 'identity', 'aml', 'accreditation', 'bank'])
  provider: ScenarioProvider;

  @ApiProperty({ enum: ['success', 'failure', 'pending'] })
  @IsIn(['success', 'failure', 'pending'])
  outcome: ScenarioOutcome;

  @ApiPropertyOptional({ example: 'Simulated AML hit' })
  @IsString()
  @IsOptional()
  reason?: string;
}
