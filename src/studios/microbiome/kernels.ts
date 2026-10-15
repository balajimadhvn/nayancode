/** Microbiome kernels: feature tables, alpha/beta diversity, PCoA, PERMANOVA, CLR differential abundance. */
import { bh, jacobiEigen, lgamma, tTwoSided } from '../expression/kernels';

export interface FeatureTable { features: string[]; samples: string[]; counts: Float64Array; taxonomy: string[] } // features × samples
export function parseFeatureTable(text: string): FeatureTable {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('# Constructed')); if (lines.length < 2) throw new Error('Need a header and at least one feature row.');
  const d = lines[0].includes('\t') ? '\t' : ',', clean = (s: string) => s.trim().replace(/^"|"$/g, '');
  let head = lines[0].split(d).map(clean); if (head[0].startsWith('#')) head[0] = head[0].replace(/^#+\s*/, '');
  const taxCol = head.findIndex((h, i) => i > 0 && /^(taxonomy|taxon|lineage|consensus lineage)$/i.test(h));
  const sIdx = head.map((_, i) => i).filter((i) => i > 0 && i !== taxCol), samples = sIdx.map((i) => head[i]);
  if (samples.length < 2) throw new Error('Need at least two sample columns.');
  const features: string[] = [], taxonomy: string[] = [], counts = new Float64Array((lines.length - 1) * samples.length);
  for (let r = 1; r < lines.length; r++) {
    const f = lines[r].split(d).map(clean); if (f.length !== head.length) throw new Error(`Line ${r + 1}: expected ${head.length} columns, found ${f.length}.`);
    features.push(f[0]); taxonomy.push(taxCol >= 0 ? f[taxCol] : '');
    sIdx.forEach((c, j) => { const v = Number(f[c]); if (!Number.isFinite(v) || v < 0) throw new Error(`Line ${r + 1}, sample ${samples[j]}: "${f[c]}" is not a non-negative count.`); counts[(r - 1) * samples.length + j] = v; });
  }
  return { features, samples, counts, taxonomy };
}
export function parseMetadata(text: string, samples: string[]): { columns: string[]; values: Record<string, string[]> } {
  const lines = text.split(/\r?\n/).filter(Boolean), d = lines[0].includes('\t') ? '\t' : ',', clean = (s: string) => s.trim().replace(/^"|"$/g, '');
  const head = lines[0].split(d).map(clean), rows = new Map(lines.slice(1).map((l) => { const f = l.split(d).map(clean); return [f[0], f] as const; }));
  const miss = samples.filter((s) => !rows.has(s)); if (miss.length) throw new Error(`Metadata is missing samples: ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? '…' : ''}`);
  const values: Record<string, string[]> = {}; head.slice(1).forEach((h, i) => { values[h] = samples.map((s) => rows.get(s)![i + 1] ?? ''); });
  return { columns: head.slice(1), values };
}
const col = (t: FeatureTable, j: number) => { const S = t.samples.length, out = new Float64Array(t.features.length); for (let i = 0; i < out.length; i++) out[i] = t.counts[i * S + j]; return out; };

// ---------------- alpha ----------------
export interface Alpha { depth: number; observed: number; shannon: number; simpson: number; chao1: number; pielou: number }
export function alphaDiversity(t: FeatureTable): Alpha[] {
  return t.samples.map((_, j) => {
    const c = col(t, j); let N = 0, S = 0, F1 = 0, F2 = 0; for (const v of c) { N += v; if (v > 0) S++; if (v === 1) F1++; if (v === 2) F2++; }
    let H = 0, D = 0; if (N) for (const v of c) if (v > 0) { const p = v / N; H -= p * Math.log(p); D += p * p; }
    return { depth: N, observed: S, shannon: H, simpson: 1 - D, chao1: S + (F1 * (F1 - 1)) / (2 * (F2 + 1)), pielou: S > 1 ? H / Math.log(S) : 0 };
  });
}
/** Expected richness at depth n (Hurlbert 1971) — analytic rarefaction, no random subsampling. */
export function rarefactionCurve(t: FeatureTable, j: number, points = 12): { depth: number; richness: number }[] {
  const c = col(t, j), N = c.reduce((a, b) => a + b, 0), lc = (n: number, k: number) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
  return Array.from({ length: points }, (_, i) => Math.max(1, Math.round((N * (i + 1)) / points))).map((n) => { let e = 0; for (const v of c) if (v > 0) e += N - v >= n ? 1 - Math.exp(lc(N - v, n) - lc(N, n)) : 1; return { depth: n, richness: e }; });
}

