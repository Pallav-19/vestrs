import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AccreditationService } from './accreditation.service';
import { AccreditationController } from './accreditation.controller';
import { AccreditationProcessor } from './accreditation.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'accred-poll',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [AccreditationController],
  providers: [AccreditationService, AccreditationProcessor],
})
export class AccreditationModule {}
