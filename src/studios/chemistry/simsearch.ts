/**
 * Tanimoto similarity over packed 2048-bit Morgan fingerprints (64 u32 words)
 * and Taylor-Butina clustering on Tanimoto distance. Pure maths, no DOM.
 * The fingerprint itself comes from RDKit (radius 2, 2048 bits) via the
 * existing chemistry worker; this module only compares packed bits.
 */
export const FP_WORDS = 64;
export const FP_BITS = 2048;
export const MAX_BUTINA = 20_000;

export interface Neighbour { index: number; sim: number }
export interface ButinaResult { cluster: Int32Array; centroids: number[]; sizes: number[] }

/** Population count of a 32-bit word. */
export function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/** Tanimoto of molecule ia in a and molecule ib in b, both packed 64 words each. */
export function tanimotoCpu(a: Uint32Array, ia: number, b: Uint32Array, ib: number): number {
  let inter = 0, uni = 0;
  const ao = ia * FP_WORDS, bo = ib * FP_WORDS;
  for (let w = 0; w < FP_WORDS; w++) {
    const x = a[ao + w], y = b[bo + w];
    inter += popcount32(x & y);
    uni += popcount32(x | y);
  }
  return uni === 0 ? 0 : inter / uni;
}

/** Best k database molecules for one 64-word query, highest similarity first (ties: lower index). */
export function topK(queryFp: Uint32Array, db: Uint32Array, k: number): Neighbour[] {
  const n = Math.floor(db.length / FP_WORDS);
  const out: Neighbour[] = [];
  for (let i = 0; i < n; i++) {
    const sim = tanimotoCpu(queryFp, 0, db, i);
    if (out.length < k || (out.length > 0 && sim > out[out.length - 1].sim)) {
      let p = out.length;
      while (p > 0 && out[p - 1].sim < sim) p--;
      out.splice(p, 0, { index: i, sim });
      if (out.length > k) out.pop();
    }
  }
  return out;
}

/**
 * Taylor-Butina on Tanimoto distance: neighbours are pairs with
 * 1 - similarity <= cutoffDistance. Repeatedly take the unassigned molecule
 * with the most unassigned neighbours as a centroid, then assign it and all of
 * its unassigned neighbours. Ties go to the lowest index.
 */
export function butinaFromLists(nb: readonly number[][], n: number): ButinaResult {
  const cluster = new Int32Array(n).fill(-1);
  const centroids: number[] = [], sizes: number[] = [];
  let left = n;
  while (left > 0) {
    let best = -1, bestCount = -1;
    for (let i = 0; i < n; i++) {
      if (cluster[i] >= 0) continue;
      let c = 0;
      for (const j of nb[i]) if (cluster[j] < 0) c++;
      if (c > bestCount) { bestCount = c; best = i; }
    }
    const c = centroids.length;
    centroids.push(best); cluster[best] = c; left--;
    let size = 1;
    for (const j of nb[best]) if (cluster[j] < 0) { cluster[j] = c; left--; size++; }
    sizes.push(size);
  }
  return { cluster, centroids, sizes };
}

/** CPU Butina for N <= 20,000; the all-pairs neighbour lists are the memory bound. */
export function butina(db: Uint32Array, n: number, cutoffDistance = 0.4): ButinaResult {
  if (n > MAX_BUTINA) throw new Error(`Butina clustering is limited to ${MAX_BUTINA.toLocaleString()} molecules in the browser (all-pairs memory); this set has ${n.toLocaleString()}.`);
  if (n <= 0) return { cluster: new Int32Array(0), centroids: [], sizes: [] };
  const cutoff = Math.min(1, Math.max(0, cutoffDistance));
  const nb: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (1 - tanimotoCpu(db, i, db, j) <= cutoff) { nb[i].push(j); nb[j].push(i); }
    }
  }
  return butinaFromLists(nb, n);
}

/** Build Butina clusters from a row-major N x words neighbour bitmap (GPU readback). */
export function butinaFromBitmap(bitmap: Uint32Array, n: number): ButinaResult {
  const words = Math.ceil(n / 32);
  const nb: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const base = i * words;
    for (let w = 0; w < words; w++) {
      let bits = bitmap[base + w];
      while (bits) {
        const lsb = bits & -bits;
        const j = w * 32 + popcount32(lsb - 1);
        if (j < n && j !== i) nb[i].push(j);
        bits ^= lsb;
      }
    }
  }
  return butinaFromLists(nb, n);
}
