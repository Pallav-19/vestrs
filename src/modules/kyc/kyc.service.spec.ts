import { Test } from '@nestjs/testing';
import { ConflictException, UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { KycService } from './kyc.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CkycProvider } from '../../third-party/providers/ckyc.provider';
import { IdentityProvider } from '../../third-party/providers/identity.provider';
import { AmlProvider } from '../../third-party/providers/aml.provider';

const mockPrisma = {
  kycCheck: {
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  user: { update: jest.fn() },
};

const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
const mockConfig = { get: jest.fn().mockReturnValue(1000) };

const mockCkyc = { initiate: jest.fn(), poll: jest.fn() };
const mockIdentity = { initiate: jest.fn(), poll: jest.fn() };
const mockAml = { initiate: jest.fn(), poll: jest.fn() };

const testUser: any = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  nationality: 'US',
  domicile: 'US',
  onboardingStep: 'REGISTERED',
};

const successCheck = {
  id: 'check-1',
  status: 'SUCCESS',
  provider: 'composite',
  attemptNumber: 1,
  responsePayload: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('KycService', () => {
  let service: KycService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: CkycProvider, useValue: mockCkyc },
        { provide: IdentityProvider, useValue: mockIdentity },
        { provide: AmlProvider, useValue: mockAml },
        { provide: ConfigService, useValue: mockConfig },
        { provide: getQueueToken('kyc-poll'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
    mockQueue.add.mockResolvedValue(undefined);
    mockPrisma.user.update.mockResolvedValue(testUser);
  });

  describe('initiate', () => {
    it('throws ConflictException when a check is already pending', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue({ status: 'PENDING' });

      await expect(service.initiate(testUser)).rejects.toThrow(ConflictException);
    });

    it('throws UnprocessableEntityException when max attempts reached', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue(null);
      mockPrisma.kycCheck.count.mockResolvedValue(3);

      await expect(service.initiate(testUser)).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns FAILURE when CKYC fails (short-circuits identity+aml)', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue(null);
      mockPrisma.kycCheck.count.mockResolvedValue(0);
      mockCkyc.initiate.mockResolvedValue({ refId: 'c1', status: 'failure', provider: 'ckyc_registry' });
      mockPrisma.kycCheck.create.mockResolvedValue({ ...successCheck, status: 'FAILURE' });

      const result = await service.initiate(testUser);

      expect(result.status).toBe('failure');
      expect(mockIdentity.initiate).not.toHaveBeenCalled();
      expect(mockAml.initiate).not.toHaveBeenCalled();
    });

    it('returns SUCCESS when all sub-checks succeed', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue(null);
      mockPrisma.kycCheck.count.mockResolvedValue(0);
      mockCkyc.initiate.mockResolvedValue({ refId: 'c1', status: 'success', provider: 'ckyc_registry' });
      mockIdentity.initiate.mockResolvedValue({ refId: 'i1', status: 'success', provider: 'identity_verify' });
      mockAml.initiate.mockResolvedValue({ refId: 'a1', status: 'success', provider: 'aml_screening' });
      mockPrisma.kycCheck.create.mockResolvedValue(successCheck);

      const result = await service.initiate(testUser);

      expect(result.status).toBe('success');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { onboardingStep: 'KYC_SUCCESS' } }),
      );
    });

    it('returns PENDING and enqueues job when any sub-check is pending', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue(null);
      mockPrisma.kycCheck.count.mockResolvedValue(0);
      mockCkyc.initiate.mockResolvedValue({ refId: 'c1', status: 'success', provider: 'ckyc_registry' });
      mockIdentity.initiate.mockResolvedValue({ refId: 'i1', status: 'pending', provider: 'identity_verify' });
      mockAml.initiate.mockResolvedValue({ refId: 'a1', status: 'success', provider: 'aml_screening' });
      mockPrisma.kycCheck.create.mockResolvedValue({ ...successCheck, status: 'PENDING' });

      const result = await service.initiate(testUser);

      expect(result.status).toBe('pending');
      expect(mockQueue.add).toHaveBeenCalledWith('poll', expect.any(Object), expect.any(Object));
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { onboardingStep: 'KYC_INITIATED' } }),
      );
    });

    it('FAILURE composite when identity fails even if aml succeeds', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue(null);
      mockPrisma.kycCheck.count.mockResolvedValue(0);
      mockCkyc.initiate.mockResolvedValue({ refId: 'c1', status: 'success', provider: 'ckyc_registry' });
      mockIdentity.initiate.mockResolvedValue({ refId: 'i1', status: 'failure', provider: 'identity_verify' });
      mockAml.initiate.mockResolvedValue({ refId: 'a1', status: 'success', provider: 'aml_screening' });
      mockPrisma.kycCheck.create.mockResolvedValue({ ...successCheck, status: 'FAILURE' });

      const result = await service.initiate(testUser);

      expect(result.status).toBe('failure');
    });
  });

  describe('retry', () => {
    it('throws ConflictException when latest check is not FAILURE', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue({ status: 'PENDING' });

      await expect(service.retry(testUser)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when no check exists', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue(null);

      await expect(service.retry(testUser)).rejects.toThrow(ConflictException);
    });

    it('throws UnprocessableEntityException when max attempts reached', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue({ status: 'FAILURE' });
      mockPrisma.kycCheck.count.mockResolvedValue(3);

      await expect(service.retry(testUser)).rejects.toThrow(UnprocessableEntityException);
    });

    it('proceeds to runKycCheck on valid retry', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue({ status: 'FAILURE' });
      mockPrisma.kycCheck.count.mockResolvedValue(1);
      mockCkyc.initiate.mockResolvedValue({ refId: 'c1', status: 'success', provider: 'ckyc_registry' });
      mockIdentity.initiate.mockResolvedValue({ refId: 'i1', status: 'success', provider: 'identity_verify' });
      mockAml.initiate.mockResolvedValue({ refId: 'a1', status: 'success', provider: 'aml_screening' });
      mockPrisma.kycCheck.create.mockResolvedValue({ ...successCheck, attemptNumber: 2 });

      const result = await service.retry(testUser);

      expect(result.attemptNumber).toBe(2);
    });
  });

  describe('getStatus', () => {
    it('returns latest check formatted', async () => {
      const check = {
        id: 'check-1',
        status: 'SUCCESS',
        provider: 'composite',
        attemptNumber: 1,
        responsePayload: { subResults: {} },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.kycCheck.findFirst.mockResolvedValue(check);

      const result = await service.getStatus('user-1');

      expect(result.status).toBe('success');
      expect(result.id).toBe('check-1');
    });

    it('throws NotFoundException when no check exists', async () => {
      mockPrisma.kycCheck.findFirst.mockResolvedValue(null);

      await expect(service.getStatus('user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
