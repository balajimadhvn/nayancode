/** Read-mapping helpers around the vendored minimap2 / samtools builds: demo-read simulator, flagstat / depth parsing,
 *  samtools-mpileup SNV caller (clean-room), VCF writer. */
import { revComp } from '../sequence/kernels';

const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
export interface PlantedSnv { pos: number; ref: string; alt: string; af: number }
/** Simulate single-end reads with substitution errors and planted variants (clearly synthetic; for demos and tests). */
export function simulateReads(ref: string, o: { n: number; len: number; err: number; snvs: PlantedSnv[]; seed?: number }): { fastq: string; truth: PlantedSnv[] } {
  const r = rng(o.seed ?? 1), out: string[] = [], B = 'ACGT';
  for (let i = 0; i < o.n; i++) {
    const start = Math.floor(r() * (ref.length - o.len + 1)); let seq = ref.slice(start, start + o.len).split('');
    for (const v of o.snvs) if (v.pos >= start && v.pos < start + o.len && r() < v.af) seq[v.pos - start] = v.alt;
    const q = seq.map(() => { const e = r() < o.err; return e ? 12 : 36; });
    seq = seq.map((b, k) => (q[k] === 12 && r() < 0.85 ? B[(B.indexOf(b) + 1 + Math.floor(r() * 3)) % 4] : b));
    let s = seq.join(''), qs = q.map((x) => String.fromCharCode(33 + x)).join(''); if (r() < 0.5) { s = revComp(s); qs = [...qs].reverse().join(''); }
    out.push(`@read${i + 1}\n${s}\n+\n${qs}`);
  }
  return { fastq: out.join('\n') + '\n', truth: o.snvs };
}
export function simulateReference(len: number, seed = 3, gc = 0.5): string { const r = rng(seed); return Array.from({ length: len }, () => (r() < gc ? (r() < 0.5 ? 'G' : 'C') : r() < 0.5 ? 'A' : 'T')).join(''); }

export interface Flagstat { total: number; mapped: number; mappedPct: number; primary: number; secondary: number; supplementary: number; duplicates: number; paired: number; properlyPaired: number }
export function parseFlagstat(text: string): Flagstat {
  const num = (re: RegExp) => { const m = re.exec(text); return m ? +m[1] : 0; }, total = num(/^(\d+) \+ \d+ in total/m), mapped = num(/^(\d+) \+ \d+ mapped/m);
  if (!total && !/in total/.test(text)) throw new Error('Unrecognised samtools flagstat output.');
  return { total, mapped, mappedPct: total ? (mapped / total) * 100 : 0, primary: num(/^(\d+) \+ \d+ primary\n/m), secondary: num(/^(\d+) \+ \d+ secondary/m), supplementary: num(/^(\d+) \+ \d+ supplementary/m), duplicates: num(/^(\d+) \+ \d+ duplicates/m), paired: num(/^(\d+) \+ \d+ paired in sequencing/m), properlyPaired: num(/^(\d+) \+ \d+ properly paired/m) };
}
export interface Coverage { contig: string; length: number; mean: number; pct1x: number; pct10x: number; pct30x: number; bins: number[] }
/** `samtools depth -a` output (contig, 1-based position, depth) → per-contig stats and a binned profile. */
export function summariseDepth(text: string, bins = 400): Coverage[] {
  const per = new Map<string, number[]>();
  for (const l of text.split('\n')) { if (!l) continue; const f = l.split('\t'); const d = +f[2]; if (!Number.isFinite(d)) continue; (per.get(f[0]) ?? per.set(f[0], []).get(f[0])!).push(d); }
  if (!per.size) throw new Error('No depth values: no reads aligned?');
  return [...per.entries()].map(([contig, d]) => { const n = d.length, step = Math.max(1, Math.ceil(n / bins)), b: number[] = []; for (let i = 0; i < n; i += step) { const sl = d.slice(i, i + step); b.push(sl.reduce((x, y) => x + y, 0) / sl.length); } return { contig, length: n, mean: d.reduce((x, y) => x + y, 0) / n, pct1x: (d.filter((x) => x >= 1).length / n) * 100, pct10x: (d.filter((x) => x >= 10).length / n) * 100, pct30x: (d.filter((x) => x >= 30).length / n) * 100, bins: b }; });
}

