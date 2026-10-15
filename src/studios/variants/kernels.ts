/** Variant kernels: VCF parsing, QC, filtering, mutation spectrum/TMB, GWAS summary statistics. */

export interface SampleCall { gt: string; dp: number | null; gq: number | null; vaf: number | null }
export type VType = 'SNV' | 'MNV' | 'INS' | 'DEL' | 'COMPLEX' | 'SV';
export interface Variant { chrom: string; pos: number; id: string; ref: string; alt: string; nAlt: number; qual: number | null; filter: string; info: Record<string, string>; type: VType; ti: boolean | null; dp: number | null; af: number | null; calls: SampleCall[] }
export interface Vcf { samples: string[]; variants: Variant[]; contigs: string[]; skipped: number }

export function classify(ref: string, alt: string): VType {
  if (alt.startsWith('<') || alt.includes('[') || alt.includes(']') || alt === '*') return 'SV';
  if (ref.length === 1 && alt.length === 1) return 'SNV';
  if (ref.length === alt.length) return 'MNV';
  if (ref.length === 1 && alt.startsWith(ref)) return 'INS';
  if (alt.length === 1 && ref.startsWith(alt)) return 'DEL';
  if (ref.length < alt.length && alt.startsWith(ref)) return 'INS';
  if (alt.length < ref.length && ref.startsWith(alt)) return 'DEL';
  return 'COMPLEX';
}
const PURINE = new Set(['A', 'G']);
const num = (s: string | undefined) => { if (s === undefined || s === '.' || s === '') return null; const v = Number(s); return Number.isFinite(v) ? v : null; };

export function parseVcf(text: string): Vcf {
  const lines = text.split(/\r?\n/);
  let samples: string[] = [], headerSeen = false, skipped = 0; const variants: Variant[] = []; const contigs = new Set<string>();
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('##')) continue;
    if (line.startsWith('#CHROM')) { const f = line.split('\t'); if (f.length < 8) throw new Error('VCF header has fewer than 8 columns.'); samples = f.slice(9); headerSeen = true; continue; }
    if (!headerSeen) throw new Error('This does not look like a VCF (no #CHROM header line).');
    const f = line.split('\t');
    if (f.length < 8) { skipped++; continue; }
    const pos = Number(f[1]); if (!Number.isInteger(pos)) { skipped++; continue; }
    const alts = f[4].split(','), alt = alts[0], ref = f[3].toUpperCase();
    const info: Record<string, string> = {};
    if (f[7] !== '.') for (const kv of f[7].split(';')) { const e = kv.indexOf('='); if (e < 0) info[kv] = 'true'; else info[kv.slice(0, e)] = kv.slice(e + 1); }
    const type = classify(ref, alt);
    let ti: boolean | null = null; if (type === 'SNV') { const a = alt.toUpperCase(); ti = (PURINE.has(ref) && PURINE.has(a)) || (!PURINE.has(ref) && !PURINE.has(a)); }
    const calls: SampleCall[] = [];
    if (f.length > 9) {
      const keys = f[8].split(':');
      for (let s = 9; s < f.length; s++) {
        const v = f[s].split(':'), get = (k: string) => { const i = keys.indexOf(k); return i >= 0 ? v[i] : undefined; };
        const ad = get('AD')?.split(',').map(Number); let vaf: number | null = null;
        if (ad && ad.length >= 2 && ad.every(Number.isFinite)) { const t = ad.reduce((a, b) => a + b, 0); vaf = t ? ad[1] / t : null; } else if (get('AF')) vaf = num(get('AF')?.split(',')[0]);
        calls.push({ gt: (get('GT') ?? './.').replace('|', '/'), dp: num(get('DP')), gq: num(get('GQ')), vaf });
      }
    }
    const dp = num(info.DP) ?? (calls.length ? calls.reduce((a, c) => a + (c.dp ?? 0), 0) : null);
    variants.push({ chrom: f[0], pos, id: f[2], ref, alt: alt.toUpperCase(), nAlt: alts.length, qual: num(f[5]), filter: f[6], info, type, ti, dp, af: num(info.AF?.split(',')[0]), calls });
    contigs.add(f[0]);
  }
  if (!headerSeen) throw new Error('This does not look like a VCF (no #CHROM header line).');
  return { samples, variants, contigs: [...contigs], skipped };
}

