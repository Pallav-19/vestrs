import { Controller, Post, Get, HttpCode, HttpStatus, UseGuards, Ip } from '@nestjs/common';
import { User } from '@prisma/client';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OnboardingStepGuard } from '../../common/guards/onboarding-step.guard';
import { StepRequired } from '../../common/decorators/step-required.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingStep } from '../../common/enums';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('initiate')
  @StepRequired(OnboardingStep.REGISTERED)
  @UseGuards(OnboardingStepGuard)
  async initiate(@CurrentUser() user: User, @Ip() ip: string) {
    const data = await this.kycService.initiate(user, ip);
    return { success: true, data };
  }

  @Get('status')
  async getStatus(@CurrentUser() user: User) {
    const data = await this.kycService.getStatus(user.id);
    return { success: true, data };
  }

  @Post('retry')
  @StepRequired(OnboardingStep.KYC_FAILED)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async retry(@CurrentUser() user: User, @Ip() ip: string) {
    const data = await this.kycService.retry(user, ip);
    return { success: true, data };
  }
}
