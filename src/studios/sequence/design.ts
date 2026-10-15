/** Primer design, in-silico PCR, CRISPR guide design, protein analysis, PWM motif scanning.
 *  Clean-room implementations from the published methods (no Primer3 / GPL code). */
import { oligoTm, revComp, toDNA } from './kernels';

// ---------------- Primer design ----------------
export interface PrimerParams { minLen: number; optLen: number; maxLen: number; minTm: number; optTm: number; maxTm: number; minGc: number; maxGc: number; maxPolyX: number; gcClamp: boolean; maxTmDiff: number; minProduct: number; maxProduct: number; naMM: number; mgMM: number; primerNM: number }
export const DEFAULT_PRIMER_PARAMS: PrimerParams = { minLen: 18, optLen: 22, maxLen: 26, minTm: 57, optTm: 60, maxTm: 63, minGc: 0.4, maxGc: 0.6, maxPolyX: 4, gcClamp: true, maxTmDiff: 2.5, minProduct: 100, maxProduct: 600, naMM: 50, mgMM: 1.5, primerNM: 250 };
export interface Primer { seq: string; start: number; end: number; strand: '+' | '-'; len: number; tm: number; gc: number; penalty: number; selfAny: number; self3: number; hairpin: boolean; warnings: string[] }
export interface PrimerPair { left: Primer; right: Primer; product: number; productTm: number; penalty: number; pairCompl: number; warnings: string[]; extraSites: number }

