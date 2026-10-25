/** CRISPR guide enumeration and a transparent on-target heuristic. Pure TypeScript: no DOM, no React. */
import { revComp } from '@/studios/sequence/kernels';

export type NucleaseId = 'SpCas9' | 'Cas12a';

export interface Guide {
  id: string;
  strand: 1 | -1;
  /** 1-based start of the protospacer on the input sequence (plus-strand coordinates). */
  start: number;
  /** Protospacer as the nuclease reads it, 5′→3′ on its own strand. */
  protospacer: string;
  /** PAM as read on the nuclease's strand. */
  pam: string;
  /** 1-based index of the last base before the cut on the input plus strand. */
  cutPos: number;
  /** GC fraction of the protospacer (0–1). */
  gc: number;
  score: number;
  flags: string[];
}

const ACGT = /^[ACGT]+$/;
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * On-target heuristic: start at 100 and subtract the item's five penalties.
 * `nearPam` is the protospacer base next to the PAM (position 20 for SpCas9, position 1 for Cas12a).
 */
export function scoreGuide(protospacer: string, nearPam: number): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 100;
  const gc = [...protospacer].filter((b) => b === 'G' || b === 'C').length / Math.max(1, protospacer.length);
  if (gc < 0.3 || gc > 0.8) { score -= 30; flags.push('GC outside 30–80%'); }
  else if (gc <= 0.4 || gc >= 0.7) { score -= 15; flags.push('GC 30–40% or 70–80%'); }
  if (protospacer.includes('TTTT')) { score -= 40; flags.push('TTTT (Pol III terminator)'); }
  if (/G{4,}/.test(protospacer)) { score -= 20; flags.push('GGGG+ homopolymer'); }
  const b = protospacer[nearPam - 1];
  if (b === 'C' || b === 'T') { score -= 10; flags.push(`C/T at position ${nearPam}`); }
  return { score: Math.max(0, Math.min(100, score)), flags };
}

/**
 * Enumerate nuclease sites on both strands.
 * SpCas9: 20-nt protospacer followed by NGG. Cas12a: TTTV followed by a 23-nt protospacer.
 * Windows that run off the sequence, or protospacers containing non-ACGT characters, are skipped.
 */
export function findGuides(input: string, nuclease: NucleaseId | string): Guide[] {
  const seq = input.toUpperCase();
  const cas12 = nuclease === 'Cas12a';
  const out: Guide[] = [];
  const protoLen = cas12 ? 23 : 20;
  const total = cas12 ? 27 : 23;
  const push = (s: string, i: number, strand: 1 | -1) => {
    const pam = s.slice(cas12 ? i : i + protoLen, cas12 ? i + 4 : i + total);
    const protospacer = s.slice(cas12 ? i + 4 : i, cas12 ? i + total : i + protoLen);
    if (!ACGT.test(protospacer) || !ACGT.test(pam)) return;
    const start = strand === 1 ? (cas12 ? i + 5 : i + 1) : (cas12 ? seq.length - i - 26 : seq.length - i - 19);
    const cutPos = strand === 1 ? start + (cas12 ? 17 : 16) : start + (cas12 ? 4 : 2);
    const { score, flags } = scoreGuide(protospacer, cas12 ? 1 : 20);
    const gc = [...protospacer].filter((b) => b === 'G' || b === 'C').length / protoLen;
    out.push({ id: `${strand === 1 ? 'f' : 'r'}${start}`, strand, start, protospacer, pam, cutPos, gc: round(gc), score, flags });
  };
  const rc = revComp(seq);
  for (const [s, strand] of [[seq, 1], [rc, -1]] as const) {
    for (let i = 0; i + total <= s.length; i++) {
      if (cas12) {
        if (s.slice(i, i + 3) !== 'TTT') continue;
        if (!'ACG'.includes(s[i + 3])) continue;
      } else if (!/^[ACGT]GG$/.test(s.slice(i + protoLen, i + total))) continue;
      push(s, i, strand);
    }
  }
  return out.sort((a, b) => a.start - b.start || (a.strand === b.strand ? 0 : a.strand === 1 ? -1 : 1));
}

/** Cloning oligos for a U6/BsmBI-style vector. The extra 5′ G is omitted when the guide already starts with G. */
export function cloningOligos(protospacer: string): { top: string; bottom: string } {
  const guide = protospacer.toUpperCase().replace(/[^ACGT]/g, '');
  const top = (guide.startsWith('G') ? 'CACC' : 'CACCG') + guide;
  return { top, bottom: 'AAAC' + revComp(guide) + 'C' };
}
