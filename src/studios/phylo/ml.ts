/** Maximum-likelihood tree inference. Clean-room implementation (no PhyML / IQ-TREE / RAxML / FastTree code):
 *  Felsenstein's pruning algorithm (1981), JC69 / K80 / HKY85 / F81-type models for DNA and an equal-rates "Poisson" model for protein,
 *  optional discrete-Γ rate heterogeneity (Yang 1994, 4 categories), maximum-likelihood κ and α, per-edge golden-section
 *  branch optimisation, NNI hill-climbing, and site-pattern compression.
 *  Intended for ≲ 150 taxa and ≲ 5,000 sites in the browser; bootstrap replicates run in parallel workers. */
import { distanceMatrix, lcg, nj, resampleColumns, supportFromTrees, type TreeNode } from './kernels';

export type MlModel = 'JC69' | 'K80' | 'HKY85' | 'Poisson';
export interface MlOptions { model: MlModel; gamma: boolean; alpha?: number; kappa?: number; maxRounds?: number; fixedAlpha?: boolean }
const DNA = 'ACGT';
interface Prep { n: number; L: number; S: number; codes: Uint8Array[]; w: Float64Array; freqs: number[]; kappa: number; alpha: number; cats: number; rates: number[]; model: MlModel } // L = unique site patterns, w = their counts

// ---- Γ rate categories (mean of each quantile bin of Γ(α, α)) ----
function lgammaF(x: number): number { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const cj of c) s += cj / ++y; return -t + Math.log((2.5066282746310005 * s) / x); }
function gammaP(a: number, x: number): number { if (x <= 0) return 0; if (x < a + 1) { let sum = 1 / a, del = sum, ap = a; for (let i = 0; i < 300; i++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; } return sum * Math.exp(-x + a * Math.log(x) - lgammaF(a)); } let b = x + 1 - a, c = 1e300, d = 1 / b, h = d; for (let i = 1; i < 300; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; } return 1 - Math.exp(-x + a * Math.log(x) - lgammaF(a)) * h; }
function gammaQuantile(p: number, a: number): number { let lo = 0, hi = 1; while (gammaP(a, hi) < p) hi *= 2; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (gammaP(a, mid) < p) lo = mid; else hi = mid; } return (lo + hi) / 2; }
export function gammaRates(alpha: number, k = 4): number[] {
  // mean rate in category i = k * [P(α+1, α*q_{i+1}) − P(α+1, α*q_i)] with q the Γ(α, α)-quantiles → standard discrete-Γ (mean) approximation
  const cuts = Array.from({ length: k + 1 }, (_, i) => (i === 0 ? 0 : i === k ? Infinity : gammaQuantile(i / k, alpha) / alpha)), r: number[] = [];
  for (let i = 0; i < k; i++) { const lo = cuts[i] === 0 ? 0 : gammaP(alpha + 1, alpha * cuts[i]), hi = cuts[i + 1] === Infinity ? 1 : gammaP(alpha + 1, alpha * cuts[i + 1]); r.push(k * (hi - lo)); }
  const m = r.reduce((a, b) => a + b, 0) / k; return r.map((x) => x / m);
}

// ---- transition probabilities ----
function pmatrix(p: Prep, t: number, rate: number, out: Float64Array) {
  const S = p.S, tt = Math.max(t * rate, 1e-8);
  if (p.model === 'JC69' || p.model === 'Poisson') { const e = Math.exp((-S / (S - 1)) * tt), same = 1 / S + ((S - 1) / S) * e, diff = (1 - same) / (S - 1); for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) out[i * S + j] = i === j ? same : diff; return; }
  const [pA, pC, pG, pT] = p.freqs, pR = pA + pG, pY = pC + pT, f = p.freqs, k = p.model === 'K80' ? 1 : 1, kappa = p.kappa; void k;
  // HKY85 / K80 closed form (Hasegawa et al. 1985). For K80, base frequencies are 0.25.
  const fr = p.model === 'K80' ? [0.25, 0.25, 0.25, 0.25] : f, R = fr[0] + fr[2], Y = fr[1] + fr[3], beta = 1 / (2 * (R * Y + kappa * (fr[0] * fr[2] + fr[1] * fr[3]))), grp = [R, Y, R, Y], cls = [0, 1, 0, 1]; /* purine / pyrimidine class of A,C,G,T */ void pR; void pY; void pA; void pC; void pG; void pT; // A,C,G,T → purine,pyrimidine,purine,pyrimidine
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const e1 = Math.exp(-beta * tt), e2 = Math.exp(-beta * tt * (1 + (grp[i] * (kappa - 1)))); if (i === j) out[i * 4 + j] = fr[j] + (fr[j] * (1 / grp[j] - 1)) * e1 + ((grp[j] - fr[j]) / grp[j]) * e2; else if (cls[i] === cls[j]) out[i * 4 + j] = fr[j] + (fr[j] * (1 / grp[j] - 1)) * e1 - (fr[j] / grp[j]) * e2; else out[i * 4 + j] = fr[j] * (1 - e1); }
}

