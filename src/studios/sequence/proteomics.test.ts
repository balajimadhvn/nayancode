import { describe, expect, it } from 'vitest';
import { cleavageSites, composition, DEFAULT_DIGEST, digestProtein, isotopePattern, matchMasses, MODS, mz, parseMzml, PROT_ENZYMES, peptideMass, PROTON, chromatogram, xic } from './proteomics';
import { deflateSync } from 'node:zlib';

describe('peptide masses (published values)', () => {
  it('PEPTIDE: monoisotopic neutral 799.35996 and [M+H]+ 800.3672', () => { const m = peptideMass('PEPTIDE'); expect(m).toBeCloseTo(799.35996, 4); expect(mz(m, 1)).toBeCloseTo(800.36724, 4); });
  it('angiotensin II (DRVYIHPF) [M+H]+ = 1046.5418', () => expect(mz(peptideMass('DRVYIHPF'), 1)).toBeCloseTo(1046.5418, 3));
  it('bradykinin (RPPGFSPFR, C50H73N15O11) monoisotopic mass 1059.5614', () => expect(peptideMass('RPPGFSPFR')).toBeCloseTo(50 * 12 + 73 * 1.00782503223 + 15 * 14.00307400443 + 11 * 15.99491461957, 3));
  it('average mass of PEPTIDE is 799.8', () => expect(peptideMass('PEPTIDE', 'avg')).toBeCloseTo(799.82, 1));
  it('adds carbamidomethyl per cysteine', () => expect(peptideMass('ACDC', 'mono', ['carbamidomethyl']) - peptideMass('ACDC')).toBeCloseTo(2 * MODS.carbamidomethyl.delta, 6));
  it('rejects unknown residues', () => expect(() => peptideMass('PEPXIDE')).toThrow());
  it('composition reproduces the monoisotopic mass', () => {
    const c = composition('PEPTIDE'), m = c.C * 12 + c.H * 1.00782503223 + c.N * 14.00307400443 + c.O * 15.99491461957 + c.S * 31.9720711744;
    expect(m).toBeCloseTo(peptideMass('PEPTIDE'), 4);
  });
});

describe('digestion', () => {
  it('trypsin does not cut before proline, Trypsin/P does', () => {
    const e = PROT_ENZYMES.find((x) => x.id === 'trypsin')!, ep = PROT_ENZYMES.find((x) => x.id === 'trypsinp')!;
    expect(cleavageSites('AAKPAAKAAR', e)).toEqual([7]); expect(cleavageSites('AAKPAAKAAR', ep)).toEqual([3, 7]);
  });
  it('digests with missed cleavages, length and mass filters', () => {
    const o = { ...DEFAULT_DIGEST, minLen: 1, minMass: 0, maxMass: 1e5, missed: 0, fixed: [] };
    expect(digestProtein('MKWVTFISLLFLFSSAYSRGVFRR', o).map((p) => p.seq)).toEqual(['MK', 'WVTFISLLFLFSSAYSR', 'GVFR', 'R']);
    expect(digestProtein('AAAAAKBBB'.replace(/B/g, 'G'), { ...o, missed: 1 }).map((p) => p.seq)).toContain('AAAAAKGGG');
    expect(digestProtein('MKWVTFISLLFLFSSAYSRGVFRR', { ...o, minLen: 5 }).map((p) => p.seq)).toEqual(['WVTFISLLFLFSSAYSR']);
  });
  it('enumerates oxidation variants', () => {
    const r = digestProtein('MAAAAAAK', { ...DEFAULT_DIGEST, fixed: [], variable: ['oxidation'], minLen: 4, minMass: 0 });
    expect(r.length).toBe(2); expect(r[1].mass - r[0].mass).toBeCloseTo(15.994915, 5); expect(r[1].mods[0]).toContain('Oxidation');
  });
  it('rejects non-protein input', () => { expect(() => digestProtein('ACGTBXZ', DEFAULT_DIGEST)).toThrow(); expect(() => digestProtein('', DEFAULT_DIGEST)).toThrow(); });
});

