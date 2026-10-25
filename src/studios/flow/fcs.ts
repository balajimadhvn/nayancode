/** FCS 3.0/3.1 list-mode reader and writer (single DATA segment, integer/F/D). */

export interface FcsParam { name: string; stain: string; range: number; log: boolean }
export interface FcsSpill { names: string[]; matrix: number[][] }
export interface FcsFile {
  params: FcsParam[];
  /** One Float32Array per parameter, column-major. Log channels are converted to linear values. */
  events: Float32Array[];
  tot: number;
  spill?: FcsSpill;
  text: Record<string, string>;
}

const MAX_EVENTS = 2_000_000, MAX_PARAMS = 64;
const chars = (v: DataView, off: number, n: number) => {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(off + i));
  return s;
};
const offsetAt = (v: DataView, off: number) => {
  const s = chars(v, off, 8).trim();
  return s ? Number(s) : 0;
};
const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

function parseText(view: DataView, start: number, end: number): Record<string, string> {
  const delim = view.getUint8(start);
  const last = Math.min(end, view.byteLength - 1);
  const parts: string[] = [];
  let cur = '', i = start + 1;
  while (i <= last) {
    const b = view.getUint8(i);
    if (b === delim) {
      if (i + 1 <= last && view.getUint8(i + 1) === delim) { cur += String.fromCharCode(delim); i += 2; continue; }
      parts.push(cur); cur = ''; i++;
    } else { cur += String.fromCharCode(b); i++; }
  }
  if (cur) parts.push(cur);
  const out: Record<string, string> = {};
  for (let k = 0; k + 1 < parts.length; k += 2) out[parts[k]] = parts[k + 1];
  return out;
}