/** Longest run of complementary bases between a and the reverse complement of b (anywhere / ending at a's 3′ end). */
export function complementarity(a: string, b: string): { any: number; threePrime: number } {
  const rb = revComp(b); let any = 0, three = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < rb.length; j++) { let k = 0; while (i + k < a.length && j + k < rb.length && a[i + k] === rb[j + k]) k++; if (k > any) any = k; if (i + k === a.length && k > three) three = k; }
  return { any, threePrime: three };
}
const maxRun = (s: string) => { let m = 1, c = 1; for (let i = 1; i < s.length; i++) { c = s[i] === s[i - 1] ? c + 1 : 1; if (c > m) m = c; } return m; };
function scorePrimer(seq: string, start: number, strand: '+' | '-', p: PrimerParams): Primer | null {
  if (/[^ACGT]/.test(seq)) return null;
  const o = oligoTm(seq, { naMM: p.naMM, mgMM: p.mgMM, primerNM: p.primerNM }), warnings: string[] = [];
  if (o.tm < p.minTm || o.tm > p.maxTm || o.gc < p.minGc || o.gc > p.maxGc || maxRun(seq) > p.maxPolyX) return null;
  const last5 = seq.slice(-5), gcLast = (last5.match(/[GC]/g) ?? []).length;
  if (p.gcClamp && (gcLast < 1 || gcLast > 3)) return null;
  const sc = complementarity(seq, seq); if (sc.any > 6 || sc.threePrime > 3) return null;
  if (o.hairpinRisk) warnings.push('possible hairpin');
  const penalty = Math.abs(o.tm - p.optTm) * 1 + Math.abs(seq.length - p.optLen) * 0.25 + Math.abs(o.gc - 0.5) * 8 + sc.any * 0.4 + sc.threePrime * 0.8 + (o.hairpinRisk ? 1.5 : 0) + (gcLast === 3 ? 0.5 : 0);
  return { seq, start, end: start + seq.length, strand, len: seq.length, tm: o.tm, gc: o.gc, penalty, selfAny: sc.any, self3: sc.threePrime, hairpin: o.hairpinRisk, warnings };
}
/** Count binding sites of a primer on the template (both strands), exact 3′ 10-mer + ≤2 mismatches elsewhere. */
export function bindingSites(primer: string, template: string, maxMismatch = 2): { pos: number; strand: '+' | '-'; mismatches: number }[] {
  const out: { pos: number; strand: '+' | '-'; mismatches: number }[] = [], L = primer.length;
  for (const strand of ['+', '-'] as const) {
    const t = strand === '+' ? template : revComp(template);
    for (let i = 0; i + L <= t.length; i++) { let mm = 0, ok = true; for (let j = L - 1; j >= 0; j--) { if (t[i + j] !== primer[j]) { mm++; if (L - 1 - j < 10 || mm > maxMismatch) { ok = false; break; } } } if (ok) out.push({ pos: strand === '+' ? i : template.length - i - L, strand, mismatches: mm }); }
  }
  return out;
}
export function designPrimers(template: string, target: { start: number; len: number }, params: Partial<PrimerParams> = {}, excluded: [number, number][] = [], maxPairs = 8): { pairs: PrimerPair[]; leftCandidates: number; rightCandidates: number } {
  const p = { ...DEFAULT_PRIMER_PARAMS, ...params }, T = toDNA(template.toUpperCase()), n = T.length, ts = target.start, te = target.start + target.len;
  if (ts < 0 || te > n || target.len < 1) throw new Error('Target region is outside the template.');
  if (n < p.minProduct) throw new Error(`Template (${n} bp) is shorter than the minimum product size (${p.minProduct}).`);
  const bad = (a: number, b: number) => excluded.some(([s, e]) => a < e && b > s);
  const left: Primer[] = [], right: Primer[] = [];
  for (let len = p.minLen; len <= p.maxLen; len++) {
    for (let s = Math.max(0, te - p.maxProduct); s + len <= ts; s++) { if (bad(s, s + len)) continue; const pr = scorePrimer(T.slice(s, s + len), s, '+', p); if (pr) left.push(pr); }
    for (let e = Math.min(n, ts + p.maxProduct); e - len >= te; e--) { const s = e - len; if (bad(s, e)) continue; const pr = scorePrimer(revComp(T.slice(s, e)), s, '-', p); if (pr) right.push(pr); }
  }
  left.sort((a, b) => a.penalty - b.penalty); right.sort((a, b) => a.penalty - b.penalty);
  const pairs: PrimerPair[] = [], L = left.slice(0, 80), R = right.slice(0, 80);
  for (const a of L) for (const b of R) {
    const product = b.end - a.start; if (product < p.minProduct || product > p.maxProduct) continue; const dTm = Math.abs(a.tm - b.tm); if (dTm > p.maxTmDiff) continue;
    const pc = complementarity(a.seq, b.seq); if (pc.threePrime > 3 || pc.any > 7) continue;
    const gc = (T.slice(a.start, b.end).match(/[GC]/g) ?? []).length / product, productTm = 81.5 + 16.6 * Math.log10(p.naMM / 1000) + 41 * gc - 675 / product;
    pairs.push({ left: a, right: b, product, productTm, penalty: a.penalty + b.penalty + dTm * 0.5 + pc.any * 0.3 + pc.threePrime * 0.8, pairCompl: pc.any, warnings: [], extraSites: 0 });
  }
  pairs.sort((x, y) => x.penalty - y.penalty);
  const top = pairs.slice(0, maxPairs);
  for (const pr of top) { const extra = (s: string) => bindingSites(s, T).length - 1; pr.extraSites = Math.max(0, extra(pr.left.seq)) + Math.max(0, extra(pr.right.seq)); if (pr.extraSites > 0) pr.warnings.push(`primers bind ${pr.extraSites} additional template site(s)`); if (pr.left.hairpin || pr.right.hairpin) pr.warnings.push('hairpin risk'); }
  if (!top.length) throw new Error(`No primer pairs satisfy the constraints (${left.length} left / ${right.length} right candidates). Relax Tm, GC, product size or the GC clamp.`);
  return { pairs: top, leftCandidates: left.length, rightCandidates: right.length };
}
/** In-silico PCR: every product between a forward and a downstream reverse binding site (≤ maxMismatch mismatches, exact 3′ 10-mer). */
export function insilicoPcr(fwd: string, rev: string, template: string, maxProduct = 5000, maxMismatch = 1): { start: number; end: number; size: number; fwdMm: number; revMm: number; seq: string }[] {
  const T = toDNA(template.toUpperCase()), f = bindingSites(fwd.toUpperCase(), T, maxMismatch).filter((s) => s.strand === '+'), r = bindingSites(rev.toUpperCase(), T, maxMismatch).filter((s) => s.strand === '-'), out = [];
  for (const a of f) for (const b of r) { const end = b.pos + rev.length; if (end > a.pos && end - a.pos <= maxProduct) out.push({ start: a.pos, end, size: end - a.pos, fwdMm: a.mismatches, revMm: b.mismatches, seq: T.slice(a.pos, end) }); }
  return out.sort((x, y) => x.start - y.start);
}

