import {
  Controller,
  Post,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditAction, AuditStatus, CheckStatus, OnboardingStep } from '../../common/enums';
import { assertNonProd } from '../utils/non-prod.guard';

class WebhookDto {
  status: 'success' | 'failure';
  reason?: string;
}

@Controller('dev/webhooks')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('kyc/:refId')
  async simulateKycWebhook(@Param('refId') refId: string, @Body() dto: WebhookDto) {
    assertNonProd();

    const check = await this.prisma.kycCheck.findFirst({ where: { refId } });
    if (!check) throw new NotFoundException(`KYC check not found for refId: ${refId}`);

    const newStatus = dto.status === 'success' ? CheckStatus.SUCCESS : CheckStatus.FAILURE;
    const nextStep = dto.status === 'success' ? OnboardingStep.KYC_SUCCESS : OnboardingStep.KYC_FAILED;

    await this.prisma.$transaction([
      this.prisma.kycCheck.update({
        where: { id: check.id },
        data: { status: newStatus, updatedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: check.userId },
        data: { onboardingStep: nextStep as any },
      }),
    ]);

    await this.audit.log({
      userId: check.userId,
      action: AuditAction.KYC_COMPLETED,
      status: dto.status === 'success' ? AuditStatus.SUCCESS : AuditStatus.FAILURE,
      metadata: { refId, reason: dto.reason, source: 'webhook' },
    });

    return { success: true, message: `KYC status updated to ${dto.status}` };
  }

  @Post('accreditation/:refId')
  async simulateAccredWebhook(@Param('refId') refId: string, @Body() dto: WebhookDto) {
    assertNonProd();

    const check = await this.prisma.accredCheck.findFirst({ where: { refId } });
    if (!check) throw new NotFoundException(`Accreditation check not found for refId: ${refId}`);

    const newStatus = dto.status === 'success' ? CheckStatus.SUCCESS : CheckStatus.FAILURE;
    const nextStep = dto.status === 'success' ? OnboardingStep.ACCRED_SUCCESS : OnboardingStep.ACCRED_FAILED;

    await this.prisma.$transaction([
      this.prisma.accredCheck.update({
        where: { id: check.id },
        data: { status: newStatus, updatedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: check.userId },
        data: { onboardingStep: nextStep as any },
      }),
    ]);

    await this.audit.log({
      userId: check.userId,
      action: AuditAction.ACCRED_COMPLETED,
      status: dto.status === 'success' ? AuditStatus.SUCCESS : AuditStatus.FAILURE,
      metadata: { refId, reason: dto.reason, source: 'webhook' },
    });

    return { success: true, message: `Accreditation status updated to ${dto.status}` };
  }
}
