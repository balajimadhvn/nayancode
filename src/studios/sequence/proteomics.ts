/**
 * Proteomics basics, pure TypeScript: enzymatic in-silico digestion, monoisotopic and average peptide masses with
 * fixed and variable modifications, isotope patterns from elemental composition, peptide-mass-fingerprint matching
 * and an mzML reader (zlib and plain, 32/64-bit, base64). Masses use IUPAC/NIST monoisotopic values.
 */

// ---------------------------------------------------------------- masses
export const PROTON = 1.00727646688;
export const WATER = 18.0105646863;
/** Monoisotopic residue masses (NIST). */
export const MONO: Record<string, number> = { G: 57.02146372, A: 71.03711379, S: 87.03202841, P: 97.05276385, V: 99.06841391, T: 101.04767847, C: 103.00918478, L: 113.08406398, I: 113.08406398, N: 114.04292744, D: 115.02694303, Q: 128.05857751, K: 128.09496302, E: 129.04259309, M: 131.04048491, H: 137.05891186, F: 147.06841391, R: 156.10111103, Y: 163.06332853, W: 186.07931295, U: 150.95363, O: 237.14773 };
/** Average residue masses (IUPAC atomic weights). */
export const AVG: Record<string, number> = { G: 57.0519, A: 71.0788, S: 87.0782, P: 97.1167, V: 99.1326, T: 101.1051, C: 103.1388, L: 113.1594, I: 113.1594, N: 114.1038, D: 115.0886, Q: 128.1307, K: 128.1741, E: 129.1155, M: 131.1926, H: 137.1411, F: 147.1766, R: 156.1875, Y: 163.1760, W: 186.2132, U: 150.0379, O: 237.3018 };
/** Elemental composition of each residue (C, H, N, O, S). */
export const COMP: Record<string, [number, number, number, number, number]> = {
  G: [2, 3, 1, 1, 0], A: [3, 5, 1, 1, 0], S: [3, 5, 1, 2, 0], P: [5, 7, 1, 1, 0], V: [5, 9, 1, 1, 0], T: [4, 7, 1, 2, 0], C: [3, 5, 1, 1, 1], L: [6, 11, 1, 1, 0], I: [6, 11, 1, 1, 0], N: [4, 6, 2, 2, 0], D: [4, 5, 1, 3, 0], Q: [5, 8, 2, 2, 0], K: [6, 12, 2, 1, 0], E: [5, 7, 1, 3, 0], M: [5, 9, 1, 1, 1], H: [6, 7, 3, 1, 0], F: [9, 9, 1, 1, 0], R: [6, 12, 4, 1, 0], Y: [9, 9, 1, 2, 0], W: [11, 10, 2, 1, 0],
};
export const MODS = {
  carbamidomethyl: { name: 'Carbamidomethyl (C)', delta: 57.021464, residues: 'C', dformula: [2, 3, 1, 1, 0] as [number, number, number, number, number] },
  oxidation: { name: 'Oxidation (M)', delta: 15.994915, residues: 'M', dformula: [0, 0, 0, 1, 0] as [number, number, number, number, number] },
  phospho: { name: 'Phospho (S, T, Y)', delta: 79.966331, residues: 'STY', dformula: [0, 1, 0, 3, 0] as [number, number, number, number, number] }, // + HPO3 (P omitted in CHNOS isotope model)
  acetylNterm: { name: 'Acetyl (protein N-term)', delta: 42.010565, residues: '', dformula: [2, 2, 0, 1, 0] as [number, number, number, number, number] },
};
export type ModKey = keyof typeof MODS;

export interface EnzymeDef { id: string; name: string; /** cleave after (C-terminal side) residues, or before (N-terminal side) */ side: 'after' | 'before'; residues: string; notBefore?: string; notAfter?: string }
export const PROT_ENZYMES: EnzymeDef[] = [
  { id: 'trypsin', name: 'Trypsin (K/R, not before P)', side: 'after', residues: 'KR', notBefore: 'P' },
  { id: 'trypsinp', name: 'Trypsin/P (K/R, also before P)', side: 'after', residues: 'KR' },
  { id: 'lysc', name: 'Lys-C (K)', side: 'after', residues: 'K' },
  { id: 'argc', name: 'Arg-C (R, not before P)', side: 'after', residues: 'R', notBefore: 'P' },
  { id: 'gluc', name: 'Glu-C (E)', side: 'after', residues: 'E' },
  { id: 'aspn', name: 'Asp-N (before D)', side: 'before', residues: 'D' },
  { id: 'chymo', name: 'Chymotrypsin (F/Y/W, not before P)', side: 'after', residues: 'FYW', notBefore: 'P' },
  { id: 'cnbr', name: 'CNBr (after M)', side: 'after', residues: 'M' },
];