// ---------------- beta ----------------
export type BetaMetric = 'bray' | 'jaccard' | 'aitchison';
export function betaDiversity(t: FeatureTable, metric: BetaMetric): number[][] {
  const S = t.samples.length, F = t.features.length, cols = Array.from({ length: S }, (_, j) => col(t, j)), D = Array.from({ length: S }, () => new Array(S).fill(0));
  const tot = cols.map((c) => c.reduce((a, b) => a + b, 0) || 1);
  let clr: Float64Array[] = [];
  if (metric === 'aitchison') clr = cols.map((c) => { const l = Array.from(c, (v) => Math.log(v + 0.5)), m = l.reduce((a, b) => a + b, 0) / F; return Float64Array.from(l, (v) => v - m); });
  for (let a = 0; a < S; a++) for (let b = a + 1; b < S; b++) {
    let d = 0;
    if (metric === 'bray') { let mn = 0, sm = 0; for (let i = 0; i < F; i++) { const x = cols[a][i] / tot[a], y = cols[b][i] / tot[b]; mn += Math.min(x, y); sm += x + y; } d = sm ? 1 - (2 * mn) / sm : 0; }
    else if (metric === 'jaccard') { let inter = 0, uni = 0; for (let i = 0; i < F; i++) { const x = cols[a][i] > 0, y = cols[b][i] > 0; if (x && y) inter++; if (x || y) uni++; } d = uni ? 1 - inter / uni : 0; }
    else { let s = 0; for (let i = 0; i < F; i++) s += (clr[a][i] - clr[b][i]) ** 2; d = Math.sqrt(s); }
    D[a][b] = D[b][a] = d;
  }
  return D;
}
export function pcoa(D: number[][], nAxes = 3): { coords: number[][]; varExplained: number[]; negative: number } {
  const n = D.length, A = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (_, j) => -0.5 * D[i][j] ** 2));
  const rm = A.map((r) => r.reduce((a, b) => a + b, 0) / n), gm = rm.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] = A[i][j] - rm[i] - rm[j] + gm;
  const { values, vectors } = jacobiEigen(A), ord = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const pos = ord.filter(([v]) => v > 1e-10), tot = pos.reduce((a, [v]) => a + v, 0) || 1, k = Math.min(nAxes, pos.length);
  return { coords: Array.from({ length: n }, (_, i) => pos.slice(0, k).map(([v, idx]) => vectors[i][idx] * Math.sqrt(v))), varExplained: pos.slice(0, k).map(([v]) => v / tot), negative: ord.filter(([v]) => v < -1e-8).length };
}
export function permanova(D: number[][], groups: string[], perms = 999, seed = 1): { F: number; R2: number; p: number; df: [number, number] } {
  const n = groups.length, levels = [...new Set(groups)], g = levels.length; if (g < 2) throw new Error('PERMANOVA needs at least two groups.'); if (n <= g) throw new Error('Need more samples than groups.');
  let sst = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sst += D[i][j] ** 2; sst /= n;
  const stat = (lab: string[]) => { let ssw = 0; for (const lv of levels) { const idx = lab.map((x, i) => (x === lv ? i : -1)).filter((i) => i >= 0); let s = 0; for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) s += D[idx[a]][idx[b]] ** 2; ssw += s / idx.length; } const ssa = sst - ssw; return { F: (ssa / (g - 1)) / (ssw / (n - g)), R2: ssa / sst }; };
  const obs = stat(groups); let s = seed; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); const lab = [...groups]; let ge = 0;
  for (let p = 0; p < perms; p++) { for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [lab[i], lab[j]] = [lab[j], lab[i]]; } if (stat(lab).F >= obs.F - 1e-12) ge++; }
  return { ...obs, p: (ge + 1) / (perms + 1), df: [g - 1, n - g] };
}

