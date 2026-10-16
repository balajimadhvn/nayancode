/** Genome-wide CRISPR off-target search (clean-room): every PAM-compatible window on both strands is compared with each guide,
 *  allowing mismatches and optional DNA / RNA bulges, then scored with CFD (Doench 2016) and MIT (Hsu 2013).
 *  A non-ACGT genome base never matches (it counts as a mismatch, and a PAM base must match its IUPAC code exactly). */
import { CFD_MM, CFD_PAM } from './cfdData';
import { decodeSeq, encodeSeq, revCompCodes, type Contig } from './genomeData';

const IUPAC: Record<string, number> = { A: 1, C: 2, G: 4, T: 8, R: 5, Y: 10, S: 6, W: 9, K: 12, M: 3, B: 14, D: 13, H: 11, V: 7, N: 15 };
/** bit i set ⇔ base code i (A C G T) satisfies the IUPAC letter; code 4 (non-ACGT) satisfies none. */
const maskOf = (pam: string) => [...pam.toUpperCase()].map((c) => { const m = IUPAC[c]; if (!m) throw new Error(`Bad PAM letter "${c}"`); return m; });

export interface Nuclease { id: string; name: string; protoLen: number; pamSide: '3' | '5'; pams: { pam: string; label: string; primary: boolean }[] }
export const CRISPR_NUCLEASES: Nuclease[] = [
  { id: 'spcas9', name: 'SpCas9', protoLen: 20, pamSide: '3', pams: [{ pam: 'NGG', label: 'NGG', primary: true }, { pam: 'NAG', label: 'NAG', primary: false }] },
  { id: 'sacas9', name: 'SaCas9', protoLen: 21, pamSide: '3', pams: [{ pam: 'NNGRRT', label: 'NNGRRT', primary: true }] },
  { id: 'cas12a', name: 'Cas12a (Cpf1)', protoLen: 23, pamSide: '5', pams: [{ pam: 'TTTV', label: 'TTTV', primary: true }] },
];

export interface SearchOpts {
  maxMismatch: number;
  /** Extra DNA bases (bulge in the genome relative to the guide) and extra guide bases (RNA bulge). 0 = ungapped search. */
  maxDnaBulge: number;
  maxRnaBulge: number;
  /** PAM patterns to accept (IUPAC), default the nuclease's primary PAM. */
  pams: string[];
  pamSide: '3' | '5';
  /** Stop collecting after this many hits per guide (reports `truncated`). */
  maxHits: number;
}
export interface Hit {
  guide: number; contig: number; strand: '+' | '-';
  /** Leftmost base of PAM + protospacer on the + strand (the Cas-OFFinder coordinate), 0-based. */
  siteStart: number; siteEnd: number;
  /** Protospacer extent on the + strand, 0-based half-open. */
  start: number; end: number;
  pam: string; mismatches: number; dnaBulge: number; rnaBulge: number;
  /** Protospacer DNA as read 5′→3′ along the guide's strand, with `-` where the guide has an RNA bulge. */
  target: string; alignedGuide: string;
  /** 1-based mismatch positions along the guide (5′ end = 1). */
  mmPos: number[];
}

interface Aln { mm: number; dnaB: number; rnaB: number; used: number; mmPos: number[]; target: string; ag: string }
/** Best alignment of the guide to the DNA next to the PAM (fewest edits; ties favour fewer bulges), searched PAM-proximal → distal by
 *  depth-first search within the edit budgets. `dna(b)` is the b-th DNA base from the PAM (0-3 base, 4 = non-ACGT, 5 = off the contig).
 *  Bulges are interior only (not at either end of the guide). */
function alignBulged(g: Uint8Array, dna: (b: number) => number, o: SearchOpts, proxEnd: boolean): Aln | null {
  const L = g.length; let best: Aln | null = null; const tot = (m: number, d: number, r: number) => m + d + r;
  const rec = (a: number, b: number, mm: number, d: number, r: number, mmPos: number[], tgt: string, ag: string): void => {
    if (best && tot(mm, d, r) > tot(best.mm, best.dnaB, best.rnaB)) return;
    if (a === 0) { if (!best || tot(mm, d, r) < tot(best.mm, best.dnaB, best.rnaB) || d + r < best.dnaB + best.rnaB) best = { mm, dnaB: d, rnaB: r, used: b, mmPos: [...mmPos].sort((x, y) => x - y), target: tgt, ag }; return; }
    const gi = proxEnd ? a - 1 : L - a, gc = g[gi], dc = dna(b), gl = 'ACGT'[gc];
    if (dc <= 4) {
      if (dc === gc) rec(a - 1, b + 1, mm, d, r, mmPos, tgt + gl, ag + gl);
      else if (mm < o.maxMismatch) rec(a - 1, b + 1, mm + 1, d, r, [...mmPos, gi + 1], tgt + 'acgtn'[dc], ag + gl);
    }
    if (a < L && a > 1 && r < o.maxRnaBulge) rec(a - 1, b, mm, d, r + 1, mmPos, tgt + '-', ag + gl);
    if (a < L && d < o.maxDnaBulge && dc <= 4) rec(a, b + 1, mm, d + 1, r, mmPos, tgt + 'ACGTN'[dc], ag + '-');
  };
  rec(L, 0, 0, 0, 0, [], '', ''); return best;
}

