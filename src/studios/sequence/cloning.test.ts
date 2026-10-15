import { describe, expect, it } from 'vitest';
import { cloneRestriction, designGibsonPrimers, digestFragments, flip, gibsonAssemble, goldenGate, compatible } from './cloning';
import { digest, ENZYMES, revComp } from './kernels';

const rnd = (seed: number, n: number, avoid: string[] = []) => { let s = seed >>> 0; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); let t = Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join(''); for (const a of avoid) t = t.split(a).join('ACAC'); return t; };
const AV = ENZYMES.flatMap((e) => [e.site]).concat(['GGTCTC', 'GAGACC', 'CGTCTC', 'GAGACG', 'GAAGAC', 'GTCTTC']);
describe('restriction digest model', () => {
  it('overhang bookkeeping for 5′, 3′ and blunt cutters', () => {
    const seq = 'AAAA' + 'GAATTC' + 'CCCC' + 'CTGCAG' + 'TTTT' + 'GATATC' + 'AAAA', f = digestFragments(seq, ['EcoRI', 'PstI', 'EcoRV'], false);
    expect(f).toHaveLength(4); expect(f[0].right).toMatchObject({ type: '5', ov: 'AATT' }); expect(f[1].left).toMatchObject({ type: '5', ov: 'AATT' }); expect(f[1].right).toMatchObject({ type: '3', ov: 'TGCA' }); expect(f[2].right).toMatchObject({ type: 'blunt', ov: '' });
    // lengths: fragment spans (core + both overhangs counted once) sum to template
    expect(f.reduce((a, x) => a + x.core.length, 0) + 4 + 4 + 0).toBe(seq.length);
  });
  it('agrees with the simple digest kernel on fragment count', () => { const s = rnd(2, 900, AV).slice(0, 300) + 'GGATCC' + rnd(3, 300, AV) + 'GGATCC' + rnd(4, 200, AV); expect(digestFragments(s, ['BamHI'], true)).toHaveLength(digest(s, ['BamHI'], true).fragments.length); });
  it('flip is an involution and keeps compatibility semantics', () => { const f = digestFragments('AAAAGAATTCCCCCCCGGATCCTTTT', ['EcoRI', 'BamHI'], false)[1]; expect(flip(flip(f))).toEqual(f); expect(compatible(f.right, f.left)).toBe(false); /* BamHI GATC vs EcoRI AATT */ expect(flip(f).left.ov).toBe(revComp(f.right.ov)); expect(compatible(f.left, f.left)).toBe(true); });
});
describe('restriction cloning', () => {
  const left = rnd(10, 500, AV), mid = rnd(11, 150, AV), right = rnd(12, 600, AV), gene = rnd(13, 400, AV);
  const vector = left + 'GAATTC' + mid + 'GGATCC' + right, insert = 'TTTTT' + 'GAATTC' + gene + 'GGATCC' + 'TTTTT';
  it('directional EcoRI/BamHI cloning gives exactly one correct product', () => {
    const r = cloneRestriction(vector, true, ['EcoRI', 'BamHI'], insert, false, ['EcoRI', 'BamHI']);
    expect(r.products).toHaveLength(1); const p = r.products[0];
    expect(p.length).toBe(vector.length - mid.length - 0 + gene.length); expect(p.sequence + p.sequence).toContain(left.slice(-30) + 'GAATTC' + gene.slice(0, 30)); expect(p.sequence + p.sequence).toContain(gene.slice(-30) + 'GGATCC' + right.slice(0, 30));
    expect(p.regeneratedSites.join()).toMatch(/EcoRI/); expect(p.warnings).toHaveLength(0);
  });
  it('single-enzyme cloning is flagged as non-directional with both orientations', () => {
    const v = left + 'GAATTC' + right, ins = 'GAATTC' + gene + 'GAATTC'; const r = cloneRestriction(v, true, ['EcoRI'], ins, false, ['EcoRI']);
    expect(r.products).toHaveLength(2); expect(r.products[0].warnings.join()).toMatch(/both orientations/); expect(r.products[1].sequence).not.toBe(r.products[0].sequence);
  });
  it('compatible cohesive ends (BamHI × BglII) ligate; incompatible ends are refused with an explanation', () => {
    const v = left + 'GGATCC' + mid + 'GGATCC' + right, ins = 'AAAA' + 'AGATCT' + gene + 'AGATCT' + 'AAAA'; expect(cloneRestriction(v, true, ['BamHI'], ins, false, ['BglII']).products.length).toBeGreaterThan(0);
    expect(() => cloneRestriction(vector, true, ['EcoRI', 'BamHI'], 'AAAA' + 'GTCGAC' + gene + 'GTCGAC' + 'AAAA', false, ['SalI'])).toThrow(/not compatible/);
    expect(() => cloneRestriction(left + right, true, ['EcoRI'], insert, false, ['EcoRI'])).toThrow(/not cut/);
  });
  it('warns about an internal site in the insert', () => { const bad = 'TTTT' + 'GAATTC' + gene.slice(0, 200) + 'GGATCC' + gene.slice(200) + 'GGATCC' + 'TTTT'; const r = cloneRestriction(vector, true, ['EcoRI', 'BamHI'], bad, false, ['EcoRI', 'BamHI']); expect(r.insertFragments.length).toBeGreaterThan(2); });
});
describe('Golden Gate', () => {
  const ov = ['AATG', 'GCTA', 'TTCG', 'CAGT'];
  const part = (name: string, i: number, core: string) => ({ name, circular: false, seq: 'AA' + 'GGTCTC' + 'A' + ov[i] + core + ov[(i + 1) % 4].replace(/^/, '') + 'T' + 'GAGACC' + 'AA' });
  it('assembles three parts + backbone in overhang order, in a scrambled input order', () => {
    const c = [rnd(21, 120, AV), rnd(22, 90, AV), rnd(23, 150, AV), rnd(24, 80, AV)];
    // parts: ov[i] + core + ov[i+1]; top-strand overhang of left end is ov[i], right end ov[i+1]
    const mk = (i: number) => ({ name: 'p' + i, circular: false, seq: 'CC' + 'GGTCTC' + 'A' + ov[i] + c[i] + ov[(i + 1) % 4] + 'T' + 'GAGACC' + 'CC' });
    const r = goldenGate([mk(2), mk(0), mk(3), mk(1)], 'BsaI');
    expect(r.order.map((o) => o.name)).toEqual(['p2', 'p3', 'p0', 'p1']); // starts from the first supplied part, follows overhangs
    expect(r.length).toBe(c.reduce((a, x) => a + x.length, 0) + 4 * 4); expect(r.warnings).toHaveLength(0);
    expect(r.sequence + r.sequence).toContain(ov[0] + c[0] + ov[1]);
    expect(part('x', 0, 'A')).toBeTruthy();
  });
  it('rejects duplicate overhangs and broken rings', () => {
    const mk = (l: string, r: string, core: string) => ({ name: l + r, circular: false, seq: 'CC' + 'GGTCTC' + 'A' + l + core + r + 'T' + 'GAGACC' + 'CC' });
    expect(() => goldenGate([mk('AATG', 'GCTA', rnd(1, 50, AV)), mk('AATG', 'TTCG', rnd(2, 50, AV))], 'BsaI')).toThrow(/ambiguous/);
    expect(() => goldenGate([mk('AATG', 'GCTA', rnd(1, 50, AV)), mk('GCTA', 'TTCG', rnd(2, 50, AV))], 'BsaI')).toThrow(/single circular/);
  });
});
describe('Gibson assembly', () => {
  const a = rnd(31, 300, AV), b = rnd(32, 250, AV), c = rnd(33, 200, AV), o1 = rnd(34, 25, AV), o2 = rnd(35, 25, AV), o3 = rnd(36, 25, AV);
  const fa = o3 + a + o1, fb = o1 + b + o2, fc = o2 + c + o3;
  it('finds the order and orientation automatically and rebuilds the circle', () => {
    const r = gibsonAssemble([{ name: 'A', seq: fa }, { name: 'C', seq: revComp(fc) }, { name: 'B', seq: fb }], true);
    expect(r.order.map((o) => o.name)).toEqual(['A', 'B', 'C']); expect(r.order[2].flipped).toBe(true); expect(r.junctions).toHaveLength(3);
    expect(r.sequence.length).toBe(a.length + b.length + c.length + 75); expect((r.sequence + r.sequence).includes(o1 + b + o2)).toBe(true);
  });
  it('linear assembly and clear failure', () => { const r = gibsonAssemble([{ name: 'A', seq: fa }, { name: 'B', seq: fb }], false); expect(r.sequence.length).toBe(fa.length + fb.length - 25); expect(() => gibsonAssemble([{ name: 'A', seq: fa }, { name: 'X', seq: rnd(99, 200, AV) }], true)).toThrow(/No assembly/); });
  it('designs primers whose product matches the plan', () => {
    const vec = rnd(41, 800, AV), ins = rnd(42, 300, AV), p = designGibsonPrimers(vec, 400, ins, 25);
    expect(p.fwd.seq.startsWith(vec.slice(375, 400))).toBe(true); expect(revComp(p.rev.seq).endsWith(vec.slice(400, 425))).toBe(true); expect(p.fwd.anneal).toBe(ins.slice(0, p.fwd.anneal.length)); expect(p.product).toBe(vec.slice(0, 400) + ins + vec.slice(400)); expect(Math.abs(p.fwd.tm - 60)).toBeLessThan(4);
    expect(() => designGibsonPrimers(vec, 10, ins)).toThrow(/≥ 25/);
  });
});

import { demoGoldenGate, demoGibson, demoRestriction } from './demoSets';
import { parseFasta } from './kernels';
describe('built-in demo sets actually work (guards against broken demos)', () => {
  it('restriction demo clones', () => { const [v, i] = parseFasta(demoRestriction()); expect(cloneRestriction(v.seq, true, ['EcoRI', 'BamHI'], i.seq, false, ['EcoRI', 'BamHI']).products).toHaveLength(1); });
  it('Golden Gate demo assembles all four pieces', () => { const r = goldenGate(parseFasta(demoGoldenGate()).map((x) => ({ name: x.id, seq: x.seq, circular: false })), 'BsaI'); expect(r.order).toHaveLength(4); expect(r.warnings).toHaveLength(0); });
  it('Gibson demo closes the circle with one fragment reversed', () => { const r = gibsonAssemble(parseFasta(demoGibson()).map((x) => ({ name: x.id, seq: x.seq })), true); expect(r.order.some((o) => o.flipped)).toBe(true); expect(r.junctions).toHaveLength(3); });
});
