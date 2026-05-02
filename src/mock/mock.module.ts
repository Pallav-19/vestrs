import { Global, Module } from '@nestjs/common';
import { ScenarioStoreService } from './scenarios/scenario-store.service';
import { MockCkycProvider } from './providers/mock-ckyc.provider';
import { MockIdentityProvider } from './providers/mock-identity.provider';
import { MockAmlProvider } from './providers/mock-aml.provider';
import { MockAccreditationProvider } from './providers/mock-accreditation.provider';
import { MockBankProvider } from './providers/mock-bank.provider';
import { MockWebhookController } from './controllers/mock-webhook.controller';
import { MockScenariosController } from './controllers/mock-scenarios.controller';

@Global()
@Module({
  controllers: [MockWebhookController, MockScenariosController],
  providers: [
    ScenarioStoreService,
    MockCkycProvider,
    MockIdentityProvider,
    MockAmlProvider,
    MockAccreditationProvider,
    MockBankProvider,
  ],
  exports: [
    ScenarioStoreService,
    MockCkycProvider,
    MockIdentityProvider,
    MockAmlProvider,
    MockAccreditationProvider,
    MockBankProvider,
  ],
})
export class MockModule {}