// ---- tree as arrays ----
interface Node { id: number; left: number; right: number; parent: number; len: number; leaf: number } // leaf index or -1
interface MTree { nodes: Node[]; root: number }
function fromNewickTree(t: TreeNode, names: string[]): MTree {
  const idx = new Map(names.map((nm, i) => [nm, i])), nodes: Node[] = [];
  const bin = (x: TreeNode): number => { // binarise multifurcations with zero-length internal edges
    if (!x.children.length) { nodes.push({ id: nodes.length, left: -1, right: -1, parent: -1, len: Math.max(x.length, 1e-6), leaf: idx.get(x.name!)! }); return nodes.length - 1; }
    let ch = x.children.map(bin); while (ch.length > 2) { const a = ch.shift()!, b = ch.shift()!; nodes.push({ id: nodes.length, left: a, right: b, parent: -1, len: 1e-6, leaf: -1 }); nodes[a].parent = nodes.length - 1; nodes[b].parent = nodes.length - 1; ch.unshift(nodes.length - 1); }
    nodes.push({ id: nodes.length, left: ch[0], right: ch[1], parent: -1, len: Math.max(x.length, 1e-6), leaf: -1 }); const me = nodes.length - 1; nodes[ch[0]].parent = me; nodes[ch[1]].parent = me; return me;
  };
  let root = bin(t); // if the root has 3 children, `bin` made a binary root already
  return { nodes, root };
}
function toTree(t: MTree, names: string[]): TreeNode { const rec = (i: number): TreeNode => { const n = t.nodes[i]; return n.leaf >= 0 ? { name: names[n.leaf], length: n.len, children: [] } : { length: n.len, children: [rec(n.left), rec(n.right)] }; }; const r = rec(t.root); r.length = 0; return r; }

