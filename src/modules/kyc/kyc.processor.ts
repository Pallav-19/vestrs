import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditStatus } from '../../common/enums';
import { MockIdentityProvider } from '../../mock/providers/mock-identity.provider';
import { MockAmlProvider } from '../../mock/providers/mock-aml.provider';
import { KycPollJobData, SubResults } from './types';

const MAX_POLLS = 10;

@Processor('kyc-poll')
export class KycProcessor extends WorkerHost {
  private readonly logger = new Logger(KycProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly identity: MockIdentityProvider,
    private readonly aml: MockAmlProvider,
    private readonly config: ConfigService,
    @InjectQueue('kyc-poll') private readonly kycQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<KycPollJobData>): Promise<void> {
    const { kycCheckId, userId, pollCount } = job.data;

    this.logger.debug(`KYC poll #${pollCount + 1} for check ${kycCheckId}`);

    if (pollCount >= MAX_POLLS) {
      await this.forceFailure(kycCheckId, userId, 'max_polls_exceeded');
      return;
    }

    const check = await this.prisma.kycCheck.findUnique({ where: { id: kycCheckId } });

    // Already resolved by webhook or another job
    if (!check || check.status !== 'PENDING') {
      this.logger.debug(`Check ${kycCheckId} already resolved — skipping`);
      return;
    }

    const payload = check.responsePayload as any;
    let subResults: SubResults = payload.subResults;

    // Poll only the sub-providers still pending
    const [identityResult, amlResult] = await Promise.all([
      subResults.identity?.status === 'pending'
        ? this.identity.poll(subResults.identity.refId)
        : Promise.resolve(subResults.identity),
      subResults.aml?.status === 'pending'
        ? this.aml.poll(subResults.aml.refId)
        : Promise.resolve(subResults.aml),
    ]);

    subResults = { ...subResults, identity: identityResult, aml: amlResult };

    const compositeStatus = this.computeComposite(
      identityResult?.status ?? 'success',
      amlResult?.status ?? 'success',
    );

    await this.audit.log({
      userId,
      action: AuditAction.KYC_POLL_ATTEMPTED,
      status: AuditStatus.PENDING,
      metadata: { checkId: kycCheckId, pollCount: pollCount + 1, compositeStatus },
    });

    if (compositeStatus === 'PENDING') {
      // Update stored sub-results and re-enqueue
      await this.prisma.kycCheck.update({
        where: { id: kycCheckId },
        data: { responsePayload: { subResults } as any },
      });

      await this.kycQueue.add(
        'poll',
        { kycCheckId, userId, pollCount: pollCount + 1 },
        { delay: this.config.get<number>('app.mock.kycPollDelayMs') ?? 30000 },
      );
      return;
    }

    // Resolved — update check + user in one transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.kycCheck.update({
        where: { id: kycCheckId },
        data: { status: compositeStatus, responsePayload: { subResults } as any },
      });
      await tx.user.update({
        where: { id: userId },
        data: { onboardingStep: compositeStatus === 'SUCCESS' ? 'KYC_SUCCESS' : 'KYC_FAILED' },
      });
    });

    await this.audit.log({
      userId,
      action: AuditAction.KYC_COMPLETED,
      status: compositeStatus === 'SUCCESS' ? AuditStatus.SUCCESS : AuditStatus.FAILURE,
      metadata: { checkId: kycCheckId, pollCount: pollCount + 1 },
    });

    this.logger.log(`KYC check ${kycCheckId} resolved: ${compositeStatus}`);
  }

  private async forceFailure(kycCheckId: string, userId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.kycCheck.update({ where: { id: kycCheckId }, data: { status: 'FAILURE' } });
      await tx.user.update({ where: { id: userId }, data: { onboardingStep: 'KYC_FAILED' } });
    });
    await this.audit.log({
      userId,
      action: AuditAction.KYC_COMPLETED,
      status: AuditStatus.FAILURE,
      metadata: { checkId: kycCheckId, reason },
    });
    this.logger.warn(`KYC check ${kycCheckId} force-failed: ${reason}`);
  }

  private computeComposite(identityStatus: string, amlStatus: string): 'SUCCESS' | 'FAILURE' | 'PENDING' {
    if (identityStatus === 'failure' || amlStatus === 'failure') return 'FAILURE';
    if (identityStatus === 'pending' || amlStatus === 'pending') return 'PENDING';
    return 'SUCCESS';
  }
}