export interface SearchResult { hits: Hit[]; truncated: boolean[]; pamSites: number }

/** Search all contigs for all guides (each a 5′→3′ ACGT string; all must share one length for ungapped search to be meaningful). */
export function searchGuides(contigs: Contig[], guides: string[], opts: Partial<SearchOpts> & { nuclease?: Nuclease } = {}): SearchResult {
  const nuc = opts.nuclease ?? CRISPR_NUCLEASES[0];
  const o: SearchOpts = { maxMismatch: 4, maxDnaBulge: 0, maxRnaBulge: 0, pams: nuc.pams.filter((p) => p.primary).map((p) => p.pam), pamSide: nuc.pamSide, maxHits: 50000, ...opts };
  const gcodes = guides.map((x, i) => { const c = encodeSeq(x.toUpperCase().replace(/[^A-Z]/g, '')); if (!c.length || c.some((v) => v > 3)) throw new Error(`Guide ${i + 1} must contain only A, C, G, T`); return c; });
  const pamMasks = o.pams.map(maskOf), pl = pamMasks[0].length; if (pamMasks.some((m) => m.length !== pl)) throw new Error('All PAM patterns must have the same length');
  const proxEnd = o.pamSide === '3', bulged = o.maxDnaBulge > 0 || o.maxRnaBulge > 0, hits: Hit[] = [], count = guides.map(() => 0), truncated = guides.map(() => false); let pamSites = 0;
  contigs.forEach((ct, ci) => {
    const n = ct.length;
    for (const strand of ['+', '-'] as const) {
      const s = strand === '+' ? ct.codes : revCompCodes(ct.codes), fwd = (a: number, b: number): [number, number] => (strand === '+' ? [a, b] : [n - b, n - a]), pams: number[] = [];
      for (let i = 0; i + pl <= n; i++) { for (const mk of pamMasks) { let good = true; for (let j = 0; j < pl; j++) { const c = s[i + j]; if (c > 3 || !((mk[j] >> c) & 1)) { good = false; break; } } if (good) { pams.push(i); break; } } }
      pamSites += pams.length;
      gcodes.forEach((g, gi) => {
        const L = g.length;
        for (const pamPos of pams) {
          let mm = 0, mmPos: number[] = [], dnaB = 0, rnaB = 0, target: string, ag: string, pStart: number, pEnd: number;
          if (!bulged) {
            if (proxEnd) { pStart = pamPos - L; pEnd = pamPos; } else { pStart = pamPos + pl; pEnd = pStart + L; } if (pStart < 0 || pEnd > n) continue;
            for (let j = 0; j < L; j++) if (s[pStart + j] !== g[j]) { if (++mm > o.maxMismatch) break; mmPos.push(j + 1); }
            if (mm > o.maxMismatch) continue;
            target = ''; for (let j = 0; j < L; j++) { const c = s[pStart + j], b = c < 4 ? 'ACGT'[c] : 'N'; target += c === g[j] ? b : b.toLowerCase(); } ag = decodeSeq(g);
          } else {
            const r = alignBulged(g, (b) => { const p = proxEnd ? pamPos - 1 - b : pamPos + pl + b; return p < 0 || p >= n ? 5 : s[p]; }, o, proxEnd); if (!r) continue;
            mm = r.mm; dnaB = r.dnaB; rnaB = r.rnaB; mmPos = r.mmPos; target = proxEnd ? [...r.target].reverse().join('') : r.target; ag = proxEnd ? [...r.ag].reverse().join('') : r.ag;
            if (proxEnd) { pStart = pamPos - r.used; pEnd = pamPos; } else { pStart = pamPos + pl; pEnd = pStart + r.used; } if (pStart < 0 || pEnd > n) continue;
          }
          if (count[gi] >= o.maxHits) { truncated[gi] = true; continue; } count[gi]++;
          const [fa, fb] = fwd(proxEnd ? pStart : pamPos, proxEnd ? pamPos + pl : pEnd), [pa, pb] = fwd(pStart, pEnd);
          hits.push({ guide: gi, contig: ci, strand, siteStart: fa, siteEnd: fb, start: pa, end: pb, pam: decodeSeq(s, pamPos, pamPos + pl), mismatches: mm, dnaBulge: dnaB, rnaBulge: rnaB, target, alignedGuide: ag, mmPos });
        }
      });
    }
  });
  hits.sort((a, b) => a.guide - b.guide || a.contig - b.contig || a.siteStart - b.siteStart || (a.strand < b.strand ? -1 : 1));
  return { hits, truncated, pamSites };
}