function prepare(aln: string[], o: MlOptions): Prep {
  const n = aln.length, L0 = aln[0].length, protein = o.model === 'Poisson', alpha = 'ARNDCQEGHILKMFPSTWYV', S = protein ? 20 : 4, full = aln.map((r) => Uint8Array.from(r, (c) => { const k = (protein ? alpha : DNA).indexOf(c.toUpperCase()); return k < 0 ? 255 : k; }));
  // Empirical state frequencies (as IQ-TREE's +F); a state never observed gets half a count so it stays possible.
  const counts = new Array(S).fill(0); for (const r of full) for (const c of r) if (c < S) counts[c]++; for (let k = 0; k < S; k++) if (!counts[k]) counts[k] = 0.5; const tot = counts.reduce((a, b) => a + b, 0), freqs = counts.map((c) => c / tot);
  // Identical alignment columns share one likelihood computation (weighted by their count).
  const idx = new Map<string, number>(), cols: number[] = [], w: number[] = [];
  for (let j = 0; j < L0; j++) { let key = ''; for (let i = 0; i < n; i++) key += String.fromCharCode(full[i][j]); const k = idx.get(key); if (k === undefined) { idx.set(key, cols.length); cols.push(j); w.push(1); } else w[k]++; }
  const codes = full.map((r) => Uint8Array.from(cols, (j) => r[j]));
  return { n, L: cols.length, S, codes, w: Float64Array.from(w), freqs: o.model === 'HKY85' ? freqs : new Array(S).fill(1 / S), kappa: o.kappa ?? 2, alpha: o.alpha ?? 1, cats: o.gamma ? 4 : 1, rates: o.gamma ? gammaRates(o.alpha ?? 1) : [1], model: o.model };
}
interface Down { order: number[]; cl: Float64Array; P: Float64Array[][]; at(i: number, site: number, c: number): number }
function computeDown(p: Prep, t: MTree): Down {
  const { S, L, cats, rates } = p, order: number[] = [], stack = [t.root]; while (stack.length) { const i = stack.pop()!; order.push(i); const nd = t.nodes[i]; if (nd.left >= 0) stack.push(nd.left, nd.right); } order.reverse();
  const P = Array.from({ length: t.nodes.length }, () => Array.from({ length: cats }, () => new Float64Array(S * S)));
  for (const i of order) if (i !== t.root) for (let c = 0; c < cats; c++) pmatrix(p, t.nodes[i].len, rates[c], P[i][c]);
  const cl = new Float64Array(t.nodes.length * S * L * cats), at = (i: number, site: number, c: number) => ((i * L + site) * cats + c) * S;
  for (const i of order) { const nd = t.nodes[i];
    for (let site = 0; site < L; site++) for (let c = 0; c < cats; c++) { const o = at(i, site, c);
      if (nd.leaf >= 0) { const code = p.codes[nd.leaf][site]; for (let s = 0; s < S; s++) cl[o + s] = code === 255 || code === s ? 1 : 0; }
      else { const a = at(nd.left, site, c), b = at(nd.right, site, c), Pa = P[nd.left][c], Pb = P[nd.right][c]; for (let s = 0; s < S; s++) { let x = 0, y = 0; for (let k = 0; k < S; k++) { x += Pa[s * S + k] * cl[a + k]; y += Pb[s * S + k] * cl[b + k]; } cl[o + s] = x * y; } } } }
  return { order, cl, P, at };
}
function logLik(p: Prep, t: MTree, d: Down = computeDown(p, t)): number {
  const { S, L, cats } = p; let total = 0;
  for (let site = 0; site < L; site++) { let lik = 0; for (let c = 0; c < cats; c++) { const o = d.at(t.root, site, c); let s = 0; for (let k = 0; k < S; k++) s += p.freqs[k] * d.cl[o + k]; lik += s / cats; } total += p.w[site] * Math.log(Math.max(lik, 1e-300)); }
  return total;
}
/** Upward vectors: up[a][site,cat,x] = P(data outside subtree(a), and state x at a's parent) — makes any single-branch trial O(L·S²). */
function computeUp(p: Prep, t: MTree, d: Down): Float64Array {
  const { S, L, cats } = p, up = new Float64Array(t.nodes.length * S * L * cats), at = d.at, out = new Float64Array(S);
  const visit = (v: number) => { const nd = t.nodes[v]; if (nd.left < 0) return;
    for (const [a, b] of [[nd.left, nd.right], [nd.right, nd.left]] as const) for (let site = 0; site < L; site++) for (let c = 0; c < cats; c++) {
      const ov = at(v, site, c), Pb = d.P[b][c], ob = at(b, site, c);
      // out_v[x] = Σ_z up[v][z] P_v[z,x]  (root: π_x)
      if (v === t.root) for (let x = 0; x < S; x++) out[x] = p.freqs[x]; else { const Pv = d.P[v][c]; for (let x = 0; x < S; x++) { let sum = 0; for (let z = 0; z < S; z++) sum += up[ov + z] * Pv[z * S + x]; out[x] = sum; } }
      const oa = at(a, site, c); for (let x = 0; x < S; x++) { let sib = 0; for (let y = 0; y < S; y++) sib += Pb[x * S + y] * d.cl[ob + y]; up[oa + x] = out[x] * sib; } }
    visit(nd.left); visit(nd.right); };
  visit(t.root); return up;
}
function edgeLogLik(p: Prep, d: Down, up: Float64Array, a: number, tlen: number, tmp: Float64Array): number {
  const { S, L, cats, rates } = p; let total = 0; const Pm = Array.from({ length: cats }, (_, c) => { pmatrix(p, tlen, rates[c], tmp); return Float64Array.from(tmp); });
  for (let site = 0; site < L; site++) { let lik = 0; for (let c = 0; c < cats; c++) { const o = d.at(a, site, c), P = Pm[c]; let s = 0; for (let x = 0; x < S; x++) { const ux = up[o + x]; if (!ux) continue; let y = 0; for (let k = 0; k < S; k++) y += P[x * S + k] * d.cl[o + k]; s += ux * y; } lik += s / cats; } total += p.w[site] * Math.log(Math.max(lik, 1e-300)); }
  return total;
}
function optimiseEdge(p: Prep, t: MTree, i: number): number { // golden-section on one branch using cached partials
  const d = computeDown(p, t), up = computeUp(p, t, d), tmp = new Float64Array(p.S * p.S), f = (x: number) => edgeLogLik(p, d, up, i, x, tmp), g = 0.618033988749895;
  let a = 1e-6, b = 5, c = b - g * (b - a), dd = a + g * (b - a), fc = f(c), fd = f(dd);
  for (let it = 0; it < 22; it++) { if (fc > fd) { b = dd; dd = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = dd; fc = fd; dd = a + g * (b - a); fd = f(dd); } }
  const x = (a + b) / 2; t.nodes[i].len = x; return f(x);
}
function optimiseAllExact(p: Prep, t: MTree, passes = 2): number { for (let k = 0; k < passes; k++) for (const nd of t.nodes) if (nd.id !== t.root) optimiseEdge(p, t, nd.id); return logLik(p, t); }
/**
 * Branch-length passes that optimise every edge against one shared set of partial likelihoods (O(n) per pass instead of
 * O(n²)). A pass whose joint update would lower the likelihood is undone and replaced by the exact sequential pass, so
 * the likelihood never decreases.
 */
