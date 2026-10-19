import { Module } from '@nestjs/common';
import { GroupMembersController, InvitationsController } from './members.controller';
import { MembersService } from './members.service';

@Module({ controllers: [GroupMembersController, InvitationsController], providers: [MembersService], exports: [MembersService] })
export class MembersModule {}
