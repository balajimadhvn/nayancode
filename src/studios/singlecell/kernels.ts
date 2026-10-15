/** Single-cell + spatial kernels: sparse matrix, QC, HVG, randomized PCA, SNN graph, Louvain, t-SNE, markers, Moran's I. */
import { bh, jacobiEigen, tTwoSided } from '../expression/kernels';
import { umap } from './umap';

export interface Sparse { genes: string[]; cells: string[]; indptr: Uint32Array; indices: Uint32Array; data: Float32Array } // CSC: columns = cells

const rngf = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const gaussf = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

function fromTriplets(genes: string[], cells: string[], ti: number[], tj: number[], tv: number[]): Sparse {
  const nC = cells.length, counts = new Uint32Array(nC + 1);
  for (const j of tj) counts[j + 1]++;
  for (let j = 0; j < nC; j++) counts[j + 1] += counts[j];
  const indices = new Uint32Array(ti.length), data = new Float32Array(ti.length), fill = counts.slice(0, nC);
  for (let k = 0; k < ti.length; k++) { const p = fill[tj[k]]++; indices[p] = ti[k]; data[p] = tv[k]; }
  return { genes, cells, indptr: counts, indices, data };
}
export function parseDenseMatrix(text: string): Sparse {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) throw new Error('Matrix needs a header and at least one gene row.');
  const d = lines[0].includes('\t') ? '\t' : ',';
  const cells = lines[0].split(d).slice(1).map((x) => x.trim().replace(/^"|"$/g, ''));
  const genes: string[] = [], ti: number[] = [], tj: number[] = [], tv: number[] = [];
  for (let g = 1; g < lines.length; g++) {
    const f = lines[g].split(d); if (f.length !== cells.length + 1) throw new Error(`Line ${g + 1}: expected ${cells.length + 1} columns, found ${f.length}.`);
    genes.push(f[0].trim().replace(/^"|"$/g, ''));
    for (let c = 0; c < cells.length; c++) { const v = +f[c + 1]; if (!Number.isFinite(v) || v < 0) throw new Error(`Line ${g + 1}, cell ${cells[c]}: "${f[c + 1]}" is not a non-negative count.`); if (v) { ti.push(g - 1); tj.push(c); tv.push(v); } }
  }
  return fromTriplets(genes, cells, ti, tj, tv);
}
/** 10x Genomics MatrixMarket triplet (matrix.mtx genes×cells + features.tsv + barcodes.tsv). */
export function parseMtx(mtx: string, features: string, barcodes: string): Sparse {
  const genes = features.split(/\r?\n/).filter(Boolean).map((l) => { const f = l.split('\t'); return (f[1] || f[0]).trim(); });
  const cells = barcodes.split(/\r?\n/).filter(Boolean).map((l) => l.trim());
  const lines = mtx.split(/\r?\n/); let i = 0; while (i < lines.length && lines[i].startsWith('%')) i++;
  const [nG, nC] = lines[i++].trim().split(/\s+/).map(Number);
  if (nG !== genes.length || nC !== cells.length) throw new Error(`matrix.mtx is ${nG}×${nC} but features has ${genes.length} and barcodes has ${cells.length} entries. Is the matrix transposed?`);
  const ti: number[] = [], tj: number[] = [], tv: number[] = [];
  for (; i < lines.length; i++) { const l = lines[i]; if (!l) continue; const f = l.split(' '); ti.push(+f[0] - 1); tj.push(+f[1] - 1); tv.push(+f[2]); }
  return fromTriplets(genes, cells, ti, tj, tv);
}

export interface ScParams { minGenes: number; maxPctMito: number; minCellsPerGene: number; nHvg: number; nPcs: number; k: number; resolution: number; embedCap: number; seed: number; embedMethod: 'umap' | 'tsne' }
export const SC_DEFAULTS: ScParams = { minGenes: 200, maxPctMito: 20, minCellsPerGene: 3, nHvg: 2000, nPcs: 20, k: 15, resolution: 0.8, embedCap: 3000, seed: 1, embedMethod: 'umap' };

