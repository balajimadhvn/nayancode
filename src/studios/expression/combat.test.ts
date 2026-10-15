import { describe, expect, it } from 'vitest';
import { combat, parseBatches } from './combat';

const sim = (G = 300, per = 6, seed = 4) => {
  let s = seed; const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296), nrm = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  const S = per * 4, batch: string[] = [], groups: string[] = []; // 2 batches × 2 groups, balanced
  for (let j = 0; j < S; j++) { batch.push(j < S / 2 ? 'A' : 'B'); groups.push(j % 2 ? 'case' : 'ctrl'); }
  const shift = Array.from({ length: G }, () => nrm() * 1.5), scale = Array.from({ length: G }, () => 1 + u()), eff = Array.from({ length: G }, (_, g) => (g < 30 ? 2 : 0));
  const x = new Float64Array(G * S);
  for (let g = 0; g < G; g++) for (let j = 0; j < S; j++) { const b = batch[j] === 'B'; x[g * S + j] = 5 + (groups[j] === 'case' ? eff[g] : 0) + (b ? shift[g] : 0) + nrm() * (b ? scale[g] : 1) * 0.5; }
  return { x, G, S, batch, groups, eff, shift };
};
const batchGap = (x: Float64Array, G: number, S: number, batch: string[]) => { let t = 0; for (let g = 0; g < G; g++) { let a = 0, b = 0, na = 0, nb = 0; for (let j = 0; j < S; j++) { if (batch[j] === 'A') { a += x[g * S + j]; na++; } else { b += x[g * S + j]; nb++; } } t += Math.abs(a / na - b / nb); } return t / G; };

describe('ComBat', () => {
  it('removes a planted per-gene batch shift and keeps the biological effect', () => {
    const d = sim(), out = combat(d.x, d.G, d.S, d.batch, d.groups);
    const before = batchGap(d.x, d.G, d.S, d.batch), after = batchGap(out.x, d.G, d.S, d.batch);
    expect(after).toBeLessThan(before * 0.2);
    let eff = 0; for (let g = 0; g < 30; g++) { let c = 0, k = 0, nc = 0, nk = 0; for (let j = 0; j < d.S; j++) { if (d.groups[j] === 'case') { c += out.x[g * d.S + j]; nc++; } else { k += out.x[g * d.S + j]; nk++; } } eff += c / nc - k / nk; }
    expect(eff / 30).toBeGreaterThan(1.7); expect(eff / 30).toBeLessThan(2.3);
  });
  it('rejects confounded designs and single-batch input', () => {
    const d = sim(); expect(() => combat(d.x, d.G, d.S, d.batch, d.batch.map((b) => (b === 'A' ? 'ctrl' : 'case')))).toThrow(/confounded/);
    expect(() => combat(d.x, d.G, d.S, d.batch.map(() => 'A'))).toThrow(/two batches/);
  });
  it('parses the optional batch column', () => {
    expect(parseBatches('sample,group,batch\ns1,a,x\ns2,b,y', ['s1', 's2'])).toEqual(['x', 'y']); expect(parseBatches('sample,group\ns1,a', ['s1'])).toBeNull();
  });
});
