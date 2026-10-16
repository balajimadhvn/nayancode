// Case study A: dexamethasone response of airway smooth-muscle cells (Himes et al. 2014, GEO GSE52778).
// Paired design ~ cell + dex in Expression Studio, then Reactome GSEA and ORA. Writes results/airway.json.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { designDe, guessSpecs, parseSheet } from '@/studios/expression/design';
import { gsea, normaliseGenes, ora, unpack, type GeneSetPack } from '@/studios/expression/enrichment';
import { parseMatrix } from '@/studios/expression/kernels';
import { readGz, round, writeJson } from '../../benchmarks/lib/metrics';

// Glucocorticoid-responsive genes reported for this dataset and in the glucocorticoid literature.
const KNOWN = ['CRISPLD2', 'DUSP1', 'KLF15', 'PER1', 'TSC22D3', 'FKBP5', 'ZBTB16'];

it('airway: paired differential expression and enrichment', () => {
  const t0 = performance.now();
  const m = parseMatrix(readGz('benchmarks/deseq2/airway_counts.tsv.gz')), sheet = parseSheet(readFileSync('benchmarks/deseq2/airway_samples.tsv', 'utf8'), m.samples);
  const specs = guessSpecs(sheet).map((s) => (s.name === 'dex' ? { ...s, reference: 'untrt' } : s));
  const de = designDe(m, sheet, { specs, test: { kind: 'pair', factor: 'dex', a: 'untrt', b: 'trt' }, minCpm: 1, minSamples: 2, useVoom: true, fdr: 0.05, lfc: 0 });
  const deSecs = (performance.now() - t0) / 1000;
  const ens = (JSON.parse(readFileSync('public/data/human_idmap.json', 'utf8')) as { ensembl: Record<string, string> }).ensembl;
  const sym = normaliseGenes(de.rows.map((r) => r.gene), ens).symbols, rows = de.rows.map((r, i) => ({ ...r, symbol: sym[i], rank: i + 1 }));
  const ref = JSON.parse(readGz('benchmarks/deseq2/reference.json.gz')).airway.deseq2, dIdx = new Map((ref.gene as string[]).map((g, i) => [g, i]));
  const known = KNOWN.map((g) => { const r = rows.find((x) => x.symbol === g); const di = r ? dIdx.get(r.gene) : undefined; return r ? { gene: g, ensembl: r.gene, log2FC: round(r.log2FC, 2), fdr: r.fdr, rank: r.rank, deseq2Log2FC: di !== undefined ? round(ref.log2FC[di], 2) : null, deseq2Padj: di !== undefined ? ref.padj[di] : null } : { gene: g, notTested: true }; });
  const sets = unpack(JSON.parse(readFileSync('public/data/reactome_human.json', 'utf8')) as GeneSetPack);
  const g0 = performance.now(), gs = gsea(sets, rows.map((r) => ({ gene: r.symbol, score: r.t })), { perms: Number(process.env.GSEA_PERMS ?? 20000), seed: 1 }), gseaSecs = (performance.now() - g0) / 1000;
  const up = rows.filter((r) => r.fdr <= 0.05 && r.log2FC >= 1).map((r) => r.symbol), down = rows.filter((r) => r.fdr <= 0.05 && r.log2FC <= -1).map((r) => r.symbol);
  const oUp = ora(sets, up, rows.map((r) => r.symbol)), oDown = ora(sets, down, rows.map((r) => r.symbol));
  const top = <T extends { name: string; fdr: number }>(xs: T[], f: (x: T) => Record<string, unknown>) => xs.slice(0, 10).map((x) => ({ name: x.name, fdr: x.fdr, ...f(x) }));
  const results = {
    data: { samples: m.samples.length, genesIn: m.genes.length, genesTested: de.tested, design: de.formula, contrast: de.label },
    de: { significant: de.nUp + de.nDown, up: de.nUp, down: de.nDown, upLfc1: up.length, downLfc1: down.length, priorDf: round(de.priorDf, 2) },
    knownGlucocorticoidGenes: known,
    gseaReactome: top(gs, (x) => ({ nes: round(x.nes, 2), size: x.size })),
    oraUpReactome: top(oUp, (x) => ({ overlap: x.overlap, setSize: x.setSize })),
    oraDownReactome: top(oDown, (x) => ({ overlap: x.overlap, setSize: x.setSize })),
    runtimeSeconds: { differentialExpression: round(deSecs, 1), gsea: round(gseaSecs, 1), gseaPermutations: Number(process.env.GSEA_PERMS ?? 20000) },
  };
  writeJson('docs/case-studies/results/airway.json', results);
  for (const g of known) if (!('notTested' in g)) { expect(g.log2FC).toBeGreaterThan(0); expect(g.fdr).toBeLessThan(0.05); }
});
