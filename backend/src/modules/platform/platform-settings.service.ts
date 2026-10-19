import { Global, Injectable, Module } from '@nestjs/common';
import { defaultPlatformSettings, PlatformSettings, platformSettingsSchema } from '@chamahub/shared';
import { PrismaService } from '../../prisma/prisma.service';

const KEY = 'platform';

/** Platform-wide configuration, cached briefly so hot paths stay cheap. */
@Injectable()
export class PlatformSettingsService {
  private cache: { value: PlatformSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.value;
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const parsed = platformSettingsSchema.partial().safeParse(row?.value ?? {});
    const value = { ...defaultPlatformSettings, ...(parsed.success ? parsed.data : {}) };
    this.cache = { value, at: Date.now() };
    return value;
  }

  async set(value: PlatformSettings, userId: string) {
    await this.prisma.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedById: userId }, update: { value, updatedById: userId } });
    this.cache = null;
    return this.get();
  }
}

@Global()
@Module({ providers: [PlatformSettingsService], exports: [PlatformSettingsService] })
export class PlatformSettingsModule {}
