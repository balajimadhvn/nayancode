import { describe, expect, it } from 'vitest';
import { batchMixing, doubletScores, harmony, knnApprox, knnRecall, valleyThreshold } from './scale';
import { knn } from './umap';

const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const auc = (pos: number[], neg: number[]) => { let w = 0; for (const p of pos) for (const q of neg) w += p > q ? 1 : p === q ? 0.5 : 0; return w / (pos.length * neg.length); };

/** Cell types on a ring of well-separated centres plus a batch offset. */
function cohort(nPer: number, types: number, batches: number, shift: number, seed: number, d = 10) {
  const r = rng(seed), Z: number[][] = [], batch: number[] = [], type: number[] = [];
  const centres = Array.from({ length: types }, () => Array.from({ length: d }, () => gauss(r) * 6));
  const offs = Array.from({ length: batches }, () => Array.from({ length: d }, () => gauss(r) * shift));
  for (let b = 0; b < batches; b++) for (let t = 0; t < types; t++) for (let i = 0; i < nPer; i++) { Z.push(centres[t].map((c, j) => c + offs[b][j] + gauss(r))); batch.push(b); type.push(t); }
  return { Z, batch, type };
}

describe('NN-descent', () => {
  it('recovers ≥ 95% of the exact 15 nearest neighbours on clustered data', () => {
    const { Z } = cohort(300, 5, 1, 0, 3, 20), k = 15, ex = knn(Z, k), ap = knnApprox(Z, k, 1);
    expect(knnRecall(ap, ex, k)).toBeGreaterThan(0.95);
  });
  it('returns sorted distances, no self-neighbours and no duplicates', () => {
    const { Z } = cohort(80, 3, 1, 0, 4, 8), k = 10, ap = knnApprox(Z, k, 2);
    for (let i = 0; i < Z.length; i++) { const row = Array.from(ap.idx.subarray(i * k, (i + 1) * k)); expect(row).not.toContain(i); expect(new Set(row).size).toBe(k); for (let t = 1; t < k; t++) expect(ap.dist[i * k + t]).toBeGreaterThanOrEqual(ap.dist[i * k + t - 1]); }
  });
  it('is deterministic for a seed', () => { const { Z } = cohort(60, 3, 1, 0, 5, 6); expect(Array.from(knnApprox(Z, 8, 7).idx)).toEqual(Array.from(knnApprox(Z, 8, 7).idx)); });
});

describe('Harmony-style integration', () => {
  it('mixes batches while keeping cell types apart', () => {
    const { Z, batch, type } = cohort(150, 4, 2, 3, 9), before = batchMixing(Z, batch, 30);
    const r = harmony(Z, batch, { seed: 2 }), after = batchMixing(r.Z, batch, 30);
    expect(after).toBeGreaterThan(before + 0.3); expect(after).toBeGreaterThan(1.7); // perfect mixing of two batches = 2
    // cell types remain separable: nearest neighbours share the cell type
    const ex = knn(r.Z, 15); let same = 0; for (let i = 0; i < r.Z.length; i++) for (let t = 0; t < 15; t++) if (type[ex.idx[i * 15 + t]] === type[i]) same++;
    expect(same / (r.Z.length * 15)).toBeGreaterThan(0.97);
  });
  it('is a no-op for a single batch and leaves already mixed data nearly unchanged', () => {
    const { Z } = cohort(60, 3, 1, 0, 2); expect(harmony(Z, Z.map(() => 0)).Z).toEqual(Z);
    const m = cohort(100, 3, 2, 0, 6); const r = harmony(m.Z, m.batch, { seed: 1 }); let dev = 0; m.Z.forEach((z, i) => z.forEach((v, c) => { dev += Math.abs(v - r.Z[i][c]); })); expect(dev / (m.Z.length * 10)).toBeLessThan(0.5);
  });
  it('handles three batches', () => { const { Z, batch } = cohort(100, 3, 3, 2.5, 11); expect(batchMixing(harmony(Z, batch, { seed: 3 }).Z, batch, 30)).toBeGreaterThan(batchMixing(Z, batch, 30) + 0.4); });
});

