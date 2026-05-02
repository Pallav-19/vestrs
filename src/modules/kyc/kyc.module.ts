import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { KycProcessor } from './kyc.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'kyc-poll',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [KycController],
  providers: [KycService, KycProcessor],
})
export class KycModule {}
