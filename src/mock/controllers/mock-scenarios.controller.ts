import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  ForbiddenException,
} from '@nestjs/common';
import { ScenarioStoreService, ScenarioProvider } from '../scenarios/scenario-store.service';
import { SetScenarioDto } from '../dto/set-scenario.dto';

@Controller('mock/scenarios')
export class MockScenariosController {
  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  private guardNonProd() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Mock endpoints are not available in production');
    }
  }

  @Post()
  set(@Body() dto: SetScenarioDto) {
    this.guardNonProd();
    this.scenarioStore.set(dto.userId, dto.provider, { outcome: dto.outcome, reason: dto.reason });
    return { success: true, message: `Scenario set: ${dto.userId}:${dto.provider} → ${dto.outcome}` };
  }

  @Delete(':userId/:provider')
  delete(@Param('userId') userId: string, @Param('provider') provider: ScenarioProvider) {
    this.guardNonProd();
    this.scenarioStore.delete(userId, provider);
    return { success: true, message: `Scenario cleared for ${userId}:${provider}` };
  }

  @Get()
  list() {
    this.guardNonProd();
    return { success: true, data: this.scenarioStore.list() };
  }
}
