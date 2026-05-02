import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { IKycSubProvider, KycProviderPayload, KycProviderResponse } from './interfaces/kyc-provider.interface';
import { ScenarioStoreService } from '../scenarios/scenario-store.service';

const FAILURE_REASONS = ['document_expired', 'liveness_check_failed', 'face_mismatch'];

@Injectable()
export class MockIdentityProvider implements IKycSubProvider {
  // Tracks poll counts per refId to simulate async resolution
  private readonly pollCounts = new Map<string, number>();

  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  async initiate(payload: KycProviderPayload): Promise<KycProviderResponse> {
    const scenario = this.scenarioStore.get(payload.userId, 'identity');
    if (scenario) {
      const refId = `identity_${uuidv4().slice(0, 8)}`;
      if (scenario.outcome === 'pending') this.pollCounts.set(refId, 0);
      return { refId, status: scenario.outcome, provider: 'mock_identity', reason: scenario.reason };
    }

    const refId = `identity_${uuidv4().slice(0, 8)}`;
    const rand = Math.random();

    // 60% immediate success, 20% async pending→success, 10% immediate failure, 10% async pending→failure
    if (rand < 0.6) {
      return { refId, status: 'success', provider: 'mock_identity' };
    } else if (rand < 0.8) {
      this.pollCounts.set(refId, 0);
      return { refId, status: 'pending', provider: 'mock_identity' };
    } else if (rand < 0.9) {
      return {
        refId,
        status: 'failure',
        provider: 'mock_identity',
        reason: FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)],
      };
    } else {
      this.pollCounts.set(refId, 0);
      return { refId, status: 'pending', provider: 'mock_identity' };
    }
  }

  async poll(refId: string): Promise<KycProviderResponse> {
    const count = (this.pollCounts.get(refId) ?? 0) + 1;
    this.pollCounts.set(refId, count);

    // Resolve after 2–4 poll cycles
    const threshold = 2 + Math.floor(Math.random() * 3);
    if (count < threshold) {
      return { refId, status: 'pending', provider: 'mock_identity' };
    }

    this.pollCounts.delete(refId);

    // 80% resolve to success, 20% to failure
    if (Math.random() < 0.8) {
      return { refId, status: 'success', provider: 'mock_identity' };
    }
    return {
      refId,
      status: 'failure',
      provider: 'mock_identity',
      reason: FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)],
    };
  }
}