export interface ScResult {
  nCellsIn: number; nCellsKept: number; nGenesIn: number; nGenesKept: number; hasMito: boolean;
  cells: string[]; qc: { nCounts: number[]; nGenes: number[]; pctMito: number[] };
  hvg: string[]; varExplained: number[]; pcs: number[][]; clusters: number[]; nClusters: number;
  embedMethod: 'umap' | 'tsne'; embedIdx: number[]; embed: [number, number][]; kept: number[];
  markers: { cluster: number; gene: string; log2fc: number; pctIn: number; pctOut: number; t: number; fdr: number }[];
  annotation: { cluster: number; label: string; score: number; margin: number; n: number }[];
  expr: Map<string, Float32Array>; // log-normalised expression of every marker + panel gene (kept cells order)
}

export const MARKER_PANEL: Record<string, string[]> = {
  'T cells': ['CD3D', 'CD3E', 'IL7R', 'CCR7', 'LTB'], 'CD8 T cells': ['CD8A', 'CD8B', 'CCL5', 'GZMK'], 'NK cells': ['NKG7', 'GNLY', 'NCAM1', 'KLRD1'],
  'B cells': ['MS4A1', 'CD79A', 'CD79B', 'CD74'], 'CD14+ monocytes': ['CD14', 'LYZ', 'S100A9', 'S100A8'], 'FCGR3A+ monocytes': ['FCGR3A', 'MS4A7', 'LST1'],
  'Dendritic cells': ['FCER1A', 'CST3', 'CLEC10A'], Platelets: ['PPBP', 'PF4', 'GNG11'],
};

