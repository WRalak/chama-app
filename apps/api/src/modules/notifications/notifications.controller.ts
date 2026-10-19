import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NotificationItem, paginationSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators';
import { AuthContext } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, skipTake } from '../../common/pagination';

const listSchema = paginationSchema.extend({ unread: z.enum(['true', 'false']).optional() });

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthContext, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const where = { userId: user.id, ...(q.unread === 'true' ? { readAt: null } : {}) };
    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    const groupIds = [...new Set(rows.map((r) => r.groupId).filter(Boolean) as string[])];
    const groups = await this.prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } });
    const name = new Map(groups.map((g) => [g.id, g.name]));
    const items: NotificationItem[] = rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      groupName: r.groupId ? (name.get(r.groupId) ?? null) : null,
      type: r.type,
      title: r.title,
      body: r.body,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { ...paginate(items, total, q.page, q.pageSize), unread };
  }

  @Post(':id/read')
  async read(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: AuthContext) {
    const r = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}
