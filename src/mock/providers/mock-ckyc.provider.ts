import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { IKycSubProvider, KycProviderPayload, KycProviderResponse } from './interfaces/kyc-provider.interface';
import { ScenarioStoreService } from '../scenarios/scenario-store.service';

const SANCTIONED_COUNTRIES = ['KP', 'IR', 'CU', 'SY'];
const BLOCKED_EMAIL_DOMAIN = '@blocked.test';

@Injectable()
export class MockCkycProvider implements IKycSubProvider {
  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  async initiate(payload: KycProviderPayload): Promise<KycProviderResponse> {
    const scenario = this.scenarioStore.get(payload.userId, 'ckyc');
    if (scenario) {
      return {
        refId: `ckyc_${uuidv4().slice(0, 8)}`,
        status: scenario.outcome,
        provider: 'ckyc_registry',
        reason: scenario.reason,
      };
    }

    if (SANCTIONED_COUNTRIES.includes(payload.nationality.toUpperCase())) {
      return {
        refId: `ckyc_${uuidv4().slice(0, 8)}`,
        status: 'failure',
        provider: 'ckyc_registry',
        reason: 'sanctioned_country',
      };
    }

    if (payload.email.toLowerCase().endsWith(BLOCKED_EMAIL_DOMAIN)) {
      return {
        refId: `ckyc_${uuidv4().slice(0, 8)}`,
        status: 'failure',
        provider: 'ckyc_registry',
        reason: 'flagged_identity',
      };
    }

    // 70% found in registry (success), 30% not found (treated as pending — continue to identity check)
    const rand = Math.random();
    const status = rand < 0.7 ? 'success' : 'pending';

    return {
      refId: `ckyc_${uuidv4().slice(0, 8)}`,
      status,
      provider: 'ckyc_registry',
      extra: status === 'success' ? { ckycNumber: `CKYC-${Date.now()}` } : undefined,
    };
  }

  // CKYC is synchronous — poll always returns the same result as initiate
  async poll(refId: string): Promise<KycProviderResponse> {
    return {
      refId,
      status: 'success',
      provider: 'ckyc_registry',
    };
  }
}