export function runSingleCell(m: Sparse, p: ScParams, progress: (f: number, note: string) => void): ScResult {
  const nG = m.genes.length, nC = m.cells.length;
  // --- QC ---
  progress(0.02, 'QC');
  const mito = new Uint8Array(nG); let hasMito = false; m.genes.forEach((g, i) => { if (/^mt-/i.test(g)) { mito[i] = 1; hasMito = true; } });
  const nCounts = new Float64Array(nC), nGenesDet = new Uint32Array(nC), pctMito = new Float64Array(nC);
  for (let c = 0; c < nC; c++) { let t = 0, mt = 0; for (let k = m.indptr[c]; k < m.indptr[c + 1]; k++) { t += m.data[k]; if (mito[m.indices[k]]) mt += m.data[k]; } nCounts[c] = t; nGenesDet[c] = m.indptr[c + 1] - m.indptr[c]; pctMito[c] = t ? (100 * mt) / t : 0; }
  const kept: number[] = []; for (let c = 0; c < nC; c++) if (nGenesDet[c] >= p.minGenes && pctMito[c] <= p.maxPctMito && nCounts[c] > 0) kept.push(c);
  if (kept.length < 30) throw new Error(`Only ${kept.length} cells pass QC (min genes ${p.minGenes}, max mito ${p.maxPctMito}%). Relax the thresholds.`);
  const n = kept.length;
  const cellsPer = new Uint32Array(nG); for (const c of kept) for (let k = m.indptr[c]; k < m.indptr[c + 1]; k++) cellsPer[m.indices[k]]++;
  // --- normalise (log1p CP10k), gene mean / var ---
  progress(0.08, 'Normalising');
  const sum = new Float64Array(nG), sum2 = new Float64Array(nG), norm = new Float32Array(m.data.length);
  for (const c of kept) { const f = 1e4 / nCounts[c]; for (let k = m.indptr[c]; k < m.indptr[c + 1]; k++) { const v = Math.log1p(m.data[k] * f); norm[k] = v; const g = m.indices[k]; sum[g] += v; sum2[g] += v * v; } }
  // --- HVG (Seurat-style: dispersion z-scored within mean bins) ---
  progress(0.12, 'Highly variable genes');
  const cand: { g: number; mean: number; disp: number }[] = [];
  for (let g = 0; g < nG; g++) { if (cellsPer[g] < p.minCellsPerGene) continue; const mean = sum[g] / n, v = Math.max(0, (sum2[g] - n * mean * mean) / (n - 1)); if (mean > 0 && v > 0) cand.push({ g, mean, disp: Math.log(v / mean) }); }
  const nBins = 20, sortedMeans = cand.map((c) => c.mean).sort((a, b) => a - b), edges = Array.from({ length: nBins - 1 }, (_, i) => sortedMeans[Math.floor(((i + 1) * sortedMeans.length) / nBins)]);
  const bin = (x: number) => { let b = 0; while (b < edges.length && x > edges[b]) b++; return b; };
  const bs = Array.from({ length: nBins }, () => ({ s: 0, s2: 0, n: 0 })); for (const c of cand) { const b = bs[bin(c.mean)]; b.s += c.disp; b.s2 += c.disp ** 2; b.n++; }
  const z = cand.map((c) => { const b = bs[bin(c.mean)], mu = b.s / b.n, sd = Math.sqrt(Math.max(1e-12, b.s2 / b.n - mu * mu)); return { g: c.g, z: b.n > 1 ? (c.disp - mu) / sd : 0 }; }).sort((a, b) => b.z - a.z);
  const nH = Math.min(p.nHvg, Math.max(50, Math.floor(cand.length * 0.5)), cand.length), hvg = z.slice(0, nH).map((x) => x.g);
  // --- scale (dense cells × hvg) ---
  progress(0.18, 'Scaling');
  const gi = new Int32Array(nG).fill(-1); hvg.forEach((g, i) => (gi[g] = i));
  const X = new Float32Array(n * nH);
  kept.forEach((c, r) => { for (let k = m.indptr[c]; k < m.indptr[c + 1]; k++) { const j = gi[m.indices[k]]; if (j >= 0) X[r * nH + j] = norm[k]; } });
  for (let j = 0; j < nH; j++) { const g = hvg[j], mean = sum[g] / n, sd = Math.sqrt(Math.max(1e-12, (sum2[g] - n * mean * mean) / (n - 1))); for (let r = 0; r < n; r++) { const v = (X[r * nH + j] - mean) / sd; X[r * nH + j] = Math.max(-10, Math.min(10, v)); } }
  // --- randomized PCA ---
  progress(0.25, 'PCA');
  const kPc = Math.min(p.nPcs, nH - 1, n - 1), l = Math.min(kPc + 10, nH, n), rnd = rngf(p.seed);
  const mulXA = (A: Float64Array[], ncol: number): Float64Array[] => Array.from({ length: ncol }, (_, c) => { const out = new Float64Array(n); const a = A[c]; for (let r = 0; r < n; r++) { let s = 0; const off = r * nH; for (let j = 0; j < nH; j++) s += X[off + j] * a[j]; out[r] = s; } return out; }); // columns of X·A
  const mulXtY = (Y: Float64Array[]): Float64Array[] => Y.map((y) => { const out = new Float64Array(nH); for (let r = 0; r < n; r++) { const yr = y[r], off = r * nH; if (yr) for (let j = 0; j < nH; j++) out[j] += X[off + j] * yr; } return out; });
  const orth = (cols: Float64Array[]) => { for (let a = 0; a < cols.length; a++) { for (let b = 0; b < a; b++) { let d = 0; for (let i = 0; i < cols[a].length; i++) d += cols[a][i] * cols[b][i]; for (let i = 0; i < cols[a].length; i++) cols[a][i] -= d * cols[b][i]; } let nr = 0; for (let i = 0; i < cols[a].length; i++) nr += cols[a][i] ** 2; nr = Math.sqrt(nr) || 1; for (let i = 0; i < cols[a].length; i++) cols[a][i] /= nr; } return cols; };
  let Q = orth(mulXA(Array.from({ length: l }, () => Float64Array.from({ length: nH }, () => gaussf(rnd))), l));
  for (let it = 0; it < 3; it++) Q = orth(mulXA(orth(mulXtY(Q)), l));
  const Bt = mulXtY(Q); // columns: Xᵀ q_i (length nH) -> B = Qᵀ X has rows = Bt[i]
  const M = Array.from({ length: l }, () => new Float64Array(l)); for (let a = 0; a < l; a++) for (let b = a; b < l; b++) { let s = 0; for (let j = 0; j < nH; j++) s += Bt[a][j] * Bt[b][j]; M[a][b] = M[b][a] = s; }
  const { values, vectors } = jacobiEigen(M); const ord = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, kPc);
  const pcs: number[][] = Array.from({ length: n }, () => new Array(kPc).fill(0));
  ord.forEach(([lam, idx], c) => { const sigma = Math.sqrt(Math.max(0, lam)); for (let r = 0; r < n; r++) { let s = 0; for (let a = 0; a < l; a++) s += Q[a][r] * vectors[a][idx]; pcs[r][c] = s * sigma; } });
  const varExplained = ord.map(([lam]) => Math.max(0, lam) / (n - 1) / nH);
  // --- kNN + SNN ---
  progress(0.4, 'Neighbour graph');
  const K = Math.min(p.k, n - 1), nn: Int32Array[] = [];
  for (let i = 0; i < n; i++) { const d = new Float64Array(n); const pi = pcs[i]; for (let j = 0; j < n; j++) { let s = 0; const pj = pcs[j]; for (let c = 0; c < kPc; c++) { const t = pi[c] - pj[c]; s += t * t; } d[j] = s; } d[i] = Infinity; const idx = Int32Array.from({ length: n }, (_, j) => j); const part = Array.from(idx).sort((a, b) => d[a] - d[b]).slice(0, K); nn.push(Int32Array.from(part)); if (i % 200 === 0) progress(0.4 + 0.1 * (i / n), 'Neighbour graph'); }
  const sets = nn.map((a, i) => new Set([i, ...a])); const edges2 = new Map<number, number>(); const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (let i = 0; i < n; i++) for (const j of nn[i]) { const key = i < j ? i * n + j : j * n + i; if (edges2.has(key)) continue; let inter = 0; for (const x of sets[i]) if (sets[j].has(x)) inter++; const w = inter / (sets[i].size + sets[j].size - inter); if (w >= 1 / 15) { edges2.set(key, w); adj[i].set(j, w); adj[j].set(i, w); } }
  // --- Louvain ---
  progress(0.52, 'Louvain clustering');
  const clusters = louvain(adj, p.resolution, p.seed);
  const nClusters = Math.max(...clusters) + 1;
  // --- t-SNE ---
  const em = p.embedMethod === 'tsne' ? 't-SNE' : 'UMAP'; progress(0.58, em);
  const embedIdx = n <= p.embedCap ? Array.from({ length: n }, (_, i) => i) : (() => { const r = rngf(p.seed + 1), a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, p.embedCap).sort((x, y) => x - y); })();
  const embIn = embedIdx.map((i) => pcs[i].slice(0, Math.min(kPc, 20)));
  const embed = p.embedMethod === 'tsne' ? tsne(embIn, 30, p.seed, (f) => progress(0.58 + 0.3 * f, em)) : umap(embIn, { nNeighbors: p.k, seed: p.seed }, (f) => progress(0.58 + 0.3 * f, em));
  // --- markers ---
  progress(0.9, 'Markers');
  const cs = Array.from({ length: nClusters }, () => ({ n: 0, sum: new Float64Array(nG), sum2: new Float64Array(nG), nnz: new Uint32Array(nG) }));
  kept.forEach((c, r) => { const cl = cs[clusters[r]]; cl.n++; for (let k = m.indptr[c]; k < m.indptr[c + 1]; k++) { const g = m.indices[k], v = norm[k]; cl.sum[g] += v; cl.sum2[g] += v * v; cl.nnz[g]++; } });
  const markers: ScResult['markers'] = [];
  for (let c = 0; c < nClusters; c++) {
    const a = cs[c], nIn = a.n, nOut = n - nIn; if (nIn < 3 || nOut < 3) continue;
    const rows: { g: number; log2fc: number; pIn: number; pOut: number; t: number; p: number }[] = [];
    for (let g = 0; g < nG; g++) { if (cellsPer[g] < p.minCellsPerGene) continue; const sIn = a.sum[g], sOut = sum[g] - sIn, mIn = sIn / nIn, mOut = sOut / nOut; const vIn = Math.max(0, (a.sum2[g] - nIn * mIn * mIn) / (nIn - 1)), vOut = Math.max(0, (sum2[g] - a.sum2[g] - nOut * mOut * mOut) / (nOut - 1)); const se = Math.sqrt(vIn / nIn + vOut / nOut); if (!se) continue; const t = (mIn - mOut) / se; const df = (vIn / nIn + vOut / nOut) ** 2 / ((vIn / nIn) ** 2 / (nIn - 1) + (vOut / nOut) ** 2 / (nOut - 1)); rows.push({ g, log2fc: Math.log2((Math.expm1(mIn) + 1) / (Math.expm1(mOut) + 1)), pIn: a.nnz[g] / nIn, pOut: (cellsPer[g] - a.nnz[g]) / nOut, t, p: tTwoSided(t, df) }); }
    const fdr = bh(rows.map((r) => r.p)); rows.forEach((r, i) => { (r as { fdr?: number }).fdr = fdr[i]; });
    rows.filter((r) => r.t > 0 && r.log2fc > 0.25).sort((x, y) => y.t - x.t).slice(0, 10).forEach((r) => markers.push({ cluster: c, gene: m.genes[r.g], log2fc: r.log2fc, pctIn: r.pIn, pctOut: r.pOut, t: r.t, fdr: (r as unknown as { fdr: number }).fdr }));
  }
  // --- annotation by marker panel ---
  const gIdx = new Map(m.genes.map((g, i) => [g.toUpperCase(), i])), overall = (g: number) => sum[g] / n;
  const annotation = Array.from({ length: nClusters }, (_, c) => {
    const scores = Object.entries(MARKER_PANEL).map(([label, gs]) => { const ids = gs.map((x) => gIdx.get(x)).filter((x): x is number => x !== undefined); if (!ids.length) return { label, s: -Infinity }; return { label, s: ids.reduce((acc, g) => acc + (cs[c].sum[g] / Math.max(1, cs[c].n) - overall(g)), 0) / ids.length }; }).sort((a, b) => b.s - a.s);
    return { cluster: c, label: scores[0].s > 0.1 ? scores[0].label : 'Unassigned', score: scores[0].s, margin: scores[0].s - (scores[1]?.s ?? 0), n: cs[c].n };
  });
  // --- per-gene expression for plotting (markers + panel genes + top HVGs) ---
  const want = new Set<number>(); for (const mk of markers) { const i = gIdx.get(mk.gene.toUpperCase()); if (i !== undefined) want.add(i); } for (const gs of Object.values(MARKER_PANEL)) for (const g of gs) { const i = gIdx.get(g); if (i !== undefined) want.add(i); } hvg.slice(0, 30).forEach((g) => want.add(g));
  const expr = new Map<string, Float32Array>(); for (const g of want) expr.set(m.genes[g], new Float32Array(n));
  const gw = new Map([...want].map((g) => [g, m.genes[g]])); kept.forEach((c, r) => { for (let k = m.indptr[c]; k < m.indptr[c + 1]; k++) { const nm = gw.get(m.indices[k]); if (nm) expr.get(nm)![r] = norm[k]; } });
  progress(1, 'Done');
  return { embedMethod: p.embedMethod, nCellsIn: nC, nCellsKept: n, nGenesIn: nG, nGenesKept: cand.length, hasMito, cells: kept.map((c) => m.cells[c]), qc: { nCounts: Array.from(nCounts), nGenes: Array.from(nGenesDet), pctMito: Array.from(pctMito) }, hvg: hvg.map((g) => m.genes[g]), varExplained, pcs, clusters, nClusters, embedIdx, embed, kept, markers, annotation, expr };
}