describe('doublet scoring', () => {
  it('ranks simulated true doublets above singlets (AUC > 0.9) and calls roughly the right number', () => {
    const r = rng(14), d = 12, types = 4, centres = Array.from({ length: types }, () => Array.from({ length: d }, () => gauss(r) * 5));
    const singlet = () => { const t = Math.floor(r() * types); return { z: centres[t].map((c) => c + gauss(r) * 0.8), t }; };
    const obs: number[][] = [], isDbl: boolean[] = [];
    for (let i = 0; i < 1000; i++) { if (r() < 0.06) { const a = singlet(), b = singlet(); obs.push(a.z.map((v, j) => (v + b.z[j]) / 2)); isDbl.push(true); } else { obs.push(singlet().z); isDbl.push(false); } }
    const sim: number[][] = Array.from({ length: 2000 }, () => { const a = obs[Math.floor(r() * 1000)], b = obs[Math.floor(r() * 1000)]; return a.map((v, j) => (v + b[j]) / 2); });
    const res = doubletScores(obs, sim, 0.06, 3), A = auc(res.score.filter((_, i) => isDbl[i]), res.score.filter((_, i) => !isDbl[i]));
    expect(A).toBeGreaterThan(0.9); const trueN = isDbl.filter(Boolean).length; expect(res.predicted).toBeGreaterThan(trueN * 0.4); expect(res.predicted).toBeLessThan(trueN * 2.5);
  });
  it('threshold falls between the modes of a bimodal distribution and defaults to 0.25 otherwise', () => {
    const r = rng(1), s = [...Array.from({ length: 900 }, () => Math.abs(gauss(r)) * 0.05), ...Array.from({ length: 80 }, () => 0.6 + r() * 0.2)];
    const t = valleyThreshold(s); expect(t).toBeGreaterThan(0.12); expect(t).toBeLessThan(0.6);
    expect(valleyThreshold(Array.from({ length: 200 }, () => r() * 0.1))).toBe(0.25);
  });
});

import { parseDenseMatrix, runSingleCell, SC_DEFAULTS, syntheticPbmcLike } from './kernels';
describe('pipeline: doublets and batch integration end to end', () => {
  const build = () => {
    const d = syntheticPbmcLike(12, 900, 1500), m = parseDenseMatrix(d.counts), nG = m.genes.length, nC = m.cells.length, r = rng(5);
    const dense = Array.from({ length: nG }, () => new Float64Array(nC));
    for (let c = 0; c < nC; c++) for (let k = m.indptr[c]; k < m.indptr[c + 1]; k++) dense[m.indices[k]][c] = m.data[k];
    const f = Float64Array.from({ length: nG }, () => (r() < 0.4 ? Math.exp(gauss(r) * 0.6) : 1)); // batch-2 gene-specific scaling
    const batch = Array.from({ length: nC }, (_, c) => (c % 2 ? 'B2' : 'B1')); for (let c = 0; c < nC; c++) if (c % 2) for (let g = 0; g < nG; g++) dense[g][c] = Math.round(dense[g][c] * f[g]);
    const planted: boolean[] = new Array(nC).fill(false), cells = [...m.cells], cols: Float64Array[] = [];
    for (let t = 0; t < 54; t++) { const a = Math.floor(r() * nC), b = Math.floor(r() * nC); if (batch[a] !== batch[b]) continue; cols.push(Float64Array.from({ length: nG }, (_, g) => dense[g][a] + dense[g][b])); cells.push(`DBL${t}`); batch.push(batch[a]); planted.push(true); }
    const lines = ['gene,' + cells.join(','), ...m.genes.map((g, i) => `${g},${[...dense[i], ...cols.map((c) => c[i])].join(',')}`)];
    return { text: lines.join('\n'), batch, planted, n: cells.length };
  };
  it('scores planted doublets higher than singlets and mixes the two batches', () => {
    const b = build(), m = parseDenseMatrix(b.text);
    const res = runSingleCell(m, { ...SC_DEFAULTS, minGenes: 50, nHvg: 500, integrate: true, doublets: true, embedCap: 300 }, () => {}, b.batch);
    expect(res.doublet).toBeDefined(); expect(res.integration).toBeDefined();
    const idx = new Map(m.cells.map((c, i) => [c, i])), sc = res.cells.map((c) => res.doublet!.score[res.cells.indexOf(c)]);
    const pos = res.cells.map((c, i) => (c.startsWith('DBL') ? sc[i] : null)).filter((v): v is number => v !== null), neg = res.cells.map((c, i) => (c.startsWith('DBL') ? null : sc[i])).filter((v): v is number => v !== null);
    void idx; expect(pos.length).toBeGreaterThan(20); expect(auc(pos, neg)).toBeGreaterThan(0.8);
    expect(res.integration!.after).toBeGreaterThan(res.integration!.before);
  }, 120_000);
  it('uses approximate neighbours above the threshold and still finds the cell types', () => {
    const d = syntheticPbmcLike(12, 900, 1500), m = parseDenseMatrix(d.counts);
    const exact = runSingleCell(m, { ...SC_DEFAULTS, minGenes: 50, nHvg: 500, embedCap: 100, approxAbove: 100000 }, () => {}), approx = runSingleCell(m, { ...SC_DEFAULTS, minGenes: 50, nHvg: 500, embedCap: 100, approxAbove: 100 }, () => {});
    expect(exact.approxKnn).toBe(false); expect(approx.approxKnn).toBe(true);
    const purity = (r: typeof exact) => { const lab = new Map(r.annotation.map((a) => [a.cluster, a.label])); return r.kept.filter((c, i) => lab.get(r.clusters[i]) === d.truth[c]).length / r.kept.length; };
    expect(purity(approx)).toBeGreaterThan(purity(exact) - 0.05);
  }, 120_000);
});
