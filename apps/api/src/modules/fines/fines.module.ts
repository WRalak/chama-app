import { Module } from '@nestjs/common';
import { FinesController } from './fines.controller';
import { FinesService } from './fines.service';

@Module({ controllers: [FinesController], providers: [FinesService] })
export class FinesModule {}