// ---------------- Louvain (Blondel et al. 2008) ----------------
export function louvain(adj0: Map<number, number>[], resolution = 1, seed = 1): number[] {
  let adj = adj0, n = adj.length; let membership = Array.from({ length: n }, (_, i) => i); const rnd = rngf(seed);
  for (let level = 0; level < 20; level++) {
    const deg = adj.map((m) => { let s = 0; for (const w of m.values()) s += w; return s; }), m2 = deg.reduce((a, b) => a + b, 0); if (!m2) break;
    const comm = Array.from({ length: adj.length }, (_, i) => i), tot = [...deg]; let moved = true, anyMove = false, guard = 0;
    const order = Array.from({ length: adj.length }, (_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    while (moved && guard++ < 30) {
      moved = false;
      for (const i of order) {
        const ci = comm[i], links = new Map<number, number>(); for (const [j, w] of adj[i]) if (j !== i) links.set(comm[j], (links.get(comm[j]) ?? 0) + w);
        tot[ci] -= deg[i]; let best = ci, bestGain = (links.get(ci) ?? 0) - (resolution * tot[ci] * deg[i]) / m2;
        for (const [c, w] of links) { const gain = w - (resolution * tot[c] * deg[i]) / m2; if (gain > bestGain + 1e-12) { bestGain = gain; best = c; } }
        tot[best] += deg[i]; if (best !== ci) { comm[i] = best; moved = true; anyMove = true; }
      }
    }
    if (!anyMove) break;
    const ids = new Map<number, number>(); comm.forEach((c) => { if (!ids.has(c)) ids.set(c, ids.size); });
    membership = membership.map((c) => ids.get(comm[c])!);
    const next: Map<number, number>[] = Array.from({ length: ids.size }, () => new Map());
    adj.forEach((nb, i) => { const ci = ids.get(comm[i])!; for (const [j, w] of nb) { const cj = ids.get(comm[j])!; next[ci].set(cj, (next[ci].get(cj) ?? 0) + w); } });
    if (ids.size === adj.length) break; adj = next; n = adj.length;
  }
  const sizes = new Map<number, number>(); membership.forEach((c) => sizes.set(c, (sizes.get(c) ?? 0) + 1));
  const rank = new Map([...sizes.entries()].sort((a, b) => b[1] - a[1]).map(([c], i) => [c, i])); return membership.map((c) => rank.get(c)!);
}

// ---------------- t-SNE (van der Maaten & Hinton 2008, exact) ----------------
export function tsne(X: number[][], perplexity = 30, seed = 1, progress?: (f: number) => void, iters = 500): [number, number][] {
  const n = X.length, d = X[0]?.length ?? 0; if (n < 4) return X.map((_, i) => [i, 0]);
  const rnd = rngf(seed), perp = Math.min(perplexity, (n - 1) / 3), logU = Math.log(perp);
  const D = new Float64Array(n * n); for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { let s = 0; for (let c = 0; c < d; c++) { const t = X[i][c] - X[j][c]; s += t * t; } D[i * n + j] = D[j * n + i] = s; }
  const P = new Float64Array(n * n);
  for (let i = 0; i < n; i++) { let beta = 1, lo = -Infinity, hi = Infinity; const row = new Float64Array(n);
    for (let it = 0; it < 60; it++) { let sp = 0, h = 0; for (let j = 0; j < n; j++) { if (j === i) { row[j] = 0; continue; } const v = Math.exp(-D[i * n + j] * beta); row[j] = v; sp += v; } sp = Math.max(sp, 1e-300); let dh = 0; for (let j = 0; j < n; j++) if (j !== i) dh += D[i * n + j] * row[j]; h = Math.log(sp) + (beta * dh) / sp; const diff = h - logU; if (Math.abs(diff) < 1e-5) break; if (diff > 0) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; } else { hi = beta; beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2; } }
    let sp = 0; for (let j = 0; j < n; j++) sp += row[j]; for (let j = 0; j < n; j++) P[i * n + j] = row[j] / (sp || 1); }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const v = Math.max((P[i * n + j] + P[j * n + i]) / (2 * n), 1e-12); P[i * n + j] = P[j * n + i] = v; }
  const Y = new Float64Array(n * 2), dY = new Float64Array(n * 2), gains = new Float64Array(n * 2).fill(1), vel = new Float64Array(n * 2);
  // PCA-like init: first two input dims scaled small, plus noise
  let sd0 = 0, sd1 = 0; for (let i = 0; i < n; i++) { sd0 += X[i][0] ** 2; sd1 += (X[i][1] ?? 0) ** 2; } sd0 = Math.sqrt(sd0 / n) || 1; sd1 = Math.sqrt(sd1 / n) || 1;
  for (let i = 0; i < n; i++) { Y[2 * i] = (X[i][0] / sd0) * 1e-2 + gaussf(rnd) * 1e-4; Y[2 * i + 1] = ((X[i][1] ?? 0) / sd1) * 1e-2 + gaussf(rnd) * 1e-4; }
  const Qn = new Float64Array(n * n), lr = Math.max(50, n / 12);
  for (let it = 0; it < iters; it++) {
    const ex = it < 250 ? 12 : 1, mom = it < 250 ? 0.5 : 0.8; let sumQ = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const dx = Y[2 * i] - Y[2 * j], dy = Y[2 * i + 1] - Y[2 * j + 1], q = 1 / (1 + dx * dx + dy * dy); Qn[i * n + j] = Qn[j * n + i] = q; sumQ += 2 * q; }
    dY.fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) continue; const q = Qn[i * n + j], mult = (ex * P[i * n + j] - q / sumQ) * q; dY[2 * i] += mult * (Y[2 * i] - Y[2 * j]); dY[2 * i + 1] += mult * (Y[2 * i + 1] - Y[2 * j + 1]); }
    for (let k = 0; k < 2 * n; k++) { const g = 4 * dY[k]; gains[k] = Math.sign(g) !== Math.sign(vel[k]) ? gains[k] + 0.2 : Math.max(0.01, gains[k] * 0.8); vel[k] = mom * vel[k] - lr * gains[k] * g; Y[k] += vel[k]; }
    let m0 = 0, m1 = 0; for (let i = 0; i < n; i++) { m0 += Y[2 * i]; m1 += Y[2 * i + 1]; } m0 /= n; m1 /= n; for (let i = 0; i < n; i++) { Y[2 * i] -= m0; Y[2 * i + 1] -= m1; }
    if (progress && it % 25 === 0) progress(it / iters);
  }
  return Array.from({ length: n }, (_, i) => [Y[2 * i], Y[2 * i + 1]] as [number, number]);
}