/** Cleavage positions: index i means a cut between residue i−1 and i. */
export function cleavageSites(seq: string, e: EnzymeDef): number[] {
  const out: number[] = [];
  for (let i = 0; i < seq.length; i++) {
    if (e.side === 'after') { if (!e.residues.includes(seq[i]) || i === seq.length - 1) continue; if (e.notBefore?.includes(seq[i + 1])) continue; if (e.notAfter?.includes(seq[i])) continue; out.push(i + 1); }
    else { if (!e.residues.includes(seq[i]) || i === 0) continue; out.push(i); }
  }
  return out;
}

export interface Peptide { seq: string; start: number; end: number; missed: number; mass: number; avgMass: number; mods: string[]; nTerm: boolean }
const cleanSeq = (s: string) => s.replace(/^>.*$/gm, '').replace(/[^A-Za-z]/g, '').toUpperCase();
export interface DigestOptions { enzyme: string; missed: number; minLen: number; maxLen: number; minMass: number; maxMass: number; fixed: ModKey[]; variable: ModKey[]; maxVariable: number }
export const DEFAULT_DIGEST: DigestOptions = { enzyme: 'trypsin', missed: 1, minLen: 6, maxLen: 40, minMass: 500, maxMass: 5000, fixed: ['carbamidomethyl'], variable: [], maxVariable: 2 };

export function peptideMass(seq: string, kind: 'mono' | 'avg' = 'mono', fixed: ModKey[] = []) {
  const T = kind === 'mono' ? MONO : AVG; let m = kind === 'mono' ? WATER : 18.01528;
  for (const a of seq) { if (T[a] === undefined) throw new Error(`Unknown residue "${a}".`); m += T[a]; }
  for (const k of fixed) { if (k === 'acetylNterm') continue; const n = [...seq].filter((a) => MODS[k].residues.includes(a)).length; m += n * MODS[k].delta; }
  return m;
}
export const mz = (mass: number, z: number) => (mass + z * PROTON) / z;

