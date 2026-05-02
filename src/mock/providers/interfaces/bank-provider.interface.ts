export interface BankLinkPayload {
  publicToken: string;
  accountId: string;
}

export interface BankLinkResponse {
  providerAccountId: string;
  maskedNumber: string;
  bankName: string;
  accountType: 'checking' | 'savings';
  balance: number;
  currency: string;
}

export interface IBankProvider {
  link(payload: BankLinkPayload): Promise<BankLinkResponse>;
  getBalance(providerAccountId: string): Promise<number>;
}
