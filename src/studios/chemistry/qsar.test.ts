import { describe, expect, it } from 'vitest';
import { applicabilityDomain, auc, butina, classificationMetrics, crossValidate, makeFolds, pca2, predictForest, predictRidge, regressionMetrics, spearman, tanimoto, toPActivity, trainForest, trainRidge, yRandomization, knnPredict, type Data, type ModelSpec } from './qsar';

const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const bits = (on: number[], words = 4) => { const w = new Uint32Array(words); for (const b of on) w[b >> 5] |= 1 << (b & 31); return w; };
describe('metrics', () => {
  it('match closed forms', () => {
    expect(regressionMetrics([1, 2, 3, 4], [1, 2, 3, 4]).r2).toBe(1); expect(regressionMetrics([1, 2, 3], [2, 2, 2]).r2).toBeCloseTo(0, 10);
    expect(spearman([1, 2, 3, 4], [10, 20, 25, 100])).toBeCloseTo(1, 10);
    expect(auc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8])).toBeCloseTo(0.75, 10); // classic textbook example
    const c = classificationMetrics([1, 1, 0, 0], [0.9, 0.8, 0.2, 0.1]); expect(c.mcc).toBe(1); expect(c.balancedAccuracy).toBe(1);
  });
  it('tanimoto and activity transform', () => { expect(tanimoto(bits([1, 2, 3]), bits([2, 3, 4]))).toBeCloseTo(2 / 4, 10); expect(toPActivity(10)).toBeCloseTo(8, 10); });
});
describe('models learn a known function', () => {
  const r = rng(3), n = 300, p = 10, X = Array.from({ length: n }, () => Float32Array.from({ length: p }, () => r() * 10));
  const y = X.map((x) => 3 * x[0] - 2 * x[1] + (x[2] > 5 ? 4 : 0) + (r() - 0.5));
  const d: Data = { X, fp: X.map((x) => bits([...x].map((v, j) => (v > 5 ? j : -1)).filter((j) => j >= 0))), y };
  it('random forest: high CV R² and finds the informative features', () => {
    const spec: ModelSpec = { kind: 'rf', task: 'regression', nTrees: 60, k: 5 }, pred = crossValidate(spec, d, 5, 'random', 1), m = regressionMetrics(y, pred);
    expect(m.r2).toBeGreaterThan(0.8);
    const f = trainForest(X, y, 'regression', { nTrees: 60 }); const top = [...f.importance].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]); expect(top).toContain(0); expect(top).toContain(1);
    const oob = Array.from(f.oob!); expect(regressionMetrics(y.filter((_, i) => !Number.isNaN(oob[i])), oob.filter((v) => !Number.isNaN(v))).r2).toBeGreaterThan(0.75);
  });
  it('ridge captures the linear part', () => { const m = trainRidge(X, y, 0.1), p = predictRidge(m, X); expect(regressionMetrics(y, p).r2).toBeGreaterThan(0.85); });
  it('y-randomisation collapses performance', () => { const scr = yRandomization({ kind: 'rf', task: 'regression', nTrees: 30, k: 5 }, d, 5, 3); expect(Math.max(...scr)).toBeLessThan(0.15); });
  it('classification forest separates classes', () => {
    const yc = y.map((v) => (v > 8 ? 1 : 0)), f = trainForest(X, yc, 'classification', { nTrees: 60 }), prob = predictForest(f, X); expect(auc(yc, prob)).toBeGreaterThan(0.95);
  });
});
describe('chemistry helpers', () => {
  const fps = [bits([1, 2, 3, 4]), bits([1, 2, 3, 5]), bits([1, 2, 3, 4, 5]), bits([40, 41, 42, 43]), bits([40, 41, 42, 44])];
  it('Butina groups near neighbours', () => { const b = butina(fps, 0.5); expect(b.cluster[0]).toBe(b.cluster[1]); expect(b.cluster[3]).toBe(b.cluster[4]); expect(b.cluster[0]).not.toBe(b.cluster[3]); });
  it('cluster folds keep clusters together', () => { const f = makeFolds(5, 2, 'cluster', fps); expect(f[0]).toBe(f[1]); expect(f[3]).toBe(f[4]); });
  it('applicability domain, kNN, PCA', () => {
    const ad = applicabilityDomain(fps.slice(0, 3), [fps[4], bits([1, 2, 3, 4])], 2); expect(ad[0].maxSim).toBe(0); expect(ad[1].maxSim).toBe(1);
    expect(knnPredict(fps.slice(0, 3), [1, 2, 3], [bits([1, 2, 3, 4])], 1)[0]).toBeCloseTo(1, 6);
    const pc = pca2(fps); expect(pc).toHaveLength(5); expect(Math.hypot(pc[0].x - pc[3].x, pc[0].y - pc[3].y)).toBeGreaterThan(Math.hypot(pc[0].x - pc[1].x, pc[0].y - pc[1].y));
  });
});
