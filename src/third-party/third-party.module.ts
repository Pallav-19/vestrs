import { Global, Module } from '@nestjs/common';
import { ScenarioStoreService } from './scenarios/scenario-store.service';
import { CkycProvider } from './providers/ckyc.provider';
import { IdentityProvider } from './providers/identity.provider';
import { AmlProvider } from './providers/aml.provider';
import { AccreditationProvider } from './providers/accreditation.provider';
import { BankProvider } from './providers/bank.provider';
import { WebhookController } from './controllers/webhook.controller';
import { ScenariosController } from './controllers/scenarios.controller';

@Global()
@Module({
  controllers: [WebhookController, ScenariosController],
  providers: [
    ScenarioStoreService,
    CkycProvider,
    IdentityProvider,
    AmlProvider,
    AccreditationProvider,
    BankProvider,
  ],
  exports: [
    ScenarioStoreService,
    CkycProvider,
    IdentityProvider,
    AmlProvider,
    AccreditationProvider,
    BankProvider,
  ],
})
export class ThirdPartyModule {}
