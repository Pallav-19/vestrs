import { Test } from '@nestjs/testing';
import { ConflictException, UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { AccreditationService } from './accreditation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccreditationProvider } from '../../third-party/providers/accreditation.provider';

const mockPrisma = {
  accredCheck: {
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  user: { update: jest.fn() },
};

const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
const mockConfig = { get: jest.fn().mockReturnValue(1000) };
const mockProvider = { initiate: jest.fn(), poll: jest.fn() };

const testUser: any = {
  id: 'user-1',
  name: 'Test User',
  nationality: 'US',
  onboardingStep: 'KYC_SUCCESS',
};

const baseCheck = {
  id: 'check-1',
  provider: 'finra_accreditation',
  attemptNumber: 1,
  responsePayload: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AccreditationService', () => {
  let service: AccreditationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AccreditationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: AccreditationProvider, useValue: mockProvider },
        { provide: ConfigService, useValue: mockConfig },
        { provide: getQueueToken('accred-poll'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AccreditationService>(AccreditationService);
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
    mockQueue.add.mockResolvedValue(undefined);
    mockPrisma.user.update.mockResolvedValue(testUser);
  });

  describe('initiate', () => {
    it('throws ConflictException when a check is already pending', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue({ status: 'PENDING' });

      await expect(service.initiate(testUser)).rejects.toThrow(ConflictException);
    });

    it('throws UnprocessableEntityException when max attempts reached', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue(null);
      mockPrisma.accredCheck.count.mockResolvedValue(3);

      await expect(service.initiate(testUser)).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns SUCCESS on immediate success from provider', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue(null);
      mockPrisma.accredCheck.count.mockResolvedValue(0);
      mockProvider.initiate.mockResolvedValue({
        refId: 'accred_abc',
        status: 'success',
        provider: 'finra_accreditation',
        accreditationType: 'income',
      });
      mockPrisma.accredCheck.create.mockResolvedValue({ ...baseCheck, status: 'SUCCESS' });

      const result = await service.initiate(testUser);

      expect(result.status).toBe('success');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { onboardingStep: 'ACCRED_SUCCESS' } }),
      );
    });

    it('returns PENDING and enqueues job when provider returns pending', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue(null);
      mockPrisma.accredCheck.count.mockResolvedValue(0);
      mockProvider.initiate.mockResolvedValue({
        refId: 'accred_abc',
        status: 'pending',
        provider: 'finra_accreditation',
      });
      mockPrisma.accredCheck.create.mockResolvedValue({ ...baseCheck, status: 'PENDING' });

      const result = await service.initiate(testUser);

      expect(result.status).toBe('pending');
      expect(result.message).toContain('Poll');
      expect(mockQueue.add).toHaveBeenCalledWith('poll', expect.any(Object), expect.any(Object));
    });

    it('returns FAILURE on provider failure', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue(null);
      mockPrisma.accredCheck.count.mockResolvedValue(0);
      mockProvider.initiate.mockResolvedValue({
        refId: 'accred_abc',
        status: 'failure',
        provider: 'finra_accreditation',
        reason: 'not_qualified',
      });
      mockPrisma.accredCheck.create.mockResolvedValue({ ...baseCheck, status: 'FAILURE' });

      const result = await service.initiate(testUser);

      expect(result.status).toBe('failure');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { onboardingStep: 'ACCRED_FAILED' } }),
      );
    });
  });

  describe('retry', () => {
    it('throws ConflictException when latest check is not FAILURE', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue({ status: 'SUCCESS' });

      await expect(service.retry(testUser)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when no check exists', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue(null);

      await expect(service.retry(testUser)).rejects.toThrow(ConflictException);
    });

    it('throws UnprocessableEntityException when max attempts reached', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue({ status: 'FAILURE' });
      mockPrisma.accredCheck.count.mockResolvedValue(3);

      await expect(service.retry(testUser)).rejects.toThrow(UnprocessableEntityException);
    });

    it('succeeds on valid retry', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue({ status: 'FAILURE' });
      mockPrisma.accredCheck.count.mockResolvedValue(1);
      mockProvider.initiate.mockResolvedValue({
        refId: 'accred_xyz',
        status: 'success',
        provider: 'finra_accreditation',
        accreditationType: 'net_worth',
      });
      mockPrisma.accredCheck.create.mockResolvedValue({ ...baseCheck, status: 'SUCCESS', attemptNumber: 2 });

      const result = await service.retry(testUser);

      expect(result.status).toBe('success');
      expect(result.attemptNumber).toBe(2);
    });
  });

  describe('getStatus', () => {
    it('returns formatted check', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue({
        ...baseCheck,
        status: 'SUCCESS',
      });

      const result = await service.getStatus('user-1');

      expect(result.status).toBe('success');
    });

    it('throws NotFoundException when no check exists', async () => {
      mockPrisma.accredCheck.findFirst.mockResolvedValue(null);

      await expect(service.getStatus('user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
