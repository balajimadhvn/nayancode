/** nf-core output recognition + conversion. Pure functions; everything runs in the browser, nothing is uploaded. */

export type NfKind = 'rnaseq-counts' | 'tenx-matrix' | 'tenx-features' | 'tenx-barcodes' | 'vcf' | 'multiqc-general' | 'samplesheet' | 'unknown';
export interface Detected { kind: NfKind; pipeline: string; note: string }

const base = (name: string) => name.replace(/^.*[\\/]/, '').toLowerCase().replace(/\.gz$/, '');

/** Decide what a file is from its name and first ~2 KB. */
export function detect(name: string, head: string): Detected {
  const n = base(name), first = head.split(/\r?\n/, 1)[0] ?? '';
  if (/\.vcf$/.test(n) || head.startsWith('##fileformat=VCF')) return { kind: 'vcf', pipeline: 'nf-core/sarek · viralrecon · raredisease', note: 'Variant calls' };
  if (/(^|[._-])matrix\.mtx$/.test(n) || /^%%MatrixMarket/.test(head)) return { kind: 'tenx-matrix', pipeline: 'nf-core/scrnaseq', note: 'Sparse count matrix' };
  if (/^(features|genes)\.tsv$/.test(n)) return { kind: 'tenx-features', pipeline: 'nf-core/scrnaseq', note: 'Gene list' };
  if (/^barcodes\.tsv$/.test(n)) return { kind: 'tenx-barcodes', pipeline: 'nf-core/scrnaseq', note: 'Cell barcodes' };
  if (/multiqc_general_stats/.test(n)) return { kind: 'multiqc-general', pipeline: 'MultiQC (any nf-core pipeline)', note: 'Per-sample QC summary' };
  if (/gene_counts(_length_scaled|_scaled)?\.tsv$|gene_counts\.tsv$|merged.*counts/.test(n) || /^gene_id\tgene_name\t/.test(first)) return { kind: 'rnaseq-counts', pipeline: 'nf-core/rnaseq', note: 'Gene × sample counts' };
  if (/samplesheet.*\.csv$/.test(n) || /^sample,(fastq_1|fastq|group)/i.test(first)) return { kind: 'samplesheet', pipeline: 'nf-core samplesheet', note: 'Sample metadata' };
  return { kind: 'unknown', pipeline: '', note: 'Not recognised; use the studio importer directly.' };
}

const clean = (x: string) => x.trim().replace(/^"|"$/g, '');
const delim = (l: string) => (l.includes('\t') ? '\t' : ',');

export interface ConvertedCounts { csv: string; samples: string[]; nGenes: number; idColumn: 'gene_name' | 'gene_id'; mergedDuplicates: number }
/** nf-core/rnaseq merged table (gene_id, gene_name, <samples…>) → genes × samples CSV that Expression Studio reads. Duplicate symbols are summed. */
export function convertRnaseqCounts(text: string, useSymbols = true): ConvertedCounts {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error('The table has no data rows.');
  const d = delim(lines[0]), head = lines[0].split(d).map(clean);
  if (head[0].toLowerCase() !== 'gene_id') throw new Error('Expected an nf-core/rnaseq merged table whose first column is "gene_id".');
  const hasName = head[1]?.toLowerCase() === 'gene_name', start = hasName ? 2 : 1, samples = head.slice(start);
  if (samples.length < 2) throw new Error('Need at least two sample columns.');
  const sym = useSymbols && hasName, acc = new Map<string, number[]>(); let dup = 0;
  for (let r = 1; r < lines.length; r++) {
    const f = lines[r].split(d).map(clean); if (f.length !== head.length) throw new Error(`Line ${r + 1}: expected ${head.length} columns, found ${f.length}.`);
    const id = (sym && f[1]) || f[0], vals = f.slice(start).map(Number);
    if (vals.some((v) => !Number.isFinite(v) || v < 0)) throw new Error(`Line ${r + 1}: counts must be non-negative numbers.`);
    const cur = acc.get(id); if (cur) { dup++; vals.forEach((v, i) => (cur[i] += v)); } else acc.set(id, vals);
  }
  const csv = ['gene,' + samples.join(','), ...[...acc].map(([g, v]) => g + ',' + v.map((x) => Math.round(x * 1000) / 1000).join(','))].join('\n');
  return { csv, samples, nGenes: acc.size, idColumn: sym ? 'gene_name' : 'gene_id', mergedDuplicates: dup };
}

/** Guess a condition from a sample name by stripping a trailing replicate token: WT_REP1, treated-2, KO_rep3 → WT, treated, KO. */
export function suggestGroup(sample: string): string {
  const g = sample.replace(/[._-]?(rep(licate)?)?[._-]?\d+$/i, '').replace(/[._-]+$/, '');
  return g || sample;
}
export function suggestGroups(samples: string[]): string[] {
  const g = samples.map(suggestGroup); return new Set(g).size === samples.length ? samples.map(() => '') : g; // all-unique means no replicate pattern: leave blank for the user
}
export function buildSheet(samples: string[], groups: string[], batches?: string[]): string {
  return (batches ? 'sample,group,batch\n' : 'sample,group\n') + samples.map((s, i) => `${s},${groups[i]}${batches ? ',' + batches[i] : ''}`).join('\n');
}

/** MultiQC general stats (TSV: Sample + metric columns) → rows for display. */
export function parseMultiqc(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length); if (lines.length < 2) throw new Error('Empty MultiQC table.');
  const head = lines[0].split('\t').map(clean);
  return { columns: head, rows: lines.slice(1).map((l) => { const f = l.split('\t'); return Object.fromEntries(head.map((h, i) => [h, clean(f[i] ?? '')])); }) };
}

/** Read a File, gunzipping with the built-in DecompressionStream when it is .gz (no library needed). */
export async function readText(file: File): Promise<string> {
  if (!/\.gz$/i.test(file.name)) return file.text();
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress .gz; gunzip the file first.');
  return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
