/** Alignment & phylogenetics kernels. Clean-room implementations from the published algorithms
 *  (no GPL code): progressive profile alignment, distance models, NJ (Saitou & Nei 1987), UPGMA, bootstrap (Felsenstein 1985). */
import { blosum62 } from '../sequence/kernels';

export interface TreeNode { name?: string; length: number; children: TreeNode[]; support?: number }

// ---------------- Newick ----------------
export function parseNewick(src: string): TreeNode {
  let i = 0; const s = src.trim().replace(/\s+/g, ' ');
  const readName = () => { let o = ''; if (s[i] === "'") { i++; while (i < s.length && s[i] !== "'") o += s[i++]; i++; return o; } while (i < s.length && !'(),:;[]'.includes(s[i])) o += s[i++]; return o.trim(); };
  const node = (): TreeNode => {
    const n: TreeNode = { length: 0, children: [] };
    if (s[i] === '(') { i++; do { if (s[i] === ',') i++; n.children.push(node()); } while (s[i] === ','); if (s[i] !== ')') throw new Error('Newick: expected ")" at position ' + i); i++; }
    const nm = readName();
    if (nm) { if (n.children.length && /^[\d.]+$/.test(nm)) n.support = +nm; else n.name = nm; }
    if (s[i] === ':') { i++; let t = ''; while (i < s.length && !',);'.includes(s[i])) t += s[i++]; n.length = parseFloat(t) || 0; }
    return n;
  };
  const t = node();
  if (!t.children.length && !t.name) throw new Error('Newick: empty tree');
  return t;
}
export function toNewick(t: TreeNode, dec = 5): string {
  const f = (n: TreeNode, root = false): string => (n.children.length ? `(${n.children.map((c) => f(c)).join(',')})${n.support !== undefined ? +n.support.toFixed(2) : ''}` : n.name ?? '') + (root ? '' : `:${(+n.length.toFixed(dec))}`);
  return f(t, true) + ';';
}
export const leaves = (t: TreeNode): TreeNode[] => (t.children.length ? t.children.flatMap(leaves) : [t]);

// ---------------- Distances ----------------
export type DistModel = 'p' | 'jc' | 'k2p' | 'poisson';
const PUR = new Set(['A', 'G']), PYR = new Set(['C', 'T', 'U']);
export function distanceMatrix(seqs: string[], model: DistModel): number[][] {
  const n = seqs.length, D = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    let valid = 0, diff = 0, ts = 0, tv = 0;
    const A = seqs[a], B = seqs[b];
    for (let k = 0; k < A.length; k++) {
      const x = A[k], y = B[k];
      if (x === '-' || y === '-' || x === 'N' || y === 'N' || x === 'X' || y === 'X') continue;
      valid++;
      if (x !== y) { diff++; if ((PUR.has(x) && PUR.has(y)) || (PYR.has(x) && PYR.has(y))) ts++; else tv++; }
    }
    const p = valid ? diff / valid : 1;
    let d: number;
    if (model === 'p') d = p;
    else if (model === 'jc') d = p >= 0.75 ? 3 : -0.75 * Math.log(1 - (4 / 3) * p);
    else if (model === 'k2p') { const P = valid ? ts / valid : 0, Q = valid ? tv / valid : 0; const v = (1 - 2 * P - Q) * Math.sqrt(1 - 2 * Q); d = v > 0 ? -0.5 * Math.log(v) : 3; }
    else d = p >= 0.95 ? 3 : -Math.log(1 - p);
    D[a][b] = D[b][a] = Number.isFinite(d) ? d : 3;
  }
  return D;
}

