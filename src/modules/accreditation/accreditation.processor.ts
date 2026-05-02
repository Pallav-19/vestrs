import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditStatus } from '../../common/enums';
import { MockAccreditationProvider } from '../../mock/providers/mock-accreditation.provider';
import { AccredPollJobData } from './types';

const MAX_POLLS = 15;

@Processor('accred-poll')
export class AccreditationProcessor extends WorkerHost {
  private readonly logger = new Logger(AccreditationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accreditationProvider: MockAccreditationProvider,
    private readonly config: ConfigService,
    @InjectQueue('accred-poll') private readonly accredQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<AccredPollJobData>): Promise<void> {
    const { accredCheckId, userId, pollCount } = job.data;

    this.logger.debug(`Accreditation poll #${pollCount + 1} for check ${accredCheckId}`);

    if (pollCount >= MAX_POLLS) {
      await this.forceFailure(accredCheckId, userId, 'max_polls_exceeded');
      return;
    }

    const check = await this.prisma.accredCheck.findUnique({ where: { id: accredCheckId } });

    if (!check || check.status !== 'PENDING') {
      this.logger.debug(`Check ${accredCheckId} already resolved — skipping`);
      return;
    }

    const result = await this.accreditationProvider.poll(check.refId);

    await this.audit.log({
      userId,
      action: AuditAction.ACCRED_POLL_ATTEMPTED,
      status: AuditStatus.PENDING,
      metadata: { checkId: accredCheckId, pollCount: pollCount + 1, providerStatus: result.status },
    });

    if (result.status === 'pending') {
      await this.accredQueue.add(
        'poll',
        { accredCheckId, userId, pollCount: pollCount + 1 },
        { delay: this.config.get<number>('app.mock.accredPollDelayMs') ?? 30000 },
      );
      return;
    }

    const newStatus = result.status === 'success' ? 'SUCCESS' : 'FAILURE';
    const nextStep = newStatus === 'SUCCESS' ? 'ACCRED_SUCCESS' : 'ACCRED_FAILED';

    await this.prisma.$transaction(async (tx) => {
      await tx.accredCheck.update({
        where: { id: accredCheckId },
        data: { status: newStatus, responsePayload: result as any },
      });
      await tx.user.update({
        where: { id: userId },
        data: { onboardingStep: nextStep },
      });
    });

    await this.audit.log({
      userId,
      action: AuditAction.ACCRED_COMPLETED,
      status: newStatus === 'SUCCESS' ? AuditStatus.SUCCESS : AuditStatus.FAILURE,
      metadata: {
        checkId: accredCheckId,
        pollCount: pollCount + 1,
        accreditationType: result.accreditationType,
      },
    });

    this.logger.log(`Accreditation check ${accredCheckId} resolved: ${newStatus}`);
  }

  private async forceFailure(accredCheckId: string, userId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.accredCheck.update({ where: { id: accredCheckId }, data: { status: 'FAILURE' } });
      await tx.user.update({ where: { id: userId }, data: { onboardingStep: 'ACCRED_FAILED' } });
    });
    await this.audit.log({
      userId,
      action: AuditAction.ACCRED_COMPLETED,
      status: AuditStatus.FAILURE,
      metadata: { checkId: accredCheckId, reason },
    });
    this.logger.warn(`Accreditation check ${accredCheckId} force-failed: ${reason}`);
  }
}
