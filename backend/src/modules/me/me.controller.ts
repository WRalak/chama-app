import { Controller, Get, Query } from '@nestjs/common';
import { addDays, isoDateSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators';
import { today } from '../../common/dates';
import { AuthContext } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { MeService } from './me.service';

const obligationsQuery = z.object({ groupId: z.string().optional(), from: isoDateSchema.optional(), to: isoDateSchema.optional(), status: z.string().optional() });
const paymentsQuery = z.object({ groupId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
const calendarQuery = z.object({ groupId: z.string().optional(), from: isoDateSchema.optional(), to: isoDateSchema.optional() });

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthContext) {
    return this.me.dashboard(user.id);
  }

  @Get('obligations')
  obligations(@CurrentUser() user: AuthContext, @Query(new ZodPipe(obligationsQuery)) q: z.infer<typeof obligationsQuery>) {
    return this.me.obligations(user.id, q);
  }

  @Get('payments')
  payments(@CurrentUser() user: AuthContext, @Query(new ZodPipe(paymentsQuery)) q: z.infer<typeof paymentsQuery>) {
    return this.me.payments(user.id, q);
  }

  @Get('loans')
  loans(@CurrentUser() user: AuthContext) {
    return this.me.loans(user.id);
  }

  @Get('calendar')
  calendar(@CurrentUser() user: AuthContext, @Query(new ZodPipe(calendarQuery)) q: z.infer<typeof calendarQuery>) {
    const from = q.from ?? addDays(today(), -14);
    const to = q.to ?? addDays(from, 90);
    return this.me.calendar(user.id, { from, to, groupId: q.groupId });
  }
}
