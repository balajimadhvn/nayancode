/**
 * Sequence diversity for an aligned FASTA: segregating sites S, mean pairwise differences π, Watterson's θW and
 * Tajima's D (Tajima 1989), plus sliding-window versions. Gaps and N are treated as missing sites (dropped whole
 * columns), which is the conservative choice for short alignments; dN/dS is not computed.
 */
export interface AlignedSequence { id: string; seq: string }

export function parseAlignedFasta(text: string): AlignedSequence[] {
  const out: AlignedSequence[] = [];
  let id = '', parts: string[] = [];
  const flush = () => { if (id || parts.length) out.push({ id: id || `seq${out.length + 1}`, seq: parts.join('').toUpperCase() }); };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('>')) { flush(); id = line.slice(1).trim().split(/\s+/)[0] || ''; parts = []; }
    else { parts.push(line.replace(/\s+/g, '')); }
  }
  flush();
  return out.filter((s) => s.seq.length > 0);
}

export interface DiversityStats {
  n: number; sites: number; usableSites: number; S: number; pi: number; thetaW: number; D: number | null;
}

const harmonic = (n: number) => { let s = 0; for (let i = 1; i < n; i++) s += 1 / i; return s; };
const harmonic2 = (n: number) => { let s = 0; for (let i = 1; i < n; i++) s += 1 / (i * i); return s; };

/** Whole-alignment diversity. Tajima's D needs at least four sequences; S = 0 gives D = null. */
export function diversityStats(seqs: string[]): DiversityStats {
  const n = seqs.length;
  if (n < 4) throw new Error("Tajima's D needs at least four sequences.");
  const length = seqs[0].length;
  if (seqs.some((s) => s.length !== length)) throw new Error('The sequences are not aligned (lengths differ).');
  const usable: number[] = [];
  for (let j = 0; j < length; j++) if (seqs.every((s) => /[ACGT]/.test(s[j]))) usable.push(j);
  let S = 0, piSum = 0;
  const pairs = (n * (n - 1)) / 2;
  for (const j of usable) {
    const counts = new Map<string, number>();
    for (const s of seqs) counts.set(s[j], (counts.get(s[j]) ?? 0) + 1);
    if (counts.size > 1) S++;
    let same = 0;
    for (const c of counts.values()) same += (c * (c - 1)) / 2;
    piSum += (pairs - same) / pairs;
  }
  const pi = usable.length ? piSum : 0;
  const a1 = harmonic(n), a2 = harmonic2(n);
  const thetaW = a1 > 0 ? S / a1 : 0;
  let D: number | null = null;
  if (n >= 4 && S > 0 && a1 > 0) {
    const b1 = (n + 1) / (3 * (n - 1));
    const b2 = (2 * (n * n + n + 3)) / (9 * n * (n - 1));
    const c1 = b1 - 1 / a1;
    const c2 = b2 - (n + 2) / (a1 * n) + a2 / (a1 * a1);
    const e1 = c1 / a1;
    const e2 = c2 / (a1 * a1 + a2);
    const den = e1 * S + e2 * S * (S - 1);
    if (den > 0) D = (pi - thetaW) / Math.sqrt(den);
  }
  return { n, sites: length, usableSites: usable.length, S, pi, thetaW, D };
}

export interface WindowStats { start: number; end: number; S: number; pi: number; D: number | null; usableSites: number }

/** Sliding-window π and Tajima's D. Windows are clipped to the alignment. */
export function slidingDiversity(seqs: string[], window = 100, step = 25): WindowStats[] {
  const length = seqs[0]?.length ?? 0;
  if (length === 0) return [];
  if (window <= 0 || step <= 0) throw new Error('Window and step must be positive.');
  const out: WindowStats[] = [];
  for (let start = 0; start < length; start += step) {
    const end = Math.min(length, start + window);
    const sub = seqs.map((s) => s.slice(start, end));
    const st = diversityStats(sub);
    out.push({ start, end, S: st.S, pi: st.pi, D: st.D, usableSites: st.usableSites });
    if (end === length) break;
  }
  return out;
}
