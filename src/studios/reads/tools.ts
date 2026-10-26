/** Deduplication, seeded reservoir sampling and barcode demultiplexing. */
import type { FastqRecord } from './fastq';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** cyrb53: a seeded 53-bit string hash. At 2e6 reads the collision chance is ~ (2e6)^2 / 2^54 ~ 2.2e-4. */
export function hash53(s: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Keep the first occurrence of every sequence (or sequence pair). */
export function dedupExact<T extends { seq: string; seq2?: string }>(records: readonly T[]): T[] {
  const out: T[] = [];
  if (records.length < 2_000_000) {
    const seen = new Set<string>();
    for (const r of records) {
      const key = r.seq2 === undefined ? r.seq : `${r.seq}|${r.seq2}`;
      if (seen.has(key)) continue;
      seen.add(key); out.push(r);
    }
    return out;
  }
  // Large input: store 53-bit hashes (a collision would drop one read; probability ~2e-4 at 2e6 reads).
  const seen = new Set<number>();
  for (const r of records) {
    const key = hash53(r.seq2 === undefined ? r.seq : `${r.seq}|${r.seq2}`);
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}

/** Algorithm R reservoir sample. Same seed -> same sample; exactly min(n, size) records. */
export async function reservoirSample<T>(stream: Iterable<T> | AsyncIterable<T>, n: number, seed: number): Promise<T[]> {
  const want = Math.max(0, Math.floor(n)), rnd = mulberry32(seed), out: T[] = [];
  let seen = 0;
  for await (const item of stream) {
    seen++;
    if (out.length < want) out.push(item);
    else if (want > 0) {
      const j = Math.floor(rnd() * seen);
      if (j < want) out[j] = item;
    }
  }
  return out;
}

export interface Barcode { sample: string; seq: string }

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export interface DemuxResult {
  samples: Map<string, FastqRecord[]>;
  ambiguous: FastqRecord[];
  unassigned: FastqRecord[];
  counts: Record<string, number>;
}

/**
 * Assign each read to the unique barcode within maxMismatch Hamming distance.
 * Equally good matches are ambiguous; no match is unassigned. The barcode is
 * removed from the read. Barcode sets closer than 2*maxMismatch are rejected.
 */
export function demultiplex(records: readonly FastqRecord[], barcodes: readonly Barcode[], opts: { maxMismatch?: number; where?: 'start' | 'end' } = {}): DemuxResult {
  const maxMismatch = opts.maxMismatch ?? 1, where = opts.where ?? 'start';
  if (!barcodes.length) throw new Error('Provide at least one barcode.');
  const L = barcodes[0].seq.length;
  for (const b of barcodes) if (b.seq.length !== L) throw new Error('All barcodes must have the same length.');
  for (let i = 0; i < barcodes.length; i++) for (let j = i + 1; j < barcodes.length; j++) {
    const d = hamming(barcodes[i].seq, barcodes[j].seq);
    if (d <= 2 * maxMismatch) throw new Error(`Barcode sets "${barcodes[i].sample}" and "${barcodes[j].sample}" differ by only ${d} bases; with maxMismatch ${maxMismatch} they need more than ${2 * maxMismatch}.`);
  }
  const samples = new Map<string, FastqRecord[]>(barcodes.map((b) => [b.sample, []]));
  const ambiguous: FastqRecord[] = [], unassigned: FastqRecord[] = [];
  for (const r of records) {
    const probe = where === 'start' ? r.seq.slice(0, L) : r.seq.slice(-L);
    if (probe.length < L) { unassigned.push(r); continue; }
    let best = Infinity, hits: Barcode[] = [];
    for (const b of barcodes) {
      const d = hamming(probe, b.seq);
      if (d < best) { best = d; hits = [b]; } else if (d === best) hits.push(b);
    }
    if (best > maxMismatch) { unassigned.push(r); continue; }
    if (hits.length > 1) { ambiguous.push(r); continue; }
    const b = hits[0];
    const seq = where === 'start' ? r.seq.slice(L) : r.seq.slice(0, r.seq.length - L);
    const qual = where === 'start' ? r.qual.slice(L) : r.qual.slice(0, r.qual.length - L);
    samples.get(b.sample)!.push({ ...r, seq, qual });
  }
  const counts: Record<string, number> = {};
  for (const [name, rows] of samples) counts[name] = rows.length;
  return { samples, ambiguous, unassigned, counts };
}

export function parseBarcodes(text: string): Barcode[] {
  const out: Barcode[] = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(/[,\t]/).map((x) => x.trim());
    const seq = (f[1] ?? '').toUpperCase();
    if (f.length >= 2 && f[0] && /^[ACGTN]+$/.test(seq)) out.push({ sample: f[0], seq });
  }
  return out;
}
