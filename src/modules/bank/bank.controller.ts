import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Ip,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { BankService } from './bank.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OnboardingStepGuard } from '../../common/guards/onboarding-step.guard';
import { StepRequired } from '../../common/decorators/step-required.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingStep } from '../../common/enums';
import { LinkBankDto } from './dto/link-bank.dto';

@ApiTags('Bank')
@ApiBearerAuth('access-token')
@Controller('bank')
@UseGuards(JwtAuthGuard)
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Post('link')
  @StepRequired(OnboardingStep.ACCRED_SUCCESS)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Link a bank account (requires onboardingStep: ACCRED_SUCCESS)' })
  @ApiResponse({ status: 201, description: 'Bank account linked — onboardingStep advances to COMPLETE' })
  @ApiResponse({ status: 403, description: 'STEP_NOT_ALLOWED' })
  @ApiResponse({ status: 422, description: 'BANK_LINK_FAILED' })
  async link(@CurrentUser() user: User, @Body() dto: LinkBankDto, @Ip() ip: string) {
    const data = await this.bankService.link(user, dto, ip);
    return { success: true, data };
  }

  @Get('accounts')
  @ApiOperation({ summary: 'List all active linked bank accounts' })
  @ApiResponse({ status: 200, description: 'Array of linked bank accounts' })
  async findAll(@CurrentUser() user: User) {
    const data = await this.bankService.findAll(user.id);
    return { success: true, data };
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink a bank account' })
  @ApiParam({ name: 'id', description: 'Bank account ID' })
  @ApiResponse({ status: 204, description: 'Account unlinked' })
  @ApiResponse({ status: 404, description: 'ACCOUNT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ACCOUNT_ALREADY_UNLINKED' })
  async unlink(@CurrentUser() user: User, @Param('id') id: string) {
    await this.bankService.unlink(user.id, id);
  }
}
