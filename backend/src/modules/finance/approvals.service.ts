import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ApprovalEntity } from '@prisma/client';
import { ApprovalRecord, GroupRole } from '@chamahub/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { readSettings } from './policies';

/** Approvals a group can make subject to a Joint Signatory. */
const SIGNATORY_ENTITIES: ApprovalEntity[] = ['EXPENSE', 'PAYOUT', 'DISTRIBUTION', 'LOAN'];

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
  /** True when the count is met but the group still needs a Joint Signatory's approval. */
  awaitingSignatory: boolean;
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
    return this.tally(tx, input.groupId, input.entityType, input.entityId, input.required);
  }

  /**
   * Counts approvals. When the group requires a Joint Signatory for this kind
   * of item, the item is approved only once at least one approval came from a
   * member holding that role at the time of counting.
   */
  async tally(tx: Tx, groupId: string, entityType: ApprovalEntity, entityId: string, required: number): Promise<DecideResult> {
    const rows = await tx.approval.findMany({ where: { entityType, entityId }, include: { approver: { select: { specialRoles: true } } } });
    const approved = rows.filter((r) => r.decision === 'APPROVED');
    const rejected = rows.some((r) => r.decision === 'REJECTED');
    const counted = !rejected && approved.length >= required;
    let awaitingSignatory = false;
    if (counted && SIGNATORY_ENTITIES.includes(entityType)) {
      const g = await tx.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
      if (readSettings(g.settings).requireJointSignatory) awaitingSignatory = !approved.some((r) => r.approver.specialRoles.includes('JOINT_SIGNATORY'));
    }
    return { approvals: approved.length, rejected, reached: counted && !awaitingSignatory, awaitingSignatory };
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
