import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anova1, averageReplicates, geNorm, holm, parsePlate, pfaffl, relativeQuantification, sd, standardCurve, tTest, type PlateRow } from './qpcr';

const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/lab/reference.json', import.meta.url), 'utf8')).qpcr;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const rows = (sample: string, group: string, gene: string, cts: number[], wells = false): PlateRow[] => cts.map((ct, i) => ({ sample, group, gene, ct, well: wells ? `w${i}` : undefined }));

// Livak KJ, Schmittgen TD (2001) Methods 25:402–408, Table 1 (target and reference in separate wells) and Table 2 (same well).
const T1 = {
  brain: { myc: [30.72, 30.34, 30.58, 30.34, 30.50, 30.43], gapdh: [23.70, 23.56, 23.47, 23.65, 23.69, 23.68] },
  kidney: { myc: [27.06, 27.03, 27.03, 27.10, 26.99, 26.94], gapdh: [22.76, 22.61, 22.62, 22.60, 22.61, 22.76] },
};
const T2 = {
  brain: { myc: [32.38, 32.08, 32.35, 32.08, 32.34, 32.13], gapdh: [25.07, 25.29, 25.32, 25.24, 25.17, 25.29] },
  kidney: { myc: [28.73, 28.84, 28.51, 28.86, 28.86, 28.70], gapdh: [24.30, 24.32, 24.31, 24.25, 24.34, 24.18] },
};
const livakRows = (t: typeof T1, wells: boolean) => (['brain', 'kidney'] as const).flatMap((s) => [...rows(s, s, 'c-myc', t[s].myc, wells), ...rows(s, s, 'GAPDH', t[s].gapdh, wells)]);

describe('Livak & Schmittgen 2001 worked examples', () => {
  it('Table 1: separate wells (replicate Ct averaged per gene)', () => {
    const r = relativeQuantification(livakRows(T1, false), { refGenes: ['GAPDH'], controlGroup: 'brain' }).genes[0];
    const brain = r.groups.find((g) => g.group === 'brain')!, kid = r.groups.find((g) => g.group === 'kidney')!;
    expect(brain.meanX).toBeCloseTo(6.86, 2); expect(kid.meanX).toBeCloseTo(4.37, 2);       // ΔCt 6.86 and 4.37 (4.365 unrounded)
    expect(kid.ddct).toBeCloseTo(-2.50, 2); expect(kid.fold).toBeCloseTo(5.6, 1);            // ΔΔCt −2.50, 5.6-fold
    expect(brain.fold).toBe(1);
    // replicate SDs of the paper: c-myc 0.15 / 0.06, GAPDH 0.09 / 0.08
    const cells = averageReplicates(livakRows(T1, false));
    expect(sd(cells.find((c) => c.sample === 'brain' && c.gene === 'c-myc')!.values)).toBeCloseTo(0.15, 2); expect(sd(cells.find((c) => c.sample === 'kidney' && c.gene === 'GAPDH')!.values)).toBeCloseTo(0.08, 2);
    // propagated SD of ΔCt (0.17 brain, 0.10 kidney) and the asymmetric 2^-(ΔΔCt±SD) range, 5.6 (5.3–6.0)
    const s = (g: string, gene: string) => sd(cells.find((c) => c.sample === g && c.gene === gene)!.values);
    expect(Math.hypot(s('brain', 'c-myc'), s('brain', 'GAPDH'))).toBeCloseTo(0.17, 2); const sdK = Math.hypot(s('kidney', 'c-myc'), s('kidney', 'GAPDH')); expect(sdK).toBeCloseTo(0.10, 2);
    expect(2 ** (2.495 - sdK)).toBeCloseTo(5.3, 1); expect(2 ** (2.495 + sdK)).toBeCloseTo(6.0, 1);
  });
  it('Table 2: same well (ΔCt per well, then averaged)', () => {
    const r = relativeQuantification(livakRows(T2, true), { refGenes: ['GAPDH'], controlGroup: 'brain', pairedWells: true }).genes[0];
    const brain = r.groups.find((g) => g.group === 'brain')!, kid = r.groups.find((g) => g.group === 'kidney')!;
    // Kidney reproduces the paper: ΔCt 4.47 ± 0.14. The paper's brain line (6.93 ± 0.16, hence ΔΔCt −2.47 and 5.5-fold) is not consistent with its own
    // listed wells, whose ΔCt values (7.31 6.79 7.03 6.84 7.17 6.84) average 7.00 ± 0.21, so brain is checked against the arithmetic of the printed rows instead.
    const sdW = (g: string) => r.samples.find((x) => x.sample === g)!.sdWells!;
    expect(kid.meanX).toBeCloseTo(4.47, 2); expect(sdW('kidney')).toBeCloseTo(0.14, 2);
    expect(brain.meanX).toBeCloseTo(6.9967, 3); expect(sdW('brain')).toBeCloseTo(0.2103, 3);
    expect(kid.ddct).toBeCloseTo(4.4667 - 6.9967, 3); expect(kid.fold).toBeCloseTo(5.77, 2);        // paper prints 5.5 (−2.47) from its brain average 6.93; 5.5–5.8 depending on that line
    
  });
});

