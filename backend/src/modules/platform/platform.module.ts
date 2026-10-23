import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardService } from './dashboard.service';
import { PlatformController, PlatformNoticeController } from './platform.controller';
import { StaffController, StaffRolesController } from './staff.controller';
import { StaffService } from './staff.service';
import { MySupportController, StaffSupportController } from './support.controller';
import { SupportService } from './support.service';
import { GroupSupportGrantsController } from './support-grants.controller';

@Module({
  imports: [AuthModule],
  controllers: [PlatformController, PlatformNoticeController, StaffController, StaffRolesController, MySupportController, StaffSupportController, GroupSupportGrantsController],
  providers: [DashboardService, StaffService, SupportService],
  exports: [SupportService],
})
export class PlatformModule {}
