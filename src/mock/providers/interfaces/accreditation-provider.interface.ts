export interface AccreditationPayload {
  userId: string;
  name: string;
  nationality: string;
}

export interface AccreditationResponse {
  refId: string;
  status: 'success' | 'failure' | 'pending';
  provider: string;
  accreditationType?: 'income' | 'net_worth' | 'professional';
  reason?: string;
}

export interface IAccreditationProvider {
  initiate(payload: AccreditationPayload): Promise<AccreditationResponse>;
  poll(refId: string): Promise<AccreditationResponse>;
}
