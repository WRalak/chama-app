import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ImportKind } from '@prisma/client';
import { createImportSchema, IMPORT_KINDS, Permission, Feature } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequireAnyPermission, RequirePermission, RequireFeature } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { IMPORT_TEMPLATES, ImportsService } from './imports.service';

const kindParam = z.enum(IMPORT_KINDS);

@Controller('groups/:groupId/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @RequirePermission(Permission.IMPORTS_MANAGE)
  @Get('templates')
  templates() {
    return Object.entries(IMPORT_TEMPLATES).map(([kind, t]) => ({ kind, ...t }));
  }

  @RequirePermission(Permission.IMPORTS_MANAGE)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('templates/:kind.csv')
  template(@Param('kind', new ZodPipe(kindParam)) kind: ImportKind) {
    return this.imports.template(kind);
  }

  // Approvers review batches before committing them, so they can list and open them too.
  @RequireAnyPermission(Permission.IMPORTS_MANAGE, Permission.IMPORTS_APPROVE)
  @Get()
  list(@Param('groupId') groupId: string) {
    return this.imports.list(groupId);
  }

  @RequirePermission(Permission.IMPORTS_MANAGE)
  @RequireFeature(Feature.BULK_IMPORT)
  @Post()
  create(@Param('groupId') groupId: string, @Body(new ZodPipe(createImportSchema)) body: z.infer<typeof createImportSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.imports.create(groupId, body, m, meta);
  }

  @RequireAnyPermission(Permission.IMPORTS_MANAGE, Permission.IMPORTS_APPROVE)
  @Get(':id')
  detail(@Param('groupId') groupId: string, @Param('id') id: string) {
    return this.imports.detail(groupId, id);
  }

  @RequirePermission(Permission.IMPORTS_APPROVE)
  @HttpCode(200)
  @Post(':id/commit')
  commit(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.imports.commit(groupId, id, m, meta);
  }

  @RequirePermission(Permission.IMPORTS_MANAGE)
  @HttpCode(200)
  @Post(':id/discard')
  discard(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.imports.discard(groupId, id, m, meta);
  }
}
