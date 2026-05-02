import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditStatus } from '../../common/enums';
import { CreateInvestmentDto } from './dto/create-investment.dto';

@Injectable()
export class InvestmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(user: User, dto: CreateInvestmentDto, ipAddress?: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, userId: user.id, status: 'ACTIVE' },
    });

    if (!account) {
      throw new NotFoundException({
        code: 'ACCOUNT_NOT_FOUND',
        message: 'Bank account not found or inactive',
      });
    }

    const balance = Number(account.balance);
    if (balance < dto.amount) {
      throw new UnprocessableEntityException({
        code: 'INSUFFICIENT_FUNDS',
        message: `Insufficient balance. Available: ${balance} ${account.currency}`,
      });
    }

    await this.audit.log({
      userId: user.id,
      action: AuditAction.INVESTMENT_INITIATED,
      status: AuditStatus.PENDING,
      metadata: {
        bankAccountId: dto.bankAccountId,
        amount: dto.amount,
        destinationAccount: dto.destinationAccount,
      },
      ipAddress,
    });

    const txRef = `txn_${uuidv4().replace(/-/g, '')}`;

    const investment = await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: dto.bankAccountId },
        data: { balance: { decrement: dto.amount } },
      });

      return tx.investment.create({
        data: {
          userId: user.id,
          bankAccountId: dto.bankAccountId,
          amount: dto.amount,
          currency: account.currency,
          destinationAccount: dto.destinationAccount,
          txRef,
          status: 'COMPLETED',
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.INVESTMENT_COMPLETED,
      status: AuditStatus.SUCCESS,
      metadata: {
        investmentId: investment.id,
        txRef,
        amount: dto.amount,
        destinationAccount: dto.destinationAccount,
      },
      ipAddress,
    });

    return this.format(investment);
  }

  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.investment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          bankAccount: { select: { maskedNumber: true, bankName: true } },
        },
      }),
      this.prisma.investment.count({ where: { userId } }),
    ]);

    return {
      items: items.map((inv) => ({
        ...this.format(inv),
        bankAccount: inv.bankAccount,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async findOne(userId: string, investmentId: string) {
    const investment = await this.prisma.investment.findFirst({
      where: { id: investmentId, userId },
      include: {
        bankAccount: {
          select: { maskedNumber: true, bankName: true, accountType: true },
        },
      },
    });

    if (!investment) {
      throw new NotFoundException({
        code: 'INVESTMENT_NOT_FOUND',
        message: 'Investment not found',
      });
    }

    return { ...this.format(investment), bankAccount: investment.bankAccount };
  }

  private format(inv: { id: string; txRef: string; amount: any; currency: string; destinationAccount: string; status: any; createdAt: Date }) {
    return {
      id: inv.id,
      txRef: inv.txRef,
      amount: Number(inv.amount),
      currency: inv.currency,
      destinationAccount: inv.destinationAccount,
      status: inv.status.toString().toLowerCase(),
      createdAt: inv.createdAt,
    };
  }
}