// ---------------- Tree building ----------------
export function nj(D0: number[][], names: string[]): TreeNode {
  const n0 = names.length;
  if (n0 < 3) return { length: 0, children: names.map((nm) => ({ name: nm, length: n0 === 2 ? D0[0][1] / 2 : 0, children: [] })) };
  let nodes: TreeNode[] = names.map((nm) => ({ name: nm, length: 0, children: [] }));
  let D = D0.map((r) => [...r]);
  while (nodes.length > 3) {
    const n = nodes.length, r = D.map((row) => row.reduce((a, b) => a + b, 0));
    let best = Infinity, bi = 0, bj = 1;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const q = (n - 2) * D[i][j] - r[i] - r[j]; if (q < best) { best = q; bi = i; bj = j; } }
    const dij = D[bi][bj];
    const li = Math.max(0, 0.5 * dij + (r[bi] - r[bj]) / (2 * (n - 2))), lj = Math.max(0, dij - li);
    nodes[bi].length = li; nodes[bj].length = lj;
    const u: TreeNode = { length: 0, children: [nodes[bi], nodes[bj]] };
    const du = D.map((_, k) => 0.5 * (D[bi][k] + D[bj][k] - dij));
    const keep = nodes.map((_, k) => k).filter((k) => k !== bi && k !== bj);
    const nd = [[0, ...keep.map((k) => du[k])], ...keep.map((k) => [du[k], ...keep.map((k2) => D[k][k2])])];
    // note: nd[0] row/col is the new node u
    const nn = nd.map((row, ii) => row.map((v, jj) => (ii === 0 && jj === 0 ? 0 : v)));
    D = nn; nodes = [u, ...keep.map((k) => nodes[k])];
  }
  const [a, b, c] = nodes;
  const dab = D[0][1], dac = D[0][2], dbc = D[1][2];
  a.length = Math.max(0, (dab + dac - dbc) / 2); b.length = Math.max(0, (dab + dbc - dac) / 2); c.length = Math.max(0, (dac + dbc - dab) / 2);
  return { length: 0, children: [a, b, c] };
}

export function upgma(D0: number[][], names: string[]): TreeNode {
  type C = { node: TreeNode; size: number; h: number };
  let cl: C[] = names.map((nm) => ({ node: { name: nm, length: 0, children: [] }, size: 1, h: 0 }));
  let D = D0.map((r) => [...r]);
  while (cl.length > 1) {
    let best = Infinity, bi = 0, bj = 1;
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) if (D[i][j] < best) { best = D[i][j]; bi = i; bj = j; }
    const h = best / 2, A = cl[bi], B = cl[bj];
    A.node.length = Math.max(0, h - A.h); B.node.length = Math.max(0, h - B.h);
    const merged: C = { node: { length: 0, children: [A.node, B.node] }, size: A.size + B.size, h };
    const keep = cl.map((_, k) => k).filter((k) => k !== bi && k !== bj);
    const row = keep.map((k) => (D[bi][k] * A.size + D[bj][k] * B.size) / merged.size);
    D = [[0, ...row], ...keep.map((k, ii) => [row[ii], ...keep.map((k2) => D[k][k2])])];
    cl = [merged, ...keep.map((k) => cl[k])];
  }
  return cl[0].node;
}

/** Midpoint rooting: place the root halfway along the longest leaf-to-leaf path. */
export function midpointRoot(t: TreeNode): TreeNode {
  type G = { id: number; node: TreeNode; adj: { to: number; w: number }[] };
  const g: G[] = [];
  const build = (n: TreeNode, parent: number | null, w: number): number => { const id = g.length; g.push({ id, node: n, adj: [] }); if (parent !== null) { g[id].adj.push({ to: parent, w }); g[parent].adj.push({ to: id, w }); } for (const c of n.children) build(c, id, c.length); return id; };
  build(t, null, 0);
  const far = (s: number) => { const dist = new Map<number, number>([[s, 0]]), prev = new Map<number, number>(); const st = [s]; while (st.length) { const u = st.pop()!; for (const e of g[u].adj) if (!dist.has(e.to)) { dist.set(e.to, dist.get(u)! + e.w); prev.set(e.to, u); st.push(e.to); } } let bi = s; for (const [k, v] of dist) if (g[k].node.children.length === 0 && v > (dist.get(bi) ?? -1)) bi = k; return { bi, dist, prev }; };
  const first = [...g.keys()].find((k) => g[k].node.children.length === 0) ?? 0;
  const a = far(first).bi, fb = far(a), b = fb.bi, total = fb.dist.get(b)!;
  if (total === 0) return t;
  const path: number[] = [b]; while (path[path.length - 1] !== a) path.push(fb.prev.get(path[path.length - 1])!);
  let acc = 0, u = b, v = b, off = 0;
  for (let i = 0; i < path.length - 1; i++) { const w = g[path[i]].adj.find((e) => e.to === path[i + 1])!.w; if (acc + w >= total / 2) { u = path[i]; v = path[i + 1]; off = total / 2 - acc; break; } acc += w; }
  const w = g[u].adj.find((e) => e.to === v)!.w;
  const root = (from: number, to: number, ln: number): TreeNode => { const nodeOf = (id: number, par: number): TreeNode => { const nn = g[id].node; const kids = g[id].adj.filter((e) => e.to !== par).map((e) => ({ ...nodeOf(e.to, id), length: e.w })); return { name: nn.name, support: nn.support, length: 0, children: kids }; }; void ln; return nodeOf(from, to); };
  const left = { ...root(u, v, off), length: off }, right = { ...root(v, u, w - off), length: w - off };
  return { length: 0, children: [left, right] };
}

