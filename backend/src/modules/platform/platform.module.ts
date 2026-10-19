import { Module } from '@nestjs/common';
import { PlatformController, PlatformNoticeController } from './platform.controller';
import { AuthModule } from '../auth/auth.module';
import { GroupSupportGrantsController } from './support-grants.controller';

@Module({ imports: [AuthModule], controllers: [PlatformController, PlatformNoticeController, GroupSupportGrantsController] })
export class PlatformModule {}
