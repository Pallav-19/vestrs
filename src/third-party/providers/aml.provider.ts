import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ProviderStatus } from '../../common/enums';
import { IKycSubProvider, KycProviderPayload, KycProviderResponse } from './interfaces/kyc-provider.interface';
import { ScenarioStoreService } from '../scenarios/scenario-store.service';

const HIGH_RISK_COUNTRIES = ['KP', 'IR', 'CU', 'SY'];
const PEP_EMAIL_DOMAIN = '@pep.test';
const SANCTION_KEYWORD = 'SANCTION';

@Injectable()
export class AmlProvider implements IKycSubProvider {
  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  async initiate(payload: KycProviderPayload): Promise<KycProviderResponse> {
    const scenario = this.scenarioStore.get(payload.userId, 'aml');
    if (scenario) {
      return {
        refId: `aml_${uuidv4().slice(0, 8)}`,
        status: scenario.outcome as ProviderStatus,
        provider: 'aml_screening',
        reason: scenario.reason,
      };
    }

    if (payload.name.toUpperCase().includes(SANCTION_KEYWORD)) {
      return { refId: `aml_${uuidv4().slice(0, 8)}`, status: ProviderStatus.FAILURE, provider: 'aml_screening', reason: 'sanctions_hit' };
    }

    if (HIGH_RISK_COUNTRIES.includes(payload.nationality.toUpperCase())) {
      return { refId: `aml_${uuidv4().slice(0, 8)}`, status: ProviderStatus.FAILURE, provider: 'aml_screening', reason: 'high_risk_jurisdiction' };
    }

    if (payload.email.toLowerCase().endsWith(PEP_EMAIL_DOMAIN)) {
      return { refId: `aml_${uuidv4().slice(0, 8)}`, status: ProviderStatus.PENDING, provider: 'aml_screening', reason: 'pep_review' };
    }

    // 95% clear, 5% review
    const status = Math.random() < 0.95 ? ProviderStatus.SUCCESS : ProviderStatus.PENDING;
    return { refId: `aml_${uuidv4().slice(0, 8)}`, status, provider: 'aml_screening' };
  }

  async poll(refId: string): Promise<KycProviderResponse> {
    return { refId, status: ProviderStatus.SUCCESS, provider: 'aml_screening' };
  }
}
