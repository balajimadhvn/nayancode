import { describe, expect, test } from 'vitest';
import { convertTimeUnit, describeSeries, parseXvg } from './xvg';

const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

describe('XVG reader', () => {
  test('parses comments, directives, three columns and five rows', () => {
    const text = `# comment line
@    title "RMSD"
@    xaxis  label "Time (ps)"
@    yaxis  label "RMSD (nm)"
@ s0 legend "Backbone"
@ s1 legend "Ligand"
0.0  0.10  0.20
1.0  0.11  0.21
2.0  0.12  0.22
3.0  0.13  0.23
4.0  0.14  0.24
`;
    const d = parseXvg(text);
    expect(d.title).toBe('RMSD');
    expect(d.xLabel).toBe('Time (ps)');
    expect(d.yLabel).toBe('RMSD (nm)');
    expect(d.legends).toEqual(['Backbone', 'Ligand']);
    expect(d.x).toEqual([0, 1, 2, 3, 4]);
    expect(d.series).toEqual([
      [0.1, 0.11, 0.12, 0.13, 0.14],
      [0.2, 0.21, 0.22, 0.23, 0.24],
    ]);
    expect(d.datasets).toBe(1);
  });

  test('& separates data sets and missing directives are tolerated', () => {
    const text = '0 1\r\n1 2\r\n&\r\n2 3\r\n3 4\r\n';
    const d = parseXvg(text);
    expect(d.datasets).toBe(2);
    expect(d.x).toEqual([0, 1]);
    expect(d.series).toHaveLength(2);
    expect(d.series[0]).toEqual([1, 2]);
    expect(d.series[1]).toEqual([3, 4]);
    expect(d.legends).toEqual(['Series 1', 'Series 2']);
  });
});

describe('describeSeries', () => {
  test('a constant series has zero SD, drift and autocorrelation beyond 1/2', () => {
    const x = Array.from({ length: 10 }, (_, i) => i);
    const s = describeSeries(x, Array(10).fill(2));
    expect(s.mean).toBe(2);
    expect(s.sd).toBe(0);
    expect(s.min).toBe(2);
    expect(s.max).toBe(2);
    expect(s.drift).toBe(0);
    expect(s.blockSE).toBe(0);
    expect(s.autocorrelationTime).toBe(0);
  });

  test('a linear series has drift 1, min 0 and max 99', () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const s = describeSeries(x, x);
    expect(s.drift).toBeCloseTo(1, 12);
    expect(s.min).toBe(0);
    expect(s.max).toBe(99);
  });

  test('final-quarter mean of 1..100 is 87.5', () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(describeSeries(x, y).finalQuarterMean).toBeCloseTo(87.5, 12);
  });

  test('white noise has an integrated autocorrelation time of 0.5 ± 0.1', () => {
    const r = mulberry32(12345);
    const x = Array.from({ length: 5000 }, (_, i) => i * 0.01);
    const y = x.map(() => gauss(r));
    const s = describeSeries(x, y);
    expect(Math.abs(s.autocorrelationTime - 0.5)).toBeLessThan(0.1);
  });

  test('AR(1) with phi = 0.9 has an integrated autocorrelation time near 9.5', () => {
    const r = mulberry32(7);
    const phi = 0.9;
    const x = Array.from({ length: 20000 }, (_, i) => i);
    const y: number[] = [];
    let v = 0;
    for (let i = 0; i < x.length; i++) { v = phi * v + gauss(r) * 0.1; y.push(v); }
    const s = describeSeries(x, y);
    expect(s.autocorrelationTime).toBeGreaterThan(9.5 * 0.8);
    expect(s.autocorrelationTime).toBeLessThan(9.5 * 1.2);
  });

  test('equilibration time is reported for a series that settles', () => {
    const r = mulberry32(7);
    const x = Array.from({ length: 1200 }, (_, i) => i / 10);
    const y = x.map((t) => 1 + (t < 8 ? 4 * Math.exp(-t / 2) : 0) + 0.1 * gauss(r));
    const s = describeSeries(x, y);
    expect(s.equilibrationTime).not.toBeNull();
    expect(s.equilibrationTime!).toBeGreaterThan(5);
  });
});

describe('convertTimeUnit', () => {
  test('converts ps to ns and back', () => {
    expect(convertTimeUnit(1000, 'ps', 'ns')).toBeCloseTo(1, 12);
    expect(convertTimeUnit(500, 'ps', 'ns')).toBeCloseTo(0.5, 12);
    expect(convertTimeUnit(1, 'ns', 'ps')).toBeCloseTo(1000, 9);
    expect(convertTimeUnit(1, 'us', 'ns')).toBeCloseTo(1000, 9);
  });
});
