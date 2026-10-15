/** Phylogenetic beta diversity: unweighted and weighted-normalised UniFrac (Lozupone & Knight 2005; Lozupone et al. 2007).
 *  Clean-room implementation over a Newick tree; features absent from the tree are dropped and reported. */
import { parseNewick, type TreeNode } from '../phylo/kernels';
import type { FeatureTable } from './kernels';

export interface UnifracResult { unweighted: number[][]; weighted: number[][]; usedFeatures: number; droppedFeatures: string[]; tips: number }
export function unifrac(t: FeatureTable, newick: string): UnifracResult {
  const tree = parseNewick(newick), S = t.samples.length, tipIdx = new Map(t.features.map((f, i) => [f, i])), dropped: string[] = [];
  const tipsInTree = new Set<string>(); const collect = (n: TreeNode) => { if (!n.children.length) tipsInTree.add(n.name!); else n.children.forEach(collect); }; collect(tree);
  t.features.forEach((f) => { if (!tipsInTree.has(f)) dropped.push(f); });
  const used = t.features.length - dropped.length; if (used < 3) throw new Error(`Only ${used} of ${t.features.length} features match tip names in the tree. Feature IDs in the table must equal the tip labels.`);
  const tot = new Float64Array(S); for (let i = 0; i < t.features.length; i++) if (tipsInTree.has(t.features[i])) for (let j = 0; j < S; j++) tot[j] += t.counts[i * S + j];
  for (let j = 0; j < S; j++) if (!tot[j]) throw new Error(`Sample ${t.samples[j]} has no counts for features present in the tree.`);
  const edges: { len: number; w: Float64Array; present: Uint8Array }[] = []; let tipDist: { d: number; w: Float64Array }[] = [];
  const rec = (n: TreeNode, depth: number, isRoot: boolean): { w: Float64Array; present: Uint8Array } | null => {
    let w: Float64Array, present: Uint8Array;
    if (!n.children.length) { const fi = tipIdx.get(n.name!); if (fi === undefined) return null; w = new Float64Array(S); present = new Uint8Array(S); for (let j = 0; j < S; j++) { const c = t.counts[fi * S + j]; w[j] = c / tot[j]; present[j] = c > 0 ? 1 : 0; } tipDist.push({ d: depth + n.length, w }); }
    else { w = new Float64Array(S); present = new Uint8Array(S); let any = false; for (const c of n.children) { const r = rec(c, depth + n.length, false); if (!r) continue; any = true; for (let j = 0; j < S; j++) { w[j] += r.w[j]; if (r.present[j]) present[j] = 1; } } if (!any) return null; }
    if (!isRoot) edges.push({ len: n.length, w, present }); return { w, present };
  };
  rec(tree, 0, true);
  const U = Array.from({ length: S }, () => new Array(S).fill(0)), W = Array.from({ length: S }, () => new Array(S).fill(0));
  for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) {
    let un = 0, ud = 0, wn = 0; for (const e of edges) { const pa = e.present[a], pb = e.present[b]; if (pa || pb) { ud += e.len; if (pa !== pb) un += e.len; } wn += e.len * Math.abs(e.w[a] - e.w[b]); }
    let norm = 0; for (const td of tipDist) norm += td.d * (td.w[a] + td.w[b]);
    U[a][b] = U[b][a] = ud ? un / ud : 0; W[a][b] = W[b][a] = norm ? wn / norm : 0;
  }
  return { unweighted: U, weighted: W, usedFeatures: used, droppedFeatures: dropped, tips: tipDist.length };
}
/** Build a Newick tree from lineage strings (k__;p__;…): clades nest by rank, branch lengths shrink with depth. Used for the synthetic demo only. */
export function treeFromTaxonomy(ids: string[], lineages: string[]): string {
  type Node = { name: string; kids: Map<string, Node>; leaves: string[] }; const root: Node = { name: '', kids: new Map(), leaves: [] };
  ids.forEach((id, i) => { let n = root; for (const part of lineages[i].split(';').map((x) => x.trim()).filter(Boolean)) { if (!n.kids.has(part)) n.kids.set(part, { name: part, kids: new Map(), leaves: [] }); n = n.kids.get(part)!; } n.leaves.push(id); });
  const emit = (n: Node, depth: number): string => { const parts = [...[...n.kids.values()].map((k) => emit(k, depth + 1)), ...n.leaves.map((l) => `${l}:${(0.03 + 0.01 * ((l.length * 7) % 5)).toFixed(3)}`)]; const own = parts.length === 1 ? parts[0] : `(${parts.join(',')})`; return depth === 0 ? own : `${own}:${(0.5 / (depth + 0.5)).toFixed(3)}`; };
  return emit(root, 0) + ';';
}
