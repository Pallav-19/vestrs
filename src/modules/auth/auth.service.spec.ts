import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

jest.mock('bcrypt');

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

const mockJwt = { signAsync: jest.fn() };
const mockConfig = { get: jest.fn().mockReturnValue('secret') };
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

const baseUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  phone: '+14155550001',
  nationality: 'US',
  domicile: 'US',
  passwordHash: 'hashed',
  onboardingStep: 'REGISTERED',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const registerDto = {
  name: 'Test User',
  email: 'test@example.com',
  password: 'Password@123',
  phone: '+14155550001',
  nationality: 'US',
  domicile: 'US',
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwt.signAsync.mockResolvedValue('mock-token');
  });

  describe('register', () => {
    it('creates user and returns sanitized user + tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      mockPrisma.user.create.mockResolvedValue(baseUser);

      const result = await service.register(registerDto, '127.0.0.1');

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: registerDto.email }) }),
      );
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.tokens).toHaveProperty('access_token');
      expect(result.tokens).toHaveProperty('refresh_token');
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when email is already taken', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ email: baseUser.email, password: 'Password@123' });

      expect(result.tokens).toHaveProperty('access_token');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('throws UnauthorizedException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: baseUser.email, password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('returns a new access token', async () => {
      const result = await service.refresh('user-1');
      expect(result).toHaveProperty('access_token');
      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1' },
        expect.any(Object),
      );
    });
  });

  describe('sanitize', () => {
    it('strips passwordHash from user object', () => {
      const sanitized = service.sanitize(baseUser as any);
      expect(sanitized).not.toHaveProperty('passwordHash');
      expect(sanitized).toHaveProperty('email');
    });
  });
});
