import { IsoDate, isIsoDate, todayInNairobi } from '@chamahub/shared';
import { BadRequestException } from '@nestjs/common';

/** ISO calendar date → Date for @db.Date columns. */
export function dbDate(iso: IsoDate): Date {
  if (!isIsoDate(iso)) throw new BadRequestException(`Invalid date ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

/** @db.Date column → ISO calendar date. */
export function isoDate(d: Date): IsoDate;
export function isoDate(d: Date | null | undefined): IsoDate | null;
export function isoDate(d: Date | null | undefined): IsoDate | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function today(): IsoDate {
  return todayInNairobi();
}
