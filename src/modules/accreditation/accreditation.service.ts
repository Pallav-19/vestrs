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
import { AuditAction, AuditStatus } from '../../common/enums';
import { MockAccreditationProvider } from '../../mock/providers/mock-accreditation.provider';
import { AccredPollJobData } from './types';

const MAX_ATTEMPTS = 3;

@Injectable()
export class AccreditationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accreditationProvider: MockAccreditationProvider,
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

    return this.resolveCheck({
      userId: user.id,
      attemptNumber: attemptCount + 1,
      status: result.status,
      refId: result.refId,
      responsePayload: result,
      ipAddress,
    });
  }

  async retry(user: User, ipAddress?: string) {
    const latest = await this.prisma.accredCheck.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest || latest.status !== 'FAILURE') {
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

    return this.resolveCheck({
      userId: user.id,
      attemptNumber: attemptCount + 1,
      status: result.status,
      refId: result.refId,
      responsePayload: result,
      ipAddress,
    });
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
    status: 'success' | 'failure' | 'pending';
    refId: string;
    responsePayload: Record<string, unknown> | any;
    ipAddress?: string;
  }) {
    const { userId, attemptNumber, status, refId, responsePayload, ipAddress } = opts;

    const prismaStatus = status.toUpperCase() as 'SUCCESS' | 'FAILURE' | 'PENDING';

    const check = await this.prisma.accredCheck.create({
      data: {
        userId,
        provider: responsePayload['provider'] as string,
        refId: refId || `accred_${uuidv4().slice(0, 8)}`,
        status: prismaStatus,
        attemptNumber,
        responsePayload: responsePayload as any,
      },
    });

    if (prismaStatus === 'SUCCESS') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { onboardingStep: 'ACCRED_SUCCESS' },
      });
      await this.audit.log({
        userId,
        action: AuditAction.ACCRED_COMPLETED,
        status: AuditStatus.SUCCESS,
        metadata: { checkId: check.id, accreditationType: responsePayload['accreditationType'] },
        ipAddress,
      });
    } else if (prismaStatus === 'FAILURE') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { onboardingStep: 'ACCRED_FAILED' },
      });
      await this.audit.log({
        userId,
        action: AuditAction.ACCRED_COMPLETED,
        status: AuditStatus.FAILURE,
        metadata: { checkId: check.id, reason: responsePayload['reason'] },
        ipAddress,
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { onboardingStep: 'ACCRED_INITIATED' },
      });

      const jobData: AccredPollJobData = { accredCheckId: check.id, userId, pollCount: 0 };
      await this.accredQueue.add('poll', jobData, {
        delay: this.config.get<number>('app.mock.accredPollDelayMs') ?? 30000,
      });

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
      status,
      attemptNumber: check.attemptNumber,
      provider: check.provider,
      detail: responsePayload,
      message:
        status === 'pending'
          ? 'Accreditation check initiated. This may take up to 48 hours. Poll /accreditation/status for updates.'
          : undefined,
    };
  }

  private async assertNoPendingCheck(userId: string) {
    const pending = await this.prisma.accredCheck.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException({
        code: 'ACCRED_ALREADY_PENDING',
        message: 'An accreditation check is already in progress',
      });
    }
  }
}
