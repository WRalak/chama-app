import { Module } from '@nestjs/common';
import { ContributionsModule } from '../contributions/contributions.module';
import { CollectionsController } from './collections.controller';
import { EvidenceService } from './evidence.service';
import { StatementsService } from './statements.service';
import { SummariesService } from './summaries.service';

/** Collections: where members pay, evidence and payment history, statement reconciliation and shareable summaries. */
@Module({ imports: [ContributionsModule], controllers: [CollectionsController], providers: [EvidenceService, StatementsService, SummariesService], exports: [StatementsService, SummariesService] })
export class CollectionsModule {}
