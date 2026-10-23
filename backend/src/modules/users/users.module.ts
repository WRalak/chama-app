import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { UsersController } from './users.controller';

@Module({ imports: [PlatformModule], controllers: [UsersController] })
export class UsersModule {}
