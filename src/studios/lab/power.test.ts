import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pfNc, pnorm, pt, ptNc, qnorm, qt } from './dist';
import { cohenH, effectT, eventProbability, logrankEvents, logrankPower, logrankSampleSize, powerAnova, powerProp, powerT, rnaseqCv, rnaseqEffect, rnaseqPower, rnaseqSampleSize, sampleSizeAnova, sampleSizeProp, sampleSizeT } from './power';

// Known answers computed natively in R (pwr, RNASeqPower, gsDesign) by benchmarks/lab/make-reference.R.
const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/lab/reference.json', import.meta.url), 'utf8')).power;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

describe('distributions', () => {
  it('match textbook values', () => {
    expect(qnorm(0.975)).toBeCloseTo(1.959963984540054, 12); expect(pnorm(-8)).toBeCloseTo(6.220960574271786e-16, 25);
    expect(pt(2.228138851986274, 10)).toBeCloseTo(0.975, 10); expect(qt(0.975, 10)).toBeCloseTo(2.228138851986274, 9);
    expect(ptNc(1, 10, 0)).toBeCloseTo(pt(1, 10), 12); // R: pt(2, 20, ncp = 1.5), pt(-1, 7, ncp = 0.5), pt(30, 10, ncp = 25), pf(3, 2, 30, ncp = 4)
    expect(ptNc(2, 20, 1.5)).toBeCloseTo(0.674629914138008, 12); expect(ptNc(-1, 7, 0.5)).toBeCloseTo(0.0781022022010087, 12); expect(ptNc(30, 10, 25)).toBeCloseTo(0.72856123933683, 10);
    expect(pfNc(3, 2, 30, 4)).toBeCloseTo(0.572177576299009, 9); // R pnbeta stops at errmax 1e-9
  });
});

describe('pwr.t.test', () => {
  it('sample size and power match R for every grid row', () => {
    let worst = 0;
    for (const r of ref.t) {
      const n = sampleSizeT(r.d, 0.8, r.alpha, r.type, r.alt), pw = powerT(20, r.d, r.alpha, r.type, r.alt);
      worst = Math.max(worst, rel(n, r.n), Math.abs(pw - r.power20)); expect(rel(n, r.n)).toBeLessThan(1e-6); expect(Math.abs(pw - r.power20)).toBeLessThan(1e-8);
    }
    expect(worst).toBeLessThan(1e-6);
  });
  it('solves for effect size', () => { expect(rel(effectT(ref.tEffect.n, 0.9), ref.tEffect.d)).toBeLessThan(1e-6); });
});
describe('pwr.anova.test', () => {
  it('matches R', () => { for (const r of ref.anova) { expect(rel(sampleSizeAnova(r.k, r.f, 0.8, r.alpha), r.n)).toBeLessThan(1e-6); expect(Math.abs(powerAnova(r.k, 15, r.f, r.alpha) - r.power15)).toBeLessThan(1e-8); } });
});
describe('pwr.2p.test', () => {
  it('matches R (arcsine effect size)', () => {
    for (const r of ref.prop) { const h = cohenH(r.p1, r.p2); expect(Math.abs(h - r.h)).toBeLessThan(1e-12); expect(rel(sampleSizeProp(h, 0.8, r.alpha), r.n)).toBeLessThan(1e-6); expect(Math.abs(powerProp(50, h, r.alpha) - r.power50)).toBeLessThan(1e-9); expect(rel(sampleSizeProp(h, 0.8, r.alpha, 'greater'), r.nGreater)).toBeLessThan(1e-6); }
  });
});
describe('RNASeqPower', () => {
  it('matches rnapower for n, power, effect and cv', () => {
    for (const r of ref.rnaseq) {
      expect(rel(rnaseqSampleSize(r.depth, r.cv, r.effect), r.n)).toBeLessThan(1e-10); expect(Math.abs(rnaseqPower(r.depth, 6, r.cv, r.effect) - r.power6)).toBeLessThan(1e-10);
      expect(rel(rnaseqEffect(r.depth, 6, r.cv), r.effect6)).toBeLessThan(1e-10);
      if (typeof r.cv6 === 'number') expect(rel(rnaseqCv(r.depth, 6, r.effect), r.cv6)).toBeLessThan(1e-9);
    }
  });
});
describe('log-rank (Schoenfeld)', () => {
  it('events match gsDesign::nEvents and the closed form', () => {
    for (const r of ref.logrank) { expect(rel(logrankEvents(r.hr, r.power), r.events)).toBeLessThan(1e-9); expect(rel(logrankEvents(r.hr, r.power), r.closed)).toBeLessThan(1e-12); expect(rel(logrankEvents(r.hr, r.power, 0.05, 1 / 3), r.eventsRatio2)).toBeLessThan(1e-9); }
  });
  it('power round-trips and total N follows the event probability', () => {
    const d = logrankEvents(0.6, 0.85); expect(logrankPower(d, 0.6)).toBeCloseTo(0.85, 10);
    const plan = logrankSampleSize(0.6, 12, 12, 12); expect(plan.n * (0.5 * plan.pEventControl + 0.5 * plan.pEventTreat)).toBeCloseTo(plan.events, 8);
    expect(eventProbability(0.1, 0, 10)).toBeCloseTo(1 - Math.exp(-1), 12);
  });
});
