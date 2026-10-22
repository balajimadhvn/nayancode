import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { gather, mergeSketches, parseRefFasta, refSketch, revComp, screenReads, simulateReads, sketchGenome } from './screen';

const readGenome = (name: string) => parseRefFasta(gunzipSync(readFileSync(new URL(`../../../public/genomes/${name}.fna.gz`, import.meta.url))).toString('utf8')).map((r) => r.seq).join('');
const genome = (() => { const c: Record<string, string> = {}; return (name: string) => (c[name] ??= readGenome(name)); })();
const lambda = genome('lambda'), t7 = genome('t7'), ecoli = genome('ecoli-k12');

const lambdaRef = refSketch('lambda', lambda), t7Ref = refSketch('t7', t7), ecoliRef = refSketch('ecoli-k12', ecoli);
const refs = [lambdaRef, t7Ref, ecoliRef];
const sketchReads = (reads: string[]) => mergeSketches(reads.map((r) => sketchGenome(r)));

describe('FracMinHash reference screening', () => {
  test('a 70 % lambda + 30 % T7 mixture is gathered as lambda then T7, with no E. coli', () => {
    const reads = simulateReads([{ id: 'lambda', seq: lambda }, { id: 't7', seq: t7 }], [0.7, 0.3], { nReads: 20_000, readLen: 150, errorRate: 0.005, seed: 7 });
    const sample = sketchReads(reads);
    expect(sample.size).toBeGreaterThan(1_000);
    const g = gather(sample, refs);
    expect(g[0].id).toBe('lambda'); expect(g[1].id).toBe('t7');
    expect(Math.abs(g[0].fractionOfSample - 0.7)).toBeLessThan(0.10);
    expect(Math.abs(g[1].fractionOfSample - 0.3)).toBeLessThan(0.10);
    expect(g.some((r) => r.id === 'ecoli-k12')).toBe(false);
    expect(g.every((r) => r.intersection >= 5)).toBe(true);
    // The phages are E. coli phages, so a few real k-mers are shared with the host; the rest of the sample is error hash.
    const rows = screenReads(sample, refs);
    expect(rows.find((r) => r.id === 'ecoli-k12')!.containment).toBeLessThan(0.10);
    expect(rows[0].id).toBe('lambda');
    expect(lambdaRef.sketch.size).toBe(rows[0].shared);
    expect(rows[0].coverage).toBe(1);
  });

  test('reads from E. coli alone give E. coli as the top hit with containment > 0.9', () => {
    const reads = simulateReads([{ id: 'ecoli-k12', seq: ecoli }], [1], { nReads: 20_000, readLen: 150, errorRate: 0.001, seed: 11 });
    const sample = sketchReads(reads);
    const rows = screenReads(sample, refs);
    expect(rows[0].id).toBe('ecoli-k12');
    expect(rows[0].containment).toBeGreaterThan(0.9);
    expect(gather(sample, refs)[0].id).toBe('ecoli-k12');
  });

  test('random reads do not match any reference', () => {
    let s = 3; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const reads = Array.from({ length: 20_000 }, () => Array.from({ length: 150 }, () => 'ACGT'[Math.floor(rnd() * 4)]).join(''));
    const sample = sketchReads(reads);
    const rows = screenReads(sample, refs);
    expect(Math.max(...rows.map((r) => r.containment))).toBeLessThan(0.01);
    for (const g of gather(sample, refs)) expect(g.fractionOfSample).toBeLessThan(0.01);
  });

  test('a genome and its reverse complement have identical sketches', () => {
    const a = sketchGenome(lambda), b = sketchGenome(revComp(lambda));
    expect(a.size).toBeGreaterThan(100);
    expect(b.size).toBe(a.size);
    for (const [h, n] of a) expect(b.get(h)).toBe(n);
  });

  test('containment is the explained share of the sample and coverage the seen share of the reference', () => {
    const sample = sketchGenome(lambda.slice(0, 20_000));
    const rows = screenReads(sample, [lambdaRef, t7Ref]);
    const L = rows.find((r) => r.id === 'lambda')!;
    expect(L.containment).toBeCloseTo(1, 10);
    expect(L.coverage).toBeGreaterThan(0.35); expect(L.coverage).toBeLessThan(0.45); // 20 kb of 48.5 kb
    expect(rows.find((r) => r.id === 't7')!.shared).toBe(0);
  });
});
