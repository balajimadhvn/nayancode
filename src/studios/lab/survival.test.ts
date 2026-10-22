import { describe, expect, it } from 'vitest';
import { coxPh, kaplanMeier, kmByGroup, logRank, parseSurvival, survAt, withGroupCovariate, type Subject } from './survival';

// R survival::aml (acute myelogenous leukaemia): maintained (x = 0) vs non-maintained (x = 1) chemotherapy.
const mt = [9, 13, 13, 18, 23, 28, 31, 34, 45, 48, 161], me = [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0];
const nt = [5, 5, 8, 8, 12, 16, 23, 27, 30, 33, 43, 45], ne = [1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1];
const aml: Subject[] = [...mt.map((time, i) => ({ time, event: me[i] as 0 | 1, group: 'Maintained' })), ...nt.map((time, i) => ({ time, event: ne[i] as 0 | 1, group: 'Nonmaintained' }))];

describe('Kaplan–Meier', () => {
  it('reproduces survfit(aml) medians and survival', () => {
    const [m, n] = kmByGroup(aml);
    expect(m.group).toBe('Maintained'); expect(m.median).toBe(31); expect(n.median).toBe(23);
    expect(survAt(m, 9)).toBeCloseTo(0.9091, 4); expect(survAt(m, 18)).toBeCloseTo(0.7159, 4); expect(survAt(n, 8)).toBeCloseTo(0.6667, 4);
    expect(m.events).toBe(7); expect(n.n).toBe(12);
  });
  it('gives log-log intervals that stay inside [0, 1] and bracket the estimate', () => {
    for (const p of kaplanMeier(aml.filter((s) => s.group === 'Maintained')).points.slice(1, -1)) { expect(p.lo).toBeLessThanOrEqual(p.surv); expect(p.hi).toBeGreaterThanOrEqual(p.surv); expect(p.lo).toBeGreaterThanOrEqual(0); expect(p.hi).toBeLessThanOrEqual(1); }
  });
});

describe('log-rank', () => {
  it('matches survdiff(aml): chi-square 3.4 on 1 df', () => {
    const r = logRank(aml);
    expect(r.chisq).toBeCloseTo(3.3964, 3); expect(r.p).toBeCloseTo(0.06534, 4); expect(r.observed).toEqual([7, 11]); expect(r.expected[0]).toBeCloseTo(10.689, 3);
  });
  it('is zero for identical groups and needs two groups', () => {
    const same = [1, 2, 3, 4, 5, 6].flatMap((t) => [{ time: t, event: 1 as const, group: 'a' }, { time: t, event: 1 as const, group: 'b' }]);
    expect(logRank(same).chisq).toBeCloseTo(0, 10);
    expect(() => logRank(aml.filter((s) => s.group === 'Maintained'))).toThrow();
  });
  it('supports three groups', () => { const r = logRank(aml.map((s, i) => ({ ...s, group: ['a', 'b', 'c'][i % 3] }))); expect(r.df).toBe(2); expect(r.p).toBeGreaterThan(0); expect(r.p).toBeLessThanOrEqual(1); });
});

describe('Cox proportional hazards (Efron)', () => {
  it('matches coxph(Surv(time, status) ~ x, aml)', () => {
    const { subjects, name } = withGroupCovariate(aml);
    const f = coxPh(subjects, [name]);
    expect(f.converged).toBe(true);
    expect(f.coefs[0].coef).toBeCloseTo(0.91553, 4); expect(f.coefs[0].se).toBeCloseTo(0.51195, 4); expect(f.coefs[0].hr).toBeCloseTo(2.498, 3);
    expect(f.loglik0).toBeCloseTo(-42.7248, 3); expect(f.loglik).toBeCloseTo(-41.0326, 3); expect(f.lrt).toBeCloseTo(3.3845, 3);
    expect(f.coefs[0].p).toBeCloseTo(0.0737, 3);
  });
  it('recovers a known hazard ratio from simulated exponential data', () => {
    let s = 7; const u = () => { s = (s * 1664525 + 1013904223) % 4294967296; return (s + 1) / 4294967297; };
    const subj: Subject[] = Array.from({ length: 1500 }, () => { const x = u() < 0.5 ? 0 : 1; const t = -Math.log(u()) / (0.1 * Math.exp(Math.log(2) * x)); const c = -Math.log(u()) / 0.05; return { time: Math.min(t, c), event: (t <= c ? 1 : 0) as 0 | 1, x: [x] }; });
    const f = coxPh(subj, ['x']);
    expect(f.coefs[0].hr).toBeGreaterThan(1.8); expect(f.coefs[0].hr).toBeLessThan(2.25); expect(f.concordance).toBeGreaterThan(0.55);
  });
  it('rejects empty models', () => { expect(() => coxPh(aml, [])).toThrow(); });
});

describe('parseSurvival', () => {
  it('reads time, event, group and numeric covariates; skips bad rows', () => {
    const r = parseSurvival('time,event,group,age\n5,1,A,60\n8,0,B,55\nx,1,A,50\n9,2,B,40');
    expect(r.subjects).toHaveLength(2); expect(r.skipped).toBe(2); expect(r.covariates).toEqual(['age']); expect(r.subjects[0].x).toEqual([60]);
  });
  it('explains a missing column', () => { expect(() => parseSurvival('a,b\n1,2')).toThrow(/time/); });
});
