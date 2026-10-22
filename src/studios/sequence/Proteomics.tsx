import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, cssVar } from '@/viz/charts';
import { chromatogram, composition, DEFAULT_DIGEST, digestProtein, isotopePattern, matchMasses, MODS, mz, parseMzml, peptideMass, PROT_ENZYMES, xic, type DigestOptions, type ModKey, type Peptide, type Spectrum } from './proteomics';

const HBA = 'MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR';
const tool = (id: string, name: string, describe: ToolInfo['describe']): ToolInfo => ({ id, name, version: '0.1.0', engine: 'TypeScript', citations: [], describe });
const T = {
  digest: tool('proteomics.digest', 'In-silico digestion', (p) => `The protein was digested in silico with ${p.enzyme} (up to ${p.missed} missed cleavages, ${p.minLen}–${p.maxLen} residues); monoisotopic masses used IUPAC/NIST residue masses${p.fixed ? ` with fixed ${p.fixed}` : ''}`),
  pmf: tool('proteomics.pmf', 'Peptide mass fingerprint matching', (p) => `${p.n} observed masses were matched to the digest within ${p.tol} ppm`),
  mzml: tool('proteomics.mzml', 'mzML viewer', (p) => `An mzML file with ${p.n} spectra was read locally for inspection`),
};
type Sub = 'digest' | 'isotopes' | 'match' | 'mzml';
const num = (s: string, d: number) => { const v = Number(s); return s.trim() !== '' && Number.isFinite(v) ? v : d; };
const stems = (xs: number[], ys: number[]) => xs.flatMap((x, i) => [{ x, y: 0 }, { x, y: ys[i] }, { x, y: 0 }]);

