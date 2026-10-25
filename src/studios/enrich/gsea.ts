/** Pre-ranked GSEA (Subramanian et al. 2005) with seeded gene-set permutations. */
import { bh } from '@/studios/expression/kernels';
import type { GeneSet, RankedGene } from './gmt';

export interface GseaOptions { perms?: number; seed?: number; minSize?: number; maxSize?: number; weight?: number }
export interface GseaRow {
  name: string;
  /** Set size after intersecting with the ranked list. */
  size: number;
  es: number;
  nes: number;
  p: number;
  fdr: number;
  /** 1-based positions of hits in the ranked list. */
  hitPositions: number[];
  /** Running sum after each ranked gene. */
  curve: number[];
}
export interface GseaResult { rows: GseaRow[]; ranked: number }

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Score { es: number; curve: number[] }

function score(weights: number[], hit: boolean[], nHits: number, weight: number): Score {
  const N = weights.length, misses = N - nHits;
  let nr = 0;
  for (let i = 0; i < N; i++) if (hit[i]) nr += Math.abs(weights[i]) ** weight;
  const curve = new Array<number>(N);
  let run = 0, es = 0;
  for (let i = 0; i < N; i++) {
    if (hit[i]) run += nr > 0 ? Math.abs(weights[i]) ** weight / nr : 0;
    else run -= misses > 0 ? 1 / misses : 0;
    curve[i] = run;
    if (Math.abs(run) > Math.abs(es)) es = run;
  }
  return { es, curve };
}

/** Draw `size` distinct positions in [0, n) using the supplied generator (partial Fisher-Yates). */
function sample(n: number, size: number, rnd: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rnd() * (n - i));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx.slice(0, size);
}

export function gsea(ranked: RankedGene[], sets: GeneSet[], opts: GseaOptions = {}): GseaResult {
  const { perms = 1000, seed = 1, minSize = 5, maxSize = 500, weight = 1 } = opts;
  if (!ranked.length) return { rows: [], ranked: 0 };
  const genes = ranked.map((r) => r.gene.toUpperCase());
  const weights = ranked.map((r) => r.score);
  const index = new Map(genes.map((g, i) => [g, i]));
  const N = genes.length;
  const rnd = mulberry32(seed);
  const rows: GseaRow[] = [];

  for (const set of sets) {
    const positions = [...new Set(set.genes.map((g) => g.trim().toUpperCase()))]
      .map((g) => index.get(g)).filter((i): i is number => i !== undefined).sort((a, b) => a - b);
    if (positions.length < minSize || positions.length > maxSize) continue;
    const hit = new Array<boolean>(N).fill(false);
    for (const i of positions) hit[i] = true;
    const observed = score(weights, hit, positions.length, weight);

    const same: number[] = [];
    let asOrMore = 0;
    for (let p = 0; p < perms; p++) {
      const pick = sample(N, positions.length, rnd);
      const random = new Array<boolean>(N).fill(false);
      for (const i of pick) random[i] = true;
      const e = score(weights, random, positions.length, weight).es;
      if (Math.sign(e) === Math.sign(observed.es)) {
        same.push(Math.abs(e));
        if (Math.abs(e) >= Math.abs(observed.es)) asOrMore++;
      }
    }
    const p = (asOrMore + 1) / (same.length + 1);
    const meanAbs = same.length ? same.reduce((a, b) => a + b, 0) / same.length : NaN;
    rows.push({
      name: set.name, size: positions.length, es: observed.es,
      nes: meanAbs > 0 ? observed.es / meanAbs : NaN,
      p, fdr: NaN, hitPositions: positions.map((i) => i + 1), curve: observed.curve,
    });
  }

  rows.sort((a, b) => a.p - b.p || Math.abs(b.es) - Math.abs(a.es) || a.name.localeCompare(b.name));
  const q = bh(rows.map((r) => r.p));
  rows.forEach((r, i) => { r.fdr = q[i]; });
  return { rows, ranked: N };
}