// ---------------- CRISPR guide design ----------------
export interface Nuclease { id: string; name: string; pam: string; protoLen: number; pamSide: '3' | '5'; note: string }
export const NUCLEASES: Nuclease[] = [
  { id: 'spcas9', name: 'SpCas9 (NGG)', pam: 'NGG', protoLen: 20, pamSide: '3', note: 'Streptococcus pyogenes Cas9' },
  { id: 'sacas9', name: 'SaCas9 (NNGRRT)', pam: 'NNGRRT', protoLen: 21, pamSide: '3', note: 'Staphylococcus aureus Cas9' },
  { id: 'cas12a', name: 'Cas12a / Cpf1 (TTTV)', pam: 'TTTV', protoLen: 23, pamSide: '5', note: 'AsCas12a / LbCas12a' },
];
const IUPAC: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T', N: 'ACGT', R: 'AG', Y: 'CT', V: 'ACG', W: 'AT', S: 'CG', K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT' };
const pamOk = (pam: string, s: string) => { if (s.length !== pam.length) return false; for (let i = 0; i < pam.length; i++) if (!(IUPAC[pam[i]] ?? '').includes(s[i])) return false; return true; };
export interface Guide { seq: string; pamSeq: string; start: number; end: number; strand: '+' | '-'; gc: number; cutPos: number; score: number; flags: string[]; offTargets?: { mm0: number; mm1: number; mm2: number; mm3: number; specificity: number; top: { pos: number; strand: '+' | '-'; mm: number; seq: string; contig: string }[] } }
/** Transparent rule-of-thumb score (0–100). It is NOT a trained model: GC 40–70 %, no TTTT (Pol III terminator), no long homopolymer, favoured G at the PAM-proximal base, avoid T there. */
export function guideRuleScore(seq: string): { score: number; flags: string[] } {
  const gc = (seq.match(/[GC]/g) ?? []).length / seq.length, flags: string[] = []; let s = 100;
  if (gc < 0.4) { s -= (0.4 - gc) * 100; flags.push('low GC'); } if (gc > 0.7) { s -= (gc - 0.7) * 100; flags.push('high GC'); }
  if (/TTTT/.test(seq)) { s -= 30; flags.push('TTTT terminator'); } if (maxRun(seq) >= 5) { s -= 12; flags.push('homopolymer ≥5'); }
  const last = seq[seq.length - 1]; if (last === 'G') s += 4; if (last === 'T') s -= 8; if (seq.slice(-4).includes('GG')) s += 2;
  const sc = complementarity(seq, seq); if (sc.any >= 6) { s -= 10; flags.push('self-complementary'); }
  return { score: Math.max(0, Math.min(100, s)), flags };
}
export function findGuides(seq: string, nuc: Nuclease): Guide[] {
  const T = toDNA(seq.toUpperCase()), n = T.length, out: Guide[] = [], pl = nuc.pam.length, L = nuc.protoLen;
  for (const strand of ['+', '-'] as const) {
    const s = strand === '+' ? T : revComp(T);
    for (let i = 0; i + L + pl <= n; i++) {
      let proto: string, pam: string, a: number;
      if (nuc.pamSide === '3') { proto = s.slice(i, i + L); pam = s.slice(i + L, i + L + pl); a = i; } else { pam = s.slice(i, i + pl); proto = s.slice(i + pl, i + pl + L); a = i + pl; }
      if (!pamOk(nuc.pam, pam) || /[^ACGT]/.test(proto)) continue;
      const start = strand === '+' ? a : n - (a + L), cut = nuc.pamSide === '3' ? (strand === '+' ? start + L - 3 : start + 3) : (strand === '+' ? start + 18 : start + L - 18), { score, flags } = guideRuleScore(proto);
      out.push({ seq: proto, pamSeq: pam, start, end: start + L, strand, gc: (proto.match(/[GC]/g) ?? []).length / L, cutPos: cut, score, flags });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.start - b.start);
}
const MIT_W = [0, 0, 0.014, 0, 0, 0.395, 0.317, 0, 0.389, 0.079, 0.445, 0.508, 0.613, 0.851, 0.732, 0.828, 0.615, 0.804, 0.685, 0.583]; // Hsu et al. 2013, PAM-distal → proximal
/** Scan genome contigs for sites within ≤ maxMm mismatches (SpCas9-style 3′ PAM; seed pre-filter), then a MIT-style specificity score. */
export function offTargets(guide: Guide, genome: Map<string, string>, nuc: Nuclease, maxMm = 3): NonNullable<Guide['offTargets']> {
  const L = guide.seq.length, g = guide.seq, rc: Record<string, string> = {}, counts = [0, 0, 0, 0], top: { pos: number; strand: '+' | '-'; mm: number; seq: string; contig: string }[] = [], sums: number[] = [];
  for (const [contig, raw] of genome) for (const strand of ['+', '-'] as const) {
    const s = strand === '+' ? raw : (rc[contig] ??= revComp(raw));
    for (let i = 0; i + L + nuc.pam.length <= s.length; i++) {
      if (!pamOk(nuc.pam, s.slice(i + L, i + L + nuc.pam.length))) continue;
      let mm = 0, w = 1; const pos: number[] = [];
      for (let j = L - 1; j >= 0; j--) { if (s[i + j] !== g[j]) { mm++; pos.push(j); if (mm > maxMm) break; } }
      if (mm > maxMm) continue; const site = strand === '+' ? i : s.length - i - L;
      if (mm === 0 && contig === (genome.keys().next().value as string) && Math.abs(site - guide.start) < 2 && strand === guide.strand) { counts[0]++; continue; }
      counts[mm]++; if (mm > 0) { for (const p of pos) w *= 1 - MIT_W[Math.min(19, Math.round((p * 19) / (L - 1)))]; const d = pos.length > 1 ? (pos[0] - pos[pos.length - 1]) / (pos.length - 1) : 19; sums.push(w * (1 / (((19 - d) / 19) * 4 + 1)) * (1 / (mm * mm))); }
      if (top.length < 12 && mm > 0) top.push({ pos: site, strand, mm, seq: s.slice(i, i + L), contig });
    }
  }
  const total = sums.reduce((a, b) => a + b, 0) + (counts[0] > 1 ? counts[0] - 1 : 0);
  return { mm0: counts[0], mm1: counts[1], mm2: counts[2], mm3: counts[3], specificity: 100 / (100 + total * 100), top: top.sort((a, b) => a.mm - b.mm) };
}

// ---------------- Protein analysis ----------------
const KD: Record<string, number> = { A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, Q: -3.5, E: -3.5, G: -0.4, H: -3.2, I: 4.5, L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2 };
// TOP-IDP scale (Campen et al. 2008): positive = disorder-promoting
const TOP_IDP: Record<string, number> = { W: -0.884, F: -0.697, Y: -0.510, I: -0.486, M: -0.397, L: -0.326, V: -0.121, N: 0.007, C: 0.02, T: 0.059, A: 0.06, G: 0.166, R: 0.180, D: 0.192, H: 0.303, Q: 0.318, K: 0.586, S: 0.341, E: 0.736, P: 0.987 };
export function windowAvg(seq: string, scale: Record<string, number>, w: number): number[] {
  const half = Math.floor(w / 2), out: number[] = [];
  for (let i = 0; i < seq.length; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - half); j <= Math.min(seq.length - 1, i + half); j++) { const v = scale[seq[j]]; if (v !== undefined) { s += v; n++; } } out.push(n ? s / n : 0); }
  return out;
}
export interface ProteinAnalysis { hydropathy: number[]; disorder: number[]; tmHelices: { start: number; end: number; max: number }[]; disorderedFrac: number; composition: { aa: string; frac: number }[]; chargeCurve: { ph: number; charge: number }[]; lowComplexity: { start: number; end: number }[] }
export function analyseProtein(seq: string): ProteinAnalysis {
  const s = seq.toUpperCase().replace(/[^A-Z]/g, '').replace(/\*/g, ''); if (s.length < 10) throw new Error('Protein is too short to analyse (< 10 residues).');
  const hydro = windowAvg(s, KD, 19), hydro9 = windowAvg(s, KD, 9), dis = windowAvg(s, TOP_IDP, 21), tm: ProteinAnalysis['tmHelices'] = [];
  for (let i = 0; i < s.length;) { if (hydro[i] > 1.6) { let j = i, mx = 0; while (j < s.length && hydro[j] > 1.6) { mx = Math.max(mx, hydro[j]); j++; } if (j - i >= 12 || mx > 2.0) tm.push({ start: i + 1, end: j, max: mx }); i = j; } else i++; }
  const comp = 'ACDEFGHIKLMNPQRSTVWY'.split('').map((aa) => ({ aa, frac: (s.match(new RegExp(aa, 'g')) ?? []).length / s.length }));
  const cnt = (ch: string) => (s.match(new RegExp(ch, 'g')) ?? []).length, curve: { ph: number; charge: number }[] = [];
  for (let ph = 1; ph <= 14; ph += 0.5) { const pos = (pk: number) => 1 / (1 + 10 ** (ph - pk)), neg = (pk: number) => 1 / (1 + 10 ** (pk - ph)); curve.push({ ph, charge: pos(9.69) + cnt('K') * pos(10.5) + cnt('R') * pos(12.4) + cnt('H') * pos(6.0) - neg(2.34) - cnt('D') * neg(3.86) - cnt('E') * neg(4.25) - cnt('C') * neg(8.3) - cnt('Y') * neg(10.07) }); }
  const low: { start: number; end: number }[] = []; // windows of 12 with ≤ 3 distinct residues
  for (let i = 0; i + 12 <= s.length; i++) if (new Set(s.slice(i, i + 12)).size <= 3) { const last = low[low.length - 1]; if (last && i <= last.end) last.end = i + 12; else low.push({ start: i + 1, end: i + 12 }); }
  void hydro9;
  return { hydropathy: hydro, disorder: dis, tmHelices: tm, disorderedFrac: dis.filter((v) => v > 0.1).length / s.length, composition: comp, chargeCurve: curve, lowComplexity: low };
}