export default function Proteomics({ initial }: { initial?: string }) {
  const [sub, setSub] = useState<Sub>('digest');
  const [prot, setProt] = useState(initial && initial.length >= 10 ? initial : HBA);
  const [o, setO] = useState<DigestOptions>(DEFAULT_DIGEST);
  const set = <K extends keyof DigestOptions>(k: K, v: DigestOptions[K]) => setO((p) => ({ ...p, [k]: v }));
  const { run, error } = useRunner();
  const [peps, setPeps] = useState<Peptide[] | null>(null);
  const go = () => void run({ label: 'In-silico digestion', tool: T.digest, params: { enzyme: o.enzyme, missed: o.missed, minLen: o.minLen, maxLen: o.maxLen, fixed: o.fixed.map((k) => MODS[k].name).join(', ') }, inputs: [{ name: 'protein', data: prot }], run: async () => digestProtein(prot, o) }).then((r) => r && setPeps(r));
  const tog = (arr: ModKey[], k: ModKey, key: 'fixed' | 'variable') => set(key, arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
  return (
    <div className="stack">
      <Tabs<Sub> value={sub} onChange={setSub} items={[{ id: 'digest', label: 'Digest' }, { id: 'isotopes', label: 'Mass & isotopes' }, { id: 'match', label: 'Match masses' }, { id: 'mzml', label: 'mzML viewer' }]} />
      {(sub === 'digest' || sub === 'match') && <div className="split"><div className="stack">
        <Card title="Protein"><div className="stack" style={{ gap: 8 }}>
          <textarea className="input mono" rows={5} value={prot} onChange={(e) => { setProt(e.target.value); setPeps(null); }} style={{ fontSize: 12 }} aria-label="Protein sequence" />
          <div className="row" style={{ gap: 6 }}><button className="btn sm" onClick={() => { setProt(HBA); setPeps(null); }}>Example: haemoglobin α</button></div>
        </div></Card>
        <Card title="Digestion"><div className="stack" style={{ gap: 10 }}>
          <Field label="Enzyme"><select className="select" value={o.enzyme} onChange={(e) => set('enzyme', e.target.value)}>{PROT_ENZYMES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <div className="cols-2" style={{ gap: 8 }}><Field label="Missed cleavages"><input className="input" value={o.missed} onChange={(e) => set('missed', Math.max(0, Math.min(5, num(e.target.value, 0))))} /></Field><Field label="Max variable mods"><input className="input" value={o.maxVariable} onChange={(e) => set('maxVariable', Math.max(0, Math.min(3, num(e.target.value, 2))))} /></Field></div>
          <div className="cols-2" style={{ gap: 8 }}><Field label="Min length"><input className="input" value={o.minLen} onChange={(e) => set('minLen', num(e.target.value, 6))} /></Field><Field label="Max length"><input className="input" value={o.maxLen} onChange={(e) => set('maxLen', num(e.target.value, 40))} /></Field><Field label="Min mass"><input className="input" value={o.minMass} onChange={(e) => set('minMass', num(e.target.value, 0))} /></Field><Field label="Max mass"><input className="input" value={o.maxMass} onChange={(e) => set('maxMass', num(e.target.value, 1e5))} /></Field></div>
          <Field label="Fixed modifications"><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{(['carbamidomethyl', 'acetylNterm'] as ModKey[]).map((k) => <label key={k} className="row" style={{ gap: 4 }}><input type="checkbox" checked={o.fixed.includes(k)} onChange={() => tog(o.fixed, k, 'fixed')} />{MODS[k].name}</label>)}</div></Field>
          <Field label="Variable modifications"><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{(['oxidation', 'phospho'] as ModKey[]).map((k) => <label key={k} className="row" style={{ gap: 4 }}><input type="checkbox" checked={o.variable.includes(k)} onChange={() => tog(o.variable, k, 'variable')} />{MODS[k].name}</label>)}</div></Field>
          <button className="btn primary" onClick={go}>Digest</button>{error && <Callout kind="err">{error}</Callout>}
        </div></Card>
      </div>
      <div className="stack">{sub === 'digest' ? (!peps ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Digest a protein to list peptide masses and m/z values.</div></Card> : <DigestTable peps={peps} prot={prot} />) : <MatchView peps={peps} onDigest={go} />}</div></div>}
      {sub === 'isotopes' && <Isotopes />}
      {sub === 'mzml' && <MzmlView />}
    </div>
  );
}

function DigestTable({ peps, prot }: { peps: Peptide[]; prot: string }) {
  const len = prot.replace(/[^A-Za-z]/g, '').length, cov = new Set<number>(); peps.forEach((p) => { for (let i = p.start; i <= p.end; i++) cov.add(i); });
  return (
    <>
      <div className="cols-3"><Stat label="Peptides" value={peps.length} /><Stat label="Residues covered" value={`${fmt((100 * cov.size) / len, 1)} %`} hint="of the protein by the listed peptides" /><Stat label="Protein length" value={len} /></div>
      <Card title="Peptides" actions={<button className="btn sm" onClick={() => downloadText('peptides.csv', toCsv(peps.map((p) => ({ sequence: p.seq, start: p.start, end: p.end, missed: p.missed, monoisotopic_mass: p.mass.toFixed(5), average_mass: p.avgMass.toFixed(3), mz_1plus: mz(p.mass, 1).toFixed(5), mz_2plus: mz(p.mass, 2).toFixed(5), mz_3plus: mz(p.mass, 3).toFixed(5), modifications: p.mods.join(';') }))), 'text/csv')}>Download CSV</button>}>
        <DataTable rowKey={(r) => `${r.start}-${r.end}-${r.mods.join()}`} limit={120} rows={peps} cols={[
          { key: 'seq', label: 'Sequence', render: (r) => <span className="mono">{r.seq}</span>, sort: (r) => r.seq }, { key: 'pos', label: 'Position', render: (r) => `${r.start}–${r.end}`, sort: (r) => r.start }, { key: 'mc', label: 'Missed', num: true, render: (r) => r.missed },
          { key: 'mass', label: 'Mass (mono)', num: true, render: (r) => fmt(r.mass, 4), sort: (r) => r.mass }, { key: 'z1', label: '[M+H]⁺', num: true, render: (r) => fmt(mz(r.mass, 1), 4) }, { key: 'z2', label: '[M+2H]²⁺', num: true, render: (r) => fmt(mz(r.mass, 2), 4) }, { key: 'm', label: 'Mods', render: (r) => r.mods.join(', ') }]} />
      </Card>
    </>
  );
}

function MatchView({ peps, onDigest }: { peps: Peptide[] | null; onDigest(): void }) {
  const [list, setList] = useState(''), [tol, setTol] = useState('20'), [charges, setCharges] = useState([1, 2]);
  const parsed = useMemo(() => list.split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0), [list]);
  const res = useMemo(() => (peps && parsed.length ? matchMasses(parsed, peps, num(tol, 20), charges) : null), [peps, parsed, tol, charges]);
  return (
    <>
      <Card title="Observed masses" sub="peptide mass fingerprint"><div className="stack" style={{ gap: 8 }}>
        <textarea className="input mono" rows={4} placeholder="Observed m/z values, one per line or comma-separated" value={list} onChange={(e) => setList(e.target.value)} style={{ fontSize: 12 }} aria-label="Observed m/z values" />
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}><Field label="Tolerance (ppm)"><input className="input" style={{ width: 90 }} value={tol} onChange={(e) => setTol(e.target.value)} /></Field>{[1, 2, 3].map((z) => <label key={z} className="row" style={{ gap: 4 }}><input type="checkbox" checked={charges.includes(z)} onChange={() => setCharges(charges.includes(z) ? charges.filter((x) => x !== z) : [...charges, z])} />{z}+</label>)}</div>
        {!peps && <div className="row" style={{ gap: 8 }}><Callout>Digest the protein first (Digest tab).</Callout><button className="btn" onClick={onDigest}>Digest now</button></div>}
      </div></Card>
      {res && <><div className="cols-3"><Stat label="Matched" value={`${res.matches.filter((m) => m.peptide).length} / ${parsed.length}`} /><Stat label="Sequence coverage" value={`${fmt((100 * res.coverage) / Math.max(...peps!.map((p) => p.end)), 1)} %`} /><Stat label="Median |error|" value={`${fmt(med(res.matches.filter((m) => m.peptide).map((m) => Math.abs(m.ppm))), 1)} ppm`} /></div>
        <Card title="Assignments"><DataTable rowKey={(r) => String(r.observed)} rows={res.matches} cols={[{ key: 'o', label: 'Observed m/z', num: true, render: (r) => fmt(r.observed, 4) }, { key: 'p', label: 'Peptide', render: (r) => (r.peptide ? <span className="mono">{r.peptide.seq}</span> : <span className="faint">no match</span>) }, { key: 'z', label: 'z', num: true, render: (r) => (r.z || '') }, { key: 'e', label: 'Error (ppm)', num: true, render: (r) => (Number.isFinite(r.ppm) ? fmt(r.ppm, 1) : ''), sort: (r) => (Number.isFinite(r.ppm) ? Math.abs(r.ppm) : 1e9) }, { key: 'pos', label: 'Position', render: (r) => (r.peptide ? `${r.peptide.start}–${r.peptide.end}` : '') }]} /></Card></>}
    </>
  );
}
const med = (v: number[]) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function Isotopes() {
  const [seq, setSeq] = useState('PEPTIDEKR'), [z, setZ] = useState('2'), [fixed, setFixed] = useState(true);
  const clean = seq.toUpperCase().replace(/[^A-Z]/g, '');
  const r = useMemo(() => { try { const f: ModKey[] = fixed ? ['carbamidomethyl'] : []; const mono = peptideMass(clean, 'mono', f), zz = Math.max(1, Math.round(num(z, 2))); return { mono, avg: peptideMass(clean, 'avg', f), zz, pat: isotopePattern(composition(clean, f)), err: '' }; } catch (e) { return { mono: NaN, avg: NaN, zz: 1, pat: [], err: (e as Error).message }; } }, [clean, z, fixed]);
  const m0 = r.err ? NaN : mz(r.mono, r.zz), spacing = 1.00335 / r.zz;
  return (
    <div className="split"><div className="stack"><Card title="Peptide"><div className="stack" style={{ gap: 8 }}>
      <Field label="Sequence"><input className="input mono" value={seq} onChange={(e) => setSeq(e.target.value)} /></Field><Field label="Charge z"><input className="input" value={z} onChange={(e) => setZ(e.target.value)} /></Field>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} />Carbamidomethyl cysteines</label></div></Card></div>
    <div className="stack">{r.err ? <Callout kind="err">{r.err}</Callout> : <>
      <div className="cols-3"><Stat label="Monoisotopic mass" value={fmt(r.mono, 4)} /><Stat label="Average mass" value={fmt(r.avg, 3)} /><Stat label={`m/z at ${r.zz}+`} value={fmt(m0, 4)} /></div>
      <Card title="Isotope pattern" sub="relative abundance, from elemental composition"><CurvePlot height={260} exportName="isotope-pattern" spec={{ series: [{ name: 'abundance', color: cssVar('--chart-a'), curve: stems(r.pat.map((p) => m0 + p.offset * spacing), r.pat.map((p) => p.abundance)) }], xLabel: 'm/z', yLabel: 'Relative abundance', yMin: 0, yMax: 1.05 }} /></Card>
      <Callout><div>Natural isotope abundances of C, H, N, O and S; peaks are spaced 1.00335/z apart and grouped by nominal mass (fine structure is not resolved). Peak ratios shift with elemental composition, so they can confirm a charge state or flag sulphur.</div></Callout></>}</div></div>
  );
}

