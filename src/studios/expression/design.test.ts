import { describe, expect, it } from 'vitest';
import { parseMatrix, syntheticBatchExperiment, syntheticExperiment } from './kernels';
import { checkDesign, defaultTest, designDe, formula, guessSpecs, parseSheet, syntheticPairedExperiment, type DesignRun } from './design';

const base = { minCpm: 1, minSamples: 2, useVoom: true, fdr: 0.05, lfc: 0 };

describe('sample sheet', () => {
  it('reads a header and every variable column', () => {
    const s = parseSheet('sample\tgroup\tdonor\tage\na\tctl\td1\t30\nb\ttrt\td1\t31');
    expect(s.columns).toEqual(['group', 'donor', 'age']); expect(s.samples).toEqual(['a', 'b']); expect(s.values[2]).toEqual(['30', '31']);
  });
  it('treats the first row as data when it names a sample', () => {
    const s = parseSheet('a,ctl,x\nb,trt,y', ['a', 'b']);
    expect(s.columns).toEqual(['group', 'batch']); expect(s.samples).toEqual(['a', 'b']);
  });
  it('guesses factors, numeric covariates and leaves ID-like columns out', () => {
    const s = parseSheet('sample,group,age,id\na,c,30,1x\nb,c,41,2x\nc,t,52,3x\nd,t,38,4x');
    const g = guessSpecs(s);
    expect(g.map((x) => [x.name, x.kind, x.use])).toEqual([['group', 'factor', true], ['age', 'numeric', true], ['id', 'factor', false]]);
    expect(formula(g)).toBe('~ group + age');
    expect(defaultTest(s, g)).toEqual({ kind: 'pair', factor: 'group', a: 'c', b: 't' });
  });
  it('explains an impossible design', () => {
    const s = parseSheet('sample,group,batch\na,c,x\nb,c,x\nc,t,y\nd,t,y');
    const g = guessSpecs(s);
    expect(checkDesign(s, g, defaultTest(s, g)).error).toMatch(/not of full rank/);
    expect(checkDesign(s, g.map((x) => ({ ...x, use: x.name === 'group' })), { kind: 'anova', factor: 'group' }).error).toMatch(/only two levels/);
  });
});

describe('design-based differential expression', () => {
  it('two-group test recovers planted genes with controlled FDR', () => {
    const e = syntheticExperiment(7, 4000, 4), m = parseMatrix(e.csv), s = parseSheet(e.sheet, m.samples), specs = guessSpecs(s);
    const de = designDe(m, s, { ...base, specs, test: defaultTest(s, specs)! });
    const called = de.rows.filter((r) => r.sig !== 'ns'), tp = called.filter((r) => e.truth.has(r.gene)).length;
    expect(de.label).toBe('treated vs control');
    expect(tp / e.truth.size).toBeGreaterThan(0.7); // the earlier two-group kernel found 222/300 here; voom finds 226
    expect((called.length - tp) / called.length).toBeLessThan(0.1);
    expect(de.rows[0].p).toBeLessThanOrEqual(de.rows[1].p);
  });
  it('adding the batch term to the model raises power on the batch demo', () => {
    const e = syntheticBatchExperiment(9, 3000, 6), m = parseMatrix(e.csv), s = parseSheet(e.sheet, m.samples), specs = guessSpecs(s);
    const test = defaultTest(s, specs)!;
    const hit = (d: ReturnType<typeof designDe>) => d.rows.filter((r) => r.sig !== 'ns' && e.truth.has(r.gene)).length;
    const withBatch = designDe(m, s, { ...base, specs, test }), without = designDe(m, s, { ...base, specs: specs.map((x) => ({ ...x, use: x.name === 'group' })), test });
    expect(withBatch.formula).toBe('~ group + batch');
    expect(hit(withBatch)).toBeGreaterThan(hit(without));
  });
  it('pairing by donor recovers far more of the drug effect than ignoring it', () => {
    const e = syntheticPairedExperiment(), m = parseMatrix(e.csv), s = parseSheet(e.sheet, m.samples), specs = guessSpecs(s);
    const test = { kind: 'pair' as const, factor: 'treatment', a: 'control', b: 'drugA' };
    const run = (sp: DesignRun['specs']) => designDe(m, s, { ...base, specs: sp, test });
    const sens = (d: ReturnType<typeof run>) => d.rows.filter((r) => r.sig !== 'ns' && e.truth.has(r.gene)).length / e.truth.size;
    const paired = run(specs), unpaired = run(specs.map((x) => ({ ...x, use: x.name === 'treatment' })));
    expect(paired.formula).toBe('~ treatment + donor');
    expect(sens(paired)).toBeGreaterThan(0.7);
    expect(sens(paired)).toBeGreaterThan(sens(unpaired) + 0.2);
  });
  it('F-test finds genes responding to either drug', () => {
    const e = syntheticPairedExperiment(), m = parseMatrix(e.csv), s = parseSheet(e.sheet, m.samples), specs = guessSpecs(s);
    const de = designDe(m, s, { ...base, specs, test: { kind: 'anova', factor: 'treatment' } });
    expect(de.mode).toBe('anova'); expect(de.levelNames).toEqual(['drugA vs control', 'drugB vs control']);
    const sig = new Set(de.rows.filter((r) => r.sig !== 'ns').map((r) => r.gene));
    const responders = Array.from({ length: 350 }, (_, i) => `GENE${String(i + 1).padStart(4, '0')}`);
    expect(responders.filter((g) => sig.has(g)).length / 350).toBeGreaterThan(0.7);
    expect([...sig].filter((g) => !responders.includes(g)).length / sig.size).toBeLessThan(0.1);
  });
  it('numeric covariate slope is estimated per unit', () => {
    const e = syntheticExperiment(3, 2000, 4), m = parseMatrix(e.csv), S = m.samples.length;
    // Code the group as a dose (0 or 2): the slope must be half the two-group log fold change.
    const sheet = 'sample,dose\n' + m.samples.map((x) => `${x},${x.startsWith('ctrl') ? 0 : 2}`).join('\n');
    const s = parseSheet(sheet, m.samples), specs = guessSpecs(s).map((x) => ({ ...x, kind: 'numeric' as const, use: true }));
    const slope = designDe(m, s, { ...base, specs, test: { kind: 'slope', variable: 'dose' } });
    const two = designDe(m, parseSheet('sample,group\n' + m.samples.map((x) => `${x},${x.startsWith('ctrl') ? 'c' : 't'}`).join('\n'), m.samples), { ...base, specs: [{ name: 'group', use: true, kind: 'factor', reference: 'c' }], test: { kind: 'pair', factor: 'group', a: 'c', b: 't' } });
    const byGene = new Map(two.rows.map((r) => [r.gene, r]));
    for (const r of slope.rows.slice(0, 50)) { expect(r.log2FC * 2).toBeCloseTo(byGene.get(r.gene)!.log2FC, 8); expect(r.p).toBeCloseTo(byGene.get(r.gene)!.p, 8); }
    expect(S).toBe(8);
  });
});
