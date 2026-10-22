import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { assemble } from './assemble';
import { mashDistance, sketch } from './kernels';

const readFasta = (name: string) => gunzipSync(readFileSync(new URL(`../../../public/genomes/${name}.fna.gz`, import.meta.url))).toString('utf8').split('\n').filter((l) => l && l[0] !== '>').join('').toUpperCase();
const lambda = readFasta('lambda'), t7 = readFasta('t7');

const REV: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const revComp = (s: string) => [...s].reverse().map((c) => REV[c]).join('');

/** Simulated long reads: uniform length in [minLen, maxLen], both strands, substitution errors. */
function simulate(seq: string, o: { coverage: number; minLen?: number; maxLen?: number; errorRate?: number; seed?: number }): string[] {
  const minLen = o.minLen ?? 3000, maxLen = o.maxLen ?? 8000, err = o.errorRate ?? 0.003;
  let s = (o.seed ?? 1) >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const nReads = Math.round((o.coverage * seq.length) / ((minLen + maxLen) / 2)), out: string[] = [];
  for (let n = 0; n < nReads; n++) {
    const len = minLen + Math.floor(rnd() * (maxLen - minLen + 1)), start = Math.floor(rnd() * (seq.length - len));
    const chars = [...seq.slice(start, start + len)];
    for (let i = 0; i < chars.length; i++) if (rnd() < err) chars[i] = 'ACGT'[Math.floor(rnd() * 4)];
    out.push(rnd() < 0.5 ? chars.join('') : revComp(chars.join('')));
  }
  return out;
}

const n50 = (lengths: number[]) => { const l = [...lengths].sort((a, b) => b - a), total = l.reduce((a, b) => a + b, 0); let acc = 0; for (const x of l) { acc += x; if (acc >= total * 0.5) return x; } return 0; };

describe('small-genome assembly', () => {
  test('60× simulated lambda reads assemble into ≤ 3 contigs spanning the genome at ≥ 99 % ANI', () => {
    const reads = simulate(lambda, { coverage: 60, seed: 4 });
    const t0 = Date.now();
    const asm = assemble(reads);
    const ms = Date.now() - t0;
    expect(asm.reads).toBe(reads.length);
    expect(asm.contigs.length).toBeLessThanOrEqual(3);
    const longest = asm.contigs[0].seq.length;
    expect(longest).toBeGreaterThanOrEqual(0.9 * lambda.length);
    const ani = mashDistance(sketch(asm.contigs[0].seq), sketch(lambda)).ani;
    expect(ani).toBeGreaterThanOrEqual(0.99);
    expect(ms).toBeLessThan(60_000);
    console.log(`lambda: ${reads.length} reads, ${asm.contigs.length} contigs, longest ${longest}, N50 ${n50(asm.contigs.map((c) => c.seq.length))}, ANI ${ani.toFixed(5)}, ${ms} ms`);
  }, 120_000);

  test('shuffling the reads and reverse-complementing half of them gives the same N50 (± 1 %)', () => {
    const reads = simulate(lambda, { coverage: 40, seed: 4 });
    const base = assemble(reads);
    const shuffled = reads.map((r, i) => (i % 2 ? revComp(r) : r)).reverse();
    const flipped = assemble(shuffled);
    const n1 = n50(base.contigs.map((c) => c.seq.length)), n2 = n50(flipped.contigs.map((c) => c.seq.length));
    expect(Math.abs(n2 - n1) / Math.max(1, n1)).toBeLessThan(0.01);
  }, 120_000);

  test('reads from two unrelated genomes give at least two contigs, none longer than the longer genome', () => {
    const reads = [...simulate(lambda, { coverage: 35, seed: 9 }), ...simulate(t7, { coverage: 35, seed: 10 })];
    const asm = assemble(reads);
    expect(asm.contigs.length).toBeGreaterThanOrEqual(2);
    expect(asm.contigs[0].seq.length).toBeLessThanOrEqual(1.1 * Math.max(lambda.length, t7.length));
  }, 120_000);

  test('fewer than five usable reads is a clear error', () => {
    expect(() => assemble([lambda.slice(0, 2000), lambda.slice(0, 2000), lambda.slice(0, 2000), lambda.slice(0, 2000)])).toThrow(/at least 5 reads/);
    expect(() => assemble([lambda.slice(0, 400), lambda.slice(0, 400), lambda.slice(0, 400), lambda.slice(0, 400), lambda.slice(0, 400)])).toThrow(/at least 5 reads/);
  });
});
