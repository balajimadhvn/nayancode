import { describe, expect, it } from 'vitest';
import { parseFcs, writeFcs } from './fcs';

function textOf(pairs: [string, string][]): string {
  return '/' + pairs.map(([k, v]) => `${k}/${v}`).join('/') + '/';
}

function putOffset(view: DataView, off: number, n: number) {
  const s = String(n).padStart(8, ' ');
  for (let i = 0; i < 8; i++) view.setUint8(off + i, s.charCodeAt(i));
}

/** Hand-built 3-event, 2-parameter float file; optionally stores DATA offsets only in TEXT. */
function tinyFcs(opts: { textOffsets?: boolean; mode?: string; stain?: string; p1R?: string; p1E?: string; tot?: string; par?: string; values?: number[][] } = {}): ArrayBuffer {
  const pairs: [string, string][] = [
    ['$TOT', opts.tot ?? '3'], ['$PAR', opts.par ?? '2'], ['$DATATYPE', 'F'], ['$BYTEORD', '1,2,3,4'], ['$MODE', opts.mode ?? 'L'],
    ['$P1N', 'A'], ['$P1S', opts.stain ?? 'CD//3'], ['$P1B', '32'], ['$P1R', opts.p1R ?? '262144'], ['$P1E', opts.p1E ?? '0,0'],
    ['$P2N', 'B'], ['$P2B', '32'], ['$P2R', '262144'], ['$P2E', '0,0'],
  ];
  const values = opts.values ?? [[1.5, -2.25, 3], [10, 20.5, 30]];
  const dataBytes = 3 * 2 * 4;
  let dataStart = 0, dataEnd = 0, text = '';
  for (let i = 0; i < 10; i++) {
    const p = opts.textOffsets ? [...pairs, ['$BEGINDATA', String(dataStart)] as [string, string], ['$ENDDATA', String(dataEnd)] as [string, string]] : pairs;
    const next = textOf(p), start = 58 + next.length, end = start + dataBytes - 1;
    text = next;
    if (start === dataStart && end === dataEnd) break;
    dataStart = start; dataEnd = end;
  }
  const buf = new ArrayBuffer(dataStart + dataBytes), view = new DataView(buf);
  for (let i = 0; i < 6; i++) view.setUint8(i, 'FCS3.1'.charCodeAt(i));
  for (let i = 6; i < 10; i++) view.setUint8(i, 32);
  putOffset(view, 10, 58); putOffset(view, 18, 58 + text.length - 1);
  putOffset(view, 26, opts.textOffsets ? 0 : dataStart); putOffset(view, 34, opts.textOffsets ? 0 : dataEnd);
  putOffset(view, 42, 0); putOffset(view, 50, 0);
  for (let i = 0; i < text.length; i++) view.setUint8(58 + i, text.charCodeAt(i));
  let off = dataStart;
  for (let e = 0; e < 3; e++) for (let j = 0; j < 2; j++) { view.setFloat32(off, values[j][e], true); off += 4; }
  return buf;
}

describe('writeFcs + parseFcs round trip', () => {
  const params = [{ name: 'A', stain: 'FITC' }, { name: 'B' }];
  const columns = [Float32Array.from([1, 2.5, -3, 4.25]), Float32Array.from([10, 20, 30, 40])];

  it('round trips float32 data in both byte orders', () => {
    for (const littleEndian of [true, false]) {
      const p = parseFcs(writeFcs(columns, { params, datatype: 'F', littleEndian }));
      expect(p.tot).toBe(4);
      expect(p.params.map((x) => x.name)).toEqual(['A', 'B']);
      expect(p.params[0].stain).toBe('FITC');
      expect(Array.from(p.events[0])).toEqual([1, 2.5, -3, 4.25]);
      expect(Array.from(p.events[1])).toEqual([10, 20, 30, 40]);
    }
  });

  it('round trips float64 data in both byte orders', () => {
    for (const littleEndian of [true, false]) {
      const p = parseFcs(writeFcs(columns, { params, datatype: 'D', littleEndian }));
      expect(Array.from(p.events[0])).toEqual([1, 2.5, -3, 4.25]);
      expect(Array.from(p.events[1])).toEqual([10, 20, 30, 40]);
    }
  });

  it('round trips 16-bit integer data with range masking in both byte orders', () => {
    const ints = [Float32Array.from([0, 1, 65535]), Float32Array.from([10, 20, 30])];
    for (const littleEndian of [true, false]) {
      const p = parseFcs(writeFcs(ints, { params: [{ name: 'A', bits: 16, range: 65536 }, { name: 'B', bits: 16, range: 65536 }], datatype: 'I', littleEndian }));
      expect(Array.from(p.events[0])).toEqual([0, 1, 65535]);
      expect(Array.from(p.events[1])).toEqual([10, 20, 30]);
      expect(p.params[0].range).toBe(65536);
    }
  });

  it('round trips a spillover matrix', () => {
    const p = parseFcs(writeFcs(columns, { params, datatype: 'F', spill: { names: ['A', 'B'], matrix: [[1, 0.15], [0.05, 1]] } }));
    expect(p.spill).toEqual({ names: ['A', 'B'], matrix: [[1, 0.15], [0.05, 1]] });
  });
});

describe('parseFcs', () => {
  it('parses a hand-built tiny file and unescapes a doubled delimiter', () => {
    const p = parseFcs(tinyFcs());
    expect(p.tot).toBe(3);
    expect(p.params.map((x) => x.name)).toEqual(['A', 'B']);
    expect(p.params[0].stain).toBe('CD/3');
    expect(Array.from(p.events[0])).toEqual([1.5, -2.25, 3]);
    expect(Array.from(p.events[1])).toEqual([10, 20.5, 30]);
  });

  it('falls back to $BEGINDATA and $ENDDATA in TEXT', () => {
    const p = parseFcs(tinyFcs({ textOffsets: true }));
    expect(Array.from(p.events[1])).toEqual([10, 20.5, 30]);
  });

  it('linearises a log-amplified channel with $PnE and defaults f2 to 1', () => {
    const p = parseFcs(tinyFcs({ p1R: '2', p1E: '1,0', values: [[0, 0.5, 1], [10, 20.5, 30]] }));
    expect(p.params[0].log).toBe(true);
    expect(p.events[0][0]).toBeCloseTo(1, 6);
    expect(p.events[0][1]).toBeCloseTo(10 ** 0.25, 6);
    expect(p.events[0][2]).toBeCloseTo(Math.sqrt(10), 6);
  });

  it('rejects non-FCS, non-list-mode and oversized files', () => {
    expect(() => parseFcs(new ArrayBuffer(60))).toThrow(/Not an FCS/);
    expect(() => parseFcs(tinyFcs({ mode: 'C' }))).toThrow(/list-mode/);
    expect(() => parseFcs(tinyFcs({ tot: '2000001' }))).toThrow(/limit is 2,000,000/);
    expect(() => parseFcs(tinyFcs({ par: '65' }))).toThrow(/limit is 64/);
    const p = parseFcs(tinyFcs());
    expect(p.text.$TOT).toBe('3');
  });
});