describe('isotope patterns', () => {
  it('C100 has M+1/M of 100·0.0107/0.9893 = 1.082', () => { const p = isotopePattern({ C: 100, H: 0, N: 0, O: 0, S: 0 }); expect(p[1].abundance / p[0].abundance).toBeCloseTo(1.0816 * 1, 1); });
  it('a sulphur-containing peptide has a larger M+2', () => {
    const a = isotopePattern(composition('PEPTIDE')), b = isotopePattern(composition('PEPTIDMC'));
    expect(b[2].abundance / b[0].abundance).toBeGreaterThan(a[2].abundance / a[0].abundance);
  });
  it('is normalised to a maximum of 1', () => expect(Math.max(...isotopePattern(composition('PEPTIDEPEPTIDE')).map((x) => x.abundance))).toBe(1));
});

describe('peptide mass fingerprint', () => {
  it('matches observed [M+H]+ within ppm and reports coverage', () => {
    const prot = 'MKWVTFISLLFLFSSAYSRGVFRRDAHK', pep = digestProtein(prot, { ...DEFAULT_DIGEST, fixed: [], minLen: 4, minMass: 0, missed: 0 });
    const obs = [mz(peptideMass('GVFR'), 1) + 0.0005, 1234.5678];
    const r = matchMasses(obs, pep, 10); expect(r.matchedPeptides).toBe(1); expect(r.matches[0].peptide!.seq).toBe('GVFR'); expect(r.matches[1].peptide).toBeUndefined(); expect(r.coverage).toBe(4);
  });
});

const b64f64 = (v: number[]) => Buffer.from(new Float64Array(v).buffer).toString('base64');
const b64z32 = (v: number[]) => deflateSync(Buffer.from(new Float32Array(v).buffer)).toString('base64');
const spectrum = (i: number, rt: number, ms: number, mzs: number[], ints: number[]) => `<spectrum index="${i}" id="scan=${i + 1}" defaultArrayLength="${mzs.length}"><cvParam name="ms level" value="${ms}"/><cvParam name="centroid spectrum"/><cvParam name="total ion current" value="${ints.reduce((a, b) => a + b, 0)}"/><scanList><scan><cvParam name="scan start time" value="${rt}" unitName="minute"/></scan></scanList><binaryDataArrayList><binaryDataArray><cvParam name="64-bit float"/><cvParam name="no compression"/><cvParam name="m/z array"/><binary>${b64f64(mzs)}</binary></binaryDataArray><binaryDataArray><cvParam name="32-bit float"/><cvParam name="zlib compression"/><cvParam name="intensity array"/><binary>${b64z32(ints)}</binary></binaryDataArray></binaryDataArrayList></spectrum>`;
describe('mzML', () => {
  const xml = `<?xml version="1.0"?><mzML><run><spectrumList count="3">${spectrum(0, 1.0, 1, [400.2, 500.3, 600.4], [10, 50, 20])}${spectrum(1, 2.0, 1, [400.2, 500.3], [100, 60])}${spectrum(2, 2.1, 2, [150.1], [5])}</spectrumList></run></mzML>`;
  it('decodes plain 64-bit and zlib 32-bit arrays', async () => {
    const r = await parseMzml(xml); expect(r.spectra).toHaveLength(3); const s = r.spectra[0];
    expect(Array.from(s.mz)).toEqual([400.2, 500.3, 600.4]); expect(Array.from(s.intensity)).toEqual([10, 50, 20]); expect(s.basePeakMz).toBe(500.3); expect(s.rt).toBe(1); expect(r.spectra[2].msLevel).toBe(2);
  });
  it('builds TIC and XIC traces from MS1 scans only', async () => {
    const r = await parseMzml(xml); expect(chromatogram(r.spectra)).toEqual([{ x: 1, y: 80 }, { x: 2, y: 160 }]);
    expect(xic(r.spectra, 400.2, 10).map((p) => p.y)).toEqual([10, 100]);
  });
  it('rejects other files', async () => { await expect(parseMzml('<html></html>')).rejects.toThrow(/mzML/); });
  it('proton constant is the mass of a proton', () => expect(PROTON).toBeCloseTo(1.007276, 5));
});
