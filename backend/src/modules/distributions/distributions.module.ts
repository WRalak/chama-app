import { Module } from '@nestjs/common';
import { DistributionsController } from './distributions.controller';
import { DistributionsService } from './distributions.service';

@Module({ controllers: [DistributionsController], providers: [DistributionsService] })
export class DistributionsModule {}