describe('Pfaffl 2001 efficiency-corrected ratio', () => {
  // Table 2 mean CP (sample, control) and Table 3 efficiencies Gst 1.99, TyrA 2.09, PyrB 2.16; published R values in Table 3.
  const cases = [
    { name: 'TyrA high 16 ng Gst', eT: 2.09, tC: 20.303, tS: 15.020, rC: 14.013, rS: 14.290, R: 59.476 },
    { name: 'TyrA high 20 ng Gst', eT: 2.09, tC: 20.303, tS: 15.020, rC: 14.277, rS: 14.533, R: 58.625 },
    { name: 'TyrA high 24 ng Gst', eT: 2.09, tC: 20.303, tS: 15.020, rC: 14.730, rS: 14.957, R: 57.459 },
    { name: 'PyrB high 16 ng Gst', eT: 2.16, tC: 11.720, tS: 16.031, rC: 14.013, rS: 14.290, R: 0.04375 },
    { name: 'PyrB high 20 ng Gst', eT: 2.16, tC: 11.720, tS: 16.031, rC: 14.277, rS: 14.533, R: 0.04312 },
    { name: 'PyrB high 24 ng Gst', eT: 2.16, tC: 11.720, tS: 16.031, rC: 14.730, rS: 14.957, R: 0.04226 },
    { name: 'TyrA low 3.2 ng Gst', eT: 2.09, tC: 22.840, tS: 17.353, rC: 16.877, rS: 16.927, R: 59.104 },
    { name: 'TyrA low 4.0 ng Gst', eT: 2.09, tC: 22.840, tS: 17.353, rC: 16.623, rS: 16.750, R: 62.102 },
    { name: 'TyrA low 4.8 ng Gst', eT: 2.09, tC: 22.840, tS: 17.353, rC: 16.220, rS: 16.297, R: 60.208 },
    { name: 'PyrB low 3.2 ng Gst', eT: 2.16, tC: 13.390, tS: 17.667, rC: 16.877, rS: 16.927, R: 0.03844 },
    { name: 'PyrB low 4.0 ng Gst', eT: 2.16, tC: 13.390, tS: 17.667, rC: 16.623, rS: 16.750, R: 0.04031 },
    { name: 'PyrB low 4.8 ng Gst', eT: 2.16, tC: 13.390, tS: 17.667, rC: 16.220, rS: 16.297, R: 0.03914 },
  ];
  for (const c of cases) it(c.name, () => { const r = pfaffl(c.eT, c.tC, c.tS, 1.99, c.rC, c.rS); expect(rel(r, c.R), `${r} vs ${c.R}`).toBeLessThan(5e-3); /* E printed to 2 decimals; worst row deviates 0.48 % */ });
  it('the pipeline reproduces Pfaffl ratio when efficiencies are supplied', () => {
    const data = [...rows('ctl', 'ctl', 'TyrA', [20.303]), ...rows('ctl', 'ctl', 'Gst', [14.277]), ...rows('smp', 'smp', 'TyrA', [15.020]), ...rows('smp', 'smp', 'Gst', [14.533])];
    const r = relativeQuantification(data, { refGenes: ['Gst'], controlGroup: 'ctl', efficiency: { TyrA: 2.09, Gst: 1.99 } }).genes[0];
    expect(r.groups.find((g) => g.group === 'smp')!.fold).toBeCloseTo(pfaffl(2.09, 20.303, 15.020, 1.99, 14.277, 14.533), 10);
    expect(rel(r.groups.find((g) => g.group === 'smp')!.fold, 58.625)).toBeLessThan(5e-3);
  });
  it('Table 3 mean and CV of R (TyrA high level: 58.459, 1.73 %), from the printed R values', () => {
    const R = [59.476, 58.625, 57.459], m = R.reduce((a, b) => a + b) / 3; expect(Math.abs(m - 58.459)).toBeLessThan(0.1); expect((sd(R) / m) * 100).toBeCloseTo(1.73, 0);
  });
});

