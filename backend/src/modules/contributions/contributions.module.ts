import { Module } from '@nestjs/common';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { DestinationsService } from '../collections/destinations.service';

@Module({ controllers: [ContributionsController], providers: [ContributionsService, DestinationsService], exports: [ContributionsService, DestinationsService] })
export class ContributionsModule {}
