import { Controller, Post, Get, HttpCode, HttpStatus, UseGuards, Ip } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { AccreditationService } from './accreditation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OnboardingStepGuard } from '../../common/guards/onboarding-step.guard';
import { StepRequired } from '../../common/decorators/step-required.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingStep } from '../../common/enums';

@ApiTags('Accreditation')
@ApiBearerAuth('access-token')
@Controller('accreditation')
@UseGuards(JwtAuthGuard)
export class AccreditationController {
  constructor(private readonly accreditationService: AccreditationService) {}

  @Post('initiate')
  @StepRequired(OnboardingStep.KYC_SUCCESS)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start accreditation check (requires onboardingStep: KYC_SUCCESS)' })
  @ApiResponse({ status: 202, description: 'Accreditation check initiated — may take 12–48 hours; poll /accreditation/status every 30s' })
  @ApiResponse({ status: 403, description: 'STEP_NOT_ALLOWED' })
  @ApiResponse({ status: 409, description: 'ACCRED_ALREADY_PENDING' })
  @ApiResponse({ status: 422, description: 'MAX_ATTEMPTS_REACHED' })
  async initiate(@CurrentUser() user: User, @Ip() ip: string) {
    const data = await this.accreditationService.initiate(user, ip);
    return { success: true, data };
  }

  @Get('status')
  @ApiOperation({ summary: 'Poll accreditation check status' })
  @ApiResponse({ status: 200, description: 'Returns current accreditation status and detail' })
  @ApiResponse({ status: 404, description: 'ACCRED_NOT_FOUND' })
  async getStatus(@CurrentUser() user: User) {
    const data = await this.accreditationService.getStatus(user.id);
    return { success: true, data };
  }

  @Post('retry')
  @StepRequired(OnboardingStep.ACCRED_FAILED)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Retry accreditation after failure (requires onboardingStep: ACCRED_FAILED)' })
  @ApiResponse({ status: 202, description: 'Retry initiated' })
  @ApiResponse({ status: 422, description: 'MAX_ATTEMPTS_REACHED' })
  async retry(@CurrentUser() user: User, @Ip() ip: string) {
    const data = await this.accreditationService.retry(user, ip);
    return { success: true, data };
  }
}