// ---------------- Spatial: Moran's I on a kNN graph ----------------
export function morans(coords: [number, number][], genes: { name: string; v: Float32Array }[], k = 6, perms = 199, seed = 3, permTop = 20) {
  const n = coords.length, nb: number[][] = [];
  for (let i = 0; i < n; i++) { const d = coords.map((c, j) => (j === i ? Infinity : (c[0] - coords[i][0]) ** 2 + (c[1] - coords[i][1]) ** 2)); nb.push(Array.from({ length: n }, (_, j) => j).sort((a, b) => d[a] - d[b]).slice(0, k)); }
  const I = (x: Float32Array | Float64Array) => { let mean = 0; for (let i = 0; i < n; i++) mean += x[i]; mean /= n; let num = 0, den = 0, W = 0; for (let i = 0; i < n; i++) { const di = x[i] - mean; den += di * di; for (const j of nb[i]) { num += di * (x[j] - mean); W++; } } return den ? (n / W) * (num / den) : 0; };
  const rows = genes.map((g) => ({ gene: g.name, I: I(g.v), p: NaN })).sort((a, b) => b.I - a.I), rnd = rngf(seed);
  for (const r of rows.slice(0, permTop)) { const v = Float64Array.from(genes.find((g) => g.name === r.gene)!.v); let ge = 0; for (let t = 0; t < perms; t++) { for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = v[i]; v[i] = v[j]; v[j] = tmp; } if (I(v) >= r.I) ge++; } r.p = (ge + 1) / (perms + 1); }
  return rows;
}