// ---------------- scoring ----------------
/** CFD score (Doench 2016): product of position/type-specific mismatch weights × the PAM weight. Defined for 20-nt SpCas9 guides with NGG/NAG-type PAMs; null otherwise. */
export function cfdScore(guide: string, protospacer: string, pam: string): number | null {
  const g = guide.toUpperCase(), t = protospacer.toUpperCase(); if (g.length !== 20 || t.length !== 20 || pam.length !== 3) return null;
  const pw = CFD_PAM[pam.slice(1).toUpperCase()]; if (pw === undefined) return null;
  let s = 1; for (let i = 0; i < 20; i++) if (g[i] !== t[i]) { const w = CFD_MM[`${g[i]}${t[i]}${i + 1}`]; if (w === undefined) return null; s *= w; }
  return s * pw;
}
const MIT_W = [0, 0, 0.014, 0, 0, 0.395, 0.317, 0, 0.389, 0.079, 0.445, 0.508, 0.613, 0.851, 0.732, 0.828, 0.615, 0.804, 0.685, 0.583]; // Hsu et al. 2013, position 1 = PAM-distal
/** MIT off-target score (Hsu 2013) of a single site on a 0-100 scale: ∏(1−W) · 1/((19−d̄)/19·4+1) · 1/n². 100 = identical to the guide. */
export function mitSiteScore(mmPos: number[]): number {
  const n = mmPos.length; if (n === 0) return 100; let w = 1; for (const p of mmPos) w *= 1 - MIT_W[p - 1];
  const d = n > 1 ? (mmPos[n - 1] - mmPos[0]) / (n - 1) : 19; return 100 * w * (1 / (((19 - d) / 19) * 4 + 1)) * (1 / (n * n));
}
/** Guide-level MIT specificity from its off-target sites: 100 / (100 + Σ site scores). */
export const mitSpecificity = (offScores: number[]) => 100 / (100 + offScores.reduce((a, b) => a + b, 0)) * 100;
export const cfdSpecificity = (offScores: number[]) => 100 / (100 + 100 * offScores.reduce((a, b) => a + b, 0));

export interface ScoredHit extends Hit { cfd: number | null; mit: number | null; onTarget: boolean }
/** Adds CFD and MIT scores. The first perfect-match hit with the primary PAM of each guide is taken as the on-target site and excluded from the aggregate scores. */
export function scoreHits(hits: Hit[], guides: string[], primaryPams: Set<string> | ((pam: string) => boolean)): { scored: ScoredHit[]; perGuide: { guide: number; onTargets: number; offTargets: number; cfdSpecificity: number | null; mitSpecificity: number | null }[] } {
  const isPrimary = typeof primaryPams === 'function' ? primaryPams : (p: string) => primaryPams.has(p), seenOn = new Set<number>();
  const scored: ScoredHit[] = hits.map((h) => {
    const exact = h.mismatches === 0 && h.dnaBulge === 0 && h.rnaBulge === 0, on = exact && isPrimary(h.pam) && !seenOn.has(h.guide); if (on) seenOn.add(h.guide);
    const gl = guides[h.guide].length, ungapped = h.dnaBulge === 0 && h.rnaBulge === 0;
    const cfd = ungapped && gl === 20 ? cfdScore(guides[h.guide], h.target.toUpperCase(), h.pam) : null, mit = ungapped && gl === 20 && /^[ACGT]GG$/.test(h.pam) ? mitSiteScore(h.mmPos) : null;
    return { ...h, cfd, mit, onTarget: on };
  });
  const perGuide = guides.map((_, gi) => { const mine = scored.filter((h) => h.guide === gi), off = mine.filter((h) => !h.onTarget), cf = off.map((h) => h.cfd).filter((x): x is number => x !== null), mi = off.filter((h) => h.mit !== null && /^[ACGT]GG$/.test(h.pam)).map((h) => h.mit!); return { guide: gi, onTargets: mine.length - off.length, offTargets: off.length, cfdSpecificity: guides[gi].length === 20 ? cfdSpecificity(cf) : null, mitSpecificity: guides[gi].length === 20 ? mitSpecificity(mi) : null }; });
  return { scored, perGuide };
}
