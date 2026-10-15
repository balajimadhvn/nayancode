import { describe, expect, it } from 'vitest';
import { louvain, morans, parseDenseMatrix, parseMtx, runSingleCell, SC_DEFAULTS, syntheticPbmcLike, tsne } from './kernels';

const ari = (a: (string | number)[], b: (string | number)[]) => {
  const c2 = (x: number) => (x * (x - 1)) / 2, tab = new Map<string, number>(), ra = new Map<string | number, number>(), rb = new Map<string | number, number>();
  a.forEach((x, i) => { const k = `${x}|${b[i]}`; tab.set(k, (tab.get(k) ?? 0) + 1); ra.set(x, (ra.get(x) ?? 0) + 1); rb.set(b[i], (rb.get(b[i]) ?? 0) + 1); });
  const n = a.length, sij = [...tab.values()].reduce((s, v) => s + c2(v), 0), sa = [...ra.values()].reduce((s, v) => s + c2(v), 0), sb = [...rb.values()].reduce((s, v) => s + c2(v), 0), exp = (sa * sb) / c2(n);
  return (sij - exp) / ((sa + sb) / 2 - exp);
};

describe('matrix parsing', () => {
  it('parses dense CSV into CSC', () => { const m = parseDenseMatrix('g,c1,c2\nA,1,0\nB,0,3'); expect(m.genes).toEqual(['A', 'B']); expect(Array.from(m.indptr)).toEqual([0, 1, 2]); expect(Array.from(m.data)).toEqual([1, 3]); });
  it('parses 10x MatrixMarket and detects transposition', () => {
    const mtx = '%%MatrixMarket matrix coordinate integer general\n2 3 3\n1 1 5\n2 2 1\n1 3 2\n';
    const m = parseMtx(mtx, 'g1\tA\ng2\tB', 'b1\nb2\nb3'); expect(m.cells).toHaveLength(3); expect(m.indptr[3]).toBe(3);
    expect(() => parseMtx(mtx, 'g1\tA\ng2\tB\ng3\tC', 'b1\nb2\nb3')).toThrow(/transposed/);
  });
});
describe('algorithms', () => {
  it('Louvain finds planted communities', () => {
    const n = 60, adj = Array.from({ length: n }, () => new Map<number, number>());
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const same = Math.floor(i / 20) === Math.floor(j / 20); if (same ? (i * 7 + j * 13) % 3 !== 0 : (i * 5 + j * 11) % 40 === 0) { adj[i].set(j, 1); adj[j].set(i, 1); } }
    const c = louvain(adj, 1, 1); expect(ari(c, Array.from({ length: n }, (_, i) => Math.floor(i / 20)))).toBeGreaterThan(0.9);
  });
  it('t-SNE keeps separated blobs separated', () => {
    let s = 3; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const X = Array.from({ length: 120 }, (_, i) => { const c = Math.floor(i / 40); return [c * 10 + r(), c * -8 + r(), r()]; });
    const Y = tsne(X, 15, 1, undefined, 500); let pure = 0, tot = 0;
    for (let i = 0; i < Y.length; i++) { const nbr = Y.map((p, j) => [Math.hypot(p[0] - Y[i][0], p[1] - Y[i][1]), j] as const).filter(([, j]) => j !== i).sort((a, b) => a[0] - b[0]).slice(0, 10); for (const [, j] of nbr) { tot++; if (Math.floor(j / 40) === Math.floor(i / 40)) pure++; } }
    expect(pure / tot).toBeGreaterThan(0.97); // 10-NN purity in the embedding
  });
});
describe('end to end on synthetic PBMC-like data', () => {
  const demo = syntheticPbmcLike(12, 600, 800), m = parseDenseMatrix(demo.counts);
  const res = runSingleCell(m, { ...SC_DEFAULTS, minGenes: 50, nHvg: 400, embedCap: 600 }, () => {});
  it('QC keeps (almost) all cells and finds mito genes', () => { expect(res.hasMito).toBe(true); expect(res.nCellsKept).toBeGreaterThan(560); });
  it('recovers the four cell types (ARI > 0.9)', () => { const truth = res.kept.map((c) => demo.truth[c]); expect(ari(res.clusters, truth)).toBeGreaterThan(0.9); expect(res.nClusters).toBeGreaterThanOrEqual(4); });
  it('annotates clusters by marker panel correctly', () => {
    const lab = new Map(res.annotation.map((a) => [a.cluster, a.label])); const ok = res.kept.filter((c, i) => lab.get(res.clusters[i]) === demo.truth[c]).length; expect(ok / res.kept.length).toBeGreaterThan(0.9);
  });
  it('top markers include planted genes', () => { const g = new Set(res.markers.map((x) => x.gene)); expect(['CD3D', 'MS4A1', 'NKG7', 'LYZ'].filter((x) => g.has(x)).length).toBeGreaterThanOrEqual(3); });
  it('Moran I ranks spatially structured markers above noise genes', () => {
    const coords = demo.coords.split('\n').slice(1).map((l) => l.split(',').slice(1).map(Number) as [number, number]); const keptCoords = res.kept.map((c) => coords[c]);
    const genes = ['CD3D', 'MS4A1', 'NKG7', 'GENE0100', 'GENE0200', 'GENE0300'].map((n) => ({ name: n, v: res.expr.get(n) ?? new Float32Array(res.nCellsKept) })).filter((g) => res.expr.has(g.name));
    const rows = morans(keptCoords, genes, 6, 49, 3, 3); expect(rows[0].gene).toMatch(/CD3D|MS4A1|NKG7/); expect(rows[0].I).toBeGreaterThan(0.3); expect(rows[0].p).toBeLessThan(0.05);
  });
});
