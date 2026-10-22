/**
 * Pseudoalignment and quantification for small transcriptomes (bacteria, yeast, viruses), in the style of kallisto
 * (Bray et al. 2016): an index of canonical k-mers mapping to equivalence classes of transcripts, reads assigned to the
 * intersection of their k-mers' classes, and EM abundance estimation with effective lengths. Clean-room implementation.
 * Limits: k ≤ 25 (k-mers are packed into a double), at most 24 million indexed k-mer positions.
 */
export interface Tx { id: string; seq: string }
export interface PseudoIndex { k: number; ids: string[]; lengths: number[]; keys: Float64Array; vals: Int32Array; mask: number; ecs: number[][]; nKmers: number }
export const MAX_KMERS = 24_000_000;

const POW = (k: number) => 4 ** k;
const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 };
const hash = (x: number) => { const lo = x % 4294967296 | 0, hi = Math.floor(x / 4294967296) | 0; let h = Math.imul(lo ^ Math.imul(hi, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 13)) >>> 0; };

/** Calls f(canonicalKmer) for every k-mer without ambiguous bases. */
export function forEachKmer(seq: string, k: number, f: (km: number, pos: number) => void) {
  const top = POW(k - 1), mod = POW(k); let fw = 0, rc = 0, run = 0;
  for (let i = 0; i < seq.length; i++) {
    const b = CODE[seq[i]];
    if (b === undefined) { run = 0; fw = 0; rc = 0; continue; }
    fw = (fw * 4 + b) % mod; rc = Math.floor(rc / 4) + (3 - b) * top; run++;
    if (run >= k) f(fw < rc ? fw : rc, i - k + 1);
  }
}

export function buildIndex(tx: Tx[], k = 25): PseudoIndex {
  if (k < 11 || k > 25) throw new Error('k must be between 11 and 25.');
  let total = 0; for (const t of tx) total += Math.max(0, t.seq.length - k + 1);
  if (!tx.length || !total) throw new Error(`No transcript is at least ${k} nt long.`);
  if (total > MAX_KMERS) throw new Error(`This transcriptome has ${total.toLocaleString()} k-mer positions; the browser index is limited to ${MAX_KMERS.toLocaleString()}. Use kallisto or Salmon for larger transcriptomes.`);
  let cap = 1; while (cap < total * 2) cap *= 2;
  const keys = new Float64Array(cap).fill(-1), vals = new Int32Array(cap), mask = cap - 1, ecs: number[][] = [], ecKey = new Map<string, number>(), trans = new Map<number, number>(), single: number[] = [];
  const getEc = (set: number[]) => { const key = set.join(','); let id = ecKey.get(key); if (id === undefined) { id = ecs.length; ecs.push(set); ecKey.set(key, id); } return id; };
  let nKmers = 0; const T = tx.length;
  tx.forEach((t, ti) => {
    single[ti] = getEc([ti]);
    forEachKmer(t.seq.toUpperCase(), k, (km) => {
      let h = hash(km) & mask;
      for (;;) {
        if (keys[h] === -1) { keys[h] = km; vals[h] = single[ti]; nKmers++; return; }
        if (keys[h] === km) { const e = vals[h], set = ecs[e]; if (set[set.length - 1] === ti) return; const tk = e * T + ti; let ne = trans.get(tk); if (ne === undefined) { ne = getEc([...set, ti]); trans.set(tk, ne); } vals[h] = ne; return; }
        h = (h + 1) & mask;
      }
    });
  });
  return { k, ids: tx.map((t) => t.id), lengths: tx.map((t) => t.seq.length), keys, vals, mask, ecs, nKmers };
}
const lookup = (ix: PseudoIndex, km: number): number => { let h = hash(km) & ix.mask; for (;;) { const key = ix.keys[h]; if (key === km) return ix.vals[h]; if (key === -1) return -1; h = (h + 1) & ix.mask; } };
const intersect = (a: number[], b: number[]) => { const out: number[] = []; let i = 0, j = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++; } return out; };

export interface EcCounts { sets: number[][]; counts: number[]; reads: number; mapped: number; kmersSeen: number }
/** Equivalence class of one read: intersection of the classes of its indexed k-mers (empty = unmapped). */
export function classify(ix: PseudoIndex, seq: string): number[] {
  let cur: number[] | null = null, prev = -2; const k = ix.k;
  forEachKmer(seq, k, (km) => {
    if (cur && cur.length === 0) return;
    const e = lookup(ix, km); if (e < 0 || e === prev) return; prev = e;
    cur = cur === null ? ix.ecs[e] : intersect(cur, ix.ecs[e]);
  });
  return cur ?? [];
}
/** Pseudoaligns reads (single-end, or pairs given as [mate1, mate2] whose classes are intersected). */
export function pseudoalign(ix: PseudoIndex, reads: Iterable<string | [string, string]>, progress?: (n: number) => void): EcCounts {
  const map = new Map<string, number>(), sets: number[][] = [], counts: number[] = []; let n = 0, mapped = 0;
  for (const r of reads) {
    n++; if (progress && n % 20000 === 0) progress(n);
    const set = typeof r === 'string' ? classify(ix, r) : (() => { const a = classify(ix, r[0]), b = classify(ix, r[1]); return a.length && b.length ? intersect(a, b) : a.length ? a : b; })();
    if (!set.length) continue; mapped++;
    const key = set.join(','); const id = map.get(key); if (id === undefined) { map.set(key, sets.length); sets.push(set); counts.push(1); } else counts[id]++;
  }
  return { sets, counts, reads: n, mapped, kmersSeen: 0 };
}

