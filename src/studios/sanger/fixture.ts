/** Synthetic ABIF writer for demos and known-answer tests. Big-endian, standard 28-byte directory entries. */

export interface SecondaryPeak { position: number; base: 'A' | 'C' | 'G' | 'T'; ratio: number }
export interface AbifOptions {
  bases: string;
  quality?: number[];
  order?: string;
  sample?: string;
  secondary?: SecondaryPeak[];
}

type Blob = { name: string; number: number; type: number; elementSize: number; data: Uint8Array };

const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const int16Data = (a: number[]) => {
  const b = new Uint8Array(a.length * 2), v = new DataView(b.buffer);
  a.forEach((x, i) => v.setInt16(i * 2, x, false));
  return b;
};

function writeName(view: DataView, off: number, name: string) {
  const n = name.padEnd(4, ' ').slice(0, 4);
  for (let i = 0; i < 4; i++) view.setUint8(off + i, n.charCodeAt(i));
}

/**
 * Peaks are at 10 + 12 i; each called channel is a Gaussian (sigma 2.5, amplitude 1000) with zero
 * background, and each secondary entry adds `ratio × 1000` to another channel at that peak.
 */
export function makeAbif(o: AbifOptions): ArrayBuffer {
  const bases = o.bases.toUpperCase().replace(/[^ACGT]/g, '');
  if (!bases) throw new Error('The fixture needs at least one base.');
  const order = (o.order ?? 'GATC').toUpperCase();
  if (order.length !== 4 || new Set(order).size !== 4 || /[^ACGT]/.test(order)) throw new Error('order must be a permutation of ACGT.');
  const total = 10 + 12 * bases.length + 10;
  const peaks = Array.from({ length: bases.length }, (_, i) => 10 + 12 * i);
  const float: Record<string, Float64Array> = { A: new Float64Array(total), C: new Float64Array(total), G: new Float64Array(total), T: new Float64Array(total) };
  const add = (base: string, peak: number, amp: number) => {
    for (let x = Math.max(0, peak - 10); x <= Math.min(total - 1, peak + 10); x++) float[base][x] += amp * Math.exp(-0.5 * ((x - peak) / 2.5) ** 2);
  };
  for (let i = 0; i < bases.length; i++) {
    add(bases[i], peaks[i], 1000);
    for (const s of o.secondary ?? []) if (s.position === i) add(s.base, peaks[i], s.ratio * 1000);
  }
  const traces: Record<string, Int16Array> = {};
  for (const b of 'ACGT') traces[b] = Int16Array.from(float[b], (x) => Math.round(x));

  const sample = (o.sample ?? 'SYNTHETIC').slice(0, 255);
  const quality = o.quality ?? Array.from({ length: bases.length }, () => 40);
  if (quality.length !== bases.length) throw new Error('Quality length must match the number of bases.');
  const blobs: Blob[] = [];
  for (let i = 0; i < 4; i++) blobs.push({ name: 'DATA', number: 9 + i, type: 4, elementSize: 2, data: int16Data(Array.from(traces[order[i]])) });
  blobs.push({ name: 'FWO_', number: 1, type: 2, elementSize: 1, data: ascii(order) });
  blobs.push({ name: 'PBAS', number: 2, type: 2, elementSize: 1, data: ascii(bases) });
  blobs.push({ name: 'PLOC', number: 2, type: 4, elementSize: 2, data: int16Data(peaks) });
  blobs.push({ name: 'PCON', number: 2, type: 2, elementSize: 1, data: Uint8Array.from(quality.map((q) => Math.max(0, Math.min(255, q)))) });
  blobs.push({ name: 'SMPL', number: 1, type: 18, elementSize: 1, data: Uint8Array.from([sample.length, ...ascii(sample)]) });

  const header = 34, dirSize = 28 * blobs.length;
  const sizes = blobs.reduce((n, b) => n + (b.data.length > 4 ? b.data.length : 0), 0);
  const buf = new ArrayBuffer(header + dirSize + sizes), view = new DataView(buf);
  const magic = ascii('ABIF');
  magic.forEach((b, i) => view.setUint8(i, b));
  view.setInt16(4, 101, false);
  writeName(view, 6, 'tdir');
  view.setInt32(10, 1, false); view.setInt16(14, 1023, false); view.setInt16(16, 28, false);
  view.setInt32(18, blobs.length, false); view.setInt32(22, dirSize, false); view.setInt32(26, header, false); view.setInt32(30, 0, false);

  let cursor = header + dirSize;
  blobs.forEach((b, i) => {
    const off = header + i * 28;
    writeName(view, off, b.name);
    view.setInt32(off + 4, b.number, false); view.setInt16(off + 8, b.type, false); view.setInt16(off + 10, b.elementSize, false);
    view.setInt32(off + 12, b.elementSize > 1 ? b.data.length / b.elementSize : b.data.length, false); view.setInt32(off + 16, b.data.length, false);
    if (b.data.length <= 4) {
      for (let k = 0; k < 4; k++) view.setUint8(off + 20 + k, k < b.data.length ? b.data[k] : 0);
    } else {
      view.setInt32(off + 20, cursor, false); view.setInt32(off + 24, 0, false);
      new Uint8Array(buf, cursor, b.data.length).set(b.data); cursor += b.data.length;
    }
  });
  return buf;
}

/** A 400-base demo trace with a planted A/G mixed peak at index 200 and a clean tail. */
export function demoTrace(): { buffer: ArrayBuffer; bases: string; quality: number[] } {
  const bases = Array.from({ length: 400 }, (_, i) => 'GATC'[i % 4]).join('');
  const quality = Array.from({ length: 400 }, (_, i) => (i < 20 || i > 379 ? 8 : i === 200 ? 22 : 42));
  const buffer = makeAbif({ bases, quality, sample: 'SYNTHETIC_DEMO', secondary: [{ position: 200, base: bases[200] === 'A' ? 'G' : 'A', ratio: 0.4 }] });
  return { buffer, bases, quality };
}
