import { UnprocessableEntityException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { inflateRawSync } from 'node:zlib';

/** Limits for uploaded .xlsx files (a .xlsx is a zip; a small one can expand enormously). */
export const XLSX_LIMITS = {
  maxEntries: 500,
  maxUncompressedBytes: 40 * 1024 * 1024,
};

const reject = (why: string) => new UnprocessableEntityException(`This spreadsheet cannot be read safely (${why}). Save it again as .xlsx or CSV and retry.`);

/**
 * Zip-bomb and malformed-archive guard. Walks the zip's central directory and actually inflates
 * every entry with a hard output cap, so declared sizes cannot lie. Rejects encrypted entries,
 * ZIP64, unknown compression methods and archives that expand beyond the limit.
 */
export function assertSafeXlsx(buf: Buffer, limits = XLSX_LIMITS): void {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw reject('not an .xlsx file');
  // End of central directory: the last 22 bytes plus an optional comment of up to 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw reject('damaged archive');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) throw reject('ZIP64 archives are not supported');
  if (entries > limits.maxEntries) throw reject('too many parts');
  if (cdOffset + cdSize > buf.length) throw reject('damaged archive');

  let budget = limits.maxUncompressedBytes;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw reject('damaged archive');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const declared = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (flags & 0x1) throw reject('encrypted');
    if (compressed === 0xffffffff || declared === 0xffffffff || localOffset === 0xffffffff) throw reject('ZIP64 archives are not supported');
    if (declared > budget) throw reject('expands too much');
    // Local header → data.
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw reject('damaged archive');
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compressed > buf.length) throw reject('damaged archive');
    const data = buf.subarray(dataStart, dataStart + compressed);
    let size: number;
    if (method === 0) size = data.length;
    else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).length;
      } catch {
        throw reject('expands too much or is damaged');
      }
    } else throw reject('unsupported compression');
    budget -= size;
    if (budget < 0) throw reject('expands too much');
    p += 46 + nameLen + extraLen + commentLen;
  }
}

function cellText(v: ExcelJS.CellValue, dateOnlyAtMidnight: boolean): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Excel stores wall-clock time without a zone; exceljs exposes it as UTC.
    const p = (x: number) => String(x).padStart(2, '0');
    const date = `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
    const midnight = !v.getUTCHours() && !v.getUTCMinutes() && !v.getUTCSeconds();
    return dateOnlyAtMidnight && midnight ? date : `${date} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}`;
  }
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    // Formulas: only the cached result is used; formulas are never evaluated.
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue, dateOnlyAtMidnight);
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v);
}

/** Reads the first sheet of an uploaded .xlsx (after the safety checks) as rows of trimmed text. */
export async function readXlsxGrid(buf: Buffer, opts: { maxRows: number; dateOnlyAtMidnight?: boolean }): Promise<string[][]> {
  assertSafeXlsx(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new UnprocessableEntityException('Could not read the spreadsheet. Save it as .xlsx or CSV and try again.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new UnprocessableEntityException('The spreadsheet has no sheets');
  if (ws.rowCount > opts.maxRows + 50) throw new UnprocessableEntityException(`Import at most ${opts.maxRows.toLocaleString()} rows at a time`);
  const cols = Math.min(ws.columnCount, 100);
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let c = 1; c <= cols; c++) values.push(cellText(row.getCell(c).value, !!opts.dateOnlyAtMidnight).trim());
    grid.push(values);
  });
  return grid;
}