// ---------------- demo (synthetic) ----------------
export function syntheticPbmcLike(seed = 12, nCells = 900, nGenes = 1500): { counts: string; coords: string; truth: string[] } {
  const r = rngf(seed), types = ['T cells', 'B cells', 'NK cells', 'CD14+ monocytes'], mk = [['CD3D', 'CD3E', 'IL7R', 'LTB'], ['MS4A1', 'CD79A', 'CD79B', 'CD74'], ['NKG7', 'GNLY', 'NCAM1', 'KLRD1'], ['CD14', 'LYZ', 'S100A9', 'S100A8']];
  const genes: string[] = [...mk.flat(), 'MT-CO1', 'MT-ND1', 'MT-CYB']; for (let i = genes.length; i < nGenes; i++) genes.push(`GENE${String(i).padStart(4, '0')}`);
  const base = genes.map(() => Math.exp(-2.2 + 2.2 * r())), cells: string[] = [], truth: string[] = [], rows = genes.map(() => [] as number[]), xy: string[] = ['barcode,x,y'];
  const centers = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  const pois = (l: number) => { if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * gaussf(r))); const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };
  for (let c = 0; c < nCells; c++) {
    const t = Math.floor(r() * 4), depth = 0.5 + r() * 1.2, name = `CELL${String(c + 1).padStart(4, '0')}`; cells.push(name); truth.push(types[t]);
    xy.push(`${name},${(centers[t][0] + gaussf(r) * 0.11).toFixed(4)},${(centers[t][1] + gaussf(r) * 0.11).toFixed(4)}`);
    genes.forEach((g, gi) => { let mu = base[gi] * depth; const mi = mk.findIndex((a) => a.includes(g)); if (mi >= 0) mu = mi === t ? 6 * depth : 0.08 * depth; if (g.startsWith('MT-')) mu = 2 * depth; rows[gi].push(pois(mu)); });
  }
  return { counts: 'gene,' + cells.join(',') + '\n' + genes.map((g, i) => g + ',' + rows[i].join(',')).join('\n'), coords: xy.join('\n'), truth };
}
