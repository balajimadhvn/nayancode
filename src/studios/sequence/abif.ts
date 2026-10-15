/** ABIF (.ab1 / .abi) Sanger trace parser, quality trimming, and a trace simulator (for demos and tests).
 *  ABIF layout (Applied Biosystems): 'ABIF' + version, root directory entry at byte 6; each entry is 28 bytes; data ≤ 4 bytes is stored inline. */
import { align, revComp, type Alignment } from './kernels';

export interface Trace { sample: string; bases: string; quals: number[]; peaks: number[]; channels: Int16Array[]; order: string; length: number }
const dec = new TextDecoder('latin1');
export function parseAbif(buf: ArrayBuffer): Trace {
  const dv = new DataView(buf); if (buf.byteLength < 40 || dec.decode(new Uint8Array(buf, 0, 4)) !== 'ABIF') throw new Error('Not an ABIF file (missing "ABIF" header). Expected a .ab1 / .abi Sanger trace.');
  const nEntries = dv.getInt32(6 + 12), dirOffset = dv.getInt32(6 + 20), entries = new Map<string, { type: number; size: number; n: number; bytes: number; off: number }>();
  for (let i = 0; i < nEntries; i++) { const o = dirOffset + i * 28; if (o + 28 > buf.byteLength) throw new Error('Corrupt ABIF directory.'); const name = dec.decode(new Uint8Array(buf, o, 4)), num = dv.getInt32(o + 4), bytes = dv.getInt32(o + 16); entries.set(`${name}${num}`, { type: dv.getInt16(o + 8), size: dv.getInt16(o + 10), n: dv.getInt32(o + 12), bytes, off: bytes <= 4 ? o + 20 : dv.getInt32(o + 20) }); }
  const need = (k: string) => { const e = entries.get(k); if (!e) throw new Error(`ABIF tag ${k} not found. This file may not contain base calls / processed traces.`); return e; };
  const str = (k: string) => { const e = need(k); return dec.decode(new Uint8Array(buf, e.off, e.bytes)); };
  const ints = (k: string) => { const e = need(k), a = new Int16Array(e.n); for (let i = 0; i < e.n; i++) a[i] = dv.getInt16(e.off + i * 2); return a; };
  const order = str('FWO_1').slice(0, 4) || 'GATC', channels = [9, 10, 11, 12].map((d) => ints(`DATA${d}`)), bases = str('PBAS2'), pc = need('PCON2'), quals = Array.from(new Uint8Array(buf, pc.off, pc.n)), ploc = ints('PLOC2');
  let sample = ''; const sm = entries.get('SMPL1'); if (sm) { const len = dv.getUint8(sm.off); sample = dec.decode(new Uint8Array(buf, sm.off + 1, len)); }
  return { sample, bases, quals, peaks: Array.from(ploc, (v) => (v < 0 ? v + 65536 : v)), channels, order, length: channels[0].length };
}

