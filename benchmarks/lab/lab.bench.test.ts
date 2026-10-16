// Lab Studio against R: writes benchmarks/results/lab.json (maximum deviations per method). Run: npm run bench -- benchmarks/lab
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fitDoseResponse } from '@/studios/lab/doseResponse';
import { cohenH, powerAnova, powerProp, powerT, rnaseqCv, rnaseqEffect, rnaseqPower, rnaseqSampleSize, sampleSizeAnova, sampleSizeProp, sampleSizeT, logrankEvents } from '@/studios/lab/power';
import { anova1, geNorm, standardCurve, tTest } from '@/studios/lab/qpcr';

const ref = JSON.parse(readFileSync(new URL('./reference.json', import.meta.url), 'utf8'));
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const max = (xs: number[]) => xs.reduce((m, v) => Math.max(m, v), 0);

it('collects maximum deviations from R', () => {
  const P = ref.power, out: Record<string, unknown> = { versions: ref.versions };
  out.pwr_t = { cases: P.t.length, maxRelErrN: max(P.t.map((r: any) => rel(sampleSizeT(r.d, 0.8, r.alpha, r.type, r.alt), r.n))), maxAbsErrPower: max(P.t.map((r: any) => Math.abs(powerT(20, r.d, r.alpha, r.type, r.alt) - r.power20))) };
  out.pwr_anova = { cases: P.anova.length, maxRelErrN: max(P.anova.map((r: any) => rel(sampleSizeAnova(r.k, r.f, 0.8, r.alpha), r.n))), maxAbsErrPower: max(P.anova.map((r: any) => Math.abs(powerAnova(r.k, 15, r.f, r.alpha) - r.power15))) };
  out.pwr_2p = { cases: P.prop.length, maxRelErrN: max(P.prop.map((r: any) => rel(sampleSizeProp(cohenH(r.p1, r.p2), 0.8, r.alpha), r.n))), maxAbsErrPower: max(P.prop.map((r: any) => Math.abs(powerProp(50, cohenH(r.p1, r.p2), r.alpha) - r.power50))) };
  out.rnaseqpower = { cases: P.rnaseq.length, maxRelErrN: max(P.rnaseq.map((r: any) => rel(rnaseqSampleSize(r.depth, r.cv, r.effect), r.n))), maxAbsErrPower: max(P.rnaseq.map((r: any) => Math.abs(rnaseqPower(r.depth, 6, r.cv, r.effect) - r.power6))), maxRelErrEffect: max(P.rnaseq.map((r: any) => rel(rnaseqEffect(r.depth, 6, r.cv), r.effect6))), maxRelErrCv: max(P.rnaseq.filter((r: any) => typeof r.cv6 === 'number').map((r: any) => rel(rnaseqCv(r.depth, 6, r.effect), r.cv6))) };
  out.logrank = { cases: P.logrank.length, maxRelErrEvents: max(P.logrank.map((r: any) => rel(logrankEvents(r.hr, r.power), r.events))) };
  const dr: Record<string, unknown> = {};
  for (const [id, r] of Object.entries<any>(ref.doseResponse)) {
    const f = fitDoseResponse(r.x.map((x: number, i: number) => ({ x, y: r.y[i] })), r.model, r.fixed ?? {}), names: string[] = r.names, mine: Record<string, number> = { b: -f.hill, c: f.bottom, d: f.top, e: f.ec50, f: f.asym };
    dr[id] = { model: r.model, rssRatioToDrc: f.rss / r.rss, maxRelErrParams: max(names.map((n, i) => rel(mine[n], r.coef[i]))), ec50: f.ec50, ec50Drc: r.coef[names.indexOf('e')], r2: f.r2, r2Drc: r.r2, seEc50RelToGaussNewtonR: rel(f.params.find((p) => p.name === 'EC50')!.se, r.se_jtj[names.indexOf('e')]), seEc50RelToDrcHessian: rel(f.params.find((p) => p.name === 'EC50')!.se, r.se[names.indexOf('e')]) };
  }
  out.doseResponse = dr;
  const g = ref.qpcr.geNorm, res = geNorm(g.quantities, g.genes);
  out.geNorm = { genes: g.genes.length, maxRelErrMeanM: max(res.steps.map((s, i) => rel(s.meanM, g.meanM[i]))), sameRankingExceptTopPair: JSON.stringify(res.ranking.slice(2)) === JSON.stringify(g.ranking.slice(2)) };
  const s = ref.qpcr.stats; const w = tTest(s.x.A, s.x.ctrl, false), a = anova1([s.x.ctrl, s.x.A, s.x.B]);
  out.qpcrStats = { welchP: [w.p, s.welch_A.p], anovaP: [a.p, s.anova.p], maxRelErr: max([rel(w.p, s.welch_A.p), rel(a.p, s.anova.p), rel(w.t, s.welch_A.t), rel(a.F, s.anova.F)]) };
  const sc = ref.qpcr.standardCurve, fit = standardCurve(sc.quantity.map((q: number, i: number) => ({ quantity: q, ct: sc.ct[i] })));
  out.standardCurve = { maxRelErr: max([rel(fit.slope, sc.slope), rel(fit.intercept, sc.intercept), rel(fit.efficiency, sc.efficiency), rel(fit.r2, sc.r2)]) };
  writeFileSync(new URL('../results/lab.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  expect(max(P.t.map((r: any) => rel(sampleSizeT(r.d, 0.8, r.alpha, r.type, r.alt), r.n)))).toBeLessThan(1e-6);
});
