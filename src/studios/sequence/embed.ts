/** Small vector helpers for protein-language-model embeddings (no React, no DOM). */

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Parse `id,label` or `id<TAB>label` lines into a lookup keyed by the FASTA id. */
export function parseLabels(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [id, ...rest] = line.split(/[,\t]/);
    if (id && rest.length) out[id.trim()] = rest.join(',').trim();
  }
  return out;
}

/** Two-component PCA by deterministic power iteration (orthogonal deflation for PC2).
 *  Returns centred projections and the fraction of total variance explained by each component. */
export function pca2(vectors: number[][]): { x: number[]; y: number[]; explained: number[] } {
  const n = vectors.length;
  if (!n) return { x: [], y: [], explained: [0, 0] };
  const d = vectors[0].length;
  if (!d) return { x: new Array(n).fill(0), y: new Array(n).fill(0), explained: [0, 0] };
  const mean = new Array(d).fill(0);
  for (const row of vectors) for (let j = 0; j < d; j++) mean[j] += row[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  const centred = vectors.map((row) => row.map((v, j) => v - mean[j]));

  const total = centred.reduce((s, row) => s + row.reduce((t, v) => t + v * v, 0), 0) / Math.max(1, n);
  const iterate = (deflate: number[] | null): number[] => {
    let v = Array.from({ length: d }, (_, j) => Math.sin(j + 1) + 0.01);
    const norm = (a: number[]) => { const m = Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1; return a.map((x) => x / m); };
    v = norm(v);
    for (let it = 0; it < 80; it++) {
      let next = new Array(d).fill(0);
      for (const row of centred) {
        let proj = 0;
        for (let j = 0; j < d; j++) proj += row[j] * v[j];
        for (let j = 0; j < d; j++) next[j] += proj * row[j];
      }
      if (deflate) {
        const dot = next.reduce((s, x, j) => s + x * deflate[j], 0);
        next = next.map((x, j) => x - dot * deflate[j]);
      }
      const nv = norm(next);
      if (nv.every((x, j) => Math.abs(x - v[j]) < 1e-10)) { v = nv; break; }
      v = nv;
    }
    return v;
  };
  const pc1 = iterate(null);
  const pc2 = d > 1 ? iterate(pc1) : new Array(d).fill(0);
  const score = (row: number[], v: number[]) => row.reduce((s, x, j) => s + x * v[j], 0);
  const x = centred.map((row) => score(row, pc1));
  const y = centred.map((row) => score(row, pc2));
  const var1 = x.reduce((s, v) => s + v * v, 0) / Math.max(1, n);
  const var2 = y.reduce((s, v) => s + v * v, 0) / Math.max(1, n);
  return { x, y, explained: [total ? var1 / total : 0, total ? var2 / total : 0] };
}

/** Nearest neighbour (other than the query itself) by cosine similarity. */
export function nearestNeighbour(vectors: number[][], i: number): { index: number; cosine: number } {
  let best = -1, bestCos = -Infinity;
  for (let j = 0; j < vectors.length; j++) {
    if (j === i) continue;
    const c = cosine(vectors[i], vectors[j]);
    if (c > bestCos) { bestCos = c; best = j; }
  }
  return { index: best, cosine: bestCos };
}