export interface Quant { id: string; length: number; effLength: number; estCounts: number; tpm: number }
/** EM over equivalence classes (Bray et al. 2016): α_t ← Σ_e c_e · (α_t/ℓ_t) / Σ_{t'∈e} (α_t'/ℓ_t'). */
export function quantify(ix: PseudoIndex, ec: EcCounts, opt: { fragLen?: number; maxIter?: number; tol?: number } = {}): { quant: Quant[]; iterations: number } {
  const T = ix.ids.length, mu = opt.fragLen ?? 200, eff = ix.lengths.map((l) => (l - mu + 1 >= 1 ? l - mu + 1 : l));
  let alpha = new Float64Array(T).fill(ec.mapped / T), it = 0; const tol = opt.tol ?? 1e-6, maxIter = opt.maxIter ?? 5000;
  for (; it < maxIter; it++) {
    const next = new Float64Array(T);
    ec.sets.forEach((set, e) => { let den = 0; for (const t of set) den += alpha[t] / eff[t]; if (!den) { for (const t of set) next[t] += ec.counts[e] / set.length; return; } for (const t of set) next[t] += (ec.counts[e] * (alpha[t] / eff[t])) / den; });
    let diff = 0; for (let t = 0; t < T; t++) if (next[t] > 1e-2 || alpha[t] > 1e-2) diff = Math.max(diff, Math.abs(next[t] - alpha[t]) / Math.max(next[t], alpha[t], 1e-9));
    alpha = next; if (diff < tol) { it++; break; }
  }
  const rate = Array.from(alpha, (a, t) => a / eff[t]), sum = rate.reduce((a, b) => a + b, 0) || 1;
  return { quant: ix.ids.map((id, t) => ({ id, length: ix.lengths[t], effLength: eff[t], estCounts: alpha[t], tpm: (rate[t] / sum) * 1e6 })), iterations: it };
}

// ---------------------------------------------------------------- demo data (synthetic)
const rngS = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const rcS = (s: string) => [...s].reverse().map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[c] ?? 'N')).join('');
/** Synthetic experiment: 60 random transcripts (some alternative isoform pairs), 3 control and 3 treated samples of simulated 75-nt reads, 5 genes up 4-fold. */
export function syntheticExperiment(seed = 5): { fasta: string; samples: { name: string; group: string; fastq: string }[]; sheet: string; up: string[] } {
  const r = rngS(seed), rand = (n: number) => Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join('');
  const tx: Tx[] = Array.from({ length: 60 }, (_, i) => ({ id: `gene${String(i + 1).padStart(2, '0')}`, seq: rand(600 + Math.floor(r() * 900)) }));
  tx[1] = { id: 'gene02', seq: tx[0].seq.slice(0, 300) + tx[0].seq.slice(520) }; // gene02 is an isoform of gene01 (skips exon)
  const base = tx.map(() => Math.exp(r() * 3.5) * 60), up = [4, 9, 17, 25, 38], upIds = up.map((i) => tx[i].id);
  const samples = ['ctrl1', 'ctrl2', 'ctrl3', 'treat1', 'treat2', 'treat3'].map((name) => {
    const treated = name.startsWith('treat'), depth = 0.8 + r() * 0.4, rates = base.map((b, i) => b * depth * (treated && up.includes(i) ? 4 : 1) * Math.exp((r() - 0.5) * 0.25));
    const tot = rates.reduce((a, b) => a + b, 0), nReads = 25000, cum: number[] = []; rates.reduce((a, b, i) => (cum[i] = a + b), 0);
    const out: string[] = [];
    for (let n = 0; n < nReads; n++) {
      const u = r() * tot; let lo = 0, hi = cum.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
      const t = tx[lo].seq, s = Math.floor(r() * (t.length - 75)); let rd = t.slice(s, s + 75); if (r() < 0.5) rd = rcS(rd);
      rd = [...rd].map((c) => (r() < 0.003 ? 'ACGT'[Math.floor(r() * 4)] : c)).join(''); out.push(`@${name}_${n}\n${rd}\n+\n${'I'.repeat(75)}`);
    }
    return { name, group: treated ? 'treated' : 'control', fastq: out.join('\n') + '\n' };
  });
  return { fasta: tx.map((t) => `>${t.id}\n${t.seq}`).join('\n') + '\n', samples, sheet: 'sample,group\n' + samples.map((s) => `${s.name},${s.group}`).join('\n') + '\n', up: upIds };
}