// ---------------- group tests ----------------
export function mannWhitney(a: number[], b: number[]): number {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v), n = all.length, ranks = new Array(n); let tieTerm = 0;
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && all[j + 1].v === all[i].v) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) ranks[k] = r; const t = j - i + 1; tieTerm += t ** 3 - t; i = j + 1; }
  const n1 = a.length, n2 = b.length; let R1 = 0; all.forEach((x, i) => { if (x.g === 0) R1 += ranks[i]; });
  const U = R1 - (n1 * (n1 + 1)) / 2, mu = (n1 * n2) / 2, sd = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1)))); if (!sd) return 1;
  const z = (Math.abs(U - mu) - 0.5) / sd; return Math.min(1, 2 * (1 - normCdf(Math.max(0, z))));
}
const normCdf = (z: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp((-z * z) / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
function gammaQ(a: number, x: number): number { // regularised upper incomplete gamma
  if (x <= 0) return 1;
  if (x < a + 1) { let sum = 1 / a, del = sum, ap = a; for (let n = 0; n < 300; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; } return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d; for (let i = 1; i < 300; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
export function kruskalWallis(groups: number[][]): number {
  const all = groups.flatMap((g, gi) => g.map((v) => ({ v, gi }))).sort((x, y) => x.v - y.v), n = all.length, ranks = new Array(n); let tie = 0;
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && all[j + 1].v === all[i].v) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) ranks[k] = r; const t = j - i + 1; tie += t ** 3 - t; i = j + 1; }
  const sums = groups.map(() => 0); all.forEach((x, i) => { sums[x.gi] += ranks[i]; });
  let H = (12 / (n * (n + 1))) * sums.reduce((a, s, i) => a + (s * s) / groups[i].length, 0) - 3 * (n + 1); H /= 1 - tie / (n ** 3 - n) || 1; return gammaQ((groups.length - 1) / 2, H / 2);
}
export const compareGroups = (vals: number[], groups: string[]) => { const lv = [...new Set(groups)]; const gs = lv.map((l) => vals.filter((_, i) => groups[i] === l)); return lv.length === 2 ? mannWhitney(gs[0], gs[1]) : lv.length > 2 ? kruskalWallis(gs) : NaN; };

// ---------------- differential abundance (CLR + Welch) ----------------
export interface DaRow { feature: string; taxon: string; log2fc: number; t: number; p: number; fdr: number; prevalence: number; meanAbund: number }
export function differentialAbundance(t: FeatureTable, groups: string[], a: string, b: string, minPrevalence = 0.2): DaRow[] {
  const S = t.samples.length, F = t.features.length, ia = groups.map((g, i) => (g === a ? i : -1)).filter((i) => i >= 0), ib = groups.map((g, i) => (g === b ? i : -1)).filter((i) => i >= 0);
  if (a === b) throw new Error('Choose two different groups.'); if (ia.length < 3 || ib.length < 3) throw new Error('Each group needs at least 3 samples.');
  const tot = Array.from({ length: S }, (_, j) => { let s = 0; for (let i = 0; i < F; i++) s += t.counts[i * S + j]; return s || 1; });
  const keep: number[] = []; for (let i = 0; i < F; i++) { let n = 0; for (let j = 0; j < S; j++) if (t.counts[i * S + j] > 0) n++; if (n / S >= minPrevalence) keep.push(i); }
  const K = keep.length; if (K < 3) throw new Error('Too few features pass the prevalence filter.');
  const clr = Array.from({ length: S }, (_, j) => { const l = keep.map((i) => Math.log(t.counts[i * S + j] + 0.5)), m = l.reduce((x, y) => x + y, 0) / K; return l.map((v) => v - m); });
  const rows: DaRow[] = keep.map((i, k) => {
    const va = ia.map((j) => clr[j][k]), vb = ib.map((j) => clr[j][k]), ma = va.reduce((x, y) => x + y, 0) / va.length, mb = vb.reduce((x, y) => x + y, 0) / vb.length;
    const sa = va.reduce((x, y) => x + (y - ma) ** 2, 0) / (va.length - 1), sb = vb.reduce((x, y) => x + (y - mb) ** 2, 0) / (vb.length - 1), se = Math.sqrt(sa / va.length + sb / vb.length);
    const tt = se ? (mb - ma) / se : 0, df = se ? (sa / va.length + sb / vb.length) ** 2 / ((sa / va.length) ** 2 / (va.length - 1) + (sb / vb.length) ** 2 / (vb.length - 1)) : 1;
    const rel = (idx: number[]) => idx.reduce((x, j) => x + t.counts[i * S + j] / tot[j], 0) / idx.length;
    let prev = 0; for (let j = 0; j < S; j++) if (t.counts[i * S + j] > 0) prev++;
    return { feature: t.features[i], taxon: t.taxonomy[i], log2fc: Math.log2((rel(ib) + 1e-6) / (rel(ia) + 1e-6)), t: tt, p: tTwoSided(tt, df), fdr: NaN, prevalence: prev / S, meanAbund: rel([...ia, ...ib]) };
  });
  const q = bh(rows.map((r) => r.p)); rows.forEach((r, i) => { r.fdr = q[i]; }); return rows.sort((x, y) => x.p - y.p);
}

// ---------------- composition ----------------
export const RANKS = ['Kingdom', 'Phylum', 'Class', 'Order', 'Family', 'Genus', 'Species'] as const;
export function aggregateTaxa(t: FeatureTable, rank: number, top = 10): { taxa: string[]; rel: number[][] } {
  const S = t.samples.length, name = (tax: string) => { const p = tax.split(';').map((x) => x.trim().replace(/^[a-z]__/, '')).filter(Boolean); return p[rank] ?? (p.length ? `Unclassified ${p[p.length - 1]}` : 'Unclassified'); };
  const m = new Map<string, number[]>(); t.features.forEach((_, i) => { const k = name(t.taxonomy[i]); const row = m.get(k) ?? new Array(S).fill(0); for (let j = 0; j < S; j++) row[j] += t.counts[i * S + j]; m.set(k, row); });
  const tot = Array.from({ length: S }, (_, j) => [...m.values()].reduce((a, r) => a + r[j], 0) || 1);
  const ranked = [...m.entries()].map(([k, r]) => ({ k, r: r.map((v, j) => v / tot[j]) })).sort((a, b) => b.r.reduce((x, y) => x + y, 0) - a.r.reduce((x, y) => x + y, 0));
  const head = ranked.slice(0, top), rest = ranked.slice(top);
  const rel = head.map((h) => h.r); if (rest.length) rel.push(Array.from({ length: S }, (_, j) => rest.reduce((a, r) => a + r.r[j], 0)));
  return { taxa: [...head.map((h) => h.k), ...(rest.length ? ['Other'] : [])], rel };
}

// ---------------- demo (synthetic) ----------------
export function syntheticMicrobiome(seed = 6, perGroup = 12): { table: string; meta: string; truth: Set<string>; taxonomy: { ids: string[]; lineages: string[] } } {
  let s = seed >>> 0; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296), g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const G: [string, string, string, string, string][] = [['Bacteroides', 'Bacteroidetes', 'Bacteroidia', 'Bacteroidales', 'Bacteroidaceae'], ['Prevotella', 'Bacteroidetes', 'Bacteroidia', 'Bacteroidales', 'Prevotellaceae'], ['Alistipes', 'Bacteroidetes', 'Bacteroidia', 'Bacteroidales', 'Rikenellaceae'], ['Faecalibacterium', 'Firmicutes', 'Clostridia', 'Clostridiales', 'Ruminococcaceae'], ['Ruminococcus', 'Firmicutes', 'Clostridia', 'Clostridiales', 'Ruminococcaceae'], ['Blautia', 'Firmicutes', 'Clostridia', 'Clostridiales', 'Lachnospiraceae'], ['Roseburia', 'Firmicutes', 'Clostridia', 'Clostridiales', 'Lachnospiraceae'], ['Clostridium', 'Firmicutes', 'Clostridia', 'Clostridiales', 'Clostridiaceae'], ['Lactobacillus', 'Firmicutes', 'Bacilli', 'Lactobacillales', 'Lactobacillaceae'], ['Streptococcus', 'Firmicutes', 'Bacilli', 'Lactobacillales', 'Streptococcaceae'], ['Veillonella', 'Firmicutes', 'Negativicutes', 'Selenomonadales', 'Veillonellaceae'], ['Bifidobacterium', 'Actinobacteria', 'Actinobacteria', 'Bifidobacteriales', 'Bifidobacteriaceae'], ['Escherichia', 'Proteobacteria', 'Gammaproteobacteria', 'Enterobacteriales', 'Enterobacteriaceae'], ['Akkermansia', 'Verrucomicrobia', 'Verrucomicrobiae', 'Verrucomicrobiales', 'Verrucomicrobiaceae']];
  const up = new Set(['Akkermansia', 'Bifidobacterium', 'Lactobacillus']), down = new Set(['Escherichia', 'Streptococcus', 'Veillonella']);
  const feats: { id: string; tax: string; base: number; fx: number; genus: string }[] = []; let id = 1;
  for (const [gen, ph, cl, or, fa] of G) for (let k = 0; k < 8; k++) feats.push({ id: `ASV${String(id++).padStart(3, '0')}`, tax: `k__Bacteria;p__${ph};c__${cl};o__${or};f__${fa};g__${gen}`, base: Math.exp(g() * 1.1 + 2), fx: up.has(gen) ? 2.5 : down.has(gen) ? -2.5 : 0, genus: gen });
  const samples: string[] = [], grp: string[] = [], cols: number[][] = [];
  for (let sIdx = 0; sIdx < perGroup * 2; sIdx++) {
    const treated = sIdx >= perGroup; samples.push(`${treated ? 'T' : 'C'}${(sIdx % perGroup) + 1}`); grp.push(treated ? 'treated' : 'control'); const depth = 8000 + r() * 12000;
    const prop = feats.map((f) => f.base * Math.exp((treated ? f.fx : 0) * 0.5 + g() * 0.35)), tot = prop.reduce((a, b) => a + b, 0);
    cols.push(prop.map((p) => { const mu = (p / tot) * depth; if (mu > 40) return Math.max(0, Math.round(mu + Math.sqrt(mu) * g())); const L = Math.exp(-mu); let k = 0, q = 1; do { k++; q *= r(); } while (q > L); return k - 1; }));
  }
  const table = ['feature,' + samples.join(',') + ',taxonomy', ...feats.map((f, i) => `${f.id},${cols.map((c) => c[i]).join(',')},${f.tax}`)].join('\n');
  return { taxonomy: { ids: feats.map((f) => f.id), lineages: feats.map((f) => f.tax) }, table, meta: 'sample,group\n' + samples.map((x, i) => `${x},${grp[i]}`).join('\n'), truth: new Set(feats.filter((f) => up.has(f.genus) || down.has(f.genus)).map((f) => f.id)) };
}
