/** Pure sequence-analysis kernels. No DOM; runs in a Web Worker or in Node tests. */

export interface FastaRecord { id: string; description: string; seq: string }

export function parseFasta(text: string): FastaRecord[] {
  const out: FastaRecord[] = [];
  let cur: { header: string; parts: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const [id, ...rest] = cur.header.split(/\s+/);
    out.push({ id: id || `seq${out.length + 1}`, description: rest.join(' '), seq: cur.parts.join('').replace(/[\s\d*-]/g, '').toUpperCase() });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('>')) { flush(); cur = { header: line.slice(1).trim(), parts: [] }; }
    else { cur ??= { header: 'sequence', parts: [] }; cur.parts.push(line); }
  }
  flush();
  return out.filter((r) => r.seq.length > 0);
}

const COMP: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', U: 'A', R: 'Y', Y: 'R', K: 'M', M: 'K', S: 'S', W: 'W', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N' };
export const revComp = (s: string) => { let o = ''; for (let i = s.length - 1; i >= 0; i--) o += COMP[s[i]] ?? 'N'; return o; };
export const toDNA = (s: string) => s.replace(/U/g, 'T');

export function detectAlphabet(s: string): 'dna' | 'rna' | 'protein' {
  const body = s.replace(/[^A-Z]/g, '');
  if (!body) return 'dna';
  const nuc = (body.match(/[ACGTUN]/g) ?? []).length / body.length;
  if (nuc > 0.9) return body.includes('U') && !body.includes('T') ? 'rna' : 'dna';
  return 'protein';
}

// NCBI translation table 1 (standard), codon order TCAG.
const AA = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const BASES = 'TCAG';
const CODON: Record<string, string> = {};
for (let i = 0; i < 64; i++) CODON[BASES[(i >> 4) & 3] + BASES[(i >> 2) & 3] + BASES[i & 3]] = AA[i];
export const STARTS = new Set(['ATG']);

export function translate(dna: string, frame = 0, toStop = false): string {
  let p = '';
  for (let i = frame; i + 3 <= dna.length; i += 3) {
    const a = CODON[dna.slice(i, i + 3)] ?? 'X';
    if (toStop && a === '*') break;
    p += a;
  }
  return p;
}

export interface Orf { strand: 1 | -1; frame: number; start: number; end: number; lengthAa: number; protein: string }

/** Six-frame ORF finder (ATG…stop). Coordinates are 1-based on the forward strand. */
export function findOrfs(dna: string, minAa = 50): Orf[] {
  const orfs: Orf[] = [];
  const n = dna.length;
  for (const strand of [1, -1] as const) {
    const s = strand === 1 ? dna : revComp(dna);
    for (let frame = 0; frame < 3; frame++) {
      let start = -1;
      for (let i = frame; i + 3 <= n; i += 3) {
        const c = s.slice(i, i + 3);
        if (start < 0 && STARTS.has(c)) start = i;
        else if (start >= 0 && CODON[c] === '*') {
          const aa = (i - start) / 3;
          if (aa >= minAa) {
            const [a, b] = strand === 1 ? [start + 1, i + 3] : [n - (i + 3) + 1, n - start];
            orfs.push({ strand, frame: frame + 1, start: a, end: b, lengthAa: aa, protein: translate(s.slice(start, i)) });
          }
          start = -1;
        }
      }
    }
  }
  return orfs.sort((a, b) => b.lengthAa - a.lengthAa);
}

export interface Composition { length: number; gc: number; counts: Record<string, number>; windows: { pos: number; gc: number }[] }
export function composition(seq: string, win = 100): Composition {
  const counts: Record<string, number> = {};
  for (const c of seq) counts[c] = (counts[c] ?? 0) + 1;
  const isGC = (c: string) => c === 'G' || c === 'C';
  let gcTotal = 0;
  for (const c of seq) if (isGC(c)) gcTotal++;
  const w = Math.max(10, Math.min(win, seq.length));
  const step = Math.max(1, Math.floor(seq.length / 400));
  const windows: { pos: number; gc: number }[] = [];
  if (seq.length >= w) {
    let g = 0;
    for (let i = 0; i < w; i++) if (isGC(seq[i])) g++;
    for (let i = 0; ; i++) {
      if (i % step === 0) windows.push({ pos: i + w / 2, gc: g / w });
      if (i + w >= seq.length) break;
      if (isGC(seq[i])) g--;
      if (isGC(seq[i + w])) g++;
    }
  }
  return { length: seq.length, gc: seq.length ? gcTotal / seq.length : 0, counts, windows };
}

