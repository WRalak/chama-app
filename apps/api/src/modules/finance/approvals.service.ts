import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ApprovalEntity } from '@prisma/client';
import { ApprovalRecord, GroupRole } from '@chamahub/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';

export interface DecideInput {
  groupId: string;
  entityType: ApprovalEntity;
  entityId: string;
  approverMembershipId: string;
  decision: 'APPROVE' | 'REJECT';
  comment?: string;
  /** Memberships that may not approve (the maker, the beneficiary). */
  excludedMembershipIds: string[];
  excludedMessage?: string;
  required: number;
}

export interface DecideResult {
  approvals: number;
  rejected: boolean;
  reached: boolean;
}

/**
 * Maker-checker approvals. Each officer can decide once per item; makers
 * and beneficiaries are excluded; a single rejection stops the item.
 */
@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async decide(tx: Tx, input: DecideInput): Promise<DecideResult> {
    if (input.excludedMembershipIds.includes(input.approverMembershipId)) {
      throw new ForbiddenException(input.excludedMessage ?? 'You cannot approve an item you created or benefit from.');
    }
    const existing = await tx.approval.findUnique({
      where: { entityType_entityId_approverMembershipId: { entityType: input.entityType, entityId: input.entityId, approverMembershipId: input.approverMembershipId } },
    });
    if (existing) throw new ConflictException('You have already recorded a decision on this item.');
    await tx.approval.create({
      data: {
        groupId: input.groupId,
        entityType: input.entityType,
        entityId: input.entityId,
        approverMembershipId: input.approverMembershipId,
        decision: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        comment: input.comment ?? null,
      },
    });
    return this.tally(tx, input.entityType, input.entityId, input.required);
  }

  async tally(tx: Tx, entityType: ApprovalEntity, entityId: string, required: number): Promise<DecideResult> {
    const rows = await tx.approval.findMany({ where: { entityType, entityId } });
    const approvals = rows.filter((r) => r.decision === 'APPROVED').length;
    const rejected = rows.some((r) => r.decision === 'REJECTED');
    return { approvals, rejected, reached: !rejected && approvals >= required };
  }

  async records(entityType: ApprovalEntity, entityIds: string[]): Promise<Map<string, ApprovalRecord[]>> {
    const rows = await this.prisma.approval.findMany({
      where: { entityType, entityId: { in: entityIds } },
      orderBy: { createdAt: 'asc' },
      include: { approver: { select: { role: true, user: { select: { fullName: true } } } } },
    });
    const map = new Map<string, ApprovalRecord[]>();
    for (const r of rows) {
      const list = map.get(r.entityId) ?? [];
      list.push({
        id: r.id,
        approverName: r.approver.user.fullName,
        approverRole: r.approver.role as GroupRole,
        decision: r.decision,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      });
      map.set(r.entityId, list);
    }
    return map;
  }
}
