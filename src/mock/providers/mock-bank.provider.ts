import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { IBankProvider, BankLinkPayload, BankLinkResponse } from './interfaces/bank-provider.interface';
import { ScenarioStoreService } from '../scenarios/scenario-store.service';

const MOCK_BANKS = [
  'Mock Chase Bank',
  'Mock Wells Fargo',
  'Mock Bank of America',
  'Mock Citibank',
  'Mock Goldman Sachs',
];

@Injectable()
export class MockBankProvider implements IBankProvider {
  private readonly balanceStore = new Map<string, number>();

  constructor(private readonly scenarioStore: ScenarioStoreService) {}

  async link(payload: BankLinkPayload): Promise<BankLinkResponse> {
    if (payload.publicToken === 'mock-fail-token') {
      throw new UnprocessableEntityException({
        code: 'BANK_LINK_FAILED',
        message: 'Bank provider rejected the token',
      });
    }

    let balance: number;
    if (payload.publicToken === 'mock-zero-balance') {
      balance = 0;
    } else if (payload.publicToken === 'mock-low-balance') {
      balance = 500;
    } else {
      balance = Math.floor(Math.random() * 90_000) + 10_000;
    }

    const providerAccountId = `mock_acc_${uuidv4().slice(0, 8)}`;
    this.balanceStore.set(providerAccountId, balance);

    const lastFour = String(Math.floor(Math.random() * 9000) + 1000);
    const bankName = MOCK_BANKS[Math.floor(Math.random() * MOCK_BANKS.length)];
    const accountType = Math.random() > 0.3 ? 'checking' : 'savings';

    return {
      providerAccountId,
      maskedNumber: `****${lastFour}`,
      bankName,
      accountType,
      balance,
      currency: 'USD',
    };
  }

  async getBalance(providerAccountId: string): Promise<number> {
    return this.balanceStore.get(providerAccountId) ?? 0;
  }
}