export function parseFcs(buf: ArrayBuffer): FcsFile {
  if (buf.byteLength < 58) throw new Error('Not an FCS 3.0/3.1 file.');
  const view = new DataView(buf);
  const version = chars(view, 0, 6);
  if (version !== 'FCS3.0' && version !== 'FCS3.1') throw new Error('Not an FCS 3.0/3.1 file.');
  const textStart = offsetAt(view, 10), textEnd = offsetAt(view, 18);
  if (textStart <= 0 || textEnd < textStart || textEnd >= buf.byteLength) throw new Error('The FCS TEXT segment offsets are invalid.');
  const text = parseText(view, textStart, textEnd);

  if ((text.$MODE ?? 'L').toUpperCase() !== 'L') throw new Error('Only list-mode FCS files are supported');
  const tot = Number(text.$TOT), par = Number(text.$PAR);
  if (!Number.isInteger(tot) || tot < 1) throw new Error('The FCS $TOT keyword is missing or invalid.');
  if (!Number.isInteger(par) || par < 1) throw new Error('The FCS $PAR keyword is missing or invalid.');
  if (tot > MAX_EVENTS) throw new Error(`The file has ${tot.toLocaleString()} events; the limit is 2,000,000.`);
  if (par > MAX_PARAMS) throw new Error(`The file has ${par} parameters; the limit is 64.`);
  const datatype = (text.$DATATYPE ?? 'F').toUpperCase();
  if (!['F', 'D', 'I'].includes(datatype)) throw new Error('The FCS $DATATYPE is not supported (use F, D or I).');
  const byteord = (text.$BYTEORD ?? '').replace(/\s/g, '');
  if (!/^(1,2(,3(,4)?)?|4,3,2,1|2,1)$/.test(byteord)) throw new Error('The FCS $BYTEORD keyword is missing or invalid.');
  const little = byteord.startsWith('1,2');

  let dataStart = offsetAt(view, 26), dataEnd = offsetAt(view, 34);
  if (!dataStart || !dataEnd) {
    dataStart = Number(text.$BEGINDATA ?? 0); dataEnd = Number(text.$ENDDATA ?? 0);
  }
  if (!(dataStart > 0) || !(dataEnd >= dataStart) || dataEnd >= buf.byteLength) throw new Error('The FCS DATA segment offsets are invalid.');
  const dataBytes = dataEnd - dataStart + 1;

  const params: FcsParam[] = [];
  const logF: number[] = [], logOffset: number[] = [];
  for (let n = 1; n <= par; n++) {
    const name = text[`$P${n}N`] ?? `P${n}`;
    const stain = text[`$P${n}S`] ?? '';
    const bits = Number(text[`$P${n}B`] ?? (datatype === 'F' ? 32 : datatype === 'D' ? 64 : 16));
    if (datatype === 'I' && ![8, 16, 32].includes(bits)) throw new Error(`The FCS $P${n}B width is not supported (use 8, 16 or 32 bits).`);
    const range = Number(text[`$P${n}R`] ?? 0) || (datatype === 'I' ? 2 ** bits : 262144);
    const e = (text[`$P${n}E`] ?? '0,0').split(',').map(Number);
    params.push({ name, stain, range, log: (e[0] || 0) > 0 });
    logF.push(e[0] || 0); logOffset.push(e[1] || 1);
  }

  const widths = params.map((_, i) => datatype === 'F' ? 4 : datatype === 'D' ? 8 : Number(text[`$P${i + 1}B`] ?? 16) / 8);
  const eventBytes = widths.reduce((a, b) => a + b, 0);
  if (dataBytes < tot * eventBytes) throw new Error('The FCS DATA segment is shorter than $TOT × $PAR implies.');

  const events = params.map(() => new Float32Array(tot));
  for (let e = 0; e < tot; e++) {
    let off = dataStart + e * eventBytes;
    for (let j = 0; j < par; j++) {
      let raw: number;
      if (datatype === 'F') { raw = view.getFloat32(off, little); off += 4; }
      else if (datatype === 'D') { raw = view.getFloat64(off, little); off += 8; }
      else {
        const bits = Number(text[`$P${j + 1}B`] ?? 16);
        raw = bits === 8 ? view.getUint8(off) : bits === 16 ? view.getUint16(off, little) : view.getUint32(off, little);
        off += bits / 8;
        if (isPowerOfTwo(params[j].range)) raw = raw & (params[j].range - 1);
      }
      if (params[j].log && logF[j] > 0) raw = 10 ** ((logF[j] * raw) / params[j].range) * logOffset[j];
      events[j][e] = raw;
    }
  }

  let spill: FcsSpill | undefined;
  const spillKey = ['$SPILLOVER', 'SPILL', '$SPILL'].find((k) => text[k] !== undefined);
  if (spillKey) {
    const parts = text[spillKey].split(',').map((x) => x.trim());
    const n = Number(parts[0]);
    const names = parts.slice(1, 1 + n);
    const vals = parts.slice(1 + n).map(Number);
    if (n > 0 && names.length === n && vals.length >= n * n) {
      spill = { names, matrix: Array.from({ length: n }, (_, r) => vals.slice(r * n, r * n + n)) };
    }
  }
  return { params, events, tot, spill, text };
}

export interface WriteParam { name: string; stain?: string; range?: number; bits?: 8 | 16 | 32 }
export interface WriteMeta {
  version?: 'FCS3.0' | 'FCS3.1';
  params: WriteParam[];
  datatype?: 'F' | 'D' | 'I';
  littleEndian?: boolean;
  spill?: FcsSpill;
}

