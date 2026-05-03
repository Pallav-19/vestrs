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
import { AccreditationProvider } from '../../third-party/providers/accreditation.provider';
import { AccreditationResponse } from '../../third-party/providers/interfaces/accreditation-provider.interface';
import { AccredPollJobData } from './types';
import { providerToCheckStatus } from '../kyc/kyc.utils';

const MAX_ATTEMPTS = 3;

@Injectable()
export class AccreditationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accreditationProvider: AccreditationProvider,
    private readonly config: ConfigService,
    @InjectQueue('accred-poll') private readonly accredQueue: Queue,
  ) {}

  async initiate(user: User, ipAddress?: string) {
    await this.assertNoPendingCheck(user.id);

    const attemptCount = await this.prisma.accredCheck.count({ where: { userId: user.id } });
    if (attemptCount >= MAX_ATTEMPTS) {
      throw new UnprocessableEntityException({
        code: 'MAX_ATTEMPTS_REACHED',
        message: `Maximum accreditation attempts (${MAX_ATTEMPTS}) reached`,
      });
    }

    const result = await this.accreditationProvider.initiate({
      userId: user.id,
      name: user.name,
      nationality: user.nationality,
    });

    return this.resolveCheck({ userId: user.id, attemptNumber: attemptCount + 1, result, ipAddress });
  }

  async retry(user: User, ipAddress?: string) {
    const latest = await this.prisma.accredCheck.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest || latest.status !== CheckStatus.FAILURE) {
      throw new ConflictException({
        code: 'ACCRED_NOT_FAILED',
        message: 'Latest accreditation check is not in a failed state',
      });
    }

    const attemptCount = await this.prisma.accredCheck.count({ where: { userId: user.id } });
    if (attemptCount >= MAX_ATTEMPTS) {
      throw new UnprocessableEntityException({
        code: 'MAX_ATTEMPTS_REACHED',
        message: `Maximum accreditation attempts (${MAX_ATTEMPTS}) reached`,
      });
    }

    const result = await this.accreditationProvider.initiate({
      userId: user.id,
      name: user.name,
      nationality: user.nationality,
    });

    return this.resolveCheck({ userId: user.id, attemptNumber: attemptCount + 1, result, ipAddress });
  }

  async getStatus(userId: string) {
    const check = await this.prisma.accredCheck.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!check) {
      throw new NotFoundException({
        code: 'ACCRED_NOT_FOUND',
        message: 'No accreditation check found',
      });
    }

    return {
      id: check.id,
      status: check.status.toLowerCase(),
      provider: check.provider,
      attemptNumber: check.attemptNumber,
      detail: check.responsePayload,
      createdAt: check.createdAt,
      updatedAt: check.updatedAt,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async resolveCheck(opts: {
    userId: string;
    attemptNumber: number;
    result: AccreditationResponse;
    ipAddress?: string;
  }) {
    const { userId, attemptNumber, result, ipAddress } = opts;
    const checkStatus = providerToCheckStatus(result.status);

    const check = await this.prisma.accredCheck.create({
      data: {
        userId,
        provider: result.provider,
        refId: result.refId || `accred_${uuidv4().slice(0, 8)}`,
        status: checkStatus,
        attemptNumber,
        responsePayload: result as any,
      },
    });

    if (checkStatus === CheckStatus.SUCCESS) {
      await this.prisma.user.update({ where: { id: userId }, data: { onboardingStep: OnboardingStep.ACCRED_SUCCESS } });
      await this.audit.log({
        userId,
        action: AuditAction.ACCRED_COMPLETED,
        status: AuditStatus.SUCCESS,
        metadata: { checkId: check.id, accreditationType: result.accreditationType },
        ipAddress,
      });
    } else if (checkStatus === CheckStatus.FAILURE) {
      await this.prisma.user.update({ where: { id: userId }, data: { onboardingStep: OnboardingStep.ACCRED_FAILED } });
      await this.audit.log({
        userId,
        action: AuditAction.ACCRED_COMPLETED,
        status: AuditStatus.FAILURE,
        metadata: { checkId: check.id, reason: result.reason },
        ipAddress,
      });
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { onboardingStep: OnboardingStep.ACCRED_INITIATED } });
      await this.accredQueue.add(
        'poll',
        { accredCheckId: check.id, userId, pollCount: 0 } satisfies AccredPollJobData,
        { delay: this.config.get<number>('app.mock.accredPollDelayMs') ?? 30000 },
      );
      await this.audit.log({
        userId,
        action: AuditAction.ACCRED_INITIATED,
        status: AuditStatus.PENDING,
        metadata: { checkId: check.id, message: 'May take up to 48 hours' },
        ipAddress,
      });
    }

    return {
      id: check.id,
      status: result.status,
      attemptNumber: check.attemptNumber,
      provider: check.provider,
      detail: result,
      message:
        result.status === ProviderStatus.PENDING
          ? 'Accreditation check initiated. This may take up to 48 hours. Poll /accreditation/status for updates.'
          : undefined,
    };
  }

  private async assertNoPendingCheck(userId: string) {
    const pending = await this.prisma.accredCheck.findFirst({
      where: { userId, status: CheckStatus.PENDING },
    });
    if (pending) {
      throw new ConflictException({
        code: 'ACCRED_ALREADY_PENDING',
        message: 'An accreditation check is already in progress',
      });
    }
  }
}
