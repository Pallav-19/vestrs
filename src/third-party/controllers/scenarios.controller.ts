import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
} from '@nestjs/common';
import { ScenarioStoreService, ScenarioProvider } from '../scenarios/scenario-store.service';
import { SetScenarioDto } from '../dto/set-scenario.dto';
import { assertNonProd } from '../utils/non-prod.guard';

@Controller('dev/scenarios')
export class ScenariosController {
  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  @Post()
  set(@Body() dto: SetScenarioDto) {
    assertNonProd();
    this.scenarioStore.set(dto.userId, dto.provider, { outcome: dto.outcome, reason: dto.reason });
    return { success: true, message: `Scenario set: ${dto.userId}:${dto.provider} → ${dto.outcome}` };
  }

  @Delete(':userId/:provider')
  delete(@Param('userId') userId: string, @Param('provider') provider: ScenarioProvider) {
    assertNonProd();
    this.scenarioStore.delete(userId, provider);
    return { success: true, message: `Scenario cleared for ${userId}:${provider}` };
  }

  @Get()
  list() {
    assertNonProd();
    return { success: true, data: this.scenarioStore.list() };
  }
}
