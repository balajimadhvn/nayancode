// Expression Studio vs DESeq2, limma-voom and edgeR-QL on two public RNA-seq experiments (see make-reference.R).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMatrix } from '@/studios/expression/kernels';
import { designDe, guessSpecs, parseSheet } from '@/studios/expression/design';
import { overlap, pearson, readGz, round, spearman, writeJson } from '../lib/metrics';

const dir = 'benchmarks/deseq2/';
const ref = JSON.parse(readGz(dir + 'reference.json.gz'));
type Tool = { gene: string[]; log2FC: (number | null)[]; p: (number | null)[]; padj: (number | null)[]; t?: number[] };
const FDR = 0.05;

function compare(ours: Map<string, { lfc: number; p: number; fdr: number; t: number }>, tool: Tool) {
  const common = tool.gene.map((g, i) => [g, i] as const).filter(([g, i]) => ours.has(g) && tool.log2FC[i] != null && tool.p[i] != null);
  const a = common.map(([g]) => ours.get(g)!.lfc), b = common.map(([, i]) => tool.log2FC[i] as number);
  const sigOurs = new Set(common.filter(([g]) => ours.get(g)!.fdr <= FDR).map(([g]) => g));
  const sigTool = new Set(common.filter(([, i]) => (tool.padj[i] ?? 1) <= FDR).map(([g]) => g));
  const top = (k: number) => {
    const o = [...common].sort((x, y) => ours.get(x[0])!.p - ours.get(y[0])!.p).slice(0, k).map(([g]) => g);
    const r = [...common].sort((x, y) => (tool.p[x[1]] as number) - (tool.p[y[1]] as number)).slice(0, k).map(([g]) => g);
    return overlap(new Set(o), new Set(r)).jaccard;
  };
  const ov = overlap(sigOurs, sigTool);
  return {
    genesCompared: common.length, ...(tool.t ? { maxAbsTDiff: round(Math.max(...common.map(([g, i]) => Math.abs(ours.get(g)!.t - tool.t![i]))), 8) } : {}), lfcPearson: round(pearson(a, b)), lfcSpearman: round(spearman(a, b)), maxAbsLfcDiff: round(Math.max(...a.map((x, i) => Math.abs(x - b[i]))), 8),
    pSpearman: round(spearman(common.map(([g]) => -Math.log10(ours.get(g)!.p)), common.map(([, i]) => -Math.log10(tool.p[i] as number)))),
    significant: { nayancode: ov.a, reference: ov.b, both: ov.both, jaccard: round(ov.jaccard), referenceRecovered: round(ov.bInA), nayancodeConfirmed: round(ov.aInB) },
    top100Jaccard: round(top(100)), top500Jaccard: round(top(500)),
  };
}

function runDataset(name: 'airway' | 'pasilla') {
  const R = ref[name], m = parseMatrix(readGz(`${dir}${name}_counts.tsv.gz`));
  const sheet = parseSheet(readFileSync(`${dir}${name}_samples.tsv`, 'utf8'), m.samples);
  const factor = name === 'airway' ? 'dex' : 'condition', [b, , a] = (R.contrast as string).split(' ');
  const specs = guessSpecs(sheet).map((s) => (s.name === factor ? { ...s, reference: a } : s));
  const t0 = performance.now();
  const de = designDe(m, sheet, { specs, test: { kind: 'pair', factor, a, b }, minCpm: 1, minSamples: 2, useVoom: true, fdr: FDR, lfc: 0 });
  const ms = performance.now() - t0;
  const ours = new Map(de.rows.map((r) => [r.gene, { lfc: r.log2FC, p: r.p, fdr: r.fdr, t: r.t }]));
  return { dataset: name, formula: de.formula, contrast: de.label, samples: m.samples.length, genesIn: m.genes.length, genesTested: de.tested, runtimeMs: Math.round(ms), vsLimmaVoom: compare(ours, R.limma), vsEdgeRQL: compare(ours, R.edger), vsDESeq2: compare(ours, R.deseq2) };
}

describe('Expression Studio against reference tools on public data', () => {
  const results = { versions: ref.versions, fdr: FDR, airway: runDataset('airway'), pasilla: runDataset('pasilla') };
  writeJson('benchmarks/results/expression.json', results);

  for (const name of ['airway', 'pasilla'] as const) {
    const r = results[name];
    it(`${name}: reproduces limma-voom (same model)`, () => {
      expect(r.vsLimmaVoom.maxAbsLfcDiff).toBeLessThan(1e-6);
      expect(r.vsLimmaVoom.maxAbsTDiff).toBeLessThan(1e-4);
      expect(r.vsLimmaVoom.significant.jaccard).toBe(1);
    });
    // Different statistical models (negative binomial vs linear model on log-CPM): agreement, not identity.
    // Thresholds sit just below the measured values so that a regression fails the build.
    it(`${name}: agrees with DESeq2`, () => {
      expect(r.vsDESeq2.lfcPearson).toBeGreaterThan(0.98);
      expect(r.vsDESeq2.significant.referenceRecovered).toBeGreaterThan(0.88);
    });
    it(`${name}: agrees with edgeR quasi-likelihood`, () => {
      expect(r.vsEdgeRQL.lfcPearson).toBeGreaterThan(0.99);
      expect(r.vsEdgeRQL.significant.jaccard).toBeGreaterThan(0.93);
    });
  }
});