export function digestProtein(protein: string, o: DigestOptions): Peptide[] {
  const seq = cleanSeq(protein), e = PROT_ENZYMES.find((x) => x.id === o.enzyme);
  if (!seq) throw new Error('No sequence to digest.'); if (!e) throw new Error('Unknown enzyme.');
  if (/[^ACDEFGHIKLMNPQRSTVWYUO]/.test(seq)) throw new Error('The sequence has characters that are not amino acids (B, J, X, Z are not supported).');
  const cuts = [0, ...cleavageSites(seq, e), seq.length], out: Peptide[] = [], seen = new Set<string>();
  for (let i = 0; i < cuts.length - 1; i++) for (let j = i + 1; j <= Math.min(cuts.length - 1, i + 1 + o.missed); j++) {
    const s = seq.slice(cuts[i], cuts[j]); if (s.length < o.minLen || s.length > o.maxLen) continue;
    const base = peptideMass(s, 'mono', o.fixed), avg = peptideMass(s, 'avg', o.fixed), nTerm = cuts[i] === 0;
    const nTermShift = nTerm && o.fixed.includes('acetylNterm') ? MODS.acetylNterm.delta : 0;
    // variable modifications: choose up to maxVariable sites among eligible residues
    const sites: { k: ModKey; pos: number }[] = []; for (const k of o.variable) [...s].forEach((a, p) => { if (MODS[k].residues.includes(a)) sites.push({ k, pos: p }); });
    const combos: { delta: number; label: string[] }[] = [{ delta: 0, label: [] }];
    const rec = (from: number, chosen: { k: ModKey; pos: number }[]) => { if (chosen.length) combos.push({ delta: chosen.reduce((a, c) => a + MODS[c.k].delta, 0), label: chosen.map((c) => `${MODS[c.k].name.split(' ')[0]}@${c.pos + 1}`) }); if (chosen.length >= o.maxVariable) return; for (let t = from; t < sites.length; t++) rec(t + 1, [...chosen, sites[t]]); };
    if (sites.length && sites.length <= 12) rec(0, []);
    for (const c of combos) {
      const mass = base + nTermShift + c.delta; if (mass < o.minMass || mass > o.maxMass) continue;
      const key = `${cuts[i]}-${cuts[j]}-${c.label.join(',')}`; if (seen.has(key)) continue; seen.add(key);
      out.push({ seq: s, start: cuts[i] + 1, end: cuts[j], missed: j - i - 1, mass, avgMass: avg + nTermShift + c.delta, mods: c.label, nTerm });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

// ---------------------------------------------------------------- isotope patterns
/** Natural isotope abundances: [mass offset from the lightest isotope, abundance]. */
const ISO: Record<'C' | 'H' | 'N' | 'O' | 'S', [number, number][]> = {
  C: [[0, 0.9893], [1, 0.0107]], H: [[0, 0.999885], [1, 0.000115]], N: [[0, 0.99636], [1, 0.00364]],
  O: [[0, 0.99757], [1, 0.00038], [2, 0.00205]], S: [[0, 0.9499], [1, 0.0075], [2, 0.0425], [4, 0.0001]],
};
export interface IsoPeak { offset: number; abundance: number }
/** Aggregated (nominal-mass) isotope distribution of a composition, relative abundances scaled to a maximum of 1. */
export function isotopePattern(comp: { C: number; H: number; N: number; O: number; S: number }, maxPeaks = 12): IsoPeak[] {
  let dist = [1];
  const conv = (a: number[], b: number[]) => { const r = new Array(Math.min(maxPeaks + 8, a.length + b.length - 1)).fill(0); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (i + j < r.length) r[i + j] += a[i] * b[j]; return r; };
  const powConv = (el: [number, number][], n: number) => { const base = new Array(Math.max(...el.map((x) => x[0])) + 1).fill(0); el.forEach(([o, p]) => { base[o] = p; }); let result = [1], sq = base, k = n; while (k > 0) { if (k & 1) result = conv(result, sq); k >>= 1; if (k) sq = conv(sq, sq); } return result; };
  for (const el of ['C', 'H', 'N', 'O', 'S'] as const) if (comp[el] > 0) dist = conv(dist, powConv(ISO[el], comp[el]));
  const mx = Math.max(...dist); const peaks = dist.slice(0, maxPeaks).map((p, i) => ({ offset: i, abundance: p / mx }));
  while (peaks.length > 1 && peaks[peaks.length - 1].abundance < 1e-3) peaks.pop();
  return peaks;
}
export function composition(seq: string, fixed: ModKey[] = [], extra: ModKey[] = []): { C: number; H: number; N: number; O: number; S: number } {
  const t = [0, 2, 0, 1, 0]; // water
  for (const a of seq) { const c = COMP[a]; if (!c) throw new Error(`No composition for residue "${a}".`); c.forEach((v, i) => { t[i] += v; }); }
  for (const k of [...fixed, ...extra]) { if (k === 'acetylNterm') continue; const n = [...seq].filter((a) => MODS[k].residues.includes(a)).length; MODS[k].dformula.forEach((v, i) => { t[i] += v * n; }); }
  return { C: t[0], H: t[1], N: t[2], O: t[3], S: t[4] };
}

// ---------------------------------------------------------------- peptide mass fingerprint
export interface PmfMatch { observed: number; peptide?: Peptide; z: number; ppm: number }
export function matchMasses(observed: number[], peptides: Peptide[], tolPpm: number, charges = [1], protonated = true): { matches: PmfMatch[]; coverage: number; matchedPeptides: number } {
  const cov = new Set<number>(); const matches: PmfMatch[] = []; let hit = 0;
  for (const o of observed) {
    let best: PmfMatch | undefined;
    for (const p of peptides) for (const z of charges) {
      const theo = protonated ? mz(p.mass, z) : p.mass; const ppm = ((o - theo) / theo) * 1e6;
      if (Math.abs(ppm) <= tolPpm && (!best || Math.abs(ppm) < Math.abs(best.ppm))) best = { observed: o, peptide: p, z, ppm };
    }
    if (best) { hit++; for (let i = best.peptide!.start; i <= best.peptide!.end; i++) cov.add(i); matches.push(best); } else matches.push({ observed: o, z: 0, ppm: NaN });
  }
  return { matches, coverage: cov.size, matchedPeptides: hit };
}

// ---------------------------------------------------------------- mzML
export interface Spectrum { index: number; id: string; msLevel: number; rt: number; rtUnit: string; tic: number; basePeak: number; basePeakMz: number; precursor?: { mz: number; z?: number }; centroid: boolean; mz: Float64Array; intensity: Float64Array }
export interface MzMl { spectra: Spectrum[]; instrument?: string }

const b64ToBytes = (b64: string) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function inflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream('deflate'); const w = ds.writable.getWriter(); void w.write(bytes as BufferSource); void w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
async function decodeArray(b64: string, o: { z: boolean; bits: 32 | 64 }): Promise<Float64Array> {
  let bytes: Uint8Array = b64ToBytes(b64.trim()); if (o.z) bytes = await inflate(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const n = bytes.byteLength / (o.bits / 8), out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = o.bits === 64 ? dv.getFloat64(i * 8, true) : dv.getFloat32(i * 4, true);
  return out;
}
const attr = (xml: string, name: string) => xml.match(new RegExp(`<cvParam[^>]*name="${name}"[^>]*>`))?.[0];
const val = (tag: string | undefined, a = 'value') => tag?.match(new RegExp(`${a}="([^"]*)"`))?.[1];

/** Reads an mzML file (indexed or not). Skips profile-array decoding errors per spectrum and reports how many were skipped. */
export async function parseMzml(text: string, maxSpectra = 20000): Promise<MzMl & { skipped: number }> {
  if (!/<mzML[\s>]/.test(text) && !/<indexedmzML[\s>]/.test(text)) throw new Error('This does not look like an mzML file (no <mzML> element).');
  const spectra: Spectrum[] = []; let skipped = 0; const re = /<spectrum\s[\s\S]*?<\/spectrum>/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && spectra.length < maxSpectra) {
    const sp = m[0], head = sp.match(/<spectrum\s[^>]*>/)![0];
    const arrays: { name: string; z: boolean; bits: 32 | 64; data: string }[] = [];
    for (const b of sp.matchAll(/<binaryDataArray[\s\S]*?<\/binaryDataArray>/g)) {
      const t = b[0], name = /name="m\/z array"/.test(t) ? 'mz' : /name="intensity array"/.test(t) ? 'int' : ''; if (!name) continue;
      arrays.push({ name, z: /name="zlib compression"/.test(t), bits: /name="64-bit float"/.test(t) ? 64 : 32, data: t.match(/<binary>([\s\S]*?)<\/binary>/)?.[1] ?? '' });
      if (/name="(numpress|MS-Numpress)/i.test(t)) { arrays.pop(); }
    }
    const A = arrays.find((x) => x.name === 'mz'), B = arrays.find((x) => x.name === 'int');
    if (!A || !B) { skipped++; continue; }
    try {
      const mzA = await decodeArray(A.data, A), inA = await decodeArray(B.data, B);
      let bp = 0, bpm = 0, tic = 0; for (let i = 0; i < inA.length; i++) { tic += inA[i]; if (inA[i] > bp) { bp = inA[i]; bpm = mzA[i]; } }
      const rtTag = attr(sp, 'scan start time'); const rtRaw = Number(val(rtTag) ?? NaN); const unit = val(rtTag, 'unitName') ?? 'minute';
      const prec = sp.match(/<selectedIon>[\s\S]*?<\/selectedIon>/)?.[0], pm = prec ? Number(val(attr(prec, 'selected ion m/z'))) : NaN, pz = prec ? Number(val(attr(prec, 'charge state'))) : NaN;
      spectra.push({ index: Number(val(head, 'index') ?? spectra.length), id: val(head, 'id') ?? String(spectra.length), msLevel: Number(val(attr(sp, 'ms level')) ?? 1), rt: Number.isFinite(rtRaw) ? (unit.startsWith('sec') ? rtRaw / 60 : rtRaw) : NaN, rtUnit: 'min', tic: Number(val(attr(sp, 'total ion current')) ?? tic) || tic, basePeak: bp, basePeakMz: bpm, centroid: /name="centroid spectrum"/.test(sp), precursor: Number.isFinite(pm) ? { mz: pm, z: Number.isFinite(pz) ? pz : undefined } : undefined, mz: mzA, intensity: inA });
    } catch { skipped++; }
  }
  if (!spectra.length) throw new Error(skipped ? 'No readable spectra: the arrays may use an unsupported compression (e.g. Numpress). Convert with ProteoWizard to zlib or uncompressed.' : 'No spectra found in this file.');
  return { spectra, skipped };
}
/** Total-ion chromatogram of MS1 spectra (or all when none). */
export const chromatogram = (s: Spectrum[]) => { const ms1 = s.filter((x) => x.msLevel === 1); return (ms1.length ? ms1 : s).filter((x) => Number.isFinite(x.rt)).map((x) => ({ x: x.rt, y: x.tic })); };
/** Extracted-ion chromatogram at m/z ± tol (ppm) for MS1 spectra. */
export function xic(s: Spectrum[], target: number, ppm: number) {
  const tol = (target * ppm) / 1e6;
  return s.filter((x) => x.msLevel === 1 && Number.isFinite(x.rt)).map((x) => { let y = 0; for (let i = 0; i < x.mz.length; i++) if (Math.abs(x.mz[i] - target) <= tol) y += x.intensity[i]; return { x: x.rt, y }; });
}
