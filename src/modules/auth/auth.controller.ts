import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Ip,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtRefreshGuard } from '../../common/guards/jwt-refresh.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '@prisma/client';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User created — returns user object and JWT token pair' })
  @ApiResponse({ status: 409, description: 'EMAIL_TAKEN' })
  async register(@Body() dto: RegisterDto, @Ip() ip: string) {
    const data = await this.authService.register(dto, ip);
    return { success: true, data, message: 'Registration successful' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns user object and JWT token pair' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    const data = await this.authService.login(dto, ip);
    return { success: true, data, message: 'Login successful' };
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Exchange refresh token for a new access token' })
  @ApiResponse({ status: 200, description: 'Returns new access_token' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid or expired' })
  async refresh(@CurrentUser() user: User) {
    const data = await this.authService.refresh(user.id);
    return { success: true, data };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current authenticated user' })
  @ApiResponse({ status: 200, description: 'Returns user profile including onboardingStep' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  me(@CurrentUser() user: User) {
    return { success: true, data: this.authService.sanitize(user) };
  }
}
