/** Ungapped off-target search for 20-nt SpCas9 guides and MIT-style specificity. Pure TypeScript. */
import { revComp } from '@/studios/sequence/kernels';

export interface OffTargetHit {
  /** Sequence identifier supplied in the background. */
  seq: string;
  /** 1-based start of the protospacer on the plus strand of the background sequence. */
  pos: number;
  strand: 1 | -1;
  /** 1-based mismatch positions counted from the PAM-distal 5′ end of the guide. */
  mismatches: number[];
  /** Protospacer + PAM as read on the guide's strand. */
  site: string;
}

export interface BackgroundSeq { id: string; seq: string }
export interface OffTargetExclude { seqId?: string; pos: number; strand: 1 | -1 }

/** Hsu et al. (2013) position weights, index 0 = position 1 at the PAM-distal 5′ end. */
const MIT_W = [0, 0, 0.014, 0, 0, 0.395, 0.317, 0, 0.389, 0.079, 0.445, 0.508, 0.613, 0.851, 0.732, 0.828, 0.615, 0.804, 0.685, 0.583];

/** MIT site score of one off-target (0–1 scale): ∏(1−W) × 1/(((19−d)/19)×4+1) × 1/n². */
export function mitSiteScore(mismatches: number[]): number {
  const n = mismatches.length;
  if (n === 0) return 1;
  let w = 1;
  for (const p of mismatches) w *= 1 - MIT_W[p - 1];
  const d = n > 1 ? (mismatches[n - 1] - mismatches[0]) / (n - 1) : 19;
  return w * (1 / (((19 - d) / 19) * 4 + 1)) * (1 / (n * n));
}

/** Guide specificity over its off-target sites with at least one mismatch: 100 / (1 + Σ site score). */
export const mitSpecificity = (offSites: number[]) => 100 / (1 + offSites.reduce((a, b) => a + b, 0));

const IUPAC: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'T', R: '[AG]', Y: '[CT]', S: '[GC]', W: '[AT]', K: '[GT]', M: '[AC]', B: '[CGT]', D: '[AGT]', H: '[ACT]', V: '[ACG]', N: '[ACGT]' };
const pamRegExp = (pam: RegExp | string): RegExp => {
  if (pam instanceof RegExp) return new RegExp(pam.source, pam.flags.replace(/g/g, ''));
  return new RegExp(`^${[...pam.toUpperCase()].map((c) => IUPAC[c] ?? c).join('')}$`);
};
const backgroundList = (bg: string | BackgroundSeq | BackgroundSeq[]): BackgroundSeq[] =>
  typeof bg === 'string' ? [{ id: 'background', seq: bg }] : Array.isArray(bg) ? bg : [bg];

/**
 * Scan one or more background sequences on both strands for 20-nt protospacers followed by a PAM
 * matching `pam` (default NGG) and differing from `guide` at <= maxMm positions. The on-target copy
 * can be excluded by its background sequence id, 1-based position and strand.
 */
export function offTargets(guide: string, pam: RegExp | string, background: string | BackgroundSeq | BackgroundSeq[], maxMm = 4, exclude?: OffTargetExclude): OffTargetHit[] {
  const g = guide.toUpperCase();
  if (!/^[ACGT]{20}$/.test(g)) throw new Error('The guide must be 20 ACGT bases.');
  const pamRe = pamRegExp(pam ?? 'NGG');
  const ggPam = /GG\$?$/.test(pamRe.source);
  const hits: OffTargetHit[] = [];
  for (const rec of backgroundList(background)) {
    const seq = rec.seq.toUpperCase();
    for (const strand of [1, -1] as const) {
      const s = strand === 1 ? seq : revComp(seq);
      const candidate = (pamStart: number) => {
        if (pamStart < 0) return;
        const pam = s.slice(pamStart, pamStart + 3);
        if (!pamRe.test(pam)) return;
        const p0 = pamStart - 20;
        if (p0 < 0) return;
        let mm = 0;
        const mismatches: number[] = [];
        for (let i = 0; i < 20; i++) {
          if (s.charCodeAt(p0 + i) !== g.charCodeAt(i)) {
            mismatches.push(i + 1);
            if (++mm > maxMm) return;
          }
        }
        const pos = strand === 1 ? p0 + 1 : seq.length - pamStart + 1;
        if (exclude && exclude.strand === strand && exclude.pos === pos && (exclude.seqId === undefined || exclude.seqId === rec.id)) return;
        hits.push({ seq: rec.id, pos, strand, mismatches, site: s.slice(p0, pamStart + 3) });
      };
      if (ggPam) {
        let j = s.indexOf('GG', 1);
        while (j >= 0) { candidate(j - 1); j = s.indexOf('GG', j + 1); }
      } else {
        for (let pamStart = 0; pamStart + 23 <= s.length; pamStart++) candidate(pamStart);
      }
    }
  }
  return hits;
}
