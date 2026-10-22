/** Reference-screening worker: bundled genome sketches are downloaded once and kept in memory for the session. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { assetUrl } from '@/core/asset';
import { readSequences, type SeqSource } from '@/core/readstream';
import { gather, parseRefFasta, refSketch, screenReads, simulateReads, sketchCounts, sketchGenome, type Gathered, type RefSketch, type ScreenRow, type Sketch } from './screen';

interface ManifestGenome { id: string; name: string; totalLength: number; fasta: { file: string } }
let manifestP: Promise<ManifestGenome[]> | null = null;
const manifest = () => (manifestP ??= fetch(assetUrl('genomes/manifest.json')).then((r) => { if (!r.ok) throw new Error(`Genome manifest not found (HTTP ${r.status})`); return (r.json() as Promise<{ genomes: ManifestGenome[] }>).then((m) => m.genomes); }));

const gunzip = async (buf: ArrayBuffer) => { const h = new Uint8Array(buf, 0, 2); return h[0] === 0x1f && h[1] === 0x8b ? new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf); };
const cache = new Map<string, Promise<{ ref: RefSketch; seq: string }>>();
/** Downloads a bundled genome (gzip, decompressed with DecompressionStream), sketches it and caches it in the worker. */
function bundled(id: string): Promise<{ ref: RefSketch; seq: string }> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const m = (await manifest()).find((g) => g.id === id); if (!m) throw new Error(`Unknown bundled genome "${id}"`);
      const r = await fetch(assetUrl(`genomes/${m.fasta.file}`)); if (!r.ok) throw new Error(`${m.fasta.file}: HTTP ${r.status}`);
      const seq = parseRefFasta(await gunzip(await r.arrayBuffer())).map((x) => x.seq).join('');
      return { ref: refSketch(id, seq), seq };
    })();
    p.catch(() => cache.delete(id)); cache.set(id, p);
  }
  return p;
}
const bundledIds = async () => (await manifest()).map((g) => g.id);

export interface ScreenResult { reads: number; readHashes: number; refs: ScreenRow[]; gathered: Gathered[]; demo?: boolean }
async function screenReadsOf(reads: SeqSource, maxReads: number, list: RefSketch[], ctx: { progress(p: number, note?: string): void }): Promise<ScreenResult> {
  const sample: Sketch = new Map();
  let n = 0;
  for await (const rd of readSequences(reads, { maxReads, onProgress: (f, k) => ctx.progress(0.05 + 0.85 * f, `${k.toLocaleString()} reads`) })) {
    for (const [h, c] of sketchGenome(rd)) sample.set(h, (sample.get(h) ?? 0) + c);
    n++; if (n % 20000 === 0) ctx.progress(0.05 + 0.85 * Math.min(1, n / maxReads), `${n.toLocaleString()} reads`);
  }
  if (!n) throw new Error('No reads found. Is this a FASTQ or FASTA file?');
  if (sketchCounts(sample) < 20) throw new Error('Too few usably long reads. Reads shorter than 21 nt contribute nothing to the sketch.');
  ctx.progress(0.95, 'Screening');
  return { reads: n, readHashes: sample.size, refs: screenReads(sample, list), gathered: gather(sample, list) };
}

const screen: Kernel<{ reads: SeqSource; maxReads: number; extraFasta?: string; bundled?: string[] }, ScreenResult> = async (a, ctx) => {
  ctx.progress(0.02, 'Sketching references');
  const ids = a.bundled ?? (await bundledIds());
  const extra = a.extraFasta ? parseRefFasta(a.extraFasta).map((r) => refSketch(r.id, r.seq)) : [];
  const list = [...(await Promise.all(ids.map(bundled))).map((b) => b.ref), ...extra];
  if (!list.length) throw new Error('Pick at least one reference.');
  return screenReadsOf(a.reads, a.maxReads, list, ctx);
};

const demo: Kernel<{ nReads?: number; seed?: number }, ScreenResult> = async (a, ctx) => {
  ctx.progress(0.02, 'Loading lambda and T7');
  const [L, T] = await Promise.all([bundled('lambda'), bundled('t7')]);
  ctx.progress(0.1, 'Sketching the other bundled genomes');
  const list = (await Promise.all((await bundledIds()).map(bundled))).map((b) => b.ref);
  ctx.progress(0.25, 'Simulating 70 % lambda + 30 % T7 reads');
  const reads = simulateReads([{ id: 'lambda', seq: L.seq }, { id: 't7', seq: T.seq }], [0.7, 0.3], { nReads: a.nReads ?? 20_000, readLen: 150, errorRate: 0.005, seed: a.seed ?? 7 });
  const sample: Sketch = new Map();
  for (const rd of reads) for (const [h, c] of sketchGenome(rd)) sample.set(h, (sample.get(h) ?? 0) + c);
  ctx.progress(0.95, 'Screening');
  return { reads: reads.length, readHashes: sample.size, refs: screenReads(sample, list), gathered: gather(sample, list), demo: true };
};

export type ScreenKernels = { screen: typeof screen; demo: typeof demo };
exposeKernels({ screen, demo } as Record<string, Kernel>);
