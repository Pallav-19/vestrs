import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ScenarioStoreService, ScenarioProvider } from '../scenarios/scenario-store.service';
import { SetScenarioDto } from '../dto/set-scenario.dto';
import { assertNonProd } from '../utils/non-prod.guard';

@ApiTags('Dev')
@Controller('dev/scenarios')
export class ScenariosController {
  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  @Post()
  @ApiOperation({ summary: '[Dev] Set a deterministic outcome for a provider' })
  @ApiResponse({ status: 201, description: 'Scenario set' })
  set(@Body() dto: SetScenarioDto) {
    assertNonProd();
    this.scenarioStore.set(dto.userId, dto.provider, { outcome: dto.outcome, reason: dto.reason });
    return { success: true, message: `Scenario set: ${dto.userId}:${dto.provider} → ${dto.outcome}` };
  }

  @Delete(':userId/:provider')
  @ApiOperation({ summary: '[Dev] Clear a scenario override' })
  @ApiParam({ name: 'userId' })
  @ApiParam({ name: 'provider', enum: ['ckyc', 'identity', 'aml', 'accreditation', 'bank'] })
  @ApiResponse({ status: 200, description: 'Scenario cleared' })
  delete(@Param('userId') userId: string, @Param('provider') provider: ScenarioProvider) {
    assertNonProd();
    this.scenarioStore.delete(userId, provider);
    return { success: true, message: `Scenario cleared for ${userId}:${provider}` };
  }

  @Get()
  @ApiOperation({ summary: '[Dev] List all active scenario overrides' })
  @ApiResponse({ status: 200, description: 'Map of userId:provider → outcome' })
  list() {
    assertNonProd();
    return { success: true, data: this.scenarioStore.list() };
  }
}