// ---------------- Splits & bootstrap ----------------
function cladeSets(t: TreeNode, idx: Map<string, number>, n: number): string[] {
  const out: string[] = [];
  const rec = (x: TreeNode): number[] => { if (!x.children.length) return [idx.get(x.name!)!]; const s = x.children.flatMap(rec); if (s.length > 1 && s.length < n - 1) { const set = new Set(s); const side = set.has(0) ? [...Array(n).keys()].filter((k) => !set.has(k)) : s; out.push(side.slice().sort((a, b) => a - b).join(',')); } return s; };
  rec(t); return out;
}
/** Annotates internal nodes of `tree` with bootstrap support (% of replicate trees containing the same split). */
export function bootstrapSupport(aln: string[], names: string[], tree: TreeNode, model: DistModel, method: 'nj' | 'upgma', reps: number, progress?: (p: number) => void, seed = 1): TreeNode {
  const idx = new Map(names.map((n, i) => [n, i])), n = names.length, L = aln[0].length;
  const counts = new Map<string, number>();
  let s = seed; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let r = 0; r < reps; r++) {
    const cols = Array.from({ length: L }, () => Math.floor(rnd() * L));
    const rs = aln.map((row) => { let o = ''; for (const c of cols) o += row[c]; return o; });
    const D = distanceMatrix(rs, model);
    const t = method === 'nj' ? nj(D, names) : upgma(D, names);
    for (const k of new Set(cladeSets(t, idx, n))) counts.set(k, (counts.get(k) ?? 0) + 1);
    if (progress && r % 5 === 0) progress(r / reps);
  }
  const copy = (x: TreeNode): TreeNode => ({ ...x, children: x.children.map(copy) });
  const out = copy(tree);
  const annotate = (x: TreeNode): number[] => { if (!x.children.length) return [idx.get(x.name!)!]; const sset = x.children.flatMap(annotate); if (sset.length > 1 && sset.length < n - 1) { const set = new Set(sset); const side = set.has(0) ? [...Array(n).keys()].filter((k) => !set.has(k)) : sset; x.support = Math.round(((counts.get(side.slice().sort((a, b) => a - b).join(',')) ?? 0) / reps) * 100); } return sset; };
  annotate(out);
  return out;
}

