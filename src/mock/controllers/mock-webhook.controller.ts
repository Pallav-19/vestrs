import {
  Controller,
  Post,
  Param,
  Body,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditAction, AuditStatus, OnboardingStep } from '../../common/enums';

class WebhookDto {
  status: 'success' | 'failure';
  reason?: string;
}

@Controller('mock/webhooks')
export class MockWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private guardNonProd() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Mock endpoints are not available in production');
    }
  }

  @Post('kyc/:refId')
  async simulateKycWebhook(@Param('refId') refId: string, @Body() dto: WebhookDto) {
    this.guardNonProd();

    const check = await this.prisma.kycCheck.findFirst({ where: { refId } });
    if (!check) throw new NotFoundException(`KYC check not found for refId: ${refId}`);

    const nextStep =
      dto.status === 'success' ? OnboardingStep.KYC_SUCCESS : OnboardingStep.KYC_FAILED;

    await this.prisma.$transaction([
      this.prisma.kycCheck.update({
        where: { id: check.id },
        data: { status: dto.status === 'success' ? 'SUCCESS' : 'FAILURE', updatedAt: new Date() },
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
      metadata: { refId, reason: dto.reason, source: 'mock_webhook' },
    });

    return { success: true, message: `KYC status updated to ${dto.status}` };
  }

  @Post('accreditation/:refId')
  async simulateAccredWebhook(@Param('refId') refId: string, @Body() dto: WebhookDto) {
    this.guardNonProd();

    const check = await this.prisma.accredCheck.findFirst({ where: { refId } });
    if (!check) throw new NotFoundException(`Accreditation check not found for refId: ${refId}`);

    const nextStep =
      dto.status === 'success' ? OnboardingStep.ACCRED_SUCCESS : OnboardingStep.ACCRED_FAILED;

    await this.prisma.$transaction([
      this.prisma.accredCheck.update({
        where: { id: check.id },
        data: { status: dto.status === 'success' ? 'SUCCESS' : 'FAILURE', updatedAt: new Date() },
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
      metadata: { refId, reason: dto.reason, source: 'mock_webhook' },
    });

    return { success: true, message: `Accreditation status updated to ${dto.status}` };
  }
}
