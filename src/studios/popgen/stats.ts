/**
 * Population-genetic summaries on a genotype table: per-population allele frequencies, observed and expected
 * heterozygosity, exact HWE tests, Weir & Cockerham's θ (Fst) with a locus bootstrap, pairwise Fst and LD (r²).
 * The genotype and HWE/LD/PCA kernels are the shared ones from the Variants studio.
 */
import { hweExact, r2, ldPrune, genotypePcs, parseGenotypeTable, type Genotypes } from '../variants/assoc';

/** Small seeded PRNG (mulberry32) so bootstraps and simulations are reproducible. */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const delimOf = (line: string) => (line.includes('\t') ? '\t' : line.includes(',') ? ',' : /\s+/);
const unq = (s: string) => s.trim().replace(/^"|"$/g, '');

export interface PopGenotypes extends Genotypes { pop: string[] }

/** Genotype table with a population column: `sample, population, snp1, snp2, …` (0/1/2 dosages). */
export function parsePopTable(text: string): PopGenotypes {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) throw new Error('Need a header row and at least two samples.');
  const d = delimOf(lines[0]);
  const head = lines[0].split(d).map(unq);
  const popIdx = head.findIndex((h) => /^(population|pop|group|cluster)$/i.test(h));
  if (popIdx < 1) throw new Error('Add a "population" column after the sample ID (values: population or group).');
  const keep = head.map((_, i) => i).filter((i) => i !== popIdx);
  const table = lines.map((l) => { const f = l.split(d).map(unq); return keep.map((i) => f[i] ?? '').join('\t'); }).join('\n');
  const geno = parseGenotypeTable(table);
  const pop = lines.slice(1).map((l) => unq(l.split(d)[popIdx] ?? ''));
  if (pop.some((p) => !p)) throw new Error('Every sample needs a population value.');
  return { ...geno, pop };
}

/** `sample, population` table aligned to an existing genotype file (VCF route). */
export function parsePopAssignments(text: string, samples: string[]): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('Need a header row and at least one sample.');
  const d = delimOf(lines[0]);
  const head = lines[0].split(d).map(unq);
  const popIdx = head.findIndex((h) => /^(population|pop|group|cluster)$/i.test(h));
  if (popIdx < 0) throw new Error('Add a "population" column to the sample sheet.');
  const map = new Map<string, string>();
  for (const line of lines.slice(1)) { const f = line.split(d).map(unq); map.set(f[0], f[popIdx]); }
  const missing = samples.filter((s) => !map.get(s));
  if (missing.length) throw new Error(`No population for ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}.`);
  return samples.map((s) => map.get(s)!);
}

// parsePopTable rebuilds a tab-separated table, so both input routes share one genotype parser.

export function populations(pop: string[]): string[] {
  return [...new Set(pop)];
}

export interface FreqRow {
  snp: string; population: string; n: number; alt: number; Ho: number; He: number; F: number; hweP: number;
}

/** Per-SNP, per-population allele frequency, observed/expected heterozygosity and exact HWE p. Missing genotypes are skipped. */
export function alleleFreqs(geno: Genotypes, pop: string[]): FreqRow[] {
  if (pop.length !== geno.samples.length) throw new Error('The population table does not match the genotype samples.');
  const groups = populations(pop);
  const rows: FreqRow[] = [];
  geno.snps.forEach((snp, j) => {
    const g = geno.G[j];
    for (const p of groups) {
      let n = 0, alt = 0, het = 0, c0 = 0, c1 = 0, c2 = 0;
      for (let i = 0; i < g.length; i++) {
        if (pop[i] !== p) continue;
        const v = g[i];
        if (v < 0) continue;
        n++; alt += v;
        if (v === 0) c0++; else if (v === 1) { c1++; het++; } else c2++;
      }
      const f = n ? alt / (2 * n) : NaN;
      const Ho = n ? het / n : NaN;
      const He = n ? 2 * f * (1 - f) * ((2 * n) / (2 * n - 1)) : NaN;
      rows.push({ snp: snp.id, population: p, n, alt: f, Ho, He, F: He > 0 ? 1 - Ho / He : 0, hweP: n ? hweExact(c0, c1, c2) : 1 });
    }
  });
  return rows;
}

export interface FstLocus { snp: string; a: number; b: number; c: number; theta: number }
export interface FstResult { theta: number; loci: FstLocus[]; ci95: [number, number] | null; populations: string[] }

