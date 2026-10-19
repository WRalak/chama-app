import { Global, Module } from '@nestjs/common';
import { EmailChannel, SmsChannel, WhatsAppChannel } from './channels';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, SmsChannel, WhatsAppChannel, EmailChannel],
  exports: [NotificationsService, SmsChannel, WhatsAppChannel, EmailChannel],
})
export class NotificationsModule {}
