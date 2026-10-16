// Case study C: mutations in an evolved line of the E. coli long-term evolution experiment (SRR2584863; ancestor
// REL606, NCBI NC_012967.1) found in Genome Studio: minimap2 → samtools → bcftools (haploid), annotated with the
// RefSeq genes of REL606, and compared with native bcftools. Writes results/ecoli.json and results/ecoli_workbench.vcf.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEFAULT_CALLER, parseBcftoolsVcf } from '@/studios/genome/mapping';
import { mapAndCall } from '@/studios/genome/pipeline';
import { round, writeJson } from '../../benchmarks/lib/metrics';
import { runToolNode } from '../../benchmarks/lib/wasm-node';

const C = 'benchmarks/.cache/ecoli/';
interface Gene { start: number; end: number; name: string; tag: string; strand: string; product?: string }

it.skipIf(!existsSync(C + 'SRR2584863_1.800k.fastq'))('ecoli: variants of an LTEE line against its ancestor', async () => {
  const ref = readFileSync(C + 'REL606.fa', 'utf8'), id = ref.slice(1).split(/\s/)[0], len = ref.split('\n').slice(1).join('').length;
  const t0 = performance.now();
  const r = await mapAndCall(runToolNode, { refText: ref, contigs: [{ id, length: len }], reads: new Uint8Array(readFileSync(C + 'SRR2584863_1.800k.fastq')), preset: 'sr', caller: 'bcftools', ploidy: 1, opt: DEFAULT_CALLER }, { onProgress: () => {} });
  const secs = (performance.now() - t0) / 1000;
  writeFileSync('docs/case-studies/results/ecoli_workbench.vcf', r.vcf);
  // Gene annotation: genes from the GFF3, with the protein product from the matching CDS.
  const gff = readFileSync(C + 'REL606.gff3', 'utf8').split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
  const attr = (s: string) => Object.fromEntries(s.split(';').map((kv) => kv.split('=')));
  const products = new Map(gff.filter((f) => f[2] === 'CDS').map((f) => { const a = attr(f[8]); return [a.Parent?.replace(/^gene-/, ''), decodeURIComponent(a.product ?? '')]; }));
  const genes: Gene[] = gff.filter((f) => f[2] === 'gene').map((f) => { const a = attr(f[8]); return { start: +f[3], end: +f[4], strand: f[6], name: a.Name, tag: a.locus_tag, product: products.get(a.locus_tag) }; });
  const annotate = (pos: number) => { const g = genes.find((x) => pos >= x.start && pos <= x.end); if (g) return { where: 'gene', gene: g.name, product: g.product ?? '' };
    const left = genes.filter((x) => x.end < pos).at(-1), right = genes.find((x) => x.start > pos); return { where: 'intergenic', gene: `${left?.name ?? '-'}/${right?.name ?? '-'}`, product: '' }; };
  const native = parseBcftoolsVcf(readFileSync('benchmarks/bcftools/native_rel606.vcf', 'utf8'));
  const same = (a: { pos: number; ref: string; alt: string }, b: { pos: number; ref: string; alt: string }) => a.pos === b.pos && a.ref === b.ref && a.alt === b.alt;
  const calls = r.calls.map((c) => ({ pos: c.pos, ref: c.ref, alt: c.alt, type: c.ref.length === c.alt.length ? 'SNV' : c.alt.length > c.ref.length ? 'insertion' : 'deletion', qual: round(c.qual, 0), depth: c.depth, af: round(c.af, 2), ...annotate(c.pos), alsoNative: native.some((n) => same(c, n)) }));
  const results = {
    data: { reads: 800000, meanDepth: round(r.cov.reduce((a, c) => a + c.mean * c.length, 0) / r.cov.reduce((a, c) => a + c.length, 0), 1), mappedPct: round(r.flag.mappedPct, 2) },
    summary: { workbench: calls.length, native: native.length, shared: calls.filter((c) => c.alsoNative).length, highQuality: calls.filter((c) => c.qual >= 100).length, snv: calls.filter((c) => c.type === 'SNV').length, indel: calls.filter((c) => c.type !== 'SNV').length, inGenes: calls.filter((c) => c.where === 'gene').length },
    nativeOnly: native.filter((n) => !calls.some((c) => same(c, n))).map((n) => ({ pos: n.pos, ref: n.ref, alt: n.alt, qual: round(n.qual, 0) })),
    calls, runtimeSeconds: round(secs, 1),
  };
  writeJson('docs/case-studies/results/ecoli.json', results);
  // Every Workbench call is also a native call; calls only native bcftools makes are low-quality (QUAL < 30).
  expect(results.summary.shared).toBe(results.summary.workbench);
  for (const n of results.nativeOnly) expect(n.qual).toBeLessThan(30);
});