// ---------------- Progressive MSA ----------------
export type SeqKind = 'dna' | 'protein';
const PROT = 'ACDEFGHIKLMNPQRSTVWY';
interface Profile { rows: string[]; ids: number[]; len: number; freq: Float32Array[]; gapFrac: Float32Array }
function makeProfile(rows: string[], ids: number[], kind: SeqKind): Profile {
  const alpha = kind === 'dna' ? 'ACGT' : PROT, A = alpha.length, len = rows[0].length;
  const freq = Array.from({ length: len }, () => new Float32Array(A)), gapFrac = new Float32Array(len);
  for (let c = 0; c < len; c++) { let g = 0, tot = 0; for (const r of rows) { const ch = r[c]; const k = alpha.indexOf(ch); if (k >= 0) { freq[c][k]++; tot++; } else g++; } if (tot) for (let k = 0; k < A; k++) freq[c][k] /= tot; gapFrac[c] = g / rows.length; }
  return { rows, ids, len, freq, gapFrac };
}
function alignProfiles(P: Profile, Q: Profile, kind: SeqKind, open: number, ext: number): Profile {
  const alpha = kind === 'dna' ? 'ACGT' : PROT, A = alpha.length;
  const sub: number[][] = Array.from({ length: A }, (_, x) => Array.from({ length: A }, (_, y) => (kind === 'dna' ? (x === y ? 5 : -4) : blosum62(alpha[x], alpha[y]))));
  const nzP = P.freq.map((f) => { const o: [number, number][] = []; f.forEach((v, k) => v > 0 && o.push([k, v])); return o; });
  const nzQ = Q.freq.map((f) => { const o: [number, number][] = []; f.forEach((v, k) => v > 0 && o.push([k, v])); return o; });
  const n = P.len, m = Q.len, W = m + 1, NEG = -1e8;
  if (n * m > 12_000_000) throw new Error(`Profile alignment too large (${n}×${m}); limit is 12M cells.`);
  const H = new Float32Array((n + 1) * W), E = new Float32Array((n + 1) * W), F = new Float32Array((n + 1) * W), T = new Uint8Array((n + 1) * W);
  const gp = (gf: number) => 1 - 0.5 * gf; // gaps inside already-gappy columns are cheaper
  for (let j = 1; j <= m; j++) { H[j] = -(open + ext * (j - 1)) * 0.5; E[j] = NEG; F[j] = NEG; T[j] = 1; }
  for (let i = 1; i <= n; i++) { H[i * W] = -(open + ext * (i - 1)) * 0.5; E[i * W] = NEG; F[i * W] = NEG; T[i * W] = 2; }
  for (let i = 1; i <= n; i++) {
    const pa = nzP[i - 1], ga = gp(P.gapFrac[i - 1]);
    for (let j = 1; j <= m; j++) {
      const k = i * W + j, gb = gp(Q.gapFrac[j - 1]);
      let s = 0; for (const [x, fx] of pa) for (const [y, fy] of nzQ[j - 1]) s += fx * fy * sub[x][y];
      const eo = H[k - 1] - open * ga, ee = E[k - 1] - ext * ga; E[k] = Math.max(eo, ee); let t = ee > eo ? 4 : 0;
      const fo = H[k - W] - open * gb, fe = F[k - W] - ext * gb; F[k] = Math.max(fo, fe); if (fe > fo) t |= 8;
      let h = H[k - W - 1] + s, src = 0; if (E[k] > h) { h = E[k]; src = 1; } if (F[k] > h) { h = F[k]; src = 2; }
      H[k] = h; T[k] = t | src;
    }
  }
  const ops: ('M' | 'B' | 'A')[] = []; // M both, B = gap in P (take Q col), A = gap in Pcol (take P col)
  let i = n, j = m, st = 0;
  while (i > 0 || j > 0) {
    if (i === 0) { ops.push('B'); j--; continue; } if (j === 0) { ops.push('A'); i--; continue; }
    const t = T[i * W + j];
    if (st === 0) { const src = t & 3; if (src === 0) { ops.push('M'); i--; j--; } else st = src; }
    else if (st === 1) { ops.push('B'); if (!(t & 4)) st = 0; j--; }
    else { ops.push('A'); if (!(t & 8)) st = 0; i--; }
  }
  ops.reverse();
  const outP = P.rows.map(() => [] as string[]), outQ = Q.rows.map(() => [] as string[]);
  let pi = 0, qi = 0;
  for (const op of ops) {
    if (op === 'M') { P.rows.forEach((r, k) => outP[k].push(r[pi])); Q.rows.forEach((r, k) => outQ[k].push(r[qi])); pi++; qi++; }
    else if (op === 'A') { P.rows.forEach((r, k) => outP[k].push(r[pi])); Q.rows.forEach((_, k) => outQ[k].push('-')); pi++; }
    else { P.rows.forEach((_, k) => outP[k].push('-')); Q.rows.forEach((r, k) => outQ[k].push(r[qi])); qi++; }
  }
  return makeProfile([...outP.map((a) => a.join('')), ...outQ.map((a) => a.join(''))], [...P.ids, ...Q.ids], kind);
}

export function kmerDistances(seqs: string[], kind: SeqKind): number[][] {
  const k = kind === 'dna' ? 6 : 3, sets = seqs.map((s) => { const o = new Set<string>(); for (let i = 0; i + k <= s.length; i++) o.add(s.slice(i, i + k)); return o; });
  const n = seqs.length, D = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) { let c = 0; const [s, t] = sets[a].size < sets[b].size ? [sets[a], sets[b]] : [sets[b], sets[a]]; for (const x of s) if (t.has(x)) c++; D[a][b] = D[b][a] = 1 - c / Math.max(1, s.size); }
  return D;
}

