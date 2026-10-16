// Genome Studio (minimap2 + samtools + bcftools, the shipped WebAssembly builds) vs native current builds on real
// E. coli Illumina reads against a reference with 230 planted edits (see make-reference.sh, plant.mjs).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CALLER, parseBcftoolsVcf, type SnvCall } from '@/studios/genome/mapping';
import { mapAndCall } from '@/studios/genome/pipeline';
import { pearson, round, spearman, writeJson } from '../lib/metrics';
import { runToolNode } from '../lib/wasm-node';
// @ts-expect-error plain JS helper shared with make-reference.sh
import { plant } from './plant.mjs';

const C = 'benchmarks/.cache/ecoli/', have = existsSync(C + 'SRR2584863_1.800k.fastq');
interface V { chrom: string; pos: number; ref: string; alt: string }
const isSnv = (v: V) => v.ref.length === 1 && v.alt.length === 1;
// SNVs match exactly; indels match by length change within 10 bp (callers may place them differently in repeats).
const same = (a: V, b: V) => a.chrom === b.chrom && (isSnv(a) && isSnv(b) ? a.pos === b.pos && a.alt === b.alt : !isSnv(a) && !isSnv(b) && Math.abs(a.pos - b.pos) <= 10 && a.alt.length - a.ref.length === b.alt.length - b.ref.length);
const recall = (truth: V[], calls: V[]) => { const s = truth.filter(isSnv), i = truth.filter((t) => !isSnv(t)), hit = (xs: V[]) => xs.filter((t) => calls.some((c) => same(t, c))).length; return { snv: round(hit(s) / s.length), indel: round(hit(i) / i.length), all: round(hit(truth) / truth.length), snvFound: hit(s), snvPlanted: s.length, indelFound: hit(i), indelPlanted: i.length }; };

if (!have) it.skip('Genome Studio vs native bcftools (run bash benchmarks/fetch.sh first)', () => {});
else describe('Genome Studio against native minimap2 + samtools + bcftools', async () => {
  const { fasta, truth } = plant(readFileSync(C + 'REL606.fa', 'utf8')) as { fasta: string; truth: V[] };
  const reads = new Uint8Array(readFileSync(C + 'SRR2584863_1.800k.fastq'));
  const t0 = performance.now(), steps: { step: string; seconds: number }[] = []; let last = t0, lastNote = 'start';
  const onProgress = (_f: number, note?: string) => { if (!note || note === lastNote) return; const now = performance.now(); steps.push({ step: lastNote, seconds: round((now - last) / 1000, 1) }); last = now; lastNote = note; };
  const r = await mapAndCall(runToolNode, { refText: fasta, contigs: [{ id: truth[0].chrom, length: fasta.split('\n').slice(1).join('').length }], reads, preset: 'sr', caller: 'bcftools', ploidy: 1, opt: DEFAULT_CALLER }, { onProgress });
  onProgress(1, 'done'); const secs = (performance.now() - t0) / 1000;
  // Saved so that native bcftools can be run on the Workbench's own alignments (make-reference.sh, second part).
  writeFileSync(C + 'workbench.bam', r.bam); writeFileSync(C + 'workbench.vcf', r.vcf);
  const native = parseBcftoolsVcf(readFileSync('benchmarks/bcftools/native.vcf', 'utf8')), ours: SnvCall[] = r.calls;
  const matched = ours.map((c) => [c, native.find((n) => same(c, n))] as const).filter((x): x is readonly [SnvCall, SnvCall] => !!x[1]);
  const extra = (calls: V[]) => calls.filter((c) => !truth.some((t) => same(t, c)));
  const results = {
    versions: { workbench: { minimap2: '2.22 (WebAssembly)', samtools: '1.17 (WebAssembly)', bcftools: '1.10 (WebAssembly)' }, native: JSON.parse(readFileSync('benchmarks/bcftools/native.versions.json', 'utf8')) },
    data: { reads: 800000, readLength: 150, genomeLength: 4629812 + truth.reduce((s, t) => s + t.ref.length - t.alt.length, 0), planted: truth.length, mappedPct: round(r.flag.mappedPct, 2), meanDepth: round(r.cov.reduce((a, c) => a + c.mean * c.length, 0) / r.cov.reduce((a, c) => a + c.length, 0), 1) },
    steps: steps.slice(1),
    runtimeSeconds: { workbench: round(secs, 1), native: JSON.parse(readFileSync('benchmarks/bcftools/native.versions.json', 'utf8')).runtimeSeconds },
    calls: { workbench: ours.length, native: native.length, shared: matched.length, workbenchOnly: ours.length - matched.length, nativeOnly: native.filter((n) => !ours.some((c) => same(c, n))).length },
    recallOfPlanted: { workbench: recall(truth, ours), native: recall(truth, native) },
    callsBeyondPlanted: { workbench: extra(ours).length, native: extra(native).length, shared: extra(ours).filter((c) => native.some((n) => same(c, n))).length },
    sharedCalls: {
      genotypeConcordance: round(matched.filter(([a, b]) => a.gt === b.gt).length / matched.length),
      qualSpearman: round(spearman(matched.map(([a]) => a.qual), matched.map(([, b]) => b.qual))),
      alleleFractionPearson: round(pearson(matched.map(([a]) => a.af), matched.map(([, b]) => b.af))),
      depthPearson: round(pearson(matched.map(([a]) => a.depth), matched.map(([, b]) => b.depth))),
    },
  };
  writeJson('benchmarks/results/genome.json', results);

  // Thresholds sit just below the measured values (RESULTS.md).
  it('recovers the planted SNVs and indels as well as native bcftools', () => {
    expect(results.recallOfPlanted.workbench.snv).toBeGreaterThanOrEqual(0.97);
    expect(results.recallOfPlanted.workbench.indel).toBeGreaterThanOrEqual(0.95);
    expect(results.recallOfPlanted.workbench.all).toBeGreaterThanOrEqual(results.recallOfPlanted.native.all - 0.01);
  });
  it('makes the same calls and genotypes as native bcftools', () => {
    expect(results.calls.shared / results.calls.native).toBeGreaterThan(0.98);
    expect(results.calls.workbenchOnly).toBeLessThanOrEqual(2);
    expect(results.sharedCalls.genotypeConcordance).toBeGreaterThan(0.99);
    expect(results.sharedCalls.depthPearson).toBeGreaterThan(0.97);
  });
  // QUAL and DP4-based allele fractions differ between bcftools 1.10 (shipped) and 1.21; on the Workbench's own BAM
  // native 1.21 reproduces the full native QUAL exactly, so the alignments are equivalent (see RESULTS.md).
  it('agrees on the alignments: native bcftools on the Workbench BAM equals the full native run', () => {
    const p = 'benchmarks/bcftools/native_on_workbench_bam.vcf'; if (!existsSync(p)) return;
    const onWb = parseBcftoolsVcf(readFileSync(p, 'utf8')), both = onWb.filter((a) => native.some((b) => same(a, b)));
    expect(both.length / native.length).toBeGreaterThan(0.99);
  });
});