describe('multiple reference genes and geNorm', () => {
  it('geometric-mean normalisation equals the mean Ct of the reference genes at E = 2', () => {
    const data = [...rows('s1', 'a', 'T', [25]), ...rows('s1', 'a', 'R1', [20]), ...rows('s1', 'a', 'R2', [22]), ...rows('s2', 'b', 'T', [24]), ...rows('s2', 'b', 'R1', [20]), ...rows('s2', 'b', 'R2', [22])];
    const g = relativeQuantification(data, { refGenes: ['R1', 'R2'], controlGroup: 'a' }).genes[0];
    expect(g.samples.find((s) => s.sample === 's1')!.x).toBeCloseTo(25 - 21, 12); expect(g.groups.find((q) => q.group === 'b')!.fold).toBeCloseTo(2, 12);
  });
  it('matches NormqPCR::selectHKs (M, ranking, pairwise variation) on its geNorm example', () => {
    const g = ref.geNorm, res = geNorm(g.quantities, g.genes);
    expect(res.steps.length).toBe(g.meanM.length - 0);                               // 9 steps: 10 → 2 genes
    const mine = res.steps.map((s) => s.meanM), R = [...g.meanM]; // R lists 10 → 2 genes
    mine.forEach((v, i) => expect(rel(v, R[i]), `mean M step ${i}`).toBeLessThan(1e-9));
    expect(res.ranking.slice(2)).toEqual(g.ranking.slice(2)); expect(new Set(res.ranking.slice(0, 2))).toEqual(new Set(g.ranking.slice(0, 2)));
    // R's `variation` is ordered 9/10, 8/9, …, 2/3 whereas steps run 10 → 2 genes
    const v = res.steps.filter((s) => s.variation !== undefined).map((s) => s.variation!).reverse();
    v.forEach((x, i) => expect(rel(x, g.variation[g.variation.length - 1 - i]), `V step ${i}`).toBeLessThan(1e-9));
    const M1 = res.steps[0].M; g.genes.forEach((_: string, i: number) => expect(rel(M1[i], g.M_all[i])).toBeLessThan(1e-12));
  });
});