// ---------- Restriction enzymes ----------
export interface Enzyme { name: string; site: string; cut: number /* top-strand cut offset from site start */; bot: number /* bottom-strand cut offset (top-strand coordinates) */; overhang: string }
const enz = (name: string, site: string, cut: number, bot: number): Enzyme => ({ name, site, cut, bot, overhang: cut === bot ? 'blunt' : cut < bot ? `5' ${site.slice(cut, bot)}` : `3' ${site.slice(bot, cut)}` });
/** Palindromic Type II enzymes. Recognition sequences and cut positions are scientific facts, compiled by hand (no database copied). */
export const ENZYMES: Enzyme[] = [
  enz('EcoRI', 'GAATTC', 1, 5), enz('BamHI', 'GGATCC', 1, 5), enz('HindIII', 'AAGCTT', 1, 5), enz('XhoI', 'CTCGAG', 1, 5), enz('NotI', 'GCGGCCGC', 2, 6), enz('NdeI', 'CATATG', 2, 4),
  enz('NcoI', 'CCATGG', 1, 5), enz('XbaI', 'TCTAGA', 1, 5), enz('SpeI', 'ACTAGT', 1, 5), enz('SalI', 'GTCGAC', 1, 5), enz('PstI', 'CTGCAG', 5, 1), enz('KpnI', 'GGTACC', 5, 1),
  enz('SacI', 'GAGCTC', 5, 1), enz('SmaI', 'CCCGGG', 3, 3), enz('EcoRV', 'GATATC', 3, 3), enz('ClaI', 'ATCGAT', 2, 4), enz('BglII', 'AGATCT', 1, 5), enz('NheI', 'GCTAGC', 1, 5),
  enz('AgeI', 'ACCGGT', 1, 5), enz('MluI', 'ACGCGT', 1, 5), enz('SphI', 'GCATGC', 5, 1), enz('ApaI', 'GGGCCC', 5, 1), enz('XmaI', 'CCCGGG', 1, 5), enz('NsiI', 'ATGCAT', 5, 1),
  enz('SacII', 'CCGCGG', 4, 2), enz('BspEI', 'TCCGGA', 1, 5), enz('PvuII', 'CAGCTG', 3, 3), enz('StuI', 'AGGCCT', 3, 3), enz('HpaI', 'GTTAAC', 3, 3), enz('ScaI', 'AGTACT', 3, 3), enz('NruI', 'TCGCGA', 3, 3), enz('BsrGI', 'TGTACA', 1, 5),
];

export interface Digest { enzymes: string[]; sites: { enzyme: string; pos: number }[]; fragments: number[]; circular: boolean }
export function digest(seq: string, names: string[], circular = false): Digest {
  const n = seq.length;
  const sites: { enzyme: string; pos: number }[] = [];
  const cuts: number[] = [];
  for (const nm of names) {
    const e = ENZYMES.find((x) => x.name === nm);
    if (!e) continue;
    const ext = circular ? seq + seq.slice(0, e.site.length - 1) : seq;
    for (let i = ext.indexOf(e.site); i >= 0 && i < n; i = ext.indexOf(e.site, i + 1)) {
      sites.push({ enzyme: nm, pos: i + 1 });
      cuts.push((i + e.cut) % n || (circular ? 0 : n));
    }
  }
  const sorted = [...new Set(cuts)].filter((c) => circular || (c > 0 && c < n)).sort((a, b) => a - b);
  const fragments: number[] = [];
  if (!sorted.length) fragments.push(n);
  else if (circular) {
    for (let i = 0; i < sorted.length; i++) fragments.push(((sorted[(i + 1) % sorted.length] - sorted[i]) + n) % n || n);
  } else {
    let prev = 0;
    for (const c of sorted) { fragments.push(c - prev); prev = c; }
    fragments.push(n - prev);
  }
  return { enzymes: names, sites: sites.sort((a, b) => a.pos - b.pos), fragments: fragments.sort((a, b) => b - a), circular };
}

