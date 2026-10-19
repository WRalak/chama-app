import { Global, Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { MemberFinanceService } from './member-finance.service';
import { ObligationsService } from './obligations.service';
import { PostingService } from './posting.service';

@Global()
@Module({
  providers: [ObligationsService, PostingService, MemberFinanceService, ApprovalsService],
  exports: [ObligationsService, PostingService, MemberFinanceService, ApprovalsService],
})
export class FinanceModule {}
