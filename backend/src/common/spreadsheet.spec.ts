import ExcelJS from 'exceljs';
import { crc32, deflateRawSync } from 'node:zlib';
import { assertSafeXlsx, readXlsxGrid } from './spreadsheet';

/** Builds a zip by hand so tests can produce archives that lie about their contents. */
function zip(entries: { name: string; data: Buffer; declaredSize?: number; flags?: number }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const comp = deflateRawSync(e.data);
    const name = Buffer.from(e.name);
    const size = e.declaredSize ?? e.data.length;
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, comp);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('spreadsheet upload safety', () => {
  it('reads a normal workbook', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Statement');
    ws.addRow(['Receipt No.', 'Completion Time', 'Paid In']);
    ws.addRow(['QJK12345XY', new Date(Date.UTC(2026, 9, 1, 10, 30)), 1500]);
    ws.addRow(['=HYPERLINK("http://evil.example","x")', 'formula text is data', 1]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(() => assertSafeXlsx(buf)).not.toThrow();
    const grid = await readXlsxGrid(buf, { maxRows: 100 });
    expect(grid[1]).toEqual(['QJK12345XY', '2026-10-01 10:30:00', '1500']);
  });

  it('rejects a zip bomb (60 MB of zeros in a ~60 KB file)', () => {
    const bomb = zip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(60 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => assertSafeXlsx(bomb)).toThrow(/expands too much/);
  });

  it('rejects an archive that lies about its uncompressed size', () => {
    const liar = zip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(60 * 1024 * 1024), declaredSize: 1000 }]);
    expect(() => assertSafeXlsx(liar)).toThrow(/expands too much/);
  });

  it('rejects encrypted entries, too many parts and non-zip files', () => {
    expect(() => assertSafeXlsx(zip([{ name: 'a.xml', data: Buffer.from('<a/>'), flags: 1 }]))).toThrow(/encrypted/);
    expect(() => assertSafeXlsx(zip(Array.from({ length: 501 }, (_, i) => ({ name: `p${i}.xml`, data: Buffer.from('x') }))))).toThrow(/too many parts/);
    expect(() => assertSafeXlsx(Buffer.from('name,phone\nJane,0700000000\n'))).toThrow(/not an .xlsx file/);
    expect(() => assertSafeXlsx(Buffer.alloc(10))).toThrow();
  });
});
