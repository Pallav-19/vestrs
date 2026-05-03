import { ProviderStatus } from '../../../common/enums';

export interface KycProviderPayload {
  userId: string;
  name: string;
  email: string;
  nationality: string;
  domicile: string;
}

export interface KycProviderResponse {
  refId: string;
  status: ProviderStatus;
  provider: string;
  reason?: string;
  extra?: Record<string, unknown>;
}

export interface IKycSubProvider {
  initiate(payload: KycProviderPayload): Promise<KycProviderResponse>;
  poll(refId: string): Promise<KycProviderResponse>;
}
