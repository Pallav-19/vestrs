import { Injectable } from '@nestjs/common';

export type ScenarioProvider = 'ckyc' | 'identity' | 'aml' | 'accreditation' | 'bank';
export type ScenarioOutcome = 'success' | 'failure' | 'pending';

export interface Scenario {
  outcome: ScenarioOutcome;
  reason?: string;
}

@Injectable()
export class ScenarioStoreService {
  private readonly store = new Map<string, Scenario>();

  private key(userId: string, provider: ScenarioProvider): string {
    return `${userId}:${provider}`;
  }

  set(userId: string, provider: ScenarioProvider, scenario: Scenario): void {
    this.store.set(this.key(userId, provider), scenario);
  }

  get(userId: string, provider: ScenarioProvider): Scenario | undefined {
    return this.store.get(this.key(userId, provider));
  }

  delete(userId: string, provider: ScenarioProvider): void {
    this.store.delete(this.key(userId, provider));
  }

  list(): Array<{ userId: string; provider: string; scenario: Scenario }> {
    return Array.from(this.store.entries()).map(([k, scenario]) => {
      const [userId, provider] = k.split(':');
      return { userId, provider, scenario };
    });
  }
}
