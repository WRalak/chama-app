import { Global, Module } from '@nestjs/common';
import { OfficersController } from './officers.controller';
import { OfficersService } from './officers.service';

/** Officer handovers and contribution reminders. Global so role changes can record handovers. */
@Global()
@Module({ controllers: [OfficersController], providers: [OfficersService], exports: [OfficersService] })
export class OfficersModule {}
