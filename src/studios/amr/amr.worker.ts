/** AMR screening worker: the NCBI reference gene set is fetched on first use, then kept and indexed in memory. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { assetUrl } from '@/core/asset';
import { parseFasta } from '@/studios/sequence/kernels';
import {
  annotateAmrRefs, buildAmrIndex, parseAmrCatalog, parseAmrFasta, pickDemoRefs, screenContigs, syntheticAmrContig,
  type AmrContig, type AmrDemoTruth, type AmrHit, type AmrIndex, type AmrRef,
} from './search';

export interface AmrSource { file?: File; text?: string }
export interface AmrThresholds { minIdentity?: number; minCoverage?: number }

const MAX_FILE_BYTES = 100_000_000;

const gunzip = async (buf: ArrayBuffer): Promise<string> => {
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new TextDecoder().decode(buf);
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
};

async function assetText(path: string): Promise<string> {
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error(`${path} could not be loaded (HTTP ${r.status}).`);
  return gunzip(await r.arrayBuffer());
}

let dbP: Promise<{ refs: AmrRef[]; version: string }> | null = null;
const db = () => {
  if (!dbP) {
    dbP = (async () => {
      const [fa, catalog, version] = await Promise.all([
        assetText('data/amr/AMR_CDS.fa.gz'),
        assetText('data/amr/ReferenceGeneCatalog.txt.gz'),
        assetText('data/amr/version.txt'),
      ]);
      const refs = parseAmrFasta(fa);
      annotateAmrRefs(refs, parseAmrCatalog(catalog));
      return { refs, version: version.trim() };
    })();
    dbP.catch(() => { dbP = null; });
  }
  return dbP;
};

let indexP: Promise<AmrIndex> | null = null;
const index = () => {
  if (!indexP) {
    indexP = db().then((d) => buildAmrIndex(d.refs));
    indexP.catch(() => { indexP = null; });
  }
  return indexP;
};

async function readContigs(src: AmrSource): Promise<AmrContig[]> {
  if (src.file && src.file.size > MAX_FILE_BYTES) throw new Error(`${src.file.name} is ${(src.file.size / 1e6).toFixed(0)} MB; the limit is 100 MB of FASTA.`);
  const text = src.file ? await gunzip(await src.file.arrayBuffer()) : src.text ?? '';
  const contigs = parseFasta(text).map((r) => ({ name: r.id, seq: r.seq }));
  if (!contigs.length) throw new Error('No FASTA records found. Paste or drop assembled contigs, one record per sequence.');
  return contigs;
}

export interface AmrScreenResult {
  hits: AmrHit[];
  contigs: { name: string; length: number }[];
  references: number;
  version: string;
  minIdentity: number;
  minCoverage: number;
  demo?: string;
  truth?: AmrDemoTruth[];
}

async function screen(contigs: AmrContig[], t: Required<AmrThresholds>, ctx: { progress(p: number, note?: string): void }): Promise<Omit<AmrScreenResult, 'demo' | 'truth'>> {
  ctx.progress(0.03, 'Loading the NCBI reference genes');
  const d = await db();
  ctx.progress(0.06, 'Building the k-mer index (first run only)');
  const ix = await index();
  ctx.progress(0.1, 'Screening');
  const hits = screenContigs(ix, contigs, {
    minIdentity: t.minIdentity, minCoverage: t.minCoverage,
    onProgress: (f, note) => ctx.progress(0.1 + 0.88 * f, note),
  });
  return {
    hits, contigs: contigs.map((c) => ({ name: c.name, length: c.seq.length })),
    references: d.refs.length, version: d.version, minIdentity: t.minIdentity, minCoverage: t.minCoverage,
  };
}

const thresholds = (a: AmrThresholds) => ({ minIdentity: a.minIdentity ?? 0.9, minCoverage: a.minCoverage ?? 0.6 });

const screenAssembly: Kernel<{ source: AmrSource } & AmrThresholds, AmrScreenResult> = async (a, ctx) => {
  const contigs = await readContigs(a.source);
  ctx.progress(0.02, `Read ${contigs.length} sequence(s)`);
  return { ...(await screen(contigs, thresholds(a), ctx)) };
};

const demo: Kernel<{ which: 'synthetic' | 'ecoli' } & AmrThresholds, AmrScreenResult> = async (a, ctx) => {
  if (a.which === 'ecoli') {
    ctx.progress(0.02, 'Loading the bundled E. coli K-12 genome');
    const contigs = parseFasta(await assetText('genomes/ecoli-k12.fna.gz')).map((r) => ({ name: r.id, seq: r.seq }));
    if (!contigs.length) throw new Error('The bundled E. coli K-12 genome is empty.');
    return { ...(await screen(contigs, thresholds(a), ctx)), demo: 'E. coli K-12 (NC_000913.3, bundled)' };
  }
  ctx.progress(0.02, 'Loading the reference genes for the demo contig');
  const d = await db();
  const built = syntheticAmrContig(pickDemoRefs(d.refs), { seed: 7 });
  return { ...(await screen([built.contig], thresholds(a), ctx)), demo: 'synthetic 20 kb contig, 5 planted genes', truth: built.truth };
};

export interface AmrLibraryRow { accession: string; symbol: string; allele: string; product: string; drugClass: string; subclass: string; length: number }
export interface AmrLibrary { rows: AmrLibraryRow[]; version: string; bases: number; classes: string[] }

const library: Kernel<void, AmrLibrary> = async (_a, ctx) => {
  ctx.progress(0.1, 'Loading the reference genes');
  const d = await db();
  const rows = d.refs.map((r) => ({ accession: r.accession, symbol: r.symbol, allele: r.allele, product: r.product, drugClass: r.drugClass, subclass: r.subclass, length: r.seq.length }));
  const classes = [...new Set(rows.flatMap((r) => r.drugClass.split('; ')).filter(Boolean))].sort();
  ctx.progress(1, `${rows.length.toLocaleString()} reference genes loaded`);
  return { rows, version: d.version, bases: d.refs.reduce((a2, r) => a2 + r.seq.length, 0), classes };
};

export type AmrKernels = { screenAssembly: typeof screenAssembly; demo: typeof demo; library: typeof library };
exposeKernels({ screenAssembly, demo, library } as Record<string, Kernel>);
