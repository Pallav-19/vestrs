import { IsString, IsIn, IsOptional } from 'class-validator';
import { ScenarioProvider, ScenarioOutcome } from '../scenarios/scenario-store.service';

export class SetScenarioDto {
  @IsString()
  userId: string;

  @IsIn(['ckyc', 'identity', 'aml', 'accreditation', 'bank'])
  provider: ScenarioProvider;

  @IsIn(['success', 'failure', 'pending'])
  outcome: ScenarioOutcome;

  @IsString()
  @IsOptional()
  reason?: string;
}
