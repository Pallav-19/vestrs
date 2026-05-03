import {
  Injectable,
  ConflictException,
  UnprocessableEntityException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditStatus, CheckStatus, OnboardingStep, ProviderStatus } from '../../common/enums';
import { CkycProvider } from '../../third-party/providers/ckyc.provider';
import { IdentityProvider } from '../../third-party/providers/identity.provider';
import { AmlProvider } from '../../third-party/providers/aml.provider';
import { KycProviderPayload } from '../../third-party/providers/interfaces/kyc-provider.interface';
import { KycPollJobData, SubResults } from './types';
import { computeKycComposite, providerToCheckStatus } from './kyc.utils';

const MAX_ATTEMPTS = 3;

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ckyc: CkycProvider,
    private readonly identity: IdentityProvider,
    private readonly aml: AmlProvider,
    private readonly config: ConfigService,
    @InjectQueue('kyc-poll') private readonly kycQueue: Queue,
  ) {}

  async initiate(user: User, ipAddress?: string) {
    await this.assertNoPendingCheck(user.id);
    const attemptCount = await this.prisma.kycCheck.count({ where: { userId: user.id } });
    if (attemptCount >= MAX_ATTEMPTS) {
      throw new UnprocessableEntityException({
        code: 'MAX_ATTEMPTS_REACHED',
        message: `Maximum KYC attempts (${MAX_ATTEMPTS}) reached`,
      });
    }

    return this.runKycCheck(user, attemptCount + 1, ipAddress);
  }

  async retry(user: User, ipAddress?: string) {
    const latest = await this.prisma.kycCheck.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest || latest.status !== CheckStatus.FAILURE) {
      throw new ConflictException({
        code: 'KYC_NOT_FAILED',
        message: 'Latest KYC check is not in a failed state',
      });
    }

    const attemptCount = await this.prisma.kycCheck.count({ where: { userId: user.id } });
    if (attemptCount >= MAX_ATTEMPTS) {
      throw new UnprocessableEntityException({
        code: 'MAX_ATTEMPTS_REACHED',
        message: `Maximum KYC attempts (${MAX_ATTEMPTS}) reached`,
      });
    }

    return this.runKycCheck(user, attemptCount + 1, ipAddress);
  }

  async getStatus(userId: string) {
    const check = await this.prisma.kycCheck.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!check) {
      throw new NotFoundException({ code: 'KYC_NOT_FOUND', message: 'No KYC check found' });
    }

    return {
      id: check.id,
      status: check.status.toLowerCase(),
      provider: check.provider,
      attemptNumber: check.attemptNumber,
      subResults: (check.responsePayload as any)?.subResults ?? null,
      createdAt: check.createdAt,
      updatedAt: check.updatedAt,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async runKycCheck(user: User, attemptNumber: number, ipAddress?: string) {
    const payload: KycProviderPayload = {
      userId: user.id,
      name: user.name,
      email: user.email,
      nationality: user.nationality,
      domicile: user.domicile,
    };

    // Step 1 — CKYC (synchronous, short-circuits on failure)
    const ckycResult = await this.ckyc.initiate(payload);

    if (ckycResult.status === ProviderStatus.FAILURE) {
      return this.resolveCheck({
        userId: user.id,
        attemptNumber,
        compositeStatus: CheckStatus.FAILURE,
        subResults: { ckyc: ckycResult, identity: null, aml: null },
        ipAddress,
      });
    }

    // Step 2 — Identity + AML (concurrent)
    const [identityResult, amlResult] = await Promise.all([
      this.identity.initiate(payload),
      this.aml.initiate(payload),
    ]);

    const subResults: SubResults = { ckyc: ckycResult, identity: identityResult, aml: amlResult };
    const compositeStatus = computeKycComposite(identityResult.status, amlResult.status);

    return this.resolveCheck({ userId: user.id, attemptNumber, compositeStatus, subResults, ipAddress });
  }

  private async resolveCheck(opts: {
    userId: string;
    attemptNumber: number;
    compositeStatus: CheckStatus;
    subResults: SubResults;
    ipAddress?: string;
  }) {
    const { userId, attemptNumber, compositeStatus, subResults, ipAddress } = opts;

    const check = await this.prisma.kycCheck.create({
      data: {
        userId,
        provider: 'composite',
        refId: `composite_${uuidv4().slice(0, 8)}`,
        status: compositeStatus,
        attemptNumber,
        responsePayload: { subResults } as any,
      },
    });

    if (compositeStatus === CheckStatus.SUCCESS) {
      await this.prisma.user.update({ where: { id: userId }, data: { onboardingStep: OnboardingStep.KYC_SUCCESS } });
      await this.audit.log({
        userId,
        action: AuditAction.KYC_COMPLETED,
        status: AuditStatus.SUCCESS,
        metadata: { checkId: check.id },
        ipAddress,
      });
    } else if (compositeStatus === CheckStatus.FAILURE) {
      await this.prisma.user.update({ where: { id: userId }, data: { onboardingStep: OnboardingStep.KYC_FAILED } });
      await this.audit.log({
        userId,
        action: AuditAction.KYC_COMPLETED,
        status: AuditStatus.FAILURE,
        metadata: { checkId: check.id, subResults },
        ipAddress,
      });
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { onboardingStep: OnboardingStep.KYC_INITIATED } });
      await this.kycQueue.add('poll', { kycCheckId: check.id, userId, pollCount: 0 } satisfies KycPollJobData, {
        delay: this.config.get<number>('app.mock.kycPollDelayMs') ?? 30000,
      });
      await this.audit.log({
        userId,
        action: AuditAction.KYC_INITIATED,
        status: AuditStatus.PENDING,
        metadata: { checkId: check.id },
        ipAddress,
      });
    }

    return {
      id: check.id,
      status: compositeStatus.toLowerCase(),
      attemptNumber: check.attemptNumber,
      subResults,
      message:
        compositeStatus === CheckStatus.PENDING
          ? 'KYC check initiated. Poll /kyc/status for updates.'
          : undefined,
    };
  }

  private async assertNoPendingCheck(userId: string) {
    const pending = await this.prisma.kycCheck.findFirst({
      where: { userId, status: CheckStatus.PENDING },
    });
    if (pending) {
      throw new ConflictException({
        code: 'KYC_ALREADY_PENDING',
        message: 'A KYC check is already in progress',
      });
    }
  }
}
