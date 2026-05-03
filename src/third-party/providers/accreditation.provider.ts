import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ProviderStatus } from '../../common/enums';
import {
  IAccreditationProvider,
  AccreditationPayload,
  AccreditationResponse,
} from './interfaces/accreditation-provider.interface';
import { ScenarioStoreService } from '../scenarios/scenario-store.service';

const ACCREDITATION_TYPES: Array<'income' | 'net_worth' | 'professional'> = [
  'income',
  'net_worth',
  'professional',
];

@Injectable()
export class AccreditationProvider implements IAccreditationProvider {
  private readonly pollCounts = new Map<string, number>();

  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  async initiate(payload: AccreditationPayload): Promise<AccreditationResponse> {
    const scenario = this.scenarioStore.get(payload.userId, 'accreditation');
    if (scenario) {
      const refId = `accred_${uuidv4().slice(0, 8)}`;
      if (scenario.outcome === ProviderStatus.PENDING) this.pollCounts.set(refId, 0);
      return {
        refId,
        status: scenario.outcome as ProviderStatus,
        provider: 'finra_accreditation',
        reason: scenario.reason,
      };
    }

    const refId = `accred_${uuidv4().slice(0, 8)}`;
    const rand = Math.random();

    // 30% immediate success, 40% async pending→success, 15% immediate failure, 15% async pending→failure
    if (rand < 0.3) {
      return {
        refId,
        status: ProviderStatus.SUCCESS,
        provider: 'finra_accreditation',
        accreditationType: ACCREDITATION_TYPES[Math.floor(Math.random() * ACCREDITATION_TYPES.length)],
      };
    } else if (rand < 0.7) {
      this.pollCounts.set(refId, 0);
      return { refId, status: ProviderStatus.PENDING, provider: 'finra_accreditation' };
    } else if (rand < 0.85) {
      return { refId, status: ProviderStatus.FAILURE, provider: 'finra_accreditation', reason: 'not_qualified' };
    } else {
      this.pollCounts.set(refId, 0);
      return { refId, status: ProviderStatus.PENDING, provider: 'finra_accreditation' };
    }
  }

  async poll(refId: string): Promise<AccreditationResponse> {
    const count = (this.pollCounts.get(refId) ?? 0) + 1;
    this.pollCounts.set(refId, count);

    // Resolve after 4–8 poll cycles (simulates 12–48h review)
    const threshold = 4 + Math.floor(Math.random() * 5);
    if (count < threshold) {
      return { refId, status: ProviderStatus.PENDING, provider: 'finra_accreditation' };
    }

    this.pollCounts.delete(refId);

    if (Math.random() < 0.85) {
      return {
        refId,
        status: ProviderStatus.SUCCESS,
        provider: 'finra_accreditation',
        accreditationType: ACCREDITATION_TYPES[Math.floor(Math.random() * ACCREDITATION_TYPES.length)],
      };
    }
    return { refId, status: ProviderStatus.FAILURE, provider: 'finra_accreditation', reason: 'not_qualified' };
  }
}
