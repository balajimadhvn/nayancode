import { describe, expect, it } from 'vitest';
import { revComp } from '@/studios/sequence/kernels';
import { cloningOligos, findGuides, scoreGuide } from './guides';

const mulberry32 = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const randomSeq = (n: number, seed: number) => { const r = mulberry32(seed); return Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join(''); };
const countSites = (s: string) => [...s.matchAll(/(?=([ACGT]{20})[ACGT]GG)/g)].length;

describe('findGuides', () => {
  it('finds exactly the independently counted SpCas9 sites on both strands', () => {
    const seq = randomSeq(300, 20261026);
    const expected = countSites(seq) + countSites(revComp(seq));
    const guides = findGuides(seq, 'SpCas9');
    expect(guides.length).toBe(expected);
    expect(guides.every((g) => g.protospacer.length === 20 && /^[ACGT]GG$/.test(g.pam))).toBe(true);
  });

  it('places a forward-strand guide on the reverse complement with strand -1 and the same protospacer', () => {
    const seq = randomSeq(300, 7);
    const fwd = findGuides(seq, 'SpCas9').find((g) => g.strand === 1)!;
    expect(fwd).toBeTruthy();
    const mirror = findGuides(revComp(seq), 'SpCas9').find((g) => g.strand === -1 && g.protospacer === fwd.protospacer);
    expect(mirror).toBeTruthy();
    expect(mirror!.start).toBe(seq.length - fwd.start - 18);
  });

  it('cuts SpCas9 between protospacer positions 17 and 18', () => {
    const seq = 'ACGTACGTAC' + 'GACCTGACCTGACCTGACCT' + 'AGG';
    const g = findGuides(seq, 'SpCas9').find((x) => x.start === 11)!;
    expect(g.cutPos).toBe(27); // after base 27, i.e. between 27 and 28
    expect(g.pam).toBe('AGG');
    expect(g.strand).toBe(1);
  });

  it('finds Cas12a TTTV PAMs but not TTTT', () => {
    const proto = 'ACGTTGCAACGTTGCAACGTACG';
    expect(proto).toHaveLength(23);
    const found = findGuides('GGTTTA' + proto, 'Cas12a');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ start: 7, pam: 'TTTA', protospacer: proto, strand: 1, cutPos: 24 });
    expect(findGuides('TTTT' + proto, 'Cas12a')).toHaveLength(0);
    expect(findGuides('TTTC' + proto, 'Cas12a')).toHaveLength(1);
    expect(findGuides('TTTG' + proto, 'Cas12a')).toHaveLength(1);
  });

  it('skips protospacers with non-ACGT characters', () => {
    expect(findGuides('ACGTACGTAN' + 'CGTACGTACG' + 'AGG', 'SpCas9').filter((g) => g.start === 11)).toHaveLength(0);
  });
});

describe('on-target heuristic', () => {
  it('gives a neutral 50 % GC guide with an A next to the PAM the full 100', () => {
    expect(scoreGuide('ACGTACGTACGTACGTACGA', 20)).toEqual({ score: 100, flags: [] });
  });
  it('applies the item penalties exactly', () => {
    expect(scoreGuide('GC'.repeat(10), 20)).toMatchObject({ score: 60, flags: ['GC outside 30–80%', 'C/T at position 20'] });
    expect(scoreGuide('ACGTACGTTTTTACGTACGA', 20)).toMatchObject({ score: 45, flags: ['GC 30–40% or 70–80%', 'TTTT (Pol III terminator)'] });
    expect(scoreGuide('ACGTGGGGACGTACGTACGA', 20)).toMatchObject({ score: 80, flags: ['GGGG+ homopolymer'] });
    expect(scoreGuide('ACGTACGTACGTACGTACGT', 20)).toMatchObject({ score: 90, flags: ['C/T at position 20'] });
  });
});

describe('cloning oligos', () => {
  it('adds the extra G only when the guide does not start with G', () => {
    const a = cloningOligos('ACGTACGTACGTACGTACGA');
    expect(a.top).toBe('CACCGACGTACGTACGTACGTACGA');
    expect(a.bottom).toBe('AAACTCGTACGTACGTACGTACGT' + 'C');
    const b = cloningOligos('GACCTGACCTGACCTGACCT');
    expect(b.top).toBe('CACCGACCTGACCTGACCTGACCT');
    expect(b.bottom).toHaveLength(25);
  });
});