// ---------- Oligo Tm (SantaLucia 1998 unified nearest-neighbor) ----------
const NN: Record<string, [number, number]> = { // [dH kcal/mol, dS cal/mol/K]
  AA: [-7.9, -22.2], TT: [-7.9, -22.2], AT: [-7.2, -20.4], TA: [-7.2, -21.3], CA: [-8.5, -22.7], TG: [-8.5, -22.7],
  GT: [-8.4, -22.4], AC: [-8.4, -22.4], CT: [-7.8, -21.0], AG: [-7.8, -21.0], GA: [-8.2, -22.2], TC: [-8.2, -22.2],
  CG: [-10.6, -27.2], GC: [-9.8, -24.4], GG: [-8.0, -19.9], CC: [-8.0, -19.9],
};
export interface OligoProps { length: number; gc: number; tm: number; dG37: number; hairpinRisk: boolean; selfDimerRisk: boolean; threePrimeGC: number }
export function oligoTm(seq: string, o: { naMM?: number; mgMM?: number; dntpMM?: number; primerNM?: number } = {}): OligoProps {
  const s = toDNA(seq.toUpperCase());
  const { naMM = 50, mgMM = 1.5, dntpMM = 0.2, primerNM = 250 } = o;
  if (s.length < 2 || /[^ACGT]/.test(s)) return { length: s.length, gc: NaN, tm: NaN, dG37: NaN, hairpinRisk: false, selfDimerRisk: false, threePrimeGC: 0 };
  let dH = 0, dS = 0;
  for (let i = 0; i < s.length - 1; i++) { const [h, e] = NN[s.slice(i, i + 2)]; dH += h; dS += e; }
  for (const end of [s[0], s[s.length - 1]]) { if (end === 'G' || end === 'C') { dH += 0.1; dS -= 2.8; } else { dH += 2.3; dS += 4.1; } }
  // Owczarzy-style effective monovalent concentration with Mg2+ (free Mg after dNTP chelation), simplified.
  const freeMg = Math.max(0, mgMM - dntpMM);
  const monoEff = (naMM + 120 * Math.sqrt(freeMg)) / 1000; // M
  const gcFrac = (s.match(/[GC]/g) ?? []).length / s.length;
  const ct = primerNM * 1e-9;
  const R = 1.987;
  const tm1M = (dH * 1000) / (dS + R * Math.log(ct / 4)) - 273.15;
  // 1/Tm(Na) = 1/Tm(1M) + (4.29 fGC - 3.95) 1e-5 ln[Na] + 9.40e-6 ln^2[Na]   (Owczarzy 2004)
  const inv = 1 / (tm1M + 273.15) + (4.29 * gcFrac - 3.95) * 1e-5 * Math.log(monoEff) + 9.4e-6 * Math.log(monoEff) ** 2;
  const tm = 1 / inv - 273.15;
  const dG37 = dH - (310.15 * dS) / 1000;
  const rc = revComp(s);
  const hairpinRisk = hasPalindromicStem(s, 4, 3);
  let selfDimerRisk = false;
  const tail = s.slice(-4);
  if (rc.includes(tail) || rc.includes(revComp(tail))) selfDimerRisk = s.length >= 8 && rc.includes(revComp(tail));
  return { length: s.length, gc: gcFrac, tm, dG37, hairpinRisk, selfDimerRisk, threePrimeGC: (s.slice(-5).match(/[GC]/g) ?? []).length };
}
function hasPalindromicStem(s: string, stem: number, loopMin: number): boolean {
  for (let i = 0; i + stem <= s.length; i++) {
    const rc = revComp(s.slice(i, i + stem));
    const j = s.indexOf(rc, i + stem + loopMin);
    if (j >= 0) return true;
  }
  return false;
}

