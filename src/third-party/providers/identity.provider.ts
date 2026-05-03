import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ProviderStatus } from '../../common/enums';
import { IKycSubProvider, KycProviderPayload, KycProviderResponse } from './interfaces/kyc-provider.interface';
import { ScenarioStoreService } from '../scenarios/scenario-store.service';

const FAILURE_REASONS = ['document_expired', 'liveness_check_failed', 'face_mismatch'];

@Injectable()
export class IdentityProvider implements IKycSubProvider {
  private readonly pollCounts = new Map<string, number>();

  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  async initiate(payload: KycProviderPayload): Promise<KycProviderResponse> {
    const scenario = this.scenarioStore.get(payload.userId, 'identity');
    if (scenario) {
      const refId = `identity_${uuidv4().slice(0, 8)}`;
      if (scenario.outcome === ProviderStatus.PENDING) this.pollCounts.set(refId, 0);
      return { refId, status: scenario.outcome as ProviderStatus, provider: 'identity_verify', reason: scenario.reason };
    }

    const refId = `identity_${uuidv4().slice(0, 8)}`;
    const rand = Math.random();

    // 60% immediate success, 20% async pending→success, 10% immediate failure, 10% async pending→failure
    if (rand < 0.6) {
      return { refId, status: ProviderStatus.SUCCESS, provider: 'identity_verify' };
    } else if (rand < 0.8) {
      this.pollCounts.set(refId, 0);
      return { refId, status: ProviderStatus.PENDING, provider: 'identity_verify' };
    } else if (rand < 0.9) {
      return {
        refId,
        status: ProviderStatus.FAILURE,
        provider: 'identity_verify',
        reason: FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)],
      };
    } else {
      this.pollCounts.set(refId, 0);
      return { refId, status: ProviderStatus.PENDING, provider: 'identity_verify' };
    }
  }

  async poll(refId: string): Promise<KycProviderResponse> {
    const count = (this.pollCounts.get(refId) ?? 0) + 1;
    this.pollCounts.set(refId, count);

    const threshold = 2 + Math.floor(Math.random() * 3);
    if (count < threshold) {
      return { refId, status: ProviderStatus.PENDING, provider: 'identity_verify' };
    }

    this.pollCounts.delete(refId);

    if (Math.random() < 0.8) {
      return { refId, status: ProviderStatus.SUCCESS, provider: 'identity_verify' };
    }
    return {
      refId,
      status: ProviderStatus.FAILURE,
      provider: 'identity_verify',
      reason: FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)],
    };
  }
}
