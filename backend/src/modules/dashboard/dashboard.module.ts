import { Controller, Get, Module, Param } from '@nestjs/common';
import { Permission } from '@chamahub/shared';
import { CurrentMembership, RequirePermission } from '../../common/decorators';
import { MembershipContext } from '../../common/request';
import { RotationsModule } from '../rotations/rotations.module';
import { DashboardService } from './dashboard.service';

@Controller('groups/:groupId/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Any member may call it; the service includes only what the caller's permissions allow. */
  @RequirePermission(Permission.GROUP_VIEW)
  @Get()
  get(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.dashboard.forViewer(groupId, m);
  }
}

@Module({ imports: [RotationsModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