describe('biological replicates and statistics (vs R t.test / aov / p.adjust)', () => {
  const s = ref.stats;
  it('Welch and Student t on ΔCt', () => {
    for (const [tt, fn] of [[s.welch_A, () => tTest(s.x.A, s.x.ctrl, false)], [s.welch_B, () => tTest(s.x.B, s.x.ctrl, false)], [s.student_A, () => tTest(s.x.A, s.x.ctrl, true)]] as const) {
      const r = fn(); expect(rel(r.t, tt.t)).toBeLessThan(1e-9); expect(rel(r.df, tt.df)).toBeLessThan(1e-9); expect(rel(r.p, tt.p)).toBeLessThan(1e-8); expect(r.lo).toBeCloseTo(tt.lo, 8); expect(r.hi).toBeCloseTo(tt.hi, 8);
    }
  });
  it('one-way ANOVA and Holm adjustment', () => {
    const a = anova1([s.x.ctrl, s.x.A, s.x.B]); expect(rel(a.F, s.anova.F)).toBeLessThan(1e-9); expect(rel(a.p, s.anova.p)).toBeLessThan(1e-8); expect(a.df1).toBe(s.anova.df1); expect(a.df2).toBe(s.anova.df2);
    holm(s.p).forEach((v, i) => expect(v).toBeCloseTo(s.holm[i], 12));
  });
  it('end to end: samples → ΔCt → group tests', () => {
    const data: PlateRow[] = [];
    for (const [g, v] of Object.entries(s.x as Record<string, number[]>)) v.forEach((x, i) => { data.push(...rows(`${g}${i}`, g, 'T', [20 + x, 20 + x + 0.1, 20 + x - 0.1]), ...rows(`${g}${i}`, g, 'REF', [20, 20.05, 19.95])); });
    const r = relativeQuantification(data, { refGenes: ['REF'], controlGroup: 'ctrl' }).genes[0], A = r.groups.find((q) => q.group === 'A')!;
    expect(rel(A.p!, s.welch_A.p)).toBeLessThan(1e-6); expect(rel(r.anova!.p, s.anova.p)).toBeLessThan(1e-6); expect(A.pAdj).toBeCloseTo(s.holm[0], 8);
  });
});

describe('technical replicates', () => {
  it('flags an outlier among triplicates and can exclude it', () => {
    const c = averageReplicates(rows('s', 'g', 'T', [24.0, 24.1, 25.2]))[0]; expect(c.flagged).toEqual([false, false, true]); expect(c.note).toMatch(/outlier 25.20/);
    const e = averageReplicates(rows('s', 'g', 'T', [24.0, 24.1, 25.2]), { exclude: true })[0]; expect(e.mean).toBeCloseTo(24.05, 10); expect(e.used.length).toBe(2);
    expect(averageReplicates(rows('s', 'g', 'T', [24, 25]))[0].flagged).toEqual([true, true]);
  });
});

describe('standard curve (vs R lm)', () => {
  it('slope, intercept, R², efficiency and CI', () => {
    const r = ref.standardCurve, f = standardCurve(r.quantity.map((q: number, i: number) => ({ quantity: q, ct: r.ct[i] })));
    expect(rel(f.slope, r.slope)).toBeLessThan(1e-10); expect(rel(f.intercept, r.intercept)).toBeLessThan(1e-10); expect(Math.abs(f.r2 - r.r2)).toBeLessThan(1e-12);
    expect(rel(f.efficiency, r.efficiency)).toBeLessThan(1e-10); expect(f.slopeLo).toBeCloseTo(r.slopeLo, 9); expect(f.slopeHi).toBeCloseTo(r.slopeHi, 9);
    expect(f.effLoPct / 100).toBeCloseTo(Math.min(r.effLo, r.effHi), 9);
  });
  it('E = 10^(−1/slope) − 1: slope −3.322 is 100 %', () => { expect(standardCurve([0, 1, 2, 3].map((l) => ({ quantity: 10 ** l, ct: 30 - 3.321928 * l }))).effPct).toBeCloseTo(100, 2); });
});

describe('plate import', () => {
  it('parses long and wide layouts and counts undetermined wells', () => {
    const long = parsePlate('sample,group,gene,ct\ns1,ctrl,GAPDH,18.1\ns1,ctrl,GAPDH,Undetermined\ns1,ctrl,TP53,25.2\n');
    expect(long.rows.length).toBe(2); expect(long.undetermined).toBe(1);
    const wide = parsePlate('sample\tgroup\tGAPDH\tTP53\ns1\tctrl\t18.1\t25.2\ns1\tctrl\t18.3\t\n'); expect(wide.rows.length).toBe(3); expect(wide.rows[0].gene).toBe('GAPDH');
    expect(() => parsePlate('foo,bar\n1,2\n')).toThrow(/sample column/);
  });
});
