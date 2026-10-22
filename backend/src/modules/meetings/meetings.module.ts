import { Module } from '@nestjs/common';
import { MeetingsController, MyMeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({ controllers: [MeetingsController, MyMeetingsController], providers: [MeetingsService], exports: [MeetingsService] })
export class MeetingsModule {}
