export interface KycPollJobData {
  kycCheckId: string;
  userId: string;
  pollCount: number;
}

export interface SubResults {
  ckyc: { refId: string; status: string; provider: string; reason?: string; extra?: Record<string, unknown> };
  identity: { refId: string; status: string; provider: string; reason?: string } | null;
  aml: { refId: string; status: string; provider: string; reason?: string } | null;
}
