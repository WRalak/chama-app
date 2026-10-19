import { Module } from '@nestjs/common';
import { ContributionsModule } from '../contributions/contributions.module';
import { LoansModule } from '../loans/loans.module';
import { GroupStatementsController, PersonalStatementController } from '../statements/statements.controller';
import { PdfService } from '../statements/pdf.service';
import { StatementsService } from '../statements/statements.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ContributionsModule, LoansModule],
  controllers: [ReportsController, GroupStatementsController, PersonalStatementController],
  providers: [ReportsService, StatementsService, PdfService],
  exports: [StatementsService, PdfService],
})
export class ReportsModule {}
