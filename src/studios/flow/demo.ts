/** Synthetic 30,000-event, four-parameter FCS 3.1 demo with a known spillover and three populations. */
import { writeFcs } from './fcs';
import type { Gate } from './gate';

export const DEMO_N = 30_000;
export const DEMO_DEBRIS = 5_000, DEMO_LYMPH = 19_000, DEMO_POSITIVE = 6_000;
export const DEMO_SPILL = { names: ['FITC-A', 'PE-A'], matrix: [[1, 0.15], [0.05, 1]] };
export const DEMO_LYMPH_GATE: Gate = { type: 'rect', x: 'FSC-A', y: 'SSC-A', xmin: 68_000, xmax: 118_000, ymin: 20_000, ymax: 52_000 };

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Observed columns plus a population label (0 debris, 1 lymphocyte-like, 2 FITC-positive). */
export function demoEvents(seed = 1): { columns: Float64Array[]; labels: Uint8Array } {
  const rnd = seeded(seed);
  const z = () => {
    const u = Math.max(1e-12, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const lognormal = (median: number, sigma: number) => median * Math.exp(sigma * z());
  const columns = [new Float64Array(DEMO_N), new Float64Array(DEMO_N), new Float64Array(DEMO_N), new Float64Array(DEMO_N)];
  const labels = new Uint8Array(DEMO_N);
  for (let i = 0; i < DEMO_N; i++) {
    const pop = i < DEMO_DEBRIS ? 0 : i < DEMO_DEBRIS + DEMO_LYMPH ? 1 : 2;
    labels[i] = pop;
    const fsc = pop === 0 ? 45_000 + 12_000 * z() : pop === 1 ? 90_000 + 12_000 * z() : 108_000 + 14_000 * z();
    const ssc = pop === 0 ? 20_000 + 8_000 * z() : pop === 1 ? 34_000 + 7_000 * z() : 44_000 + 9_000 * z();
    const fitc = pop === 0 ? lognormal(250, 0.5) : pop === 1 ? lognormal(600, 0.45) : lognormal(8_000, 0.35);
    const pe = pop === 0 ? lognormal(150, 0.5) : lognormal(900, pop === 2 ? 0.45 : 0.5);
    columns[0][i] = clamp(fsc, 1_000, 250_000);
    columns[1][i] = clamp(ssc, 1_000, 250_000);
    columns[2][i] = Math.max(1, fitc + 0.05 * pe);   // PE into FITC
    columns[3][i] = Math.max(1, pe + 0.15 * fitc);   // FITC into PE
  }
  return { columns, labels };
}

/** A valid FCS 3.1 file made with writeFcs, ready for the demo button and the parser. */
export function makeDemoFcs(seed = 1): ArrayBuffer {
  const { columns } = demoEvents(seed);
  return writeFcs(columns.map((c) => Float32Array.from(c)), {
    version: 'FCS3.1',
    datatype: 'F',
    params: [
      { name: 'FSC-A', stain: 'FSC-A', range: 262144 },
      { name: 'SSC-A', stain: 'SSC-A', range: 262144 },
      { name: 'FITC-A', stain: 'FITC', range: 262144 },
      { name: 'PE-A', stain: 'PE', range: 262144 },
    ],
    spill: DEMO_SPILL,
  });
}
