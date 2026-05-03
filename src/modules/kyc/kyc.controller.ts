import { Controller, Post, Get, HttpCode, HttpStatus, UseGuards, Ip } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OnboardingStepGuard } from '../../common/guards/onboarding-step.guard';
import { StepRequired } from '../../common/decorators/step-required.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingStep } from '../../common/enums';

@ApiTags('KYC')
@ApiBearerAuth('access-token')
@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('initiate')
  @StepRequired(OnboardingStep.REGISTERED)
  @UseGuards(OnboardingStepGuard)
  @ApiOperation({ summary: 'Start KYC verification (requires onboardingStep: REGISTERED)' })
  @ApiResponse({ status: 200, description: 'KYC check initiated — poll /kyc/status while status is pending' })
  @ApiResponse({ status: 403, description: 'STEP_NOT_ALLOWED' })
  @ApiResponse({ status: 409, description: 'KYC_ALREADY_PENDING' })
  @ApiResponse({ status: 422, description: 'MAX_ATTEMPTS_REACHED' })
  async initiate(@CurrentUser() user: User, @Ip() ip: string) {
    const data = await this.kycService.initiate(user, ip);
    return { success: true, data };
  }

  @Get('status')
  @ApiOperation({ summary: 'Poll KYC check status' })
  @ApiResponse({ status: 200, description: 'Returns current KYC check status and sub-results' })
  @ApiResponse({ status: 404, description: 'KYC_NOT_FOUND' })
  async getStatus(@CurrentUser() user: User) {
    const data = await this.kycService.getStatus(user.id);
    return { success: true, data };
  }

  @Post('retry')
  @StepRequired(OnboardingStep.KYC_FAILED)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Retry KYC after failure (requires onboardingStep: KYC_FAILED)' })
  @ApiResponse({ status: 202, description: 'Retry initiated' })
  @ApiResponse({ status: 409, description: 'KYC_NOT_FAILED' })
  @ApiResponse({ status: 422, description: 'MAX_ATTEMPTS_REACHED' })
  async retry(@CurrentUser() user: User, @Ip() ip: string) {
    const data = await this.kycService.retry(user, ip);
    return { success: true, data };
  }
}