/** Mott's modified trimming (Richard Mott, Phred-score based): maximise Σ (cutoff − p_err) over a contiguous window. */
export function mottTrim(quals: number[], cutoff = 0.05): { start: number; end: number } {
  let best = 0, bs = 0, be = 0, cur = 0, cs = 0;
  for (let i = 0; i < quals.length; i++) { const v = cutoff - 10 ** (-quals[i] / 10); if (cur + v > 0) { if (cur === 0) cs = i; cur += v; if (cur > best) { best = cur; bs = cs; be = i + 1; } } else cur = 0; }
  return { start: bs, end: be };
}
export function buildAbif(t: { sample: string; bases: string; quals: number[]; peaks: number[]; channels: Int16Array[]; order?: string }): ArrayBuffer {
  const order = t.order ?? 'GATC', enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const items: { name: string; num: number; type: number; size: number; n: number; data: Uint8Array }[] = [];
  const i16 = (a: ArrayLike<number>) => { const b = new DataView(new ArrayBuffer(a.length * 2)); for (let i = 0; i < a.length; i++) b.setInt16(i * 2, a[i]); return new Uint8Array(b.buffer); };
  items.push({ name: 'FWO_', num: 1, type: 2, size: 1, n: 4, data: enc(order) }, { name: 'PBAS', num: 2, type: 2, size: 1, n: t.bases.length, data: enc(t.bases) }, { name: 'PCON', num: 2, type: 1, size: 1, n: t.quals.length, data: Uint8Array.from(t.quals) }, { name: 'PLOC', num: 2, type: 4, size: 2, n: t.peaks.length, data: i16(t.peaks) });
  t.channels.forEach((c, i) => items.push({ name: 'DATA', num: 9 + i, type: 4, size: 2, n: c.length, data: i16(c) }));
  items.push({ name: 'SMPL', num: 1, type: 18, size: 1, n: t.sample.length + 1, data: Uint8Array.from([t.sample.length, ...enc(t.sample)]) });
  let off = 128; const placed = items.map((it) => { const o = off; if (it.data.length > 4) off += it.data.length + (it.data.length % 2); return o; }), dirOff = off, total = dirOff + items.length * 28, out = new Uint8Array(total), dv = new DataView(out.buffer);
  out.set(enc('ABIF'), 0); dv.setInt16(4, 101);
  const entry = (o: number, name: string, num: number, type: number, size: number, n: number, bytes: number, offset: number) => { out.set(enc(name), o); dv.setInt32(o + 4, num); dv.setInt16(o + 8, type); dv.setInt16(o + 10, size); dv.setInt32(o + 12, n); dv.setInt32(o + 16, bytes); dv.setInt32(o + 20, offset); };
  entry(6, 'tdir', 1, 1023, 28, items.length, items.length * 28, dirOff);
  items.forEach((it, i) => { const o = dirOff + i * 28; if (it.data.length > 4) { out.set(it.data, placed[i]); entry(o, it.name, it.num, it.type, it.size, it.n, it.data.length, placed[i]); } else { entry(o, it.name, it.num, it.type, it.size, it.n, it.data.length, 0); out.set(it.data, o + 20); } });
  return out.buffer;
}
/** Synthetic electropherogram for a known sequence (clearly a simulation): Gaussian peaks, noisy baseline, quality that ramps up then decays, optional mutation. */
export function simulateTrace(seq: string, seed = 5, opts: { spacing?: number; noise?: number } = {}): Trace {
  const spacing = opts.spacing ?? 11, noise = opts.noise ?? 18, order = 'GATC'; let s = seed >>> 0; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const L = seq.length * spacing + 60, ch = order.split('').map(() => new Float64Array(L)), peaks: number[] = [], quals: number[] = [];
  for (let i = 0; i < seq.length; i++) {
    const c = order.indexOf(seq[i]), centre = 30 + i * spacing + Math.round((r() - 0.5) * 2), h = (i < 15 ? 250 : 900) * (0.7 + r() * 0.6) * (i > seq.length - 40 ? 0.45 : 1); peaks.push(centre);
    for (let x = -12; x <= 12; x++) if (c >= 0) ch[c][centre + x] += h * Math.exp(-(x * x) / (2 * 2.3 * 2.3));
    const q = i < 20 ? 8 + r() * 6 : i > seq.length - 45 ? 12 + r() * 10 : 38 + r() * 12; quals.push(Math.round(q));
    if (i > 15 && r() < 0.03) { const o = (c + 1 + Math.floor(r() * 3)) % 4; for (let x = -12; x <= 12; x++) ch[o][centre + x] += h * 0.22 * Math.exp(-(x * x) / (2 * 2.3 * 2.3)); }
  }
  const channels = ch.map((c) => Int16Array.from(c, (v) => Math.round(v + (r() - 0.5) * 2 * noise + 10)));
  return { sample: 'simulated_read', bases: seq, quals, peaks, channels, order, length: L };
}
export interface ReadComparison { trim: { start: number; end: number }; trimmed: string; strand: '+' | '-'; alignment: Alignment | null; mismatches: { refPos: number; ref: string; read: string; readPos: number; qual: number }[]; identity: number; refStart: number; refEnd: number }
/** Trim a read by Mott's algorithm, align (local, either strand) to a reference and list substitutions with read quality. */
export function compareToReference(t: Trace, reference: string, cutoff = 0.05): ReadComparison {
  const trim = mottTrim(t.quals, cutoff), trimmed = t.bases.slice(trim.start, trim.end); if (trimmed.length < 20) throw new Error('Fewer than 20 high-quality bases after trimming. Try a lower cutoff or re-sequence.');
  const fwd = align(reference, trimmed, { mode: 'local', kind: 'dna' }), rev = align(reference, revComp(trimmed), { mode: 'local', kind: 'dna' }), useRev = rev.score > fwd.score, a = useRev ? rev : fwd;
  const mism: ReadComparison['mismatches'] = []; let rp = a.aStart - 1, qp = a.bStart - 1; const rc = useRev ? revComp(trimmed) : trimmed;
  for (let k = 0; k < a.a.length; k++) { const x = a.a[k], y = a.b[k]; if (x !== '-' && y !== '-' && x !== y) { const readIdx = useRev ? trim.start + (trimmed.length - 1 - qp) : trim.start + qp; mism.push({ refPos: rp + 1, ref: x, read: y, readPos: readIdx + 1, qual: t.quals[readIdx] ?? 0 }); } if (x !== '-') rp++; if (y !== '-') qp++; }
  void rc; return { trim, trimmed, strand: useRev ? '-' : '+', alignment: a, mismatches: mism, identity: a.identity, refStart: a.aStart, refEnd: rp };
}
