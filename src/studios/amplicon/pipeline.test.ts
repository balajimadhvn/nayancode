import { describe, expect, it } from 'vitest';
import { parseFeatureTable } from '../microbiome/kernels';
import { runAmplicon } from './pipeline';
import { PRIMER_F, PRIMER_R, demoAmplicon, simulateSample } from './simAmplicon';

const differences = (a: string, b: string) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

describe('amplicon pipeline', () => {
  const demo = demoAmplicon(21);

  it('planted ASVs are at least 20 substitutions apart', () => {
    for (let i = 0; i < demo.asvs.length; i++) for (let j = i + 1; j < demo.asvs.length; j++) {
      expect(differences(demo.asvs[i], demo.asvs[j])).toBeGreaterThanOrEqual(20);
    }
  });

  it('recovers exactly the five true ASVs from 0.3 % error reads', () => {
    const sample = simulateSample(demo.asvs, [5000, 2000, 800, 300, 100], 33, 's1');
    const res = runAmplicon([sample], { fwdPrimer: PRIMER_F, revPrimer: PRIMER_R });
    expect(res.rows).toHaveLength(5);
    expect([...res.rows.map((r) => r.seq)].sort()).toEqual([...demo.asvs].sort());
    expect(res.rows.some((r) => r.abundance < 50)).toBe(false);
    const total = res.rows.reduce((n, r) => n + r.abundance, 0);
    expect(Math.abs(total - 8200) / 8200).toBeLessThanOrEqual(0.03);
    expect(res.stages.raw).toBe(8200);
    expect(res.stages.merged).toBeGreaterThan(8000);
    expect(res.stages.denoised).toBe(5);
  });

  it('matches three planted sample mixes and exports a loadable table', () => {
    const res = runAmplicon(demo.samples, { reference: demo.reference, bootstrap: 100, seed: 5 });
    expect(res.rows).toHaveLength(5);
    expect(res.hasTaxonomy).toBe(true);
    for (let j = 0; j < demo.asvs.length; j++) {
      const row = res.rows.find((r) => r.seq === demo.asvs[j]);
      expect(row, `ASV ${j + 1} recovered`).toBeTruthy();
      expect(row!.genus).toBe(demo.genera[j]);
      for (let i = 0; i < demo.samples.length; i++) {
        const expected = demo.mixes[i][j], got = row!.samples[`sample${i + 1}`];
        expect(Math.abs(got - expected) / expected, `ASV ${j + 1} sample ${i + 1}: ${got} vs ${expected}`).toBeLessThanOrEqual(0.03);
      }
    }
    expect(res.table.split('\n')[0]).toBe('ASV,sample1,sample2,sample3,taxonomy');
    const parsed = parseFeatureTable(res.table);
    expect(parsed.samples).toEqual(['sample1', 'sample2', 'sample3']);
    expect(parsed.features).toHaveLength(5);
    expect(parsed.taxonomy.every((t) => t.split(';').length >= 2)).toBe(true);
    expect((res.fasta.match(/^>/gm) ?? []).length).toBe(5);
  });
});
