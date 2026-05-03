import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BankProvider } from '../../third-party/providers/bank.provider';
import { AuditAction, AuditStatus, BankAccountStatus, AccountType } from '../../common/enums';
import { LinkBankDto } from './dto/link-bank.dto';

@Injectable()
export class BankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bankProvider: BankProvider,
  ) {}

  async link(user: User, dto: LinkBankDto, ipAddress?: string) {
    await this.audit.log({
      userId: user.id,
      action: AuditAction.BANK_LINK_INITIATED,
      status: AuditStatus.PENDING,
      metadata: { accountId: dto.accountId },
      ipAddress,
    });

    // Throws UnprocessableEntityException on mock-fail-token
    const result = await this.bankProvider.link({
      publicToken: dto.publicToken,
      accountId: dto.accountId,
    });

    const account = await this.prisma.$transaction(async (tx) => {
      const bankAccount = await tx.bankAccount.create({
        data: {
          userId: user.id,
          provider: 'mock-bank',
          providerAccountId: result.providerAccountId,
          maskedNumber: result.maskedNumber,
          bankName: result.bankName,
          accountType: result.accountType.toUpperCase() as AccountType,
          balance: result.balance,
          currency: result.currency,
          linkedAt: new Date(),
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { onboardingStep: 'COMPLETE' },
      });
      return bankAccount;
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.BANK_LINK_COMPLETED,
      status: AuditStatus.SUCCESS,
      metadata: {
        accountId: account.id,
        bankName: result.bankName,
        maskedNumber: result.maskedNumber,
      },
      ipAddress,
    });

    return {
      id: account.id,
      bankName: account.bankName,
      maskedNumber: account.maskedNumber,
      accountType: account.accountType.toLowerCase(),
      balance: Number(account.balance),
      currency: account.currency,
      linkedAt: account.linkedAt,
    };
  }

  async findAll(userId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { userId, status: BankAccountStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });

    return accounts.map((a) => ({
      id: a.id,
      bankName: a.bankName,
      maskedNumber: a.maskedNumber,
      accountType: a.accountType.toLowerCase(),
      balance: Number(a.balance),
      currency: a.currency,
      linkedAt: a.linkedAt,
    }));
  }

  async unlink(userId: string, accountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: accountId, userId },
    });

    if (!account) {
      throw new NotFoundException({
        code: 'ACCOUNT_NOT_FOUND',
        message: 'Bank account not found',
      });
    }

    if (account.status === BankAccountStatus.UNLINKED) {
      throw new ConflictException({
        code: 'ACCOUNT_ALREADY_UNLINKED',
        message: 'Bank account is already unlinked',
      });
    }

    await this.prisma.bankAccount.update({
      where: { id: accountId },
      data: { status: BankAccountStatus.UNLINKED },
    });
  }
}
