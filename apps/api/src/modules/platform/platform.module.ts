import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { GroupSupportGrantsController } from './support-grants.controller';

@Module({ controllers: [PlatformController, GroupSupportGrantsController] })
export class PlatformModule {}
