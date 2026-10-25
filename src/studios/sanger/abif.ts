/** Minimal Applied Biosystems ABIF (.ab1/.abi) reader: data channels, base calls, peaks and qualities. */

export interface AbifTrace {
  sample: string;
  bases: string;
  quality: number[];
  peaks: number[];
  traces: { A: Int16Array; C: Int16Array; G: Int16Array; T: Int16Array };
  /** Base order of DATA channels 9-12, e.g. GATC. */
  order: string;
}

interface Entry {
  name: string; number: number; elementType: number; elementSize: number;
  numElements: number; dataSize: number; dataOffset: number; fieldOffset: number;
}

const chars = (view: DataView, off: number, n: number) => {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(off + i));
  return s;
};

function readEntry(view: DataView, off: number): Entry {
  return {
    name: chars(view, off, 4), number: view.getInt32(off + 4),
    elementType: view.getInt16(off + 8), elementSize: view.getInt16(off + 10),
    numElements: view.getInt32(off + 12), dataSize: view.getInt32(off + 16),
    dataOffset: view.getInt32(off + 20), fieldOffset: off,
  };
}

/** Data bytes; when dataSize <= 4 the bytes live in the dataOffset field itself. */
function bytesOf(view: DataView, e: Entry): Uint8Array {
  const start = e.dataSize <= 4 ? e.fieldOffset + 20 : e.dataOffset;
  return new Uint8Array(view.buffer, view.byteOffset + start, Math.max(0, e.dataSize));
}

function directoryOf(buf: ArrayBuffer): { view: DataView; entries: Entry[] } {
  if (buf.byteLength < 34) throw new Error('Not an ABIF (.ab1) file.');
  const view = new DataView(buf);
  if (chars(view, 0, 4) !== 'ABIF') throw new Error('Not an ABIF (.ab1) file.');
  const root = readEntry(view, 6);
  if (root.numElements <= 0 || root.numElements > 100_000 || root.dataOffset < 0 || root.dataOffset + root.numElements * 28 > buf.byteLength) {
    throw new Error('The ABIF directory is damaged.');
  }
  const entries: Entry[] = [];
  for (let i = 0; i < root.numElements; i++) entries.push(readEntry(view, root.dataOffset + i * 28));
  return { view, entries };
}

export interface DirectoryEntry extends Omit<Entry, 'fieldOffset'> { data: Uint8Array }
/** Directory entries with their resolved (inline or pointed-to) data; useful for inspecting small files. */
export function readAbifDirectory(buf: ArrayBuffer): DirectoryEntry[] {
  const { view, entries } = directoryOf(buf);
  return entries.map((e) => ({
    name: e.name, number: e.number, elementType: e.elementType, elementSize: e.elementSize,
    numElements: e.numElements, dataSize: e.dataSize, dataOffset: e.dataOffset, data: bytesOf(view, e),
  }));
}

function int16s(view: DataView, e: Entry): Int16Array {
  const n = e.elementSize === 2 ? Math.floor(e.dataSize / 2) : (e.numElements > 0 ? e.numElements : Math.floor(e.dataSize / 2));
  const out = new Int16Array(n);
  const base = e.dataSize <= 4 ? e.fieldOffset + 20 : e.dataOffset;
  for (let i = 0; i < n; i++) out[i] = view.getInt16(base + i * 2);
  return out;
}

function text(view: DataView, e: Entry): string {
  const b = bytesOf(view, e);
  if (e.elementType === 18) return chars(view, (e.dataSize <= 4 ? e.fieldOffset + 20 : e.dataOffset) + 1, b[0] ?? 0).trim();
  const nul = b.indexOf(0);
  const arr = nul >= 0 ? b.subarray(0, nul) : b;
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return s.trim();
}

export function parseAbif(buf: ArrayBuffer): AbifTrace {
  if (buf.byteLength > 20 * 1024 * 1024) throw new Error('The ABIF file is larger than 20 MB.');
  const { view, entries } = directoryOf(buf);
  const find = (name: string, number: number) => entries.find((e) => e.name === name && e.number === number);

  const data = [9, 10, 11, 12].map((n) => find('DATA', n));
  if (data.some((e) => !e)) throw new Error('The ABIF file is missing one of the DATA trace channels (9-12).');
  const pbas = find('PBAS', 2) ?? find('PBAS', 1);
  if (!pbas) throw new Error('The ABIF file is missing the PBAS base-call tag.');
  const ploc = find('PLOC', 2) ?? find('PLOC', 1);
  const pcon = find('PCON', 2) ?? find('PCON', 1);
  const fwo = find('FWO_', 1);
  const smpl = find('SMPL', 1);
  const order = (fwo ? text(view, fwo) : 'GATC').toUpperCase().replace(/[^ACGT]/g, '').slice(0, 4);
  if (order.length !== 4 || new Set(order).size !== 4) throw new Error('The ABIF FWO_ base order is invalid.');

  const byBase: Record<string, Int16Array> = {};
  data.forEach((e, i) => { byBase[order[i]] = int16s(view, e!); });
  const traces = { A: byBase.A, C: byBase.C, G: byBase.G, T: byBase.T };
  return {
    sample: smpl ? text(view, smpl) || 'unnamed sample' : 'unnamed sample',
    bases: text(view, pbas).toUpperCase().replace(/[^ACGTN]/g, ''),
    quality: pcon ? Array.from(bytesOf(view, pcon)) : [],
    peaks: ploc ? Array.from(int16s(view, ploc)) : [],
    traces, order,
  };
}