function wcLocus(geno: Genotypes, pop: string[], labels: string[]): FstLocus[] {
  const keep = pop.map((p) => labels.includes(p));
  const out: FstLocus[] = [];
  geno.snps.forEach((snp, j) => {
    const g = geno.G[j];
    const r = labels.length;
    const ni = new Array<number>(r).fill(0), altSum = new Array<number>(r).fill(0), het = new Array<number>(r).fill(0);
    for (let i = 0; i < g.length; i++) {
      if (!keep[i]) continue;
      const v = g[i];
      if (v < 0) continue;
      const k = labels.indexOf(pop[i]);
      ni[k]++; altSum[k] += v; if (v === 1) het[k]++;
    }
    const used = ni.filter((n) => n > 0).length;
    if (used < 2) return;
    let nSum = 0, nSq = 0;
    for (let k = 0; k < r; k++) { nSum += ni[k]; nSq += ni[k] * ni[k]; }
    const nBar = nSum / used;
    if (!(nBar > 1)) return;
    const nc = (used * nBar - nSq / (used * nBar)) / (used - 1);
    if (!(nc > 0)) return;
    let pBar = 0, hBar = 0, s2 = 0;
    for (let k = 0; k < r; k++) {
      if (!ni[k]) continue;
      const p = altSum[k] / (2 * ni[k]), h = het[k] / ni[k];
      pBar += ni[k] * p;
      hBar += ni[k] * h;
    }
    pBar /= used * nBar; hBar /= used * nBar;
    for (let k = 0; k < r; k++) {
      if (!ni[k]) continue;
      const p = altSum[k] / (2 * ni[k]);
      s2 += ni[k] * (p - pBar) * (p - pBar);
    }
    s2 /= (used - 1) * nBar;
    const a = (nBar / nc) * (s2 - (1 / (nBar - 1)) * (pBar * (1 - pBar) - ((used - 1) / used) * s2 - hBar / 4));
    const b = (nBar / (nBar - 1)) * (pBar * (1 - pBar) - ((used - 1) / used) * s2 - ((2 * nBar - 1) / (4 * nBar)) * hBar);
    const c = hBar / 2;
    const den = a + b + c;
    out.push({ snp: snp.id, a, b, c, theta: den !== 0 ? a / den : NaN });
  });
  return out;
}

const ratio = (loci: FstLocus[]) => {
  let a = 0, den = 0;
  for (const l of loci) { if (!Number.isFinite(l.theta)) continue; a += l.a; den += l.a + l.b + l.c; }
  return den !== 0 ? a / den : NaN;
};

/** Weir & Cockerham (1984) θ over all populations, with a bootstrap over loci for a 95 % interval. */
export function wcFst(geno: Genotypes, pop: string[], opts: { resamples?: number; seed?: number } = {}): FstResult {
  const labels = populations(pop);
  const loci = wcLocus(geno, pop, labels);
  const theta = ratio(loci);
  let ci95: [number, number] | null = null;
  const resamples = opts.resamples ?? 200;
  if (loci.length >= 2 && resamples > 0 && Number.isFinite(theta)) {
    const rnd = mulberry32(opts.seed ?? 12345), vals: number[] = [];
    for (let r = 0; r < resamples; r++) {
      const sample: FstLocus[] = [];
      for (let k = 0; k < loci.length; k++) sample.push(loci[Math.floor(rnd() * loci.length)]);
      const t = ratio(sample);
      if (Number.isFinite(t)) vals.push(t);
    }
    vals.sort((x, y) => x - y);
    if (vals.length) {
      const q = (f: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(f * (vals.length - 1))))];
      ci95 = [q(0.025), q(0.975)];
    }
  }
  return { theta, loci, ci95, populations: labels };
}

/** Pairwise θ matrix (same estimator applied to each pair); the diagonal is 0. */
export function pairwiseFst(geno: Genotypes, pop: string[]): { populations: string[]; matrix: number[][] } {
  const labels = populations(pop);
  const matrix = labels.map(() => labels.map(() => 0));
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const t = ratio(wcLocus(geno, pop, [labels[i], labels[j]]));
    matrix[i][j] = t; matrix[j][i] = t;
  }
  return { populations: labels, matrix };
}

/** r² LD matrix over the supplied SNP indices, zero outside a window of `window` indices. */
export function ldMatrix(geno: Genotypes, idx: number[], window = 100): { idx: number[]; matrix: number[][] } {
  const matrix = idx.map((_, i) => idx.map((_, k) => {
    if (Math.abs(i - k) > window) return 0;
    if (geno.snps[idx[i]].chrom !== geno.snps[idx[k]].chrom) return 0;
    return r2(geno.G[idx[i]], geno.G[idx[k]]);
  }));
  return { idx, matrix };
}

/** Principal components after LD pruning; the shared genotype-PCA kernel is used unchanged. */
export function structurePca(geno: Genotypes, nPc = 2, window = 50, threshold = 0.5) {
  const idx = ldPrune(geno.snps, geno.G, geno.G.map((_, i) => i), window, threshold);
  return { ...genotypePcs(geno.G, idx, nPc), idx };
}