function demoRun(): Spectrum[] {
  const peps = digestProtein(HBA, { ...DEFAULT_DIGEST, missed: 0, minLen: 7 }).slice(0, 8), out: Spectrum[] = [];
  for (let i = 0; i < 80; i++) {
    const rt = 5 + i * 0.5, mzs: number[] = [], ints: number[] = [];
    peps.forEach((p, k) => { const centre = 10 + k * 4, a = 1e6 * Math.exp(-((rt - centre) ** 2) / (2 * 1.2 ** 2)); if (a < 2e3) return; const m0 = mz(p.mass, 2), pat = isotopePattern(composition(p.seq, ['carbamidomethyl'])); pat.forEach((q) => { mzs.push(m0 + (q.offset * 1.00335) / 2); ints.push(a * q.abundance); }); });
    const order = mzs.map((_, j) => j).sort((x, y) => mzs[x] - mzs[y]);
    const mzA = Float64Array.from(order.map((j) => mzs[j])), inA = Float64Array.from(order.map((j) => ints[j] * (1 + 0.03 * Math.sin(j + i))));
    let bp = 0, bpm = 0, tic = 0; inA.forEach((v, j) => { tic += v; if (v > bp) { bp = v; bpm = mzA[j]; } });
    out.push({ index: i, id: `synthetic=${i + 1}`, msLevel: 1, rt, rtUnit: 'min', tic, basePeak: bp, basePeakMz: bpm, centroid: true, mz: mzA, intensity: inA });
  }
  return out;
}
function MzmlView() {
  const [spectra, setSpectra] = useState<Spectrum[] | null>(null), [sel, setSel] = useState(0), [name, setName] = useState(''), [skipped, setSkipped] = useState(0), [target, setTarget] = useState(''), { run, error } = useRunner();
  const load = (text: string, n: string) => void run({ label: `mzML · ${n}`, tool: T.mzml, params: { n: 0 }, inputs: [{ name: n, data: text.slice(0, 2000) }], run: async () => parseMzml(text) }).then((r) => { if (r) { setSpectra(r.spectra); setSkipped(r.skipped); setSel(0); setName(n); } });
  const chrom = useMemo(() => (spectra ? chromatogram(spectra) : []), [spectra]);
  const tgt = num(target, NaN), x = useMemo(() => (spectra && Number.isFinite(tgt) ? xic(spectra, tgt, 10) : null), [spectra, tgt]);
  const s = spectra?.[Math.min(sel, (spectra?.length ?? 1) - 1)];
  return (
    <div className="split"><div className="stack">
      <Card title="mzML file"><div className="stack" style={{ gap: 8 }}>
        <FileDrop accept=".mzML,.mzml,.xml" onText={load} label={name ? `${name} (${spectra?.length} spectra)` : 'Drop an mzML file (centroided or profile; plain or zlib arrays)'} />
        <button className="btn" onClick={() => { setSpectra(demoRun()); setName('synthetic demo'); setSkipped(0); setSel(20); }}>Load synthetic demo run</button>
        {error && <Callout kind="err">{error}</Callout>}{skipped > 0 && <Callout kind="warn">{skipped} spectra could not be decoded (unsupported compression) and were skipped.</Callout>}
        {spectra && <Field label="Extracted ion chromatogram m/z (±10 ppm)"><input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 523.2745" /></Field>}
      </div></Card>
      <Callout><div>Files are read in your browser and never uploaded. Spectra are decoded to their original m/z and intensity arrays; Numpress-compressed files are not supported yet, so convert them with ProteoWizard first.</div></Callout>
    </div>
    <div className="stack">{!spectra || !s ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load an mzML file to see its chromatogram and spectra.</div></Card> : <>
      <div className="cols-3"><Stat label="Spectra" value={spectra.length} hint={`${spectra.filter((q) => q.msLevel === 1).length} MS1, ${spectra.filter((q) => q.msLevel > 1).length} MS/MS`} /><Stat label="Selected" value={`#${s.index + 1} · MS${s.msLevel}`} hint={s.id} /><Stat label="Base peak" value={fmt(s.basePeakMz, 4)} hint={`intensity ${s.basePeak.toExponential(2)}`} /></div>
      <Card title={x ? `Extracted ion chromatogram, m/z ${tgt}` : 'Total ion chromatogram'} sub="click a slider position below to choose a scan"><CurvePlot height={220} exportName="chromatogram" spec={{ series: [{ name: x ? 'XIC' : 'TIC', color: cssVar('--chart-a'), curve: x ?? chrom }], xLabel: 'Retention time (min)', yLabel: 'Intensity', yMin: 0, vlines: Number.isFinite(s.rt) ? [{ x: s.rt, label: `#${s.index + 1}` }] : [] }} /></Card>
      <Card title={`Spectrum #${s.index + 1}`} sub={`${s.mz.length} points · RT ${fmt(s.rt, 2)} min${s.precursor ? ` · precursor ${fmt(s.precursor.mz, 4)}${s.precursor.z ? ` ${s.precursor.z}+` : ''}` : ''}`}>
        <input type="range" min={0} max={spectra.length - 1} value={sel} onChange={(e) => setSel(+e.target.value)} aria-label="Select spectrum" style={{ width: '100%' }} />
        <CurvePlot height={260} exportName="spectrum" spec={{ series: [{ name: 'intensity', color: cssVar('--chart-b'), curve: s.centroid ? stems(Array.from(s.mz), Array.from(s.intensity)) : Array.from(s.mz, (m, i) => ({ x: m, y: s.intensity[i] })) }], xLabel: 'm/z', yLabel: 'Intensity', yMin: 0 }} /></Card>
    </>}</div></div>
  );
}
