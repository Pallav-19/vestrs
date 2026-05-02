import { Controller, Post, Get, HttpCode, HttpStatus, UseGuards, Ip } from '@nestjs/common';
import { User } from '@prisma/client';
import { AccreditationService } from './accreditation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OnboardingStepGuard } from '../../common/guards/onboarding-step.guard';
import { StepRequired } from '../../common/decorators/step-required.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingStep } from '../../common/enums';

@Controller('accreditation')
@UseGuards(JwtAuthGuard)
export class AccreditationController {
  constructor(private readonly accreditationService: AccreditationService) {}

  @Post('initiate')
  @StepRequired(OnboardingStep.KYC_SUCCESS)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async initiate(@CurrentUser() user: User, @Ip() ip: string) {
    const data = await this.accreditationService.initiate(user, ip);
    return { success: true, data };
  }

  @Get('status')
  async getStatus(@CurrentUser() user: User) {
    const data = await this.accreditationService.getStatus(user.id);
    return { success: true, data };
  }

  @Post('retry')
  @StepRequired(OnboardingStep.ACCRED_FAILED)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async retry(@CurrentUser() user: User, @Ip() ip: string) {
    const data = await this.accreditationService.retry(user, ip);
    return { success: true, data };
  }
}
