import { describe, expect, it } from 'vitest';
import { parseAbif, readAbifDirectory } from './abif';
import { makeAbif } from './fixture';

function tiny(): ArrayBuffer {
  const entries = [
    { name: 'INLN', number: 1, type: 2, data: new Uint8Array([65, 66]) },
    { name: 'OUTS', number: 2, type: 2, data: new Uint8Array([67, 68, 69, 70, 71]) },
    { name: 'INT2', number: 3, type: 4, data: new Uint8Array([0, 7]) },
  ];
  const header = 34, dir = 28 * entries.length, out = header + dir, total = out + 5;
  const buf = new ArrayBuffer(total), v = new DataView(buf);
  'ABIF'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setInt16(4, 101, false);
  'tdir'.split('').forEach((c, i) => v.setUint8(6 + i, c.charCodeAt(0)));
  v.setInt32(10, 1, false); v.setInt16(14, 1023, false); v.setInt16(16, 28, false);
  v.setInt32(18, entries.length, false); v.setInt32(22, dir, false); v.setInt32(26, header, false); v.setInt32(30, 0, false);
  entries.forEach((e, i) => {
    const off = header + i * 28;
    e.name.split('').forEach((c, k) => v.setUint8(off + k, c.charCodeAt(0)));
    v.setInt32(off + 4, e.number, false); v.setInt16(off + 8, e.type, false); v.setInt16(off + 10, e.type === 4 ? 2 : 1, false);
    v.setInt32(off + 12, e.data.length, false); v.setInt32(off + 16, e.data.length, false);
    if (e.data.length <= 4) e.data.forEach((b, k) => v.setUint8(off + 20 + k, b));
    else { v.setInt32(off + 20, out, false); new Uint8Array(buf, out, 5).set(e.data); }
  });
  return buf;
}

describe('ABIF directory', () => {
  it('parses three hand-built entries including inline data', () => {
    const dir = readAbifDirectory(tiny());
    expect(dir.map((e) => e.name)).toEqual(['INLN', 'OUTS', 'INT2']);
    expect(Array.from(dir[0].data)).toEqual([65, 66]);
    expect(Array.from(dir[1].data)).toEqual([67, 68, 69, 70, 71]);
    expect(Array.from(dir[2].data)).toEqual([0, 7]);
  });
});

describe('parseAbif', () => {
  it('returns the fixture bases, qualities, peaks and called-channel amplitude', () => {
    const bases = 'GATTACAGATTACAGATTACA';
    const quality = bases.split('').map((_, i) => 10 + i);
    const parsed = parseAbif(makeAbif({ bases, quality, sample: 'TEST_SAMPLE', order: 'GATC' }));
    expect(parsed.sample).toBe('TEST_SAMPLE');
    expect(parsed.bases).toBe(bases);
    expect(parsed.quality).toEqual(quality);
    expect(parsed.order).toBe('GATC');
    expect(parsed.peaks).toEqual(Array.from({ length: bases.length }, (_, i) => 10 + 12 * i));
    bases.split('').forEach((b, i) => {
      const channel = parsed.traces[b as 'A' | 'C' | 'G' | 'T'];
      expect(Math.abs(channel[parsed.peaks[i]] - 1000)).toBeLessThanOrEqual(1);
    });
  });

  it('maps channels through a non-default FWO_ order', () => {
    const bases = 'ACGTACGT';
    const parsed = parseAbif(makeAbif({ bases, order: 'TGCA' }));
    expect(parsed.order).toBe('TGCA');
    expect(parsed.bases).toBe(bases);
    expect(parsed.traces.A[10]).toBe(1000);
  });

  it('rejects a file with the wrong magic', () => {
    const buf = makeAbif({ bases: 'ACGT' });
    new DataView(buf).setUint8(0, 88);
    expect(() => parseAbif(buf)).toThrow('Not an ABIF (.ab1) file.');
  });

  it('names the missing tag', () => {
    expect(() => parseAbif(tiny())).toThrow(/DATA/);
    const buf = makeAbif({ bases: 'ACGTACGT' });
    const view = new DataView(buf), count = view.getInt32(18, false), start = view.getInt32(26, false);
    for (let i = 0; i < count; i++) {
      const off = start + i * 28;
      const name = String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
      if (name === 'PBAS') view.setUint8(off, 88);
    }
    expect(() => parseAbif(buf)).toThrow(/PBAS/);
  });
});
