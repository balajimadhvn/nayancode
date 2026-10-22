import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { digest, revComp } from '@/studios/sequence/kernels';
import { findPrimerSites, annotate } from './annotate';
import { FEATURES } from './features-library';
import { parseGenBank } from './genbank';

const GB = readFileSync(new URL('./fixtures/puc19.gb', import.meta.url), 'utf8');
const puc = parseGenBank(GB);
const SEQ = puc.seq;

const overlaps = (a: number, b: number, c: number, d: number) => a <= d && c <= b;

describe('feature library', () => {
  it('stores the three long elements exactly as the fixture slices, reverse-complemented', () => {
    expect(FEATURES.find((f) => f.name === 'AmpR')!.seq).toBe(revComp(SEQ.slice(1625, 2486)));
    expect(FEATURES.find((f) => f.name === 'lacZ-alpha')!.seq).toBe(revComp(SEQ.slice(145, 469)));
    expect(FEATURES.find((f) => f.name === 'pMB1 ori')!.seq).toBe(revComp(SEQ.slice(866, 1455)));
    expect(FEATURES.find((f) => f.name === 'AmpR')!.seq).toHaveLength(861);
    expect(FEATURES.find((f) => f.name === 'lacZ-alpha')!.seq).toHaveLength(324);
    expect(FEATURES.find((f) => f.name === 'pMB1 ori')!.seq).toHaveLength(589);
  });

  it('the short elements have their canonical sequences', () => {
    const get = (n: string) => FEATURES.find((f) => f.name === n)!.seq;
    expect(get('T7 promoter')).toBe('TAATACGACTCACTATAGGG');
    expect(get('6xHis tag')).toBe('CACCACCACCACCACCAC');
    expect(get('HA tag')).toBe('TACCCATACGATGTTCCAGATTACGCT');
  });
});

describe('annotate pUC19', () => {
  const found = annotate(SEQ, FEATURES, { circular: true });

  it('finds AmpR on the minus strand overlapping 1626–2486', () => {
    const f = found.find((x) => x.label === 'AmpR')!;
    expect(f).toBeDefined();
    expect(f.strand).toBe(-1);
    expect(overlaps(f.start, Math.min(f.end, 2686), 1626, 2486)).toBe(true);
    expect(Math.abs(f.start - 1626)).toBeLessThanOrEqual(5);
    expect(Math.abs(f.end - 2486)).toBeLessThanOrEqual(5);
    expect(f.identity).toBeGreaterThanOrEqual(0.95);
  });

  it('finds lacZ-alpha and pMB1 ori on the minus strand at their coordinates', () => {
    const lac = found.find((x) => x.label === 'lacZ-alpha')!;
    expect(lac.strand).toBe(-1);
    expect(Math.abs(lac.start - 146)).toBeLessThanOrEqual(5);
    expect(Math.abs(lac.end - 469)).toBeLessThanOrEqual(5);
    const ori = found.find((x) => x.label === 'pMB1 ori')!;
    expect(ori.strand).toBe(-1);
    expect(Math.abs(ori.start - 867)).toBeLessThanOrEqual(5);
  });

  it('does not report a T7 promoter (pUC19 has none)', () => {
    expect(found.find((x) => x.label === 'T7 promoter')).toBeUndefined();
  });

  it('finds an inserted T7 promoter and 6xHis tag on the plus strand at the insertion point', () => {
    const at = 1000;
    const insert = FEATURES.find((f) => f.name === 'T7 promoter')!.seq + 'GGTACC' + FEATURES.find((f) => f.name === '6xHis tag')!.seq;
    const seq = SEQ.slice(0, at) + insert + SEQ.slice(at);
    const hits = annotate(seq, FEATURES, { circular: true });
    const t7 = hits.find((x) => x.label === 'T7 promoter')!;
    const his = hits.find((x) => x.label === '6xHis tag')!;
    expect(t7.strand).toBe(1);
    expect(t7.start).toBe(at + 1);
    expect(his.strand).toBe(1);
    expect(his.start).toBe(at + 1 + 20 + 6);
  });

  it('still finds AmpR when the sequence is rotated so it crosses position 1', () => {
    const cut = 2000; // position 2000 becomes position 1
    const rotated = SEQ.slice(cut - 1) + SEQ.slice(0, cut - 1);
    const hits = annotate(rotated, FEATURES, { circular: true });
    const amp = hits.find((x) => x.label === 'AmpR')!;
    expect(amp).toBeDefined();
    expect(amp.strand).toBe(-1);
    // AmpR now starts at 1626 − 2000 + 1 = 2315 (1-based, modulo the length)
    expect(amp.start).toBeGreaterThan(2300);
    expect(amp.start).toBeLessThan(2330);
  });

  it('drops a hit that is only a fragment below the identity threshold', () => {
    const broken = SEQ.slice(0, 1625) + SEQ.slice(1625, 2486).replace(/A/g, 'C') + SEQ.slice(2486);
    const hits = annotate(broken, FEATURES, { circular: true });
    expect(hits.find((x) => x.label === 'AmpR')).toBeUndefined();
  });
});

describe('restriction map', () => {
  it('pUC19 has a single EcoRI site at 396 and a single HindIII site at 447', () => {
    const eco = digest(SEQ, ['EcoRI'], true);
    expect(eco.sites).toHaveLength(1);
    expect(eco.sites[0].pos).toBe(396);
    const hind = digest(SEQ, ['HindIII'], true);
    expect(hind.sites).toHaveLength(1);
    expect(hind.sites[0].pos).toBe(447);
    const both = digest(SEQ, ['EcoRI', 'HindIII'], true);
    expect(both.fragments).toHaveLength(2);
    expect(both.fragments.reduce((a, b) => a + b, 0)).toBe(2686);
  });
});

describe('primer sites', () => {
  it('finds the M13 forward primer once in pUC19', () => {
    const sites = findPrimerSites(SEQ, 'GTAAAACGACGGCCAGT');
    expect(sites).toHaveLength(1);
    expect(sites[0].mismatches).toBe(0);
    expect(sites[0].start).toBe(SEQ.indexOf('GTAAAACGACGGCCAGT') + 1);
  });

  it('tolerates a mismatch away from the 3′ end but never at it', () => {
    const primer = 'GTAAAACGACGGCCAGT';
    const at = SEQ.indexOf(primer);
    // One mismatch in the 5' region (the 12 nt 3' anchor still matches): found with 2 allowed, not with 0.
    const oneOff = SEQ.slice(0, at) + 'GTCAAACGACGGCCAGT' + SEQ.slice(at + primer.length);
    expect(findPrimerSites(oneOff, primer, 2).some((s) => s.mismatches === 1)).toBe(true);
    expect(findPrimerSites(oneOff, primer, 0)).toHaveLength(0);
    // 3' terminal mismatch: the 12 nt anchor no longer matches, so no site.
    const terminal = SEQ.slice(0, at) + 'GTAAAACGACGGCCAGA' + SEQ.slice(at + primer.length);
    expect(findPrimerSites(terminal, primer, 2)).toHaveLength(0);
  });

  it('rejects a primer shorter than 12 nt', () => {
    expect(() => findPrimerSites(SEQ, 'ACGT')).toThrow(/12 nt/);
  });
});
