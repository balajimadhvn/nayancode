// Agreement metrics used by the benchmarks.
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

export const readGz = (p: string) => gunzipSync(readFileSync(p)).toString('utf8');
export const writeJson = (p: string, x: unknown) => writeFileSync(p, JSON.stringify(x, null, 2) + '\n');

export function pearson(a: number[], b: number[]): number {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}
const ranks = (v: number[]) => { const o = v.map((x, i) => [x, i] as const).sort((x, y) => x[0] - y[0]), r = new Array(v.length); for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
export const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

export function overlap<T>(a: Set<T>, b: Set<T>) {
  const inter = [...a].filter((x) => b.has(x)).length;
  return { a: a.size, b: b.size, both: inter, jaccard: a.size + b.size - inter ? inter / (a.size + b.size - inter) : 1, aInB: a.size ? inter / a.size : 1, bInA: b.size ? inter / b.size : 1 };
}

/** Adjusted Rand index (Hubert & Arabie 1985) between two labelings of the same items. */
export function ari(x: (string | number)[], y: (string | number)[]): number {
  const t = new Map<string, number>(), ra = new Map<string | number, number>(), rb = new Map<string | number, number>();
  x.forEach((a, i) => { const k = `${a}\u0000${y[i]}`; t.set(k, (t.get(k) ?? 0) + 1); ra.set(a, (ra.get(a) ?? 0) + 1); rb.set(y[i], (rb.get(y[i]) ?? 0) + 1); });
  const c2 = (n: number) => (n * (n - 1)) / 2, n = x.length;
  const sij = [...t.values()].reduce((s, v) => s + c2(v), 0), sa = [...ra.values()].reduce((s, v) => s + c2(v), 0), sb = [...rb.values()].reduce((s, v) => s + c2(v), 0);
  const exp = (sa * sb) / c2(n), max = (sa + sb) / 2;
  return (sij - exp) / (max - exp);
}
/** Normalised mutual information (arithmetic-mean normalisation, as scikit-learn's default). */
export function nmi(x0: (string | number)[], y0: (string | number)[]): number {
  const x = x0.map(String), y = y0.map(String), n = x.length, t = new Map<string, number>(), ra = new Map<string, number>(), rb = new Map<string, number>();
  x.forEach((a, i) => { const k = `${a}\u0000${y[i]}`; t.set(k, (t.get(k) ?? 0) + 1); ra.set(a, (ra.get(a) ?? 0) + 1); rb.set(y[i], (rb.get(y[i]) ?? 0) + 1); });
  const H = (m: Map<string, number>) => -[...m.values()].reduce((s, v) => s + (v / n) * Math.log(v / n), 0);
  let mi = 0; for (const [k, v] of t) { const [a, b] = k.split('\u0000'); mi += (v / n) * Math.log((v * n) / (ra.get(a)! * rb.get(b)!)); }
  const ha = H(ra), hb = H(rb); return ha + hb ? (2 * mi) / (ha + hb) : 1;
}
export const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