// ---------- Protein properties ----------
const MW_AA: Record<string, number> = { A: 71.0788, R: 156.1875, N: 114.1038, D: 115.0886, C: 103.1388, E: 129.1155, Q: 128.1307, G: 57.0519, H: 137.1411, I: 113.1594, L: 113.1594, K: 128.1741, M: 131.1926, F: 147.1766, P: 97.1167, S: 87.0782, T: 101.1051, W: 186.2132, Y: 163.1760, V: 99.1326 };
const KD: Record<string, number> = { A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, E: -3.5, Q: -3.5, G: -0.4, H: -3.2, I: 4.5, L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2 };
export interface ProteinProps { length: number; mw: number; pI: number; gravy: number; extinction: number }
export function proteinProps(p: string): ProteinProps {
  const s = p.replace(/[^A-Z]/g, '').replace(/\*/g, '');
  let mw = 18.0153, gravy = 0, w = 0, y = 0, c = 0, n = 0;
  for (const a of s) { mw += MW_AA[a] ?? 0; gravy += KD[a] ?? 0; if (a === 'W') w++; if (a === 'Y') y++; if (a === 'C') c++; n++; }
  const pKa = { nterm: 9.69, cterm: 2.34, K: 10.5, R: 12.4, H: 6.0, D: 3.86, E: 4.25, C: 8.3, Y: 10.07 };
  const cnt = (ch: string) => (s.match(new RegExp(ch, 'g')) ?? []).length;
  const charge = (ph: number) => {
    const pos = (pk: number) => 1 / (1 + 10 ** (ph - pk));
    const neg = (pk: number) => 1 / (1 + 10 ** (pk - ph));
    return pos(pKa.nterm) + cnt('K') * pos(pKa.K) + cnt('R') * pos(pKa.R) + cnt('H') * pos(pKa.H)
      - neg(pKa.cterm) - cnt('D') * neg(pKa.D) - cnt('E') * neg(pKa.E) - cnt('C') * neg(pKa.C) - cnt('Y') * neg(pKa.Y);
  };
  let lo = 0, hi = 14;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (charge(mid) > 0) lo = mid; else hi = mid; }
  return { length: n, mw, pI: (lo + hi) / 2, gravy: n ? gravy / n : 0, extinction: 5500 * w + 1490 * y + 125 * Math.floor(c / 2) };
}

