import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ProviderStatus } from '../../common/enums';
import { IKycSubProvider, KycProviderPayload, KycProviderResponse } from './interfaces/kyc-provider.interface';
import { ScenarioStoreService } from '../scenarios/scenario-store.service';

const SANCTIONED_COUNTRIES = ['KP', 'IR', 'CU', 'SY'];
const BLOCKED_EMAIL_DOMAIN = '@blocked.test';

@Injectable()
export class CkycProvider implements IKycSubProvider {
  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  async initiate(payload: KycProviderPayload): Promise<KycProviderResponse> {
    const scenario = this.scenarioStore.get(payload.userId, 'ckyc');
    if (scenario) {
      return {
        refId: `ckyc_${uuidv4().slice(0, 8)}`,
        status: scenario.outcome as ProviderStatus,
        provider: 'ckyc_registry',
        reason: scenario.reason,
      };
    }

    if (SANCTIONED_COUNTRIES.includes(payload.nationality.toUpperCase())) {
      return {
        refId: `ckyc_${uuidv4().slice(0, 8)}`,
        status: ProviderStatus.FAILURE,
        provider: 'ckyc_registry',
        reason: 'sanctioned_country',
      };
    }

    if (payload.email.toLowerCase().endsWith(BLOCKED_EMAIL_DOMAIN)) {
      return {
        refId: `ckyc_${uuidv4().slice(0, 8)}`,
        status: ProviderStatus.FAILURE,
        provider: 'ckyc_registry',
        reason: 'flagged_identity',
      };
    }

    // 70% found in registry (success), 30% not found (continue to identity check)
    const status = Math.random() < 0.7 ? ProviderStatus.SUCCESS : ProviderStatus.PENDING;

    return {
      refId: `ckyc_${uuidv4().slice(0, 8)}`,
      status,
      provider: 'ckyc_registry',
      extra: status === ProviderStatus.SUCCESS ? { ckycNumber: `CKYC-${Date.now()}` } : undefined,
    };
  }

  async poll(refId: string): Promise<KycProviderResponse> {
    return { refId, status: ProviderStatus.SUCCESS, provider: 'ckyc_registry' };
  }
}
