import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { StaffMailerService } from './staff-mailer.service';

/** Staff identities for the platform portal. Global so the app-wide guards can authenticate staff. */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, PlatformAuditService, StaffMailerService],
  exports: [PlatformAuthService, PlatformAuditService, StaffMailerService],
})
export class PlatformAuthModule {}
