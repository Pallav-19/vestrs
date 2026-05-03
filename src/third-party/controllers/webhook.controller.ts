import {
  Controller,
  Post,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditAction, AuditStatus, CheckStatus, OnboardingStep } from '../../common/enums';
import { assertNonProd } from '../utils/non-prod.guard';

class WebhookDto {
  @ApiProperty({ enum: ['success', 'failure'] })
  status: 'success' | 'failure';

  @ApiPropertyOptional({ example: 'Simulated AML hit' })
  reason?: string;
}

@ApiTags('Dev')
@Controller('dev/webhooks')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('kyc/:refId')
  @ApiOperation({ summary: '[Dev] Simulate KYC webhook resolution' })
  @ApiParam({ name: 'refId', description: 'KYC check refId from initiate response' })
  @ApiResponse({ status: 201, description: 'KYC status updated' })
  @ApiResponse({ status: 404, description: 'KYC check not found' })
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
  @ApiOperation({ summary: '[Dev] Simulate accreditation webhook resolution' })
  @ApiParam({ name: 'refId', description: 'Accreditation check refId from initiate response' })
  @ApiResponse({ status: 201, description: 'Accreditation status updated' })
  @ApiResponse({ status: 404, description: 'Accreditation check not found' })
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
