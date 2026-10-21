import { Global, Module } from '@nestjs/common';
import { EmailChannel, PushChannel, SmsChannel, WhatsAppChannel } from './channels';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, SmsChannel, WhatsAppChannel, EmailChannel, PushChannel],
  exports: [NotificationsService, SmsChannel, WhatsAppChannel, EmailChannel, PushChannel],
})
export class NotificationsModule {}