export interface SnvCall { chrom: string; pos: number; ref: string; alt: string; depth: number; altCount: number; af: number; fwd: number; rev: number; qual: number; flags: string[] }
export interface CallerOpts { minDepth: number; minAlt: number; minAf: number; minBaseQ: number }
export const DEFAULT_CALLER: CallerOpts = { minDepth: 10, minAlt: 4, minAf: 0.05, minBaseQ: 20 };
const lgamma = (x: number): number => { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const cj of c) s += cj / ++y; return -t + Math.log((2.5066282746310005 * s) / x); };
const binomTail = (k: number, n: number, p: number) => { let t = 0; for (let i = k; i <= n; i++) t += Math.exp(lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(1 - p)); return Math.min(1, t); };
/** Parse one `samtools mpileup` line's read-base column into base observations (forward/reverse strand, with qualities). */
export function parsePileupBases(bases: string, quals: string, ref: string): { base: string; rev: boolean; q: number }[] {
  const out: { base: string; rev: boolean; q: number }[] = []; let qi = 0;
  for (let i = 0; i < bases.length; i++) {
    const c = bases[i];
    if (c === '^') { i++; continue; } if (c === '$') continue;
    if (c === '+' || c === '-') { let j = i + 1, num = ''; while (j < bases.length && /\d/.test(bases[j])) num += bases[j++]; i = j + parseInt(num || '0', 10) - 1; continue; }
    const q = quals.charCodeAt(qi++) - 33;
    if (c === '.' || c === ',') out.push({ base: ref.toUpperCase(), rev: c === ',', q }); else if (/[ACGTNacgtn]/.test(c)) out.push({ base: c.toUpperCase(), rev: c === c.toLowerCase(), q });
  }
  return out;
}
export function callSnvs(pileup: string, opt: Partial<CallerOpts> = {}): SnvCall[] {
  const o = { ...DEFAULT_CALLER, ...opt }, calls: SnvCall[] = [];
  for (const line of pileup.split('\n')) {
    if (!line) continue; const f = line.split('\t'); if (f.length < 6) continue; const ref = f[2].toUpperCase(); if (!/[ACGT]/.test(ref)) continue;
    const obs = parsePileupBases(f[4], f[5], ref).filter((x) => x.q >= o.minBaseQ && x.base !== 'N'), depth = obs.length; if (depth < o.minDepth) continue;
    const counts = new Map<string, { n: number; fwd: number; rev: number }>(); for (const x of obs) if (x.base !== ref) { const c = counts.get(x.base) ?? { n: 0, fwd: 0, rev: 0 }; c.n++; if (x.rev) c.rev++; else c.fwd++; counts.set(x.base, c); }
    for (const [alt, c] of counts) {
      if (c.n < o.minAlt || c.n / depth < o.minAf) continue;
      const err = Math.max(0.001, obs.reduce((s, x) => s + 10 ** (-x.q / 10), 0) / depth), qual = Math.min(999, -10 * Math.log10(Math.max(1e-99, binomTail(c.n, depth, err)))), flags: string[] = [];
      if (c.n >= 8 && Math.min(c.fwd, c.rev) / c.n < 0.1) flags.push('strand-bias'); if (c.n / depth < 0.2) flags.push('low-AF');
      calls.push({ chrom: f[0], pos: +f[1], ref, alt, depth, altCount: c.n, af: c.n / depth, fwd: c.fwd, rev: c.rev, qual, flags });
    }
  }
  return calls;
}
export function snvsToVcf(calls: SnvCall[], contigs: { id: string; length: number }[], sample = 'sample'): string {
  const head = ['##fileformat=VCFv4.2', '##source=Workbench-mpileup-SNV-caller', ...contigs.map((c) => `##contig=<ID=${c.id},length=${c.length}>`), '##INFO=<ID=DP,Number=1,Type=Integer,Description="Filtered depth">', '##INFO=<ID=AF,Number=A,Type=Float,Description="Allele fraction">', '##INFO=<ID=SB,Number=2,Type=Integer,Description="Alt reads fwd,rev">', '##FILTER=<ID=strand-bias,Description="Alt reads on one strand only">', '##FILTER=<ID=low-AF,Description="Allele fraction below 20%">', '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">', '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Depth">', '##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Allelic depths">', `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${sample}`];
  return head.concat(calls.map((c) => `${c.chrom}\t${c.pos}\t.\t${c.ref}\t${c.alt}\t${c.qual.toFixed(1)}\t${c.flags.length ? c.flags.join(';') : 'PASS'}\tDP=${c.depth};AF=${c.af.toFixed(4)};SB=${c.fwd},${c.rev}\tGT:DP:AD\t${c.af > 0.8 ? '1/1' : '0/1'}:${c.depth}:${c.depth - c.altCount},${c.altCount}`)).join('\n') + '\n';
}
