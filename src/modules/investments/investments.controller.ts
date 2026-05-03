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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { InvestmentsService } from './investments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OnboardingStepGuard } from '../../common/guards/onboarding-step.guard';
import { StepRequired } from '../../common/decorators/step-required.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingStep } from '../../common/enums';
import { CreateInvestmentDto } from './dto/create-investment.dto';

@ApiTags('Investments')
@ApiBearerAuth('access-token')
@Controller('investments')
@UseGuards(JwtAuthGuard)
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Post()
  @StepRequired(OnboardingStep.COMPLETE)
  @UseGuards(OnboardingStepGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an investment (requires onboardingStep: COMPLETE)' })
  @ApiResponse({ status: 201, description: 'Investment created — balance deducted atomically' })
  @ApiResponse({ status: 403, description: 'STEP_NOT_ALLOWED' })
  @ApiResponse({ status: 404, description: 'ACCOUNT_NOT_FOUND' })
  @ApiResponse({ status: 422, description: 'INSUFFICIENT_FUNDS' })
  async create(@CurrentUser() user: User, @Body() dto: CreateInvestmentDto, @Ip() ip: string) {
    const data = await this.investmentsService.create(user, dto, ip);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List investments (paginated)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated investment list' })
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
  @ApiOperation({ summary: 'Get a single investment by ID' })
  @ApiParam({ name: 'id', description: 'Investment ID' })
  @ApiResponse({ status: 200, description: 'Investment detail' })
  @ApiResponse({ status: 404, description: 'INVESTMENT_NOT_FOUND' })
  async findOne(@CurrentUser() user: User, @Param('id') id: string) {
    const data = await this.investmentsService.findOne(user.id, id);
    return { success: true, data };
  }
}