function optimiseAll(p: Prep, t: MTree, passes = 2): number {
  let ll = logLik(p, t); const g = 0.618033988749895, tmp = new Float64Array(p.S * p.S);
  for (let k = 0; k < passes; k++) {
    const d = computeDown(p, t), up = computeUp(p, t, d), old = t.nodes.map((n) => n.len);
    const next = t.nodes.map((nd) => { if (nd.id === t.root) return nd.len; const f = (x: number) => edgeLogLik(p, d, up, nd.id, x, tmp);
      let a = 1e-6, b = 5, c = b - g * (b - a), e = a + g * (b - a), fc = f(c), fe = f(e);
      for (let it = 0; it < 22; it++) { if (fc > fe) { b = e; e = c; fe = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = e; fc = fe; e = a + g * (b - a); fe = f(e); } }
      return (a + b) / 2; });
    next.forEach((x, i) => (t.nodes[i].len = x));
    const nl = logLik(p, t);
    if (nl + 1e-9 < ll) { old.forEach((x, i) => (t.nodes[i].len = x)); ll = optimiseAllExact(p, t, 1); } else ll = nl;
  }
  return ll;
}
function clone(t: MTree): MTree { return { root: t.root, nodes: t.nodes.map((n) => ({ ...n })) }; }
function nniNeighbours(t: MTree): MTree[] { // for each internal non-root edge (u with parent v): swap one child of u with u's sibling
  const out: MTree[] = [];
  for (const u of t.nodes) { if (u.leaf >= 0 || u.parent < 0) continue; const v = t.nodes[u.parent], sib = v.left === u.id ? v.right : v.left; for (const child of [u.left, u.right]) { const c = clone(t), cu = c.nodes[u.id], cv = c.nodes[v.id]; const which = cu.left === child ? 'left' : 'right'; if (cv.left === sib) cv.left = child; else cv.right = child; cu[which] = sib; c.nodes[child].parent = v.id; c.nodes[sib].parent = u.id; out.push(c); } }
  return out;
}
export interface MlResult { tree: TreeNode; logL: number; k: number; aic: number; bic: number; rounds: number; alpha: number | null; kappa: number | null; model: string }
/** Golden-section maximisation of f over [lo, hi] on a log scale. */
function goldenLog(f: (x: number) => number, lo: number, hi: number, iters = 28): number {
  const g = 0.618033988749895; let a = Math.log(lo), b = Math.log(hi), c = b - g * (b - a), d = a + g * (b - a), fc = f(Math.exp(c)), fd = f(Math.exp(d));
  for (let i = 0; i < iters; i++) { if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(Math.exp(c)); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(Math.exp(d)); } }
  return Math.exp((a + b) / 2);
}
/** Maximum-likelihood κ (K80/HKY85) and Γ shape α on a fixed tree, alternating with branch lengths. */
function optimiseParams(p: Prep, t: MTree, ll: number, o: MlOptions, rounds: number): { p: Prep; ll: number } {
  if (o.fixedAlpha) return { p, ll };
  for (let r = 0; r < rounds; r++) {
    if (p.model === 'K80' || p.model === 'HKY85') { const k = goldenLog((x) => logLik({ ...p, kappa: x }, t), 0.2, 60); p = { ...p, kappa: k }; }
    if (o.gamma) { const a = goldenLog((x) => logLik({ ...p, alpha: x, rates: gammaRates(x) }, t), 0.02, 100); p = { ...p, alpha: a, rates: gammaRates(a) }; }
    ll = optimiseAll(p, t, 1);
  }
  return { p, ll };
}
/** Optimise branch lengths (and α) on a starting topology, then hill-climb with NNI. */
export function inferMl(aln: string[], names: string[], start: TreeNode, o: MlOptions, progress?: (f: number, note: string) => void): MlResult {
  if (aln.length < 4) throw new Error('Maximum likelihood needs at least 4 sequences.'); if (aln.length > 150) throw new Error('The browser ML engine is limited to 150 taxa; for larger sets use neighbour-joining here, or IQ-TREE / RAxML-NG on a workstation.');
  if (new Set(aln.map((r) => r.length)).size !== 1) throw new Error('Sequences must be aligned (equal length).');
  let p = prepare(aln, o), tree = fromNewickTree(start, names); let ll = optimiseAll(p, tree, 2), rounds = 0;
  ({ p, ll } = optimiseParams(p, tree, ll, o, 1)); progress?.(0.1, `start lnL ${ll.toFixed(1)}`);
  const maxRounds = o.maxRounds ?? 6;
  for (; rounds < maxRounds; rounds++) {
    let improved = false; const cands = nniNeighbours(tree);
    for (const [ci, cand] of cands.entries()) { const l = logLik(p, cand); if (l > ll + 1e-3 - 0) { const refined = clone(cand); const rl = optimiseAll(p, refined, 1); if (rl > ll + 0.01) { tree = refined; ll = rl; improved = true; } } if (ci % 4 === 0) progress?.(0.1 + 0.8 * ((rounds + ci / cands.length) / maxRounds), `NNI round ${rounds + 1}, lnL ${ll.toFixed(1)}`); }
    if (!improved) break;
  }
  ({ p, ll } = optimiseParams(p, tree, ll, o, 2));
  if (!o.fixedAlpha) ll = optimiseAllExact(p, tree, 2); // final exact polish of the reported tree (replicates skip it)
  const kParams = 2 * aln.length - 3 + (o.model === 'HKY85' ? 4 : o.model === 'K80' ? 1 : 0) + (o.gamma ? 1 : 0), n = aln[0].length;
  progress?.(1, 'done');
  return { tree: toTree(tree, names), logL: ll, k: kParams, aic: 2 * kParams - 2 * ll, bic: kParams * Math.log(n) - 2 * ll, rounds: rounds + 1, alpha: o.gamma ? p.alpha : null, kappa: p.model === 'K80' || p.model === 'HKY85' ? p.kappa : null, model: `${o.model}${o.gamma ? '+Γ4' : ''}` };
}
/** Transition-probability matrix P(t) for a model (exposed for validation). */
export function transitionMatrix(model: MlModel, t: number, freqs: number[], kappa: number): number[][] { const S = model === 'Poisson' ? 20 : 4, p: Prep = { n: 0, L: 0, S, codes: [], w: new Float64Array(0), freqs, kappa, alpha: 1, cats: 1, rates: [1], model }, out = new Float64Array(S * S); pmatrix(p, t, 1, out); return Array.from({ length: S }, (_, i) => Array.from(out.slice(i * S, i * S + S))); }
export const logLikelihood = (aln: string[], names: string[], tree: TreeNode, o: MlOptions) => { const p = prepare(aln, o), t = fromNewickTree(tree, names); return logLik(p, t); };

