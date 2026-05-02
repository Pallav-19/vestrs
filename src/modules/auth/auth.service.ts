import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditStatus } from '../../common/enums';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        nationality: dto.nationality,
        domicile: dto.domicile,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.USER_REGISTERED,
      status: AuditStatus.SUCCESS,
      metadata: { email: user.email, nationality: user.nationality },
      ipAddress,
    });

    const tokens = await this.generateTokens(user.id);

    return { user: this.sanitize(user), tokens };
  }

  async login(dto: LoginDto, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const tokens = await this.generateTokens(user.id);

    return { user: this.sanitize(user), tokens };
  }

  async refresh(userId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('app.jwt.accessSecret'),
        expiresIn: this.config.get<string>('app.jwt.accessExpiresIn'),
      },
    );

    return { access_token: accessToken };
  }

  sanitize(user: User) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...rest } = user;
    return rest;
  }

  private async generateTokens(userId: string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId },
        {
          secret: this.config.get<string>('app.jwt.accessSecret'),
          expiresIn: this.config.get<string>('app.jwt.accessExpiresIn'),
        },
      ),
      this.jwt.signAsync(
        { sub: userId },
        {
          secret: this.config.get<string>('app.jwt.refreshSecret'),
          expiresIn: this.config.get<string>('app.jwt.refreshExpiresIn'),
        },
      ),
    ]);

    return { access_token: accessToken, refresh_token: refreshToken };
  }
}
