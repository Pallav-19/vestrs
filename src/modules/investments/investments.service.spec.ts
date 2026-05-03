import { Test } from '@nestjs/testing';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const mockInvestment = {
  id: 'inv-1',
  txRef: 'txn_abc123',
  amount: 1000,
  currency: 'USD',
  destinationAccount: 'DEST-001',
  status: 'COMPLETED',
  createdAt: new Date(),
  bankAccount: { maskedNumber: '****1234', bankName: 'Mock Chase Bank' },
};

const mockTx = {
  bankAccount: { update: jest.fn() },
  investment: { create: jest.fn() },
};

const mockPrisma = {
  $transaction: jest.fn(),
  bankAccount: { findFirst: jest.fn() },
  investment: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

const testUser: any = {
  id: 'user-1',
  onboardingStep: 'COMPLETE',
};

const activeAccount = {
  id: 'acc-1',
  userId: 'user-1',
  balance: 50000,
  currency: 'USD',
  status: 'ACTIVE',
};

describe('InvestmentsService', () => {
  let service: InvestmentsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvestmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<InvestmentsService>(InvestmentsService);
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
  });

  describe('create', () => {
    const dto = { bankAccountId: 'acc-1', amount: 1000, destinationAccount: 'DEST-001' };

    it('throws NotFoundException when account not found or not active', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(null);

      await expect(service.create(testUser, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException on insufficient funds', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue({ ...activeAccount, balance: 500 });

      await expect(service.create(testUser, { ...dto, amount: 1000 })).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('deducts balance and creates investment in a transaction', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(activeAccount);
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));
      mockTx.bankAccount.update.mockResolvedValue({});
      mockTx.investment.create.mockResolvedValue(mockInvestment);

      const result = await service.create(testUser, dto, '127.0.0.1');

      expect(mockTx.bankAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { decrement: dto.amount } } }),
      );
      expect(mockTx.investment.create).toHaveBeenCalled();
      expect(result.status).toBe('completed');
      expect(result.amount).toBe(1000);
      expect(mockAudit.log).toHaveBeenCalledTimes(2);
    });

    it('uses exact amount provided — no rounding', async () => {
      mockPrisma.bankAccount.findFirst.mockResolvedValue(activeAccount);
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));
      mockTx.bankAccount.update.mockResolvedValue({});
      mockTx.investment.create.mockResolvedValue({ ...mockInvestment, amount: 99.99 });

      const result = await service.create(testUser, { ...dto, amount: 99.99 });

      expect(mockTx.bankAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { decrement: 99.99 } } }),
      );
      expect(result.amount).toBe(99.99);
    });
  });

  describe('findAll', () => {
    it('returns paginated investments with metadata', async () => {
      mockPrisma.$transaction.mockResolvedValue([[mockInvestment], 1]);

      const result = await service.findAll('user-1', 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.pagination).toMatchObject({ page: 1, limit: 20, total: 1, pages: 1 });
    });

    it('computes correct page count', async () => {
      mockPrisma.$transaction.mockResolvedValue([
        Array(5).fill(mockInvestment),
        25,
      ]);

      const result = await service.findAll('user-1', 1, 5);

      expect(result.pagination.pages).toBe(5);
    });

    it('defaults to page 1 limit 20', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll('user-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns investment with bank account details', async () => {
      mockPrisma.investment.findFirst.mockResolvedValue({
        ...mockInvestment,
        bankAccount: { maskedNumber: '****1234', bankName: 'Mock Chase Bank', accountType: 'CHECKING' },
      });

      const result = await service.findOne('user-1', 'inv-1');

      expect(result.id).toBe('inv-1');
      expect(result.bankAccount).toHaveProperty('maskedNumber');
    });

    it('throws NotFoundException when investment does not exist', async () => {
      mockPrisma.investment.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('scopes to the requesting user', async () => {
      mockPrisma.investment.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'inv-other-user')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.investment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }),
      );
    });
  });
});
