import { describe, expect, it } from 'vitest';
import { findCdrs } from './cdr';
import { chainRanges, developabilityFlags, findLiabilities, fvProperties, isoelectricPoint, netCharge } from './liabilities';

const TRASTUZUMAB_VH = 'EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS';
const TRASTUZUMAB_VL = 'DIQMTQSPSSLSASVGDRVTITCRASQDVNTAVAWYQQKPGKAPKLLIYSASFLYSGVPSRFSGSRSGTDFTLTISSLQPEDFATYYCQQHYTTPPTFGQGTKVEIK';

describe('motif liabilities', () => {
  it('ANGSDGNTK carries the three expected motifs at the expected positions', () => {
    const l = findLiabilities('ANGSDGNTK', []);
    const has = (kind: string, motif: string, position: number) => l.some((x) => x.kind === kind && x.motif === motif && x.position === position);
    expect(has('deamidation', 'NG', 2)).toBe(true);
    // DG starts at position 5 in ANGSDGNTK (A1 N2 G3 S4 D5 G6 N7 T8 K9); see benchmarks/biologics/check.py.
    expect(has('isomerisation', 'DG', 5)).toBe(true);
    expect(has('N-glycosylation', 'NGS', 2)).toBe(true);
    // Under the stated N[GSTN] rule the trailing NT is also a deamidation motif.
    expect(l.filter((x) => x.kind === 'deamidation').map((x) => x.position)).toEqual([2, 7]);
  });

  it('NPS is not an N-glycosylation sequon', () => {
    expect(findLiabilities('ANPSK', []).some((l) => l.kind === 'N-glycosylation')).toBe(false);
    expect(findLiabilities('ANGSK', []).some((l) => l.kind === 'N-glycosylation')).toBe(true);
  });

  it('an odd cysteine count is flagged as a free cysteine', () => {
    expect(findLiabilities('ACDEFC', []).some((l) => l.kind === 'free cysteine')).toBe(false);
    expect(findLiabilities('ACDEFG', []).some((l) => l.kind === 'free cysteine')).toBe(true);
  });

  it('an Asp-Pro bond is flagged as acid-labile', () => {
    expect(findLiabilities('ADPK', []).some((l) => l.kind === 'acid-labile' && l.position === 2)).toBe(true);
  });
});

describe('charge and pI', () => {
  it('poly-lysine is > +4.9 at pH 7.4 and near zero at pH 14', () => {
    expect(netCharge('KKKKK', 7.4)).toBeGreaterThan(4.9);
    expect(netCharge('KKKKK', 14)).toBeLessThan(0.05);
  });

  it('poly-glutamate is < −4.9 at pH 7.4', () => {
    expect(netCharge('EEEEE', 7.4)).toBeLessThan(-4.9);
  });

  it('pI of poly-lysine is > 10.5 and of poly-aspartate < 3.5', () => {
    expect(isoelectricPoint('KKKKK')).toBeGreaterThan(10.5);
    expect(isoelectricPoint('DDDDD')).toBeLessThan(3.5);
  });
});

describe('CDR regions', () => {
  it('the trastuzumab CDR-H2 NG is flagged in a CDR', () => {
    const cdr = findCdrs(TRASTUZUMAB_VH);
    expect(cdr.cdr2).toContain('NG');
    const l = findLiabilities(TRASTUZUMAB_VH, chainRanges(cdr));
    const ng = l.find((x) => x.kind === 'deamidation' && x.motif === 'NG');
    expect(ng).toBeDefined();
    expect(ng!.region).toBe('CDR');
  });

  it('framework liabilities are labelled framework', () => {
    const cdr = findCdrs(TRASTUZUMAB_VL);
    const l = findLiabilities(TRASTUZUMAB_VL, chainRanges(cdr));
    expect(l.some((x) => x.region === 'framework')).toBe(true);
  });
});

describe('Fv properties and flags', () => {
  const cdrH = findCdrs(TRASTUZUMAB_VH), cdrL = findCdrs(TRASTUZUMAB_VL);
  const fv = TRASTUZUMAB_VH + TRASTUZUMAB_VL;
  const ranges = [...chainRanges(cdrH).map(([a, b]) => [a, b] as [number, number]), ...chainRanges(cdrL).map(([a, b]) => [a + TRASTUZUMAB_VH.length, b + TRASTUZUMAB_VH.length] as [number, number])];
  const p = fvProperties(fv, ranges, cdrH.cdr3);

  it('reports length, mass, pI, charge and CDR lengths', () => {
    expect(p.length).toBe(fv.length);
    expect(p.mw).toBeGreaterThan(20000);
    expect(p.cdrLength).toBe(cdrH.cdr1.length + cdrH.cdr2.length + cdrH.cdr3.length + cdrL.cdr1.length + cdrL.cdr2.length + cdrL.cdr3.length);
    expect(p.cdrH3Length).toBe(11);
    expect(p.hydrophobicCdrFraction).toBeGreaterThan(0);
    expect(p.hydrophobicCdrFraction).toBeLessThanOrEqual(1);
    expect(Number.isFinite(p.cdrCharge)).toBe(true);
  });

  it('flags are rules of thumb and always explain themselves', () => {
    for (const f of developabilityFlags(p)) expect(f.text.length).toBeGreaterThan(10);
  });
});
