import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fitDoseResponse, parseDoseResponse, type Fixed } from './doseResponse';

// Reference fits: R 'drc' on its bundled datasets (benchmarks/lab/make-reference.R).
const ref = JSON.parse(readFileSync(new URL('../../../benchmarks/lab/reference.json', import.meta.url), 'utf8')).doseResponse as Record<string, any>;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

describe('4PL / 5PL Levenberg–Marquardt vs drc', () => {
  for (const [id, r] of Object.entries(ref)) {
    it(`${r.label}`, () => {
      const data = (r.x as number[]).map((x, i) => ({ x, y: r.y[i] as number }));
      const fixed: Fixed = r.fixed ?? {};
      const f = fitDoseResponse(data, r.model, fixed);
      expect(f.converged).toBe(true);
      // drc stops at its optimiser tolerance (reltol 1e-7), so the fit must be at least as good, and parameters agree to that tolerance.
      expect(f.rss).toBeLessThanOrEqual(r.rss * (1 + 1e-9)); expect(rel(f.rss, r.rss)).toBeLessThan(r.model === '5PL' ? 1e-3 : 1e-6);
      expect(Math.abs(f.r2 - r.r2)).toBeLessThan(r.model === '5PL' ? 1e-4 : 1e-7); expect(f.df).toBe(r.df); expect(rel(f.sigma, r.sigma)).toBeLessThan(1e-3);
      // drc names: b = −hill, c = bottom, d = top, e = EC50, f = asymmetry; fixed parameters are absent from drc's coef
      const mine: Record<string, number> = { b: -f.hill, c: f.bottom, d: f.top, e: f.ec50, f: f.asym }, names = r.names as string[];
      if (r.model === '4PL') names.forEach((nm, i) => expect(rel(mine[nm], r.coef[i]), `${id} ${nm}`).toBeLessThan(1e-3));
      else { // 5PL is nearly unidentifiable on real data: compare the fitted curves rather than the flat parameters
        const p = (q: Record<string, number>, x: number) => (x > 0 ? q.c + (q.d - q.c) / (1 + Math.exp(q.b * (Math.log(x) - Math.log(q.e)))) ** q.f : q.b > 0 ? q.d : q.c);
        const drc = Object.fromEntries(names.map((nm, i) => [nm, r.coef[i]])), span = Math.max(...r.y) - Math.min(...r.y);
        expect(Math.max(...(r.x as number[]).map((x) => Math.abs(p(mine, x) - p(drc, x))))).toBeLessThan(1e-2 * span);
      }
      // Gauss–Newton standard errors (what nls and this app compute) agree with the R computation; drc's Hessian SEs differ by up to ~15 %
      const tol = r.model === '5PL' ? 0.08 : 0.02;
      // (on real-data 5PL the shape parameters b, e, f are nearly unidentifiable, so only bottom and top are compared there)
      for (const nm of names.filter((n) => r.model === '4PL' || id === 'sim_LL5' || n === 'c' || n === 'd')) { const pe = f.params.find((q) => q.name === (nm === 'b' ? 'hill' : { c: 'bottom', d: 'top', e: 'EC50', f: 'asym' }[nm]))!; expect(rel(pe.se, r.se_jtj[names.indexOf(nm)]), `${id} se ${nm}`).toBeLessThan(tol); expect(rel(pe.se, r.se[names.indexOf(nm)]), `${id} se vs drc ${nm}`).toBeLessThan(0.2); }
      const ie = names.indexOf('e');
      if (r.model === '4PL' && !r.fixed) { expect(rel(f.ec50Lo, r.lo[ie])).toBeLessThan(0.1); expect(rel(f.x50, r.ed50)).toBeLessThan(1e-3); }
      if (r.model === '5PL') { expect(rel(f.x50, r.x50)).toBeLessThan(id === 'sim_LL5' ? 2e-3 : 0.05); }
    });
  }
  it('fixes top and bottom exactly and reports zero SE for them', () => {
    const data = [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4].flatMap((x) => [{ x, y: 100 / (1 + (x / 1e-6) ** 1.3) + (x > 1e-7 ? 0.5 : -0.5) }, { x, y: 100 / (1 + (x / 1e-6) ** 1.3) }]);
    const f = fitDoseResponse(data, '4PL', { top: 100, bottom: 0 });
    expect(f.top).toBe(100); expect(f.bottom).toBe(0); expect(f.params[0].fixed && f.params[1].fixed).toBe(true); expect(f.ec50 / 1e-6).toBeGreaterThan(0.9); expect(f.ec50 / 1e-6).toBeLessThan(1.1); expect(f.hill).toBeLessThan(0);
  });
  it('recovers an increasing (agonist) curve with positive Hill slope', () => {
    const xs = Array.from({ length: 9 }, (_, i) => 10 ** (-9 + i * 0.5)), data = xs.flatMap((x) => [0, 1].map((k) => ({ x, y: 2 + 98 / (1 + (3e-8 / x) ** 0.9) + (k ? 1 : -1) })));
    const f = fitDoseResponse(data, '4PL'); expect(f.hill).toBeCloseTo(0.9, 1); expect(f.ec50 / 3e-8).toBeGreaterThan(0.9); expect(f.ec50 / 3e-8).toBeLessThan(1.1);
  });
  it('rejects under-determined fits and parses CSV', () => {
    expect(() => fitDoseResponse([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], '4PL')).toThrow(/more than/);
    const p = parseDoseResponse('compound,dose,response\nA,0.1,95\nA,1,50\nB,0.1,90\nB,x,5\n'); expect([...p.groups.keys()]).toEqual(['A', 'B']); expect(p.groups.get('A')!.length).toBe(2); expect(p.note).toMatch(/1 unparseable/);
  });
});
