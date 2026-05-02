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
import { User } from '@prisma/client';
import { BankService } from './bank.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OnboardingStepGuard } from '../../common/guards/onboarding-step.guard';
import { StepRequired } from '../../common/decorators/step-required.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingStep } from '../../common/enums';
import { LinkBankDto } from './dto/link-bank.dto';

@Controller('bank')
@UseGuards(JwtAuthGuard)
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Post('link')
  @StepRequired(OnboardingStep.ACCRED_SUCCESS)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.CREATED)
  async link(@CurrentUser() user: User, @Body() dto: LinkBankDto, @Ip() ip: string) {
    const data = await this.bankService.link(user, dto, ip);
    return { success: true, data };
  }

  @Get('accounts')
  async findAll(@CurrentUser() user: User) {
    const data = await this.bankService.findAll(user.id);
    return { success: true, data };
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlink(@CurrentUser() user: User, @Param('id') id: string) {
    await this.bankService.unlink(user.id, id);
  }
}