// ---------- Pairwise alignment (Gotoh affine gaps) ----------
const B62_ORDER = 'ARNDCQEGHILKMFPSTWYVBZX*';
const B62_ROWS = [
  '4 -1 -2 -2 0 -1 -1 0 -2 -1 -1 -1 -1 -2 -1 1 0 -3 -2 0 -2 -1 0 -4',
  '-1 5 0 -2 -3 1 0 -2 0 -3 -2 2 -1 -3 -2 -1 -1 -3 -2 -3 -1 0 -1 -4',
  '-2 0 6 1 -3 0 0 0 1 -3 -3 0 -2 -3 -2 1 0 -4 -2 -3 3 0 -1 -4',
  '-2 -2 1 6 -3 0 2 -1 -1 -3 -4 -1 -3 -3 -1 0 -1 -4 -3 -3 4 1 -1 -4',
  '0 -3 -3 -3 9 -3 -4 -3 -3 -1 -1 -3 -1 -2 -3 -1 -1 -2 -2 -1 -3 -3 -2 -4',
  '-1 1 0 0 -3 5 2 -2 0 -3 -2 1 0 -3 -1 0 -1 -2 -1 -2 0 3 -1 -4',
  '-1 0 0 2 -4 2 5 -2 0 -3 -3 1 -2 -3 -1 0 -1 -3 -2 -2 1 4 -1 -4',
  '0 -2 0 -1 -3 -2 -2 6 -2 -4 -4 -2 -3 -3 -2 0 -2 -2 -3 -3 -1 -2 -1 -4',
  '-2 0 1 -1 -3 0 0 -2 8 -3 -3 -1 -2 -1 -2 -1 -2 -2 2 -3 0 0 -1 -4',
  '-1 -3 -3 -3 -1 -3 -3 -4 -3 4 2 -3 1 0 -3 -2 -1 -3 -1 3 -3 -3 -1 -4',
  '-1 -2 -3 -4 -1 -2 -3 -4 -3 2 4 -2 2 0 -3 -2 -1 -2 -1 1 -4 -3 -1 -4',
  '-1 2 0 -1 -3 1 1 -2 -1 -3 -2 5 -1 -3 -1 0 -1 -3 -2 -2 0 1 -1 -4',
  '-1 -1 -2 -3 -1 0 -2 -3 -2 1 2 -1 5 0 -2 -1 -1 -1 -1 1 -3 -1 -1 -4',
  '-2 -3 -3 -3 -2 -3 -3 -3 -1 0 0 -3 0 6 -4 -2 -2 1 3 -1 -3 -3 -1 -4',
  '-1 -2 -2 -1 -3 -1 -1 -2 -2 -3 -3 -1 -2 -4 7 -1 -1 -4 -3 -2 -2 -1 -2 -4',
  '1 -1 1 0 -1 0 0 0 -1 -2 -2 0 -1 -2 -1 4 1 -3 -2 -2 0 0 0 -4',
  '0 -1 0 -1 -1 -1 -1 -2 -2 -1 -1 -1 -1 -2 -1 1 5 -2 -2 0 -1 -1 0 -4',
  '-3 -3 -4 -4 -2 -2 -3 -2 -2 -3 -2 -3 -1 1 -4 -3 -2 11 2 -3 -4 -3 -2 -4',
  '-2 -2 -2 -3 -2 -1 -2 -3 2 -1 -1 -2 -1 3 -3 -2 -2 2 7 -1 -3 -2 -1 -4',
  '0 -3 -3 -3 -1 -2 -2 -3 -3 3 1 -2 1 -1 -2 -2 0 -3 -1 4 -3 -2 -1 -4',
  '-2 -1 3 4 -3 0 1 -1 0 -3 -4 0 -3 -3 -2 0 -1 -4 -3 -3 4 1 -1 -4',
  '-1 0 0 1 -3 3 4 -2 0 -3 -3 1 -1 -3 -1 0 -1 -3 -2 -2 1 4 -1 -4',
  '0 -1 -1 -1 -2 -1 -1 -1 -1 -1 -1 -1 -1 -1 -2 0 0 -2 -1 -1 -1 -1 -1 -4',
  '-4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 -4 1',
];
const B62: Record<string, number> = {};
B62_ROWS.forEach((row, i) => row.split(' ').forEach((v, j) => { B62[B62_ORDER[i] + B62_ORDER[j]] = +v; }));

export const blosum62 = (x: string, y: string) => B62[x + y] ?? -4;

export interface AlignOpts { mode: 'global' | 'local'; kind: 'dna' | 'protein'; open?: number; extend?: number; match?: number; mismatch?: number }
export interface Alignment { score: number; a: string; b: string; mid: string; identity: number; similarity: number; gaps: number; length: number; aStart: number; bStart: number }