// ---------------- QC ----------------
const comp: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
export const SBS6 = ['C>A', 'C>G', 'C>T', 'T>A', 'T>C', 'T>G'] as const;
export function sbsClass(ref: string, alt: string): (typeof SBS6)[number] | null {
  let r = ref, a = alt; if (!comp[r] || !comp[a] || r === a) return null;
  if (r === 'A' || r === 'G') { r = comp[r]; a = comp[a]; }
  const k = `${r}>${a}` as (typeof SBS6)[number]; return SBS6.includes(k) ? k : null;
}
export interface VcfQc {
  n: number; passing: number; byType: Record<VType, number>; titv: number; ts: number; tv: number; multiAllelic: number;
  spectrum: Record<(typeof SBS6)[number], number>; perChrom: { chrom: string; n: number }[];
  perSample: { sample: string; het: number; hom: number; hetHom: number; meanDp: number; called: number }[];
  qual: number[]; dp: number[]; vaf: number[]; indelFrac: number;
}
export function vcfQc(v: Vcf, only: Variant[] = v.variants): VcfQc {
  const byType: Record<VType, number> = { SNV: 0, MNV: 0, INS: 0, DEL: 0, COMPLEX: 0, SV: 0 };
  const spectrum = Object.fromEntries(SBS6.map((k) => [k, 0])) as Record<(typeof SBS6)[number], number>;
  let ts = 0, tv = 0, multi = 0; const chrom = new Map<string, number>(); const qual: number[] = [], dp: number[] = [], vaf: number[] = [];
  const ps = v.samples.map(() => ({ het: 0, hom: 0, dpSum: 0, dpN: 0, called: 0 }));
  for (const x of only) {
    byType[x.type]++; if (x.ti === true) ts++; else if (x.ti === false) tv++; if (x.nAlt > 1) multi++;
    const c = sbsClass(x.ref, x.alt); if (c && x.type === 'SNV') spectrum[c]++;
    chrom.set(x.chrom, (chrom.get(x.chrom) ?? 0) + 1);
    if (x.qual !== null) qual.push(x.qual); if (x.dp !== null) dp.push(x.dp);
    x.calls.forEach((cl, i) => {
      const al = cl.gt.split('/'); if (al.includes('.')) return; ps[i].called++;
      if (al[0] === al[1]) { if (al[0] !== '0') ps[i].hom++; } else ps[i].het++;
      if (cl.dp !== null) { ps[i].dpSum += cl.dp; ps[i].dpN++; }
      if (i === 0 && cl.vaf !== null && al.some((a) => a !== '0')) vaf.push(cl.vaf);
    });
  }
  const ind = byType.INS + byType.DEL;
  return { n: v.variants.length, passing: only.length, byType, ts, tv, titv: tv ? ts / tv : NaN, multiAllelic: multi, spectrum, perChrom: [...chrom.entries()].map(([c, n]) => ({ chrom: c, n })).sort((a, b) => chromRank(a.chrom) - chromRank(b.chrom)),
    perSample: v.samples.map((s, i) => ({ sample: s, het: ps[i].het, hom: ps[i].hom, hetHom: ps[i].hom ? ps[i].het / ps[i].hom : NaN, meanDp: ps[i].dpN ? ps[i].dpSum / ps[i].dpN : NaN, called: ps[i].called })), qual, dp, vaf, indelFrac: only.length ? ind / only.length : 0 };
}
export const chromRank = (c: string) => { const s = c.replace(/^chr/i, ''); const n = Number(s); if (Number.isFinite(n)) return n; return { X: 23, Y: 24, M: 25, MT: 25 }[s.toUpperCase()] ?? 100 + s.charCodeAt(0); };

// ---------------- Filters ----------------
export type Field = 'QUAL' | 'DP' | 'AF' | 'VAF' | 'FILTER' | 'TYPE' | 'CHROM' | 'GT';
export interface Rule { field: Field; op: '>=' | '<=' | '=' | '!='; value: string; sample?: number }
export function matches(x: Variant, r: Rule): boolean {
  const cmp = (a: number | null, b: number) => (a === null ? false : r.op === '>=' ? a >= b : r.op === '<=' ? a <= b : r.op === '=' ? a === b : a !== b);
  const eq = (a: string) => (r.op === '!=' ? a !== r.value : a === r.value);
  const si = r.sample ?? 0, call = x.calls[si];
  switch (r.field) {
    case 'QUAL': return cmp(x.qual, +r.value); case 'DP': return cmp(call ? call.dp : x.dp, +r.value); case 'AF': return cmp(x.af, +r.value);
    case 'VAF': return cmp(call?.vaf ?? null, +r.value); case 'FILTER': return eq(x.filter); case 'TYPE': return eq(x.type);
    case 'CHROM': return eq(x.chrom.replace(/^chr/i, '')) || eq(x.chrom); case 'GT': return call ? eq(call.gt) : false;
  }
}
export function applyRules(vs: Variant[], rules: Rule[]): { kept: Variant[]; funnel: { label: string; n: number }[] } {
  let cur = vs; const funnel = [{ label: 'All variants', n: vs.length }];
  for (const r of rules) { cur = cur.filter((x) => matches(x, r)); funnel.push({ label: `${r.field} ${r.op} ${r.value}`, n: cur.length }); }
  return { kept: cur, funnel };
}
export const tmb = (nMut: number, callableMb: number) => nMut / callableMb;

