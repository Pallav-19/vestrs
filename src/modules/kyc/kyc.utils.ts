import { CheckStatus, ProviderStatus } from '../../common/enums';

export function computeKycComposite(identityStatus: string, amlStatus: string): CheckStatus {
  if (identityStatus === ProviderStatus.FAILURE || amlStatus === ProviderStatus.FAILURE) {
    return CheckStatus.FAILURE;
  }
  if (identityStatus === ProviderStatus.PENDING || amlStatus === ProviderStatus.PENDING) {
    return CheckStatus.PENDING;
  }
  return CheckStatus.SUCCESS;
}

export function providerToCheckStatus(status: ProviderStatus): CheckStatus {
  const map: Record<ProviderStatus, CheckStatus> = {
    [ProviderStatus.SUCCESS]: CheckStatus.SUCCESS,
    [ProviderStatus.FAILURE]: CheckStatus.FAILURE,
    [ProviderStatus.PENDING]: CheckStatus.PENDING,
  };
  return map[status];
}