export function align(sa: string, sb: string, opts: AlignOpts, progress?: (p: number) => void): Alignment {
  const { mode, kind } = opts;
  const open = opts.open ?? (kind === 'protein' ? 11 : 5), ext = opts.extend ?? (kind === 'protein' ? 1 : 2);
  const match = opts.match ?? 2, mism = opts.mismatch ?? -3;
  const sc = (x: string, y: string) => (kind === 'protein' ? (B62[x + y] ?? -4) : x === y && x !== 'N' ? match : mism);
  const n = sa.length, m = sb.length;
  if (n * m > 25_000_000) throw new Error(`Alignment matrix too large (${n}×${m}). Limit is 25M cells in the browser; use a cloud/MMseqs2 search for larger inputs.`);
  const W = m + 1, NEG = -1e9, local = mode === 'local';
  const H = new Float32Array((n + 1) * W), E = new Float32Array((n + 1) * W), F = new Float32Array((n + 1) * W);
  const T = new Uint8Array((n + 1) * W); // traceback: bits 0-1 H source (0 diag,1 E,2 F,3 stop); bit2 E-extend; bit3 F-extend
  H[0] = 0;
  for (let j = 1; j <= m; j++) { H[j] = local ? 0 : -(open + ext * (j - 1)); E[j] = NEG; F[j] = NEG; T[j] = local ? 3 : 1; }
  for (let i = 1; i <= n; i++) { H[i * W] = local ? 0 : -(open + ext * (i - 1)); E[i * W] = NEG; F[i * W] = NEG; T[i * W] = local ? 3 : 2; }
  let best = 0, bi = n, bj = m;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const k = i * W + j;
      const eOpen = H[k - 1] - open, eExt = E[k - 1] - ext;
      E[k] = Math.max(eOpen, eExt); let t = eExt > eOpen ? 4 : 0;
      const fOpen = H[k - W] - open, fExt = F[k - W] - ext;
      F[k] = Math.max(fOpen, fExt); if (fExt > fOpen) t |= 8;
      const d = H[k - W - 1] + sc(sa[i - 1], sb[j - 1]);
      let h = d, src = 0;
      if (E[k] > h) { h = E[k]; src = 1; }
      if (F[k] > h) { h = F[k]; src = 2; }
      if (local && h <= 0) { h = 0; src = 3; }
      H[k] = h; T[k] = t | src;
      if (local && h > best) { best = h; bi = i; bj = j; }
    }
    if (progress && i % 64 === 0) progress(i / n);
  }
  let i = local ? bi : n, j = local ? bj : m;
  const score = local ? best : H[n * W + m];
  let ra = '', rb = '', state = 0;
  while (i > 0 || j > 0) {
    const t = T[i * W + j];
    if (state === 0) {
      const src = t & 3;
      if (src === 3) break;
      if (src === 0) { ra = sa[i - 1] + ra; rb = sb[j - 1] + rb; i--; j--; }
      else state = src;
    } else if (state === 1) { // gap in a (consume b)
      ra = '-' + ra; rb = sb[j - 1] + rb; if (!(t & 4)) state = 0; j--;
    } else {
      ra = sa[i - 1] + ra; rb = '-' + rb; if (!(t & 8)) state = 0; i--;
    }
  }
  let ident = 0, sim = 0, gaps = 0, mid = '';
  for (let k = 0; k < ra.length; k++) {
    if (ra[k] === '-' || rb[k] === '-') { gaps++; mid += ' '; }
    else if (ra[k] === rb[k]) { ident++; sim++; mid += '|'; }
    else if (kind === 'protein' && (B62[ra[k] + rb[k]] ?? -4) > 0) { sim++; mid += ':'; }
    else mid += '.';
  }
  const L = ra.length || 1;
  return { score, a: ra, b: rb, mid, identity: ident / L, similarity: sim / L, gaps, length: ra.length, aStart: i + 1, bStart: j + 1 };
}

/** Exact k-mer dotplot, binned to a grid so the payload stays small. */
export function dotplot(a: string, b: string, k = 8, grid = 400): { grid: number; cells: Uint8Array; rows: number; cols: number } {
  const cols = Math.min(grid, Math.max(1, a.length)), rows = Math.min(grid, Math.max(1, b.length));
  const cells = new Uint8Array(cols * rows);
  const idx = new Map<string, number[]>();
  for (let i = 0; i + k <= a.length; i++) { const km = a.slice(i, i + k); (idx.get(km) ?? idx.set(km, []).get(km)!).push(i); }
  const rc = revComp(b);
  for (let j = 0; j + k <= b.length; j++) {
    const hit = idx.get(b.slice(j, j + k));
    if (hit && hit.length < 200) for (const i of hit) cells[Math.floor((j / b.length) * rows) * cols + Math.floor((i / a.length) * cols)] = 1;
    const hr = idx.get(rc.slice(j, j + k));
    if (hr && hr.length < 200) for (const i of hr) cells[Math.floor(((b.length - j) / b.length) * Math.min(rows - 1, rows)) % rows * cols + Math.floor((i / a.length) * cols)] = 2;
  }
  return { grid, cells, rows, cols };
}
