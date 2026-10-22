import { Module } from '@nestjs/common';
import { CollectionsModule } from '../collections/collections.module';
import { ContributionsModule } from '../contributions/contributions.module';
import { LoansModule } from '../loans/loans.module';
import { ReportsModule } from '../reports/reports.module';
import { RotationsModule } from '../rotations/rotations.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiProviderHolder } from './provider';
import { AiToolsService } from './tools/tools.service';

/** The AI assistant: provider abstraction, the read-only tool registry, chat and quick answers. */
@Module({
  imports: [ContributionsModule, LoansModule, RotationsModule, ReportsModule, CollectionsModule],
  controllers: [AiController],
  providers: [AiProviderHolder, AiToolsService, AiService],
  exports: [AiProviderHolder, AiService],
})
export class AiModule {}