// ---------------- PWM motif scanning (JASPAR matrices; CC BY 4.0) ----------------
export interface Pfm { id: string; name: string; A: number[]; C: number[]; G: number[]; T: number[] }
export interface Pwm { id: string; name: string; len: number; w: Float64Array[]; min: number; max: number }
export function pfmToPwm(m: Pfm, pseudo = 0.8): Pwm {
  const len = m.A.length, w: Float64Array[] = []; let min = 0, max = 0;
  for (let i = 0; i < len; i++) { const col = [m.A[i], m.C[i], m.G[i], m.T[i]], tot = col.reduce((a, b) => a + b, 0) + 4 * pseudo, row = Float64Array.from(col, (c) => Math.log2(((c + pseudo) / tot) / 0.25)); w.push(row); min += Math.min(...row); max += Math.max(...row); }
  return { id: m.id, name: m.name, len, w, min, max };
}
export interface MotifHit { pos: number; strand: '+' | '-'; score: number; rel: number; seq: string }
export function scanPwm(seq: string, pwm: Pwm, minRel = 0.9): MotifHit[] {
  const T = toDNA(seq.toUpperCase()), out: MotifHit[] = [], idx: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 }, span = pwm.max - pwm.min || 1;
  for (const strand of ['+', '-'] as const) {
    const s = strand === '+' ? T : revComp(T);
    for (let i = 0; i + pwm.len <= s.length; i++) { let sc = 0, ok = true; for (let j = 0; j < pwm.len; j++) { const b = idx[s[i + j]]; if (b === undefined) { ok = false; break; } sc += pwm.w[j][b]; } if (!ok) continue; const rel = (sc - pwm.min) / span; if (rel >= minRel) out.push({ pos: strand === '+' ? i : T.length - i - pwm.len, strand, score: sc, rel, seq: s.slice(i, i + pwm.len) }); }
  }
  return out.sort((a, b) => b.rel - a.rel);
}
export function pwmConsensus(m: Pfm): string { return m.A.map((_, i) => { const c = [m.A[i], m.C[i], m.G[i], m.T[i]], mx = Math.max(...c); return mx / (c.reduce((a, b) => a + b, 0) || 1) > 0.5 ? 'ACGT'[c.indexOf(mx)] : 'N'; }).join(''); }