/**
 * Non-parametric bootstrap replicates for ML (Felsenstein 1985): each replicate resamples alignment columns, starts
 * from its own neighbour-joining tree and is re-optimised (branch lengths + NNI, Γ shape fixed at the full-data value).
 */
export function mlReplicateTrees(aln: string[], names: string[], o: MlOptions, reps: number, progress?: (done: number) => void, seed = 1): TreeNode[] {
  const rnd = lcg(seed), trees: TreeNode[] = [], dist = o.model === 'Poisson' ? 'poisson' : 'jc';
  for (let r = 0; r < reps; r++) {
    const rs = resampleColumns(aln, rnd);
    trees.push(inferMl(rs, names, nj(distanceMatrix(rs, dist), names), { ...o, fixedAlpha: true, maxRounds: o.maxRounds ?? 3 }).tree);
    progress?.(r + 1);
  }
  return trees;
}
/** The ML tree annotated with the % of bootstrap replicates that contain each split (single thread). */
export function mlBootstrap(aln: string[], names: string[], mlTree: TreeNode, o: MlOptions, reps: number, progress?: (f: number) => void, seed = 1): TreeNode {
  return supportFromTrees(mlTree, names, mlReplicateTrees(aln, names, o, reps, (d) => progress?.(d / reps), seed));
}