// ---------------- Ensembl VEP (request builder + parser; network lives in the UI) ----------------
export function vepRequest(vs: Variant[]): { variants: string[] } {
  return { variants: vs.filter((v) => v.type !== 'SV').slice(0, 200).map((v) => `${v.chrom.replace(/^chr/i, '')} ${v.pos} ${v.id === '.' ? '.' : v.id} ${v.ref} ${v.alt} . . .`) };
}
export interface VepRow { input: string; consequence: string; impact: string; gene: string; biotype: string }
export function parseVep(json: unknown): VepRow[] {
  if (!Array.isArray(json)) throw new Error('Unexpected VEP response.');
  const rank = { HIGH: 3, MODERATE: 2, LOW: 1, MODIFIER: 0 } as Record<string, number>;
  return json.map((r: { input?: string; most_severe_consequence?: string; transcript_consequences?: { gene_symbol?: string; impact?: string; biotype?: string; consequence_terms?: string[] }[] }) => {
    const tc = [...(r.transcript_consequences ?? [])].sort((a, b) => (rank[b.impact ?? ''] ?? 0) - (rank[a.impact ?? ''] ?? 0))[0];
    return { input: r.input ?? '', consequence: r.most_severe_consequence ?? '–', impact: tc?.impact ?? '–', gene: tc?.gene_symbol ?? '–', biotype: tc?.biotype ?? '–' };
  });
}

