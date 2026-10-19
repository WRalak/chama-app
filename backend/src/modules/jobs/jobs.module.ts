import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { DecisionsModule } from '../decisions/decisions.module';

@Module({ imports: [DecisionsModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
