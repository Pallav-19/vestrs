import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditStatus } from '../../common/enums';

export interface CreateAuditLogDto {
  userId?: string;
  action: AuditAction;
  status: AuditStatus;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(dto: CreateAuditLogDto): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: dto.userId ?? null,
          action: dto.action as any,
          status: dto.status as any,
          metadata: (dto.metadata ?? {}) as any,
          ipAddress: dto.ipAddress ?? null,
        },
      });
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          action: true,
          status: true,
          metadata: true,
          ipAddress: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where: { userId } }),
    ]);

    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }
}
