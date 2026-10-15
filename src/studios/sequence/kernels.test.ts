import { describe, expect, it } from 'vitest';
import { align, composition, detectAlphabet, digest, findOrfs, oligoTm, parseFasta, proteinProps, revComp, translate } from './kernels';

describe('sequence kernels', () => {
  it('parses multi-FASTA', () => {
    const r = parseFasta('>a desc here\nACGT\nacgt\n>b\nGG\n');
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ id: 'a', description: 'desc here', seq: 'ACGTACGT' });
  });
  it('reverse complements incl. IUPAC', () => { expect(revComp('ATGCN')).toBe('NGCAT'); });
  it('translates with the standard code', () => {
    expect(translate('ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG')).toBe('MAIVMGR*KGAR*');
    expect(translate('ATGAAATAGCCC', 0, true)).toBe('MK');
  });
  it('detects alphabets', () => {
    expect(detectAlphabet('ACGTACGT')).toBe('dna');
    expect(detectAlphabet('ACGUACGU')).toBe('rna');
    expect(detectAlphabet('MKTAYIAKQR')).toBe('protein');
  });
  it('finds ORFs on both strands', () => {
    const orf = 'ATG' + 'GCC'.repeat(60) + 'TAA';
    const dna = 'CCCC' + orf + 'GGGG';
    const fwd = findOrfs(dna, 50);
    expect(fwd[0]).toMatchObject({ strand: 1, start: 5, end: 4 + orf.length, lengthAa: 61 });
    const rev = findOrfs(revComp(dna), 50);
    expect(rev[0].strand).toBe(-1);
    expect(rev[0].lengthAa).toBe(61);
  });
  it('computes GC', () => { expect(composition('GGCCAATT').gc).toBeCloseTo(0.5); });
  it('digests linear and circular DNA', () => {
    const s = 'AAAGAATTCAAAAAAAAAGAATTCAAA'; // two EcoRI sites, length 27
    const lin = digest(s, ['EcoRI']);
    expect(lin.sites.map((x) => x.pos)).toEqual([4, 19]);
    expect(lin.fragments.reduce((a, b) => a + b, 0)).toBe(s.length);
    expect(lin.fragments).toHaveLength(3);
    const circ = digest(s, ['EcoRI'], true);
    expect(circ.fragments).toHaveLength(2);
    expect(circ.fragments.reduce((a, b) => a + b, 0)).toBe(s.length);
  });
  it('estimates Tm in a plausible range', () => {
    const p = oligoTm('AGCGGATAACAATTTCACACAGGA'); // lac primer ~ 55-62 C at 50 mM Na
    expect(p.tm).toBeGreaterThan(50);
    expect(p.tm).toBeLessThan(68);
    expect(oligoTm('GCGCGCGCGCGCGCGCGCGC').tm).toBeGreaterThan(oligoTm('ATATATATATATATATATAT').tm);
  });
  it('computes protein properties', () => {
    const p = proteinProps('MKWVTFISLLFLFSSAYS');
    expect(p.length).toBe(18);
    expect(p.mw).toBeGreaterThan(2000);
    expect(p.mw).toBeLessThan(2200);
    expect(proteinProps('KKKKKKKK').pI).toBeGreaterThan(10);
    expect(proteinProps('DDDDEEEE').pI).toBeLessThan(4);
  });
  it('aligns globally with affine gaps', () => {
    const r = align('GATTACA', 'GATTACA', { mode: 'global', kind: 'dna' });
    expect(r.identity).toBe(1);
    expect(r.score).toBe(14);
    const g = align('ACGTACGT', 'ACGTCGT', { mode: 'global', kind: 'dna' });
    expect(g.a.replace(/-/g, '')).toBe('ACGTACGT');
    expect(g.b.replace(/-/g, '')).toBe('ACGTCGT');
    expect(g.gaps).toBe(1);
  });
  it('aligns locally', () => {
    const r = align('TTTTGATTACATTTT', 'CCGATTACACC', { mode: 'local', kind: 'dna' });
    expect(r.a).toBe('GATTACA');
    expect(r.identity).toBe(1);
  });
  it('aligns proteins with BLOSUM62', () => {
    const r = align('HEAGAWGHEE', 'PAWHEAE', { mode: 'global', kind: 'protein' });
    expect(r.a.replace(/-/g, '')).toBe('HEAGAWGHEE');
    expect(r.score).toBeGreaterThan(0);
  });
});
