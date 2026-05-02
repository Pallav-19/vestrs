import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Ip,
  Query,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { InvestmentsService } from './investments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OnboardingStepGuard } from '../../common/guards/onboarding-step.guard';
import { StepRequired } from '../../common/decorators/step-required.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingStep } from '../../common/enums';
import { CreateInvestmentDto } from './dto/create-investment.dto';

@Controller('investments')
@UseGuards(JwtAuthGuard)
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Post()
  @StepRequired(OnboardingStep.COMPLETE)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: User, @Body() dto: CreateInvestmentDto, @Ip() ip: string) {
    const data = await this.investmentsService.create(user, dto, ip);
    return { success: true, data };
  }

  @Get()
  async findAll(
    @CurrentUser() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.investmentsService.findAll(
      user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
    return { success: true, data };
  }

  @Get(':id')
  async findOne(@CurrentUser() user: User, @Param('id') id: string) {
    const data = await this.investmentsService.findOne(user.id, id);
    return { success: true, data };
  }
}