/** Write a single-DATA-segment list-mode FCS file. Integer data are rounded and range-masked. */
export function writeFcs(data: Float32Array[], meta: WriteMeta): ArrayBuffer {
  const tot = data[0]?.length ?? 0;
  if (!tot) throw new Error('writeFcs needs at least one event.');
  if (data.length !== meta.params.length) throw new Error('writeFcs needs one column per parameter.');
  if (data.some((c) => c.length !== tot)) throw new Error('writeFcs columns must have equal length.');
  if (tot > MAX_EVENTS) throw new Error(`The file would have ${tot.toLocaleString()} events; the limit is 2,000,000.`);
  if (data.length > MAX_PARAMS) throw new Error(`The file would have ${data.length} parameters; the limit is 64.`);
  const datatype = meta.datatype ?? 'F', little = meta.littleEndian ?? true;
  const bits = meta.params.map((p) => datatype === 'I' ? (p.bits ?? 16) : datatype === 'F' ? 32 : 64);
  const widths = bits.map((b) => b / 8);
  const eventBytes = widths.reduce((a, b) => a + b, 0);
  const dataBytes = tot * eventBytes;
  const delimiter = '/';
  const esc = (s: string) => s.split(delimiter).join(delimiter + delimiter);

  const buildText = (start: number, end: number) => {
    const pairs: [string, string][] = [
      ['$TOT', String(tot)], ['$PAR', String(data.length)], ['$DATATYPE', datatype],
      ['$BYTEORD', little ? '1,2,3,4' : '4,3,2,1'], ['$MODE', 'L'], ['$NEXTDATA', '0'],
      ['$BEGINANALYSIS', '0'], ['$ENDANALYSIS', '0'], ['$BEGINDATA', String(start)], ['$ENDDATA', String(end)],
    ];
    meta.params.forEach((p, i) => {
      pairs.push([`$P${i + 1}N`, p.name]);
      if (p.stain) pairs.push([`$P${i + 1}S`, p.stain]);
      pairs.push([`$P${i + 1}B`, String(bits[i])]);
      pairs.push([`$P${i + 1}R`, String(p.range ?? (datatype === 'I' ? 2 ** bits[i] : 262144))]);
      pairs.push([`$P${i + 1}E`, '0,0']);
    });
    if (meta.spill) {
      const { names, matrix } = meta.spill;
      pairs.push(['$SPILLOVER', [names.length, ...names, ...matrix.flat()].join(',')]);
    }
    return delimiter + pairs.map(([k, v]) => `${esc(k)}${delimiter}${esc(v)}`).join(delimiter) + delimiter;
  };

  let dataStart = 0, dataEnd = 0, text = '';
  for (let iter = 0; iter < 10; iter++) {
    const next = buildText(dataStart, dataEnd);
    const start = 58 + next.length, end = start + dataBytes - 1;
    text = next;
    if (start === dataStart && end === dataEnd) break;
    dataStart = start; dataEnd = end;
  }
  if (58 + text.length !== dataStart) throw new Error('Could not lay out the FCS TEXT segment.');

  const buf = new ArrayBuffer(dataStart + dataBytes), view = new DataView(buf);
  for (let i = 0; i < 6; i++) view.setUint8(i, (meta.version ?? 'FCS3.1').charCodeAt(i));
  for (let i = 6; i < 10; i++) view.setUint8(i, 32);
  const putOffset = (off: number, n: number) => { const s = String(n).padStart(8, ' '); for (let i = 0; i < 8; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  putOffset(10, 58); putOffset(18, 58 + text.length - 1);
  putOffset(26, dataStart); putOffset(34, dataEnd);
  putOffset(42, 0); putOffset(50, 0);
  for (let i = 0; i < text.length; i++) view.setUint8(58 + i, text.charCodeAt(i));

  for (let e = 0; e < tot; e++) {
    let off = dataStart + e * eventBytes;
    for (let j = 0; j < data.length; j++) {
      const v = data[j][e];
      if (datatype === 'F') { view.setFloat32(off, v, little); off += 4; }
      else if (datatype === 'D') { view.setFloat64(off, v, little); off += 8; }
      else {
        const b = bits[j], range = meta.params[j].range ?? 2 ** b;
        let n = Math.max(0, Math.round(v));
        if (isPowerOfTwo(range)) n = n & (range - 1);
        if (b === 8) { view.setUint8(off, n); off += 1; }
        else if (b === 16) { view.setUint16(off, n, little); off += 2; }
        else { view.setUint32(off, n >>> 0, little); off += 4; }
      }
    }
  }
  return buf;
}
