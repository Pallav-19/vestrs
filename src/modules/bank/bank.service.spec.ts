import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { BankService } from './bank.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BankProvider } from '../../third-party/providers/bank.provider';

const mockTx = {
  bankAccount: { create: jest.fn() },
  user: { update: jest.fn() },
};

const mockPrisma = {
  $transaction: jest.fn().mockImplementation(async (fn) => fn(mockTx)),
  bankAccount: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
const mockBankProvider = { link: jest.fn(), getBalance: jest.fn() };

const testUser: any = {
  id: 'user-1',
  onboardingStep: 'ACCRED_SUCCESS',
};

const linkedAccount = {
  id: 'acc-1',
  userId: 'user-1',
  bankName: 'Mock Chase Bank',
  maskedNumber: '****1234',
  accountType: 'CHECKING',
  balance: 50000,
  currency: 'USD',
  status: 'ACTIVE',
  linkedAt: new Date(),
  createdAt: new Date(),
};

describe('BankService', () => {
  let service: BankService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BankService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: BankProvider, useValue: mockBankProvider },
      ],
    }).compile();

    service = module.get<BankService>(BankService);
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
  });

  describe('link', () => {
    const linkDto = { publicToken: 'valid-token', accountId: 'acc_external' };
    const providerResponse = {
      providerAccountId: 'mock_acc_abc',
      maskedNumber: '****1234',
      bankName: 'Mock Chase Bank',
      accountType: 'checking' as const,
      balance: 50000,
      currency: 'USD',
    };

    it('creates a bank account and sets step to COMPLETE', async () => {
      mockBankProvider.link.mockResolvedValue(providerResponse);
      mockTx.bankAccount.create.mockResolvedValue(linkedAccount);
      mockTx.user.update.mockResolvedValue(testUser);

      const result = await service.link(testUser, linkDto, '127.0.0.1');

      expect(mockBankProvider.link).toHaveBeenCalledWith(linkDto);
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { onboardingStep: 'COMPLETE' } }),
      );
      expect(result).toMatchObject({
        bankName: 'Mock Chase Bank',
        maskedNumber: '****1234',
        accountType: 'checking',
      });
      expect(mockAudit.log).toHaveBeenCalledTimes(2);
    });

    it('propagates UnprocessableEntityException from provider on mock-fail-token', async () => {
      mockBankProvider.link.mockRejectedValue(
        new UnprocessableEntityException({ code: 'BANK_LINK_FAILED', message: 'Token rejected' }),
      );

      await expect(service.link(testUser, { publicToken: 'mock-fail-token', accountId: 'x' })).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockTx.bankAccount.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns mapped active accounts', async () => {
      mockPrisma.bankAccount.findMany.mockResolvedValue([linkedAccount]);

      const result = await service.findAll('user-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ accountType: 'checking', balance: 50000 });
      expect(mockPrisma.bankAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', status: 'ACTIVE' } }),
      );
    });

    it('returns empty array when no accounts', async () => {
      mockPrisma.bankAccount.findMany.mockResolvedValue([]);

      const result = await service.findAll('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('unlink', () => {
    it('sets account status to UNLINKED', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(linkedAccount);
      mockPrisma.bankAccount.update.mockResolvedValue({ ...linkedAccount, status: 'UNLINKED' });

      await service.unlink('user-1', 'acc-1');

      expect(mockPrisma.bankAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'UNLINKED' } }),
      );
    });

    it('throws NotFoundException when account does not belong to user', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(service.unlink('user-1', 'acc-other')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when account is already unlinked', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue({ ...linkedAccount, status: 'UNLINKED' });

      await expect(service.unlink('user-1', 'acc-1')).rejects.toThrow(ConflictException);
    });
  });
});
