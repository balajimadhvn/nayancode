import { describe, expect, it } from 'vitest';
import { DEMO_LYMPH, DEMO_LYMPH_GATE, DEMO_SPILL, demoEvents, makeDemoFcs } from './demo';
import { parseFcs } from './fcs';
import { applyGate } from './gate';
import { compensate } from './transform';

function pearson(a: Float64Array, b: Float64Array, idx: number[]): number {
  const n = idx.length;
  const ma = idx.reduce((s, i) => s + a[i], 0) / n, mb = idx.reduce((s, i) => s + b[i], 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (const i of idx) { const da = a[i] - ma, db = b[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  return cov / Math.sqrt(va * vb);
}

describe('demo FCS', () => {
  it('writes a valid 30,000-event file with four parameters and the spillover', () => {
    const p = parseFcs(makeDemoFcs());
    expect(p.tot).toBe(30_000);
    expect(p.params.map((x) => x.name)).toEqual(['FSC-A', 'SSC-A', 'FITC-A', 'PE-A']);
    expect(p.spill).toEqual(DEMO_SPILL);
  });

  it('puts at least 90 % of the lymphocyte-like events inside the demo gate', () => {
    const { columns, labels } = demoEvents();
    const mask = applyGate(null, { 'FSC-A': columns[0], 'SSC-A': columns[1] }, DEMO_LYMPH_GATE);
    let total = 0, inside = 0;
    for (let i = 0; i < mask.length; i++) if (labels[i] === 1) { total++; if (mask[i]) inside++; }
    expect(total).toBe(DEMO_LYMPH);
    expect(inside / total).toBeGreaterThanOrEqual(0.9);
  });

  it('reduces the FITC-vs-PE correlation of FITC-positive events after compensation', () => {
    const p = parseFcs(makeDemoFcs());
    const { labels } = demoEvents();
    const beforeF = Float64Array.from(p.events[2]), beforeP = Float64Array.from(p.events[3]);
    const [afterF, afterP] = compensate([beforeF, beforeP], DEMO_SPILL.matrix);
    const idx = Array.from({ length: labels.length }, (_, i) => i).filter((i) => labels[i] === 2);
    const before = Math.abs(pearson(beforeF, beforeP, idx));
    const after = Math.abs(pearson(afterF, afterP, idx));
    expect(before).toBeGreaterThan(0.5);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(0.2);
  });
});
