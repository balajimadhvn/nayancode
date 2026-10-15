/** Gene-set enrichment on permissively licensed collections (Reactome CC BY 4.0, WikiPathways CC0, GO CC BY 4.0).
 *  ORA: hypergeometric upper tail (Fisher). GSEA: preranked weighted Kolmogorov–Smirnov running sum (Subramanian et al. 2005)
 *  with a size-matched random-gene-set null (as in fgsea's simple mode). Clean-room implementation. */
import { bh, lgamma } from './kernels';

export interface GeneSetPack { meta: { name: string; license: string; attribution: string; source: string; built: string; nSets: number; species: string }; genes: string[]; sets: { id: string; name: string; g: number[] }[] }
export interface GeneSet { id: string; name: string; genes: Set<string> }

export function unpack(p: GeneSetPack): GeneSet[] { return p.sets.map((s) => ({ id: s.id, name: s.name, genes: new Set(s.g.map((i) => p.genes[i].toUpperCase())) })); }

/** Normalise identifiers to upper-case HGNC-style symbols; maps Ensembl gene IDs (version suffix dropped) when a map is supplied. */
export function normaliseGenes(names: string[], ens2sym?: Record<string, string>): { symbols: string[]; mapped: number; unmapped: number } {
  let mapped = 0, unmapped = 0;
  const symbols = names.map((n) => { const t = n.trim(); const e = /^ENS[A-Z]*G\d+/i.exec(t); if (e && ens2sym) { const s = ens2sym[e[0].toUpperCase()]; if (s) { mapped++; return s.toUpperCase(); } unmapped++; return t.toUpperCase(); } return t.toUpperCase(); });
  return { symbols, mapped, unmapped };
}

const lchoose = (n: number, k: number) => (k < 0 || k > n ? -Infinity : lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1));
/** P(X >= k) for X ~ Hypergeometric(N population, K successes, n draws). */
export function hypergeomUpper(k: number, K: number, n: number, N: number): number {
  const hi = Math.min(K, n); if (k <= 0) return 1; if (k > hi) return 0;
  let p = 0; const denom = lchoose(N, n);
  for (let x = k; x <= hi; x++) p += Math.exp(lchoose(K, x) + lchoose(N - K, n - x) - denom);
  return Math.min(1, p);
}

export interface OraRow { id: string; name: string; overlap: number; setSize: number; listSize: number; fold: number; p: number; fdr: number; genes: string[] }
export function ora(sets: GeneSet[], list: string[], background: string[], minOverlap = 2, minSize = 5, maxSize = 500): OraRow[] {
  const bg = new Set(background.map((g) => g.toUpperCase())); const hit = new Set(list.map((g) => g.toUpperCase()).filter((g) => bg.has(g)));
  const universe = new Set<string>(); for (const s of sets) for (const g of s.genes) if (bg.has(g)) universe.add(g);
  const N = universe.size, n = [...hit].filter((g) => universe.has(g)).length;
  if (n < 3) throw new Error(`Only ${n} of your genes are annotated in this collection. Check that gene identifiers are HGNC symbols (or Ensembl IDs for human).`);
  const rows: OraRow[] = [];
  for (const s of sets) {
    let K = 0; const ov: string[] = []; for (const g of s.genes) if (universe.has(g)) { K++; if (hit.has(g)) ov.push(g); }
    if (K < minSize || K > maxSize || ov.length < minOverlap) continue;
    rows.push({ id: s.id, name: s.name, overlap: ov.length, setSize: K, listSize: n, fold: (ov.length / n) / (K / N), p: hypergeomUpper(ov.length, K, n, N), fdr: NaN, genes: ov.sort() });
  }
  const q = bh(rows.map((r) => r.p)); rows.forEach((r, i) => { r.fdr = q[i]; });
  return rows.sort((a, b) => a.p - b.p);
}

export interface GseaRow { id: string; name: string; size: number; es: number; nes: number; p: number; fdr: number; leadingEdge: string[] }
function es(positions: number[], w: Float64Array, totalW: number, N: number): { es: number; peak: number } {
  const hits = positions.slice().sort((a, b) => a - b), k = hits.length, miss = 1 / (N - k); let run = 0, best = 0, peak = -1, prev = -1;
  for (let j = 0; j < k; j++) { const pos = hits[j]; run -= (pos - prev - 1) * miss; if (Math.abs(run) > Math.abs(best)) { best = run; peak = pos - 1; } run += w[pos] / totalW; if (Math.abs(run) > Math.abs(best)) { best = run; peak = pos; } prev = pos; }
  run -= (N - 1 - prev) * miss; if (Math.abs(run) > Math.abs(best)) { best = run; peak = N - 1; }
  return { es: best, peak };
}
export function gsea(sets: GeneSet[], ranked: { gene: string; score: number }[], opts: { perms?: number; minSize?: number; maxSize?: number; seed?: number } = {}, progress?: (f: number) => void): GseaRow[] {
  const { perms = 1000, minSize = 10, maxSize = 500, seed = 1 } = opts;
  const best = new Map<string, number>(); for (const r of ranked) { const g = r.gene.toUpperCase(), s = best.get(g); if (s === undefined || Math.abs(r.score) > Math.abs(s)) best.set(g, r.score); }
  const list = [...best.entries()].map(([gene, score]) => ({ gene, score })).sort((a, b) => b.score - a.score), N = list.length; if (N < 50) throw new Error('Need at least 50 ranked genes for GSEA.');
  const pos = new Map(list.map((r, i) => [r.gene, i])), w = Float64Array.from(list, (r) => Math.abs(r.score));
  let s = seed >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const nullCache = new Map<number, { pos: number[]; neg: number[] }>(); const bucket = (k: number) => Math.round(Math.exp(Math.round(Math.log(k) * 6) / 6));
  const nullFor = (k: number) => { const b = bucket(k); let n = nullCache.get(b); if (!n) { n = { pos: [], neg: [] }; for (let t = 0; t < perms; t++) { const chosen = new Set<number>(); while (chosen.size < b) chosen.add(Math.floor(rnd() * N)); const ps = [...chosen]; let tw = 0; for (const p of ps) tw += w[p]; const e = es(ps, w, tw || 1, N).es; (e >= 0 ? n.pos : n.neg).push(Math.abs(e)); } nullCache.set(b, n); } return n; };
  const rows: GseaRow[] = []; let done = 0;
  for (const set of sets) {
    const ps: number[] = []; for (const g of set.genes) { const p = pos.get(g); if (p !== undefined) ps.push(p); }
    if (ps.length < minSize || ps.length > maxSize) { done++; continue; }
    let tw = 0; for (const p of ps) tw += w[p]; const { es: e, peak } = es(ps, w, tw || 1, N), nl = nullFor(ps.length), arr = e >= 0 ? nl.pos : nl.neg;
    const mean = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 1, nes = mean ? e / mean : 0, ge = arr.filter((v) => v >= Math.abs(e)).length;
    rows.push({ id: set.id, name: set.name, size: ps.length, es: e, nes, p: (ge + 1) / (arr.length + 1), fdr: NaN, leadingEdge: ps.filter((p) => (e >= 0 ? p <= peak : p >= peak)).sort((a, b) => (e >= 0 ? a - b : b - a)).slice(0, 25).map((p) => list[p].gene) });
    if (progress && ++done % 100 === 0) progress(done / sets.length);
  }
  const q = bh(rows.map((r) => r.p)); rows.forEach((r, i) => { r.fdr = q[i]; });
  return rows.sort((a, b) => a.p - b.p || Math.abs(b.nes) - Math.abs(a.nes));
}
