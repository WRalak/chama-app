import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { RequestMeta } from './request';

export interface AuditInput {
  groupId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  reference?: string | null;
  approvalStatus?: string | null;
  meta?: RequestMeta;
}

/** Converts BigInt/Date values so audit payloads serialise into JSON. */
export function toAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes an audit event; pass `tx` so it commits atomically with the change. */
  async log(input: AuditInput, tx?: Tx) {
    const client = tx ?? this.prisma;
    await client.auditEvent.create({
      data: {
        groupId: input.groupId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: toAuditJson(input.before),
        after: toAuditJson(input.after),
        reason: input.reason ?? null,
        reference: input.reference ?? null,
        approvalStatus: input.approvalStatus ?? null,
        ipAddress: input.meta?.ipAddress ?? null,
        userAgent: input.meta?.userAgent ?? null,
        requestId: input.meta?.requestId ?? null,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
