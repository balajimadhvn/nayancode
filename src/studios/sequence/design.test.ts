import { describe, expect, it } from 'vitest';
import { analyseProtein, bindingSites, complementarity, designPrimers, findGuides, guideRuleScore, insilicoPcr, NUCLEASES, offTargets, pfmToPwm, pwmConsensus, scanPwm } from './design';
import { revComp } from './kernels';

const rnd = (seed: number, n: number) => { let s = seed >>> 0; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); return Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join(''); };
describe('primer design', () => {
  const T = rnd(5, 1200);
  it('designs valid pairs around a target', () => {
    const { pairs } = designPrimers(T, { start: 500, len: 60 }, { minProduct: 150, maxProduct: 500 });
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.left.end).toBeLessThanOrEqual(500); expect(p.right.start).toBeGreaterThanOrEqual(560); expect(p.product).toBeGreaterThanOrEqual(150); expect(p.product).toBeLessThanOrEqual(500);
      expect(Math.abs(p.left.tm - p.right.tm)).toBeLessThanOrEqual(2.5); expect(p.left.tm).toBeGreaterThanOrEqual(57); expect(p.right.tm).toBeLessThanOrEqual(63);
      expect(T.slice(p.left.start, p.left.end)).toBe(p.left.seq); expect(revComp(T.slice(p.right.start, p.right.end))).toBe(p.right.seq);
    }
    expect(pairs[0].penalty).toBeLessThanOrEqual(pairs[pairs.length - 1].penalty);
  });
  it('explains failure and rejects bad targets', () => { expect(() => designPrimers(T, { start: 500, len: 60 }, { minTm: 80, maxTm: 85 })).toThrow(/No primer pairs/); expect(() => designPrimers(T, { start: 1190, len: 50 })).toThrow(/outside/); });
  it('in-silico PCR reproduces the designed product', () => {
    const { pairs } = designPrimers(T, { start: 500, len: 60 }, { minProduct: 150, maxProduct: 500 }), p = pairs[0], prods = insilicoPcr(p.left.seq, p.right.seq, T);
    expect(prods).toHaveLength(1); expect(prods[0].size).toBe(p.product); expect(prods[0].start).toBe(p.left.start);
  });
  it('finds binding sites and complementarity', () => { expect(bindingSites('ACGTACGTAC', 'TTACGTACGTACTT').length).toBe(1); expect(complementarity('GGATCC', 'GGATCC').any).toBe(6); expect(complementarity('AAAA', 'CCCC').any).toBe(0); });
});
describe('CRISPR', () => {
  const T = rnd(11, 800), cas9 = NUCLEASES[0];
  it('finds NGG guides on both strands with correct coordinates', () => {
    const gs = findGuides(T, cas9); expect(gs.length).toBeGreaterThan(20);
    for (const g of gs.slice(0, 40)) { const seq = g.strand === '+' ? T.slice(g.start, g.end) : revComp(T.slice(g.start, g.end)); expect(seq).toBe(g.seq); const pam = g.strand === '+' ? T.slice(g.end, g.end + 3) : revComp(T.slice(g.start - 3, g.start)); expect(pam).toBe(g.pamSeq); expect(g.pamSeq.slice(1)).toBe('GG'); }
  });
  it('Cas12a PAM is 5′ of the protospacer', () => { const g = findGuides('A'.repeat(5) + 'TTTA' + 'C'.repeat(10) + 'GATC'.repeat(5) + 'A'.repeat(10), NUCLEASES[2]).find((x) => x.strand === '+'); expect(g?.pamSeq).toBe('TTTA'); });
  it('rule score penalises TTTT and extreme GC', () => { expect(guideRuleScore('GACGTCAGTCAGTCGATCGG').score).toBeGreaterThan(guideRuleScore('GACGTTTTCAGTCGATCGGT').score); expect(guideRuleScore('AAAAAAAAAAAAAAAAAAAA').score).toBeLessThan(60); });
  it('off-target scan counts the exact site once and finds planted mismatched sites', () => {
    const guide = 'GACGTCAGTCAGTCGATCGA', site = (g: string) => g + 'TGG', filler = (n: number, s: number) => rnd(s, n).replace(/GG/g, 'GA');
    const mut = (g: string, i: number) => g.slice(0, i) + (g[i] === 'A' ? 'C' : 'A') + g.slice(i + 1);
    const genome = new Map([['c1', filler(300, 1) + site(guide) + filler(300, 2) + site(mut(guide, 3)) + filler(200, 3) + site(mut(mut(guide, 0), 9)) + filler(200, 4)]]);
    const g = findGuides(genome.get('c1')!, cas9).find((x) => x.seq === guide && x.strand === '+')!; const ot = offTargets(g, genome, cas9, 3);
    expect(ot.mm0).toBe(1); expect(ot.mm1).toBe(1); expect(ot.mm2).toBe(1); expect(ot.specificity).toBeLessThan(100); expect(ot.specificity).toBeGreaterThan(0);
  });
});
describe('protein analysis', () => {
  it('finds a hydrophobic TM helix and a disordered region', () => {
    const tm = 'LLIVALLAVVLIAGLLIVALAFLV', disordered = 'PEPKSEPSKEPEKSPEPKSEEPKSPEPEKSE', s = 'MKTSEQ' + disordered + 'GSGSG' + tm + 'RRKK' + 'DEDEDEDED';
    const a = analyseProtein(s); expect(a.tmHelices.length).toBeGreaterThanOrEqual(1); expect(a.tmHelices[0].start).toBeGreaterThan(30);
    expect(a.disorder.slice(8, 30).reduce((x, y) => x + y, 0) / 22).toBeGreaterThan(0.2); expect(a.disorder.slice(45, 55).reduce((x, y) => x + y, 0) / 10).toBeLessThan(0);
    const z = a.chargeCurve.reduce((best, c) => (Math.abs(c.charge) < Math.abs(best.charge) ? c : best)); expect(z.ph).toBeGreaterThan(3); expect(z.ph).toBeLessThan(9);
    expect(a.composition.reduce((x, y) => x + y.frac, 0)).toBeCloseTo(1, 6);
  });
});
describe('PWM scanning', () => {
  const tata = { id: 'T1', name: 'TATA', A: [0, 20, 0, 20, 10], C: [0, 0, 0, 0, 5], G: [0, 0, 0, 0, 5], T: [20, 0, 20, 0, 0] };
  it('scores consensus highest and finds both strands', () => {
    const pwm = pfmToPwm(tata), seq = 'GGGG' + 'TATAA' + 'CCCC' + revComp('TATAA') + 'GGGG', hits = scanPwm(seq, pwm, 0.95);
    expect(pwmConsensus(tata)).toBe('TATAN'); // last column: A is exactly 50 %, so N expect(hits.length).toBe(2); expect(new Set(hits.map((h) => h.strand))).toEqual(new Set(['+', '-']));
    expect(hits.find((h) => h.strand === '+')!.pos).toBe(4); expect(hits[0].rel).toBeCloseTo(1, 6); expect(scanPwm('GGGGGGGGGGGG', pwm, 0.7)).toHaveLength(0);
  });
});
