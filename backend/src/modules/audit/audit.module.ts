import { Module } from '@nestjs/common';
import { GroupAuditController } from './audit.controller';

@Module({ controllers: [GroupAuditController] })
export class GroupAuditModule {}
