import { describe, expect, it } from 'vitest';
import { detectChimeras } from './chimera';
import { demoAmplicon } from './simAmplicon';
import type { UniqueSeq } from './denoise';

const asvs = demoAmplicon(21).asvs;
const counts = [5000, 2000, 800, 300, 100];
const unique = (seq: string, count: number): UniqueSeq => ({ seq, count, samples: new Map([['sample1', count]]) });

describe('de novo chimera detection', () => {
  it('removes a two-parent chimera and keeps every true ASV', () => {
    const trueAsvs = asvs.map((s, i) => unique(s, counts[i]));
    const chimera = unique(asvs[0].slice(0, 120) + asvs[1].slice(120), 150);
    const res = detectChimeras([...trueAsvs, chimera]);
    expect(res.chimeras).toHaveLength(1);
    expect(res.kept.map((a) => a.seq).sort()).toEqual([...asvs].sort());
    const hit = res.chimeras[0];
    expect(new Set([hit.parentA, hit.parentB])).toEqual(new Set([asvs[0], asvs[1]]));
    expect(hit.split).toBe(120);
    expect(hit.identity).toBeGreaterThanOrEqual(0.99);
  });

  it('does not need two parents when only one ASV exists', () => {
    const res = detectChimeras([unique(asvs[0], 50)]);
    expect(res.kept).toHaveLength(1);
    expect(res.chimeras).toHaveLength(0);
  });
});