// ---------------- GWAS ----------------
export interface GwasRow { chrom: string; pos: number; p: number; id: string }
export function parseGwas(text: string): GwasRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean); if (lines.length < 2) throw new Error('Need a header and rows.');
  const d = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : /\s+/;
  const h = lines[0].split(d).map((x) => x.trim().replace(/^"|"$/g, '').toLowerCase());
  const find = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const ci = find('chr', 'chrom', 'chromosome', '#chrom'), pi = find('pos', 'bp', 'base_pair_location', 'position'), vi = find('p', 'pval', 'p_value', 'p-value', 'pvalue'), ii = find('rsid', 'snp', 'variant_id', 'id', 'marker');
  if (ci < 0 || pi < 0 || vi < 0) throw new Error(`Could not find chromosome, position and p-value columns. Header: ${h.join(', ')}`);
  const out: GwasRow[] = [];
  for (let i = 1; i < lines.length; i++) { const f = lines[i].split(d); const p = Number(f[vi]), pos = Number(f[pi]); if (!(p > 0 && p <= 1) || !Number.isFinite(pos)) continue; out.push({ chrom: f[ci].trim().replace(/^chr/i, ''), pos, p, id: ii >= 0 ? f[ii].trim() : `${f[ci]}:${f[pi]}` }); }
  if (!out.length) throw new Error('No valid rows (p-values must be in (0, 1]).');
  return out;
}
export function normInv(p: number): number { // Acklam's algorithm, relative error < 1.2e-9
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00], b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01], c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00], d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; let q: number, r: number;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= 1 - pl) { q = p - 0.5; r = q * q; return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
export function gwasSummary(rows: GwasRow[], maxPoints = 60000) {
  const chroms = [...new Set(rows.map((r) => r.chrom))].sort((a, b) => chromRank(a) - chromRank(b));
  const maxPos = new Map<string, number>(); for (const r of rows) maxPos.set(r.chrom, Math.max(maxPos.get(r.chrom) ?? 0, r.pos));
  const offset = new Map<string, number>(); let acc = 0; for (const c of chroms) { offset.set(c, acc); acc += maxPos.get(c)! * 1.02; }
  const chi = rows.map((r) => normInv(1 - r.p / 2) ** 2).sort((a, b) => a - b); const med = chi[Math.floor(chi.length / 2)];
  const lambda = med / 0.4549364;
  const keep = rows.filter((r, i) => r.p < 0.01 || i % Math.max(1, Math.ceil(rows.length / maxPoints)) === 0);
  const pts = keep.map((r) => ({ x: offset.get(r.chrom)! + r.pos, y: -Math.log10(r.p), chrom: r.chrom, id: r.id, pos: r.pos, p: r.p }));
  const sorted = rows.map((r) => r.p).sort((a, b) => a - b), n = sorted.length, step = Math.max(1, Math.floor(n / 4000));
  const qq: { e: number; o: number }[] = []; for (let i = 0; i < n; i += i < 200 ? 1 : step) qq.push({ e: -Math.log10((i + 0.5) / n), o: -Math.log10(sorted[i]) });
  const leads: GwasRow[] = []; for (const r of [...rows].sort((a, b) => a.p - b.p)) { if (r.p > 5e-8) break; if (!leads.some((l) => l.chrom === r.chrom && Math.abs(l.pos - r.pos) < 500_000)) leads.push(r); }
  const ticks = chroms.map((c) => ({ chrom: c, x: offset.get(c)! + maxPos.get(c)! / 2 }));
  return { n, lambda, pts, qq, leads, ticks, chroms, total: acc };
}

// ---------------- demo data (synthetic) ----------------
const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
export function syntheticVcf(seed = 4, n = 3000): string {
  const r = rng(seed), B = 'ACGT', out = ['##fileformat=VCFv4.2', '##source=synthetic-demo', '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">', '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\ttumor\tnormal'];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const pos = new Set<string>();
  for (let i = 0; i < n; i++) {
    const chrom = String(1 + Math.floor(r() * 5)), p = 10000 + Math.floor(r() * 5_000_000); if (pos.has(chrom + p)) continue; pos.add(chrom + p);
    const germ = r() < 0.35, u = r(); let ref = pick(B.split('')), alt = '';
    if (u < 0.88) { // SNV: somatic skews C>T (signature-like), germline Ti/Tv ~2
      if (!germ && r() < 0.45) { ref = r() < 0.5 ? 'C' : 'G'; alt = ref === 'C' ? 'T' : 'A'; } else if (r() < 0.66) alt = { A: 'G', G: 'A', C: 'T', T: 'C' }[ref]!; else alt = pick(B.split('').filter((b) => b !== ref && b !== { A: 'G', G: 'A', C: 'T', T: 'C' }[ref]));
    } else if (u < 0.94) { alt = ref + pick(['A', 'C', 'G', 'T']).repeat(1 + Math.floor(r() * 3)); } else { alt = ref; ref = ref + pick(['A', 'C', 'G', 'T']).repeat(1 + Math.floor(r() * 3)); }
    const dpT = 40 + Math.floor(r() * 120), dpN = 40 + Math.floor(r() * 100);
    const vaf = germ ? (r() < 0.7 ? 0.5 : 1) : r() < 0.6 ? 0.35 + r() * 0.15 : 0.05 + r() * 0.2, vafN = germ ? vaf : 0;
    const altT = Math.round(dpT * Math.min(1, Math.max(0, vaf + (r() - 0.5) * 0.08))), altN = Math.round(dpN * vafN);
    const gt = (v: number) => (v > 0.85 ? '1/1' : v > 0.2 ? '0/1' : v > 0.02 ? '0/1' : '0/0');
    const qual = Math.round(20 + r() * 200), filt = r() < 0.08 ? 'LowQual' : 'PASS';
    out.push(`${chrom}\t${p}\t.\t${ref}\t${alt}\t${qual}\t${filt}\tDP=${dpT + dpN}\tGT:DP:AD\t${gt(altT / dpT)}:${dpT}:${dpT - altT},${altT}\t${gt(altN / dpN)}:${dpN}:${dpN - altN},${altN}`);
  }
  return out.join('\n') + '\n';
}
export function syntheticGwas(seed = 8, n = 60000): string {
  const r = rng(seed), peaks = [[3, 40_000_000], [11, 62_000_000], [17, 25_000_000]], out = ['chr\tpos\trsid\tp'];
  const L = [249, 243, 198, 191, 181, 171, 159, 146, 141, 136, 135, 134, 115, 107, 102, 90, 81, 78, 59, 63, 48, 51];
  for (let i = 0; i < n; i++) {
    const c = 1 + Math.floor(r() * 22), p0 = Math.floor(r() * L[c - 1] * 1e6); let p = r() ** 1.04; // mild inflation
    for (const [pc, pp] of peaks) if (c === pc && Math.abs(p0 - pp) < 400_000) p = Math.min(p, 10 ** -(4 + 6 * Math.exp(-Math.abs(p0 - pp) / 120_000) * (0.6 + r() * 0.4)) * (1 + r()));
    out.push(`${c}\t${p0}\trs${100000 + i}\t${Math.max(p, 1e-300).toExponential(3)}`);
  }
  return out.join('\n') + '\n';
}