export interface MsaResult { names: string[]; aligned: string[]; guide: string; columns: number }
export function progressiveMsa(names: string[], seqs: string[], kind: SeqKind, progress?: (p: number, n?: string) => void): MsaResult {
  const n = seqs.length;
  if (n < 2) throw new Error('Need at least two sequences.');
  if (n > 300) throw new Error('Limit is 300 sequences in the browser; use a cloud aligner for larger sets.');
  const clean = seqs.map((s) => s.toUpperCase().replace(/U/g, kind === 'dna' ? 'T' : 'U').replace(/[^A-Z]/g, kind === 'dna' ? 'N' : 'X'));
  progress?.(0.05, 'k-mer distances');
  const guide = upgma(kmerDistances(clean, kind), names.map((_, i) => String(i)));
  const open = kind === 'dna' ? 8 : 11, ext = kind === 'dna' ? 1 : 1;
  let done = 0; const merges = n - 1;
  const rec = (node: TreeNode): Profile => {
    if (!node.children.length) { const i = +node.name!; return makeProfile([clean[i]], [i], kind); }
    const kids = node.children.map(rec); let acc = kids[0];
    for (let k = 1; k < kids.length; k++) acc = alignProfiles(acc, kids[k], kind, open, ext);
    done++; progress?.(0.1 + 0.88 * (done / merges), `merging ${done}/${merges}`);
    return acc;
  };
  const root = rec(guide);
  const aligned = new Array<string>(n);
  root.ids.forEach((id, k) => { aligned[id] = root.rows[k]; });
  // drop all-gap columns
  const keep: number[] = []; for (let c = 0; c < root.len; c++) if (aligned.some((r) => r[c] !== '-')) keep.push(c);
  return { names, aligned: aligned.map((r) => keep.map((c) => r[c]).join('')), guide: toNewick(guide), columns: keep.length };
}

// ---------------- Conservation ----------------
export interface Conservation { entropy: number[]; identity: number[]; consensus: string; gapFrac: number[]; meanIdentity: number }
export function conservation(aln: string[], kind: SeqKind): Conservation {
  const L = aln[0].length, n = aln.length, maxH = Math.log2(kind === 'dna' ? 4 : 20);
  const entropy: number[] = [], identity: number[] = [], gapFrac: number[] = []; let cons = '';
  for (let c = 0; c < L; c++) {
    const cnt = new Map<string, number>(); let g = 0;
    for (const r of aln) { const ch = r[c]; if (ch === '-') g++; else cnt.set(ch, (cnt.get(ch) ?? 0) + 1); }
    const tot = n - g; let h = 0, top = '-', tc = 0;
    for (const [k, v] of cnt) { const p = v / tot; h -= p * Math.log2(p); if (v > tc) { tc = v; top = k; } }
    entropy.push(tot ? 1 - h / maxH : 0); identity.push(tot ? tc / n : 0); gapFrac.push(g / n); cons += tc / n >= 0.5 ? top : '.';
  }
  return { entropy, identity, consensus: cons, gapFrac, meanIdentity: identity.reduce((a, b) => a + b, 0) / (L || 1) };
}
export function identityMatrix(aln: string[]): number[][] {
  const n = aln.length; return Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let v = 0, m = 0; for (let k = 0; k < aln[a].length; k++) { if (aln[a][k] === '-' || aln[b][k] === '-') continue; v++; if (aln[a][k] === aln[b][k]) m++; } return v ? m / v : 0; }));
}

// ---------------- demo data (synthetic) ----------------
export function syntheticFamily(seed = 3, nTaxa = 12, len = 360): string {
  let s = seed; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const AA = 'ACDEFGHIKLMNPQRSTVWY'; let root = Array.from({ length: len }, () => AA[Math.floor(r() * 20)]).join('');
  const mutate = (seq: string, rate: number) => { let o = ''; for (const ch of seq) { const u = r(); if (u < rate) o += AA[Math.floor(r() * 20)]; else if (u < rate * 1.06) continue; else if (u < rate * 1.12) o += ch + AA[Math.floor(r() * 20)]; else o += ch; } return o; };
  const clades = [mutate(root, 0.25), mutate(root, 0.25), mutate(root, 0.3)];
  const out: string[] = []; let k = 1;
  clades.forEach((c, ci) => { const sub = [mutate(c, 0.1), mutate(c, 0.1)]; for (let i = 0; i < nTaxa / 3; i++) { const q = mutate(sub[i % 2], 0.05); out.push(`>taxon_${String.fromCharCode(65 + ci)}${k++}\n${q.replace(/(.{60})/g, '$1\n')}`); } });
  root = ''; return out.join('\n') + '\n';
}
