import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditStatus, CheckStatus, OnboardingStep, ProviderStatus } from '../../common/enums';
import { IdentityProvider } from '../../third-party/providers/identity.provider';
import { AmlProvider } from '../../third-party/providers/aml.provider';
import { KycPollJobData, SubResults } from './types';
import { computeKycComposite } from './kyc.utils';

const MAX_POLLS = 10;

@Processor('kyc-poll')
export class KycProcessor extends WorkerHost {
  private readonly logger = new Logger(KycProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly identity: IdentityProvider,
    private readonly aml: AmlProvider,
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

    if (!check || check.status !== CheckStatus.PENDING) {
      this.logger.debug(`Check ${kycCheckId} already resolved — skipping`);
      return;
    }

    const payload = check.responsePayload as any;
    let subResults: SubResults = payload.subResults;

    // Poll only the sub-providers still pending
    const [identityResult, amlResult] = await Promise.all([
      subResults.identity?.status === ProviderStatus.PENDING
        ? this.identity.poll(subResults.identity.refId)
        : Promise.resolve(subResults.identity),
      subResults.aml?.status === ProviderStatus.PENDING
        ? this.aml.poll(subResults.aml.refId)
        : Promise.resolve(subResults.aml),
    ]);

    subResults = { ...subResults, identity: identityResult, aml: amlResult };

    const compositeStatus = computeKycComposite(
      identityResult?.status ?? ProviderStatus.SUCCESS,
      amlResult?.status ?? ProviderStatus.SUCCESS,
    );

    await this.audit.log({
      userId,
      action: AuditAction.KYC_POLL_ATTEMPTED,
      status: AuditStatus.PENDING,
      metadata: { checkId: kycCheckId, pollCount: pollCount + 1, compositeStatus },
    });

    if (compositeStatus === CheckStatus.PENDING) {
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

    const nextStep = compositeStatus === CheckStatus.SUCCESS ? OnboardingStep.KYC_SUCCESS : OnboardingStep.KYC_FAILED;

    await this.prisma.$transaction(async (tx) => {
      await tx.kycCheck.update({
        where: { id: kycCheckId },
        data: { status: compositeStatus, responsePayload: { subResults } as any },
      });
      await tx.user.update({ where: { id: userId }, data: { onboardingStep: nextStep } });
    });

    await this.audit.log({
      userId,
      action: AuditAction.KYC_COMPLETED,
      status: compositeStatus === CheckStatus.SUCCESS ? AuditStatus.SUCCESS : AuditStatus.FAILURE,
      metadata: { checkId: kycCheckId, pollCount: pollCount + 1 },
    });

    this.logger.log(`KYC check ${kycCheckId} resolved: ${compositeStatus}`);
  }

  private async forceFailure(kycCheckId: string, userId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.kycCheck.update({ where: { id: kycCheckId }, data: { status: CheckStatus.FAILURE } });
      await tx.user.update({ where: { id: userId }, data: { onboardingStep: OnboardingStep.KYC_FAILED } });
    });
    await this.audit.log({
      userId,
      action: AuditAction.KYC_COMPLETED,
      status: AuditStatus.FAILURE,
      metadata: { checkId: kycCheckId, reason },
    });
    this.logger.warn(`KYC check ${kycCheckId} force-failed: ${reason}`);
  }
}
