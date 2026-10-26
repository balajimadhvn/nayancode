/** Simplified de novo chimera detection (UCHIME-style two-parent model). */
import type { UniqueSeq } from './denoise';

export interface Chimera { seq: string; count: number; parentA: string; parentB: string; split: number; identity: number }
export interface ChimeraResult { kept: UniqueSeq[]; chimeras: Chimera[] }

/**
 * Test every ASV, by decreasing abundance, as a left segment of parent A plus
 * a right segment of parent B. Both parents must be at least twice as abundant
 * and explain at least 10 bases; the best split must reach 99 % identity.
 * Only the 30 most abundant eligible parents are searched to keep this bounded.
 */
export function detectChimeras(asvs: UniqueSeq[], opts: { minParentRatio?: number; minSegment?: number; minIdentity?: number; maxParents?: number } = {}): ChimeraResult {
  const ratio = opts.minParentRatio ?? 2, minSeg = opts.minSegment ?? 10, minIdentity = opts.minIdentity ?? 0.99, maxParents = opts.maxParents ?? 30;
  const sorted = [...asvs].sort((a, b) => b.count - a.count || a.seq.localeCompare(b.seq));
  const chimeras: Chimera[] = [], kept: UniqueSeq[] = [];
  for (const child of sorted) {
    const L = child.seq.length;
    const parents = sorted.filter((p) => p !== child && p.seq.length === L && p.count >= ratio * child.count).slice(0, maxParents);
    let best: Chimera | null = null;
    // Prefix/suffix match counts for each candidate parent against this child.
    const prof = parents.map((p) => {
      const pre = new Int32Array(L + 1), suf = new Int32Array(L + 1);
      for (let i = 0; i < L; i++) pre[i + 1] = pre[i] + (child.seq[i] === p.seq[i] ? 1 : 0);
      for (let i = L - 1; i >= 0; i--) suf[i] = suf[i + 1] + (child.seq[i] === p.seq[i] ? 1 : 0);
      return { pre, suf };
    });
    for (let i = 0; i < parents.length; i++) for (let j = 0; j < parents.length; j++) {
      if (i === j) continue;
      for (let p = minSeg; p <= L - minSeg; p++) {
        const identity = (prof[i].pre[p] + prof[j].suf[p]) / L;
        if (identity < minIdentity) continue;
        if (!best || identity > best.identity) best = { seq: child.seq, count: child.count, parentA: parents[i].seq, parentB: parents[j].seq, split: p, identity };
      }
    }
    if (best) chimeras.push(best); else kept.push(child);
  }
  return { kept, chimeras };
}
