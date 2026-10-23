import { useEffect, useMemo, useRef, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CurvePlot, ScenePlot } from '@/viz/charts';
import { DEFAULT_OPTIONS, buildHelicalWheel } from '@/viz/figure';
import { chargeCurve, cleanSequence, peptideProperties, type ChargeOptions, type PeptideProperties } from './props';
import { DISULFIDE, cyclicMass, disulfideMass, disulfidePairings, fragmentIons, linearMass, matchSpectrum, type FragmentIon, type IonType } from './ms';
import { AMP_MAX_POINTS, ampScreen } from './amp';

type Tab = 'props' | 'wheel' | 'fragments' | 'cyclic' | 'amp';

const TOOL: ToolInfo = {
  id: 'peptide.properties', name: 'Peptide properties, fragments and AMP screen', version: '1.0.0', engine: 'TypeScript',
  citations: ['kyte1982', 'eisenberg1984', 'ikai1980', 'roepstorff1984'],
  describe: (p) => `Peptide properties, charge titration and pI were computed for ${p.n} sequence(s) at pH ${p.pH}; helical-wheel projections, b/y/a fragment ions and cyclic/disulfide mass shifts were available for the selected peptide.`,
};

const DEMO = 'Magainin 2,GIGKFLHSAKKFGKAFVGEIMNS\nMelittin,GIGAVLKVLTTGLPALISWIKRKRQQ';

interface Row { name: string; seq: string; props: PeptideProperties }

function parseRows(text: string, pH: number, o: ChargeOptions): { rows: Row[]; errors: string[] } {
  const rows: Row[] = [], errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const parts = line.split(',');
    const name = parts.length > 1 ? parts[0].trim() || `Peptide ${i + 1}` : `Peptide ${i + 1}`;
    const raw = (parts.length > 1 ? parts.slice(1).join('') : parts[0]).trim();
    try {
      const seq = cleanSequence(raw);
      rows.push({ name, seq, props: peptideProperties(seq, pH, o) });
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  });
  return { rows, errors };
}

export default function PeptideStudio() {
  const [tab, setTab] = useState<Tab>('props');
  const [text, setText] = useState('');
  const [pH, setPH] = useState('7.4');
  const [freeTermini, setFreeTermini] = useState(true);
  const [amidatedC, setAmidatedC] = useState(false);
  const [acetylatedN, setAcetylatedN] = useState(false);
  const [selected, setSelected] = useState(0);
  const [delta, setDelta] = useState(100);
  const [types, setTypes] = useState({ b: true, y: true, a: false });
  const [charges, setCharges] = useState({ z1: true, z2: false });
  const [modPos, setModPos] = useState('');
  const [modDelta, setModDelta] = useState('');
  const [peaks, setPeaks] = useState('');
  const [tol, setTol] = useState('10');
  const { run, error } = useRunner();
  const recorded = useRef('');

  const pHValue = Number(pH);
  const pHOk = pH.trim() !== '' && Number.isFinite(pHValue) && pHValue >= 0 && pHValue <= 14;
  const opts: ChargeOptions = { freeTermini, amidatedC, acetylatedN };

  const parsed = useMemo(() => (pHOk ? parseRows(text, pHValue, { freeTermini, amidatedC, acetylatedN }) : { rows: [], errors: [] }), [text, pHValue, pHOk, freeTermini, amidatedC, acetylatedN]);
  const rows = parsed.rows;
  const sel: Row | undefined = rows[Math.min(selected, Math.max(0, rows.length - 1))];

  const key = `${text}|${pH}|${freeTermini}|${amidatedC}|${acetylatedN}`;
  useEffect(() => {
    if (!pHOk || !rows.length || recorded.current === key) return;
    const t = setTimeout(() => {
      recorded.current = key;
      void run({
        label: `Peptide · ${rows.length} sequence(s)`, tool: TOOL, params: { n: rows.length, pH: pHValue, freeTermini, amidatedC, acetylatedN },
        inputs: [{ name: 'peptide sequences', data: text }],
        run: async () => rows.length,
        summary: () => `Properties, charge titration, pI, helical-wheel moments and fragment ions for ${rows.length} peptide(s)`,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [key, rows.length, pHOk, pHValue, freeTermini, amidatedC, acetylatedN, text, run]);

  const curve = useMemo(() => (sel ? chargeCurve(sel.seq, opts) : []), [sel, freeTermini, amidatedC, acetylatedN]);
  const wheelScene = useMemo(() => (sel ? buildHelicalWheel({ seq: sel.seq, delta }, DEFAULT_OPTIONS) : null), [sel, delta]);

  const ionTypes = useMemo(() => (['b', 'y', 'a'] as IonType[]).filter((t) => types[t]), [types]);
  const ionCharges = useMemo(() => [1, 2].filter((z) => (z === 1 ? charges.z1 : charges.z2)), [charges]);
  const mods = useMemo(() => {
    const position = Number(modPos), d = Number(modDelta);
    return modPos.trim() && modDelta.trim() && Number.isInteger(position) && Number.isFinite(d) ? [{ position, delta: d }] : [];
  }, [modPos, modDelta]);

  const ions: FragmentIon[] = useMemo(() => {
    if (!sel) return [];
    try { return fragmentIons(sel.seq, { ionTypes, charges: ionCharges, mods }); } catch { return []; }
  }, [sel, ionTypes, ionCharges, mods]);

  const peakList = useMemo(() => peaks.split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0), [peaks]);
  const tolValue = Number(tol);
  const match = useMemo(() => (ions.length && peakList.length && Number.isFinite(tolValue) && tolValue > 0 ? matchSpectrum(peakList, ions, tolValue) : null), [ions, peakList, tolValue]);

  const pairings = useMemo(() => {
    if (!sel) return { list: [] as ReturnType<typeof disulfidePairings>, err: '' };
    try { return { list: disulfidePairings(sel.seq), err: '' }; } catch (e) { return { list: [] as ReturnType<typeof disulfidePairings>, err: (e as Error).message }; }
  }, [sel]);
  const cysCount = sel ? sel.seq.split('').filter((c) => c === 'C').length : 0;

  const amps = useMemo(() => rows.map((r) => ({ row: r, amp: ampScreen(r.seq) })), [rows]);

  const err = [
    ...(!pHOk ? ['pH must be a number between 0 and 14.'] : []),
    ...parsed.errors,
    ...(error ? [error] : []),
  ];

  const downloadCsv = () => {
    const data = rows.map((r) => ({
      name: r.name, sequence: r.seq, length: r.props.length,
      mass_monoisotopic_Da: r.props.massMono.toFixed(5), mass_average_Da: r.props.massAvg.toFixed(5),
      charge_pH: r.props.charge.toFixed(4), pI: r.props.pI.toFixed(3), gravy: r.props.gravy.toFixed(4),
      aliphatic_index: r.props.aliphaticIndex.toFixed(3), moment_alpha: r.props.momentAlpha.toFixed(5), moment_beta: r.props.momentBeta.toFixed(5),
    }));
    downloadText('peptides.csv', toCsv(data), 'text/csv');
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Peptide Studio</h1><p>Peptide mass, charge and pI, GRAVY, aliphatic index, hydrophobic moment and helical wheel, b/y/a fragment ions, cyclic and disulfide mass shifts, and a rule-based antimicrobial-peptide screen. Sequences up to 100 residues.</p></div></div>

      <Card title="1 · Peptides">
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input mono" rows={5} style={{ fontSize: 11.5 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="One peptide per line: sequence, or name,sequence" />
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="pH"><input className="input" type="number" min={0} max={14} step={0.1} value={pH} onChange={(e) => setPH(e.target.value)} style={{ width: 90 }} /></Field>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={freeTermini} onChange={(e) => setFreeTermini(e.target.checked)} /> Free termini</label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={amidatedC} disabled={!freeTermini} onChange={(e) => setAmidatedC(e.target.checked)} /> C-amidated</label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={acetylatedN} disabled={!freeTermini} onChange={(e) => setAcetylatedN(e.target.checked)} /> N-acetylated</label>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { setText(DEMO); setSelected(0); }}>Load demo (magainin 2 + melittin)</button>
            <button className="btn ghost" onClick={() => { setText(''); setSelected(0); }}>Clear</button>
            <button className="btn ghost" onClick={downloadCsv} disabled={!rows.length}>Download CSV</button>
          </div>
          {rows.length > 0 && <div className="faint" style={{ fontSize: 12 }}>{rows.length} peptide(s) parsed; click a row to select it for the wheel, fragments and disulfides.</div>}
          {err.map((m) => <Callout key={m} kind="err">{m}</Callout>)}
        </div>
      </Card>

      {rows.length > 0 && sel && <>
        <Tabs value={tab} onChange={setTab} items={[{ id: 'props', label: 'Properties' }, { id: 'wheel', label: 'Helical wheel' }, { id: 'fragments', label: 'Fragments & masses' }, { id: 'cyclic', label: 'Cyclic & disulfide' }, { id: 'amp', label: 'AMP screen' }]} />

        {tab === 'props' && <>
          <Card title="Properties" sub="monoisotopic and average masses use the shared proteomics mass table; charge titrates the N- and C-termini and the K, R, H, D, E, C and Y side chains.">
            <DataTable
              rows={rows}
              onRow={(r) => setSelected(rows.indexOf(r))}
              rowKey={(r) => r.seq + r.name}
              cols={[
                { key: 'name', label: 'Name', render: (r) => r.name },
                { key: 'seq', label: 'Sequence', render: (r) => <span className="mono">{r.seq}</span> },
                { key: 'len', label: 'Length', num: true, render: (r) => r.props.length },
                { key: 'mono', label: 'Mono (Da)', num: true, render: (r) => fmt(r.props.massMono, 3) },
                { key: 'avg', label: 'Average (Da)', num: true, render: (r) => fmt(r.props.massAvg, 3) },
                { key: 'q', label: `Charge pH ${fmt(pHValue, 1)}`, num: true, render: (r) => fmt(r.props.charge, 2) },
                { key: 'pI', label: 'pI', num: true, render: (r) => fmt(r.props.pI, 2) },
                { key: 'gravy', label: 'GRAVY', num: true, render: (r) => fmt(r.props.gravy, 2) },
                { key: 'ai', label: 'Aliphatic index', num: true, render: (r) => fmt(r.props.aliphaticIndex, 1) },
                { key: 'ma', label: '⟨μH⟩ α', num: true, render: (r) => fmt(r.props.momentAlpha, 3) },
                { key: 'mb', label: '⟨μH⟩ β', num: true, render: (r) => fmt(r.props.momentBeta, 3) },
              ]}
            />
          </Card>
          <Card title="Hydrophobic moment and selected peptide" sub={`${sel.name} · ${sel.seq}`}>
            <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
              <Stat label="Hydrophobic moment (α-helix, δ = 100°)" value={fmt(sel.props.momentAlpha, 3)} />
              <Stat label="Hydrophobic moment (β-strand, δ = 160°)" value={fmt(sel.props.momentBeta, 3)} />
              <Stat label={`Net charge at pH ${fmt(pHValue, 1)}`} value={fmt(sel.props.charge, 2)} />
              <Stat label="Isoelectric point" value={fmt(sel.props.pI, 2)} />
              <Stat label="GRAVY" value={fmt(sel.props.gravy, 3)} />
              <Stat label="Aliphatic index" value={fmt(sel.props.aliphaticIndex, 1)} />
              <Stat label="Monoisotopic mass" value={`${fmt(sel.props.massMono, 3)} Da`} />
              <Stat label="Average mass" value={`${fmt(sel.props.massAvg, 3)} Da`} />
            </div>
          </Card>
          <Card title="Charge vs pH" sub="Henderson–Hasselbalch titration; the pI is where the curve crosses zero.">
            <CurvePlot spec={{ series: [{ name: `${sel.name} net charge`, color: '#0072B2', curve: curve.map((p) => ({ x: p.pH, y: p.charge })) }], xLabel: 'pH', yLabel: 'Net charge', vlines: [{ x: sel.props.pI, label: 'pI', color: '#D55E00' }], hlines: [0] }} height={300} exportName="charge-vs-ph" />
          </Card>
          <Card title="Residue composition" sub="Classes: hydrophobic AVILMFWC, polar uncharged STNQYGP, positive KR, negative DE; histidine is counted separately.">
            <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
              <Stat label="Hydrophobic" value={`${sel.props.composition.hydrophobic.count} (${(sel.props.composition.hydrophobic.fraction * 100).toFixed(0)} %)`} />
              <Stat label="Polar uncharged" value={`${sel.props.composition.polarUncharged.count} (${(sel.props.composition.polarUncharged.fraction * 100).toFixed(0)} %)`} />
              <Stat label="Positive" value={`${sel.props.composition.positive.count} (${(sel.props.composition.positive.fraction * 100).toFixed(0)} %)`} />
              <Stat label="Negative" value={`${sel.props.composition.negative.count} (${(sel.props.composition.negative.fraction * 100).toFixed(0)} %)`} />
              <Stat label="Histidine" value={`${sel.props.composition.histidine.count} (${(sel.props.composition.histidine.fraction * 100).toFixed(0)} %)`} />
            </div>
          </Card>
        </>}

        {tab === 'wheel' && <Card title="Helical wheel" sub="Residue n at angle n·δ (n from 0); the arrow points along the hydrophobic moment and its length is ⟨μH⟩.">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Periodicity"><select className="input" value={delta} onChange={(e) => setDelta(Number(e.target.value))}><option value={100}>α-helix (100°)</option><option value={160}>β-strand (160°)</option></select></Field>
            <Stat label="⟨μH⟩" value={fmt(delta === 100 ? sel.props.momentAlpha : sel.props.momentBeta, 3)} />
          </div>
          {wheelScene && <ScenePlot scene={wheelScene} build={(o) => buildHelicalWheel({ seq: sel.seq, delta }, o)} height={420} name="helical-wheel" defaults={{ title: `${sel.name} helical wheel` }} />}
        </Card>}

        {tab === 'fragments' && <>
          <Card title="Fragment ions" sub="b_i = residues 1…i + proton; y_i = residues n−i+1…n + water + proton; a_i = b_i − CO. m/z = (M + z·proton)/z.">
            <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {(['b', 'y', 'a'] as IonType[]).map((t) => <label key={t} className="row" style={{ gap: 5 }}><input type="checkbox" checked={types[t]} onChange={(e) => setTypes({ ...types, [t]: e.target.checked })} /> {t} ions</label>)}
              <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={charges.z1} onChange={(e) => setCharges({ ...charges, z1: e.target.checked })} /> 1+</label>
              <label className="row" style={{ gap: 5 }}><input type="checkbox" checked={charges.z2} onChange={(e) => setCharges({ ...charges, z2: e.target.checked })} /> 2+</label>
              <Field label="Modification position (optional)"><input className="input" type="number" min={1} max={sel.seq.length} value={modPos} onChange={(e) => setModPos(e.target.value)} style={{ width: 90 }} /></Field>
              <Field label="Mass shift (Da)"><input className="input" type="number" step="0.000001" value={modDelta} onChange={(e) => setModDelta(e.target.value)} style={{ width: 120 }} /></Field>
            </div>
            {ions.length === 0 && <Callout kind="warn">Select at least one ion type and charge.</Callout>}
            {ions.length > 0 && <DataTable
              rows={ions}
              rowKey={(i) => i.label}
              limit={400}
              cols={[
                { key: 'ion', label: 'Ion', render: (i) => i.label },
                { key: 'type', label: 'Type', render: (i) => i.type },
                { key: 'idx', label: 'Index', num: true, render: (i) => i.index },
                { key: 'z', label: 'z', num: true, render: (i) => i.z },
                { key: 'neutral', label: 'Neutral mass', num: true, render: (i) => fmt(i.neutralMass, 5) },
                { key: 'mz', label: 'm/z', num: true, render: (i) => fmt(i.mz, 5) },
                { key: 'h2o', label: '−H₂O', num: true, render: (i) => fmt(i.mzH2O, 5) },
                { key: 'nh3', label: '−NH₃', num: true, render: (i) => fmt(i.mzNH3, 5) },
              ]}
            />}
          </Card>
          <Card title="Mass list" sub="m/z values for the selected ion types and charges; download as a peak list.">
            <div className="stack" style={{ gap: 8 }}>
              <textarea className="input mono" rows={6} readOnly value={ions.map((i) => i.mz.toFixed(5)).join('\n')} />
              <div className="row" style={{ gap: 6 }}><button className="btn ghost" disabled={!ions.length} onClick={() => downloadText('peptide-fragments.txt', ions.map((i) => `${i.mz.toFixed(5)}\t${i.label}`).join('\n'))}>Download mass list</button></div>
            </div>
          </Card>
          <Card title="Match an observed spectrum" sub="Greedy nearest-peak matching within the ppm tolerance; coverage counts residues covered by matched b/y/a fragments.">
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field label="Tolerance (ppm)"><input className="input" type="number" min={1} max={100} value={tol} onChange={(e) => setTol(e.target.value)} style={{ width: 100 }} /></Field>
                <button className="btn" disabled={!peakList.length || !ions.length} onClick={() => setPeaks(peakList.join('\n'))}>Use current ion m/z as peaks</button>
              </div>
              <textarea className="input mono" rows={4} value={peaks} onChange={(e) => setPeaks(e.target.value)} placeholder="Paste observed m/z values (one per line or comma-separated)" />
              {match && <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
                <Stat label="Matched ions" value={`${match.matched.length} / ${match.matched.length + match.unmatchedIons.length}`} />
                <Stat label="Unmatched peaks" value={match.unmatchedPeaks.length} />
                <Stat label="Sequence coverage" value={`${(match.coverage * 100).toFixed(0)} %`} />
                <Stat label="Covered positions" value={match.coveredPositions.length ? match.coveredPositions.join(', ') : '–'} />
              </div>}
            </div>
          </Card>
        </>}

        {tab === 'cyclic' && <>
          <Card title="Cyclic and disulfide masses" sub="Head-to-tail cyclisation loses one water; each disulfide bond loses two hydrogens.">
            <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
              <Stat label="Linear neutral mass" value={`${fmt(linearMass(sel.seq), 4)} Da`} />
              <Stat label="Head-to-tail cyclic" value={`${fmt(cyclicMass(sel.seq), 4)} Da`} />
              <Stat label="Cysteines" value={cysCount} />
              {Array.from({ length: Math.min(cysCount, 8) }, (_, i) => i + 1).filter((n) => n <= Math.floor(cysCount / 2)).map((n) => <Stat key={n} label={`${n} disulfide bond${n > 1 ? 's' : ''}`} value={`${fmt(disulfideMass(sel.seq, n), 4)} Da`} />)}
              <Stat label="One bond shift" value={`−${fmt(DISULFIDE, 5)} Da`} />
            </div>
          </Card>
          <Card title="Cysteine pairings" sub="All (n−1)!! connectivities for up to 8 cysteines; an odd cysteine count leaves one unpaired.">
            {pairings.err && <Callout kind="warn">{pairings.err}</Callout>}
            {!pairings.err && cysCount === 0 && <div className="faint">This peptide has no cysteines.</div>}
            {!pairings.err && pairings.list.length > 0 && <DataTable
              rows={pairings.list}
              rowKey={(p) => p.label}
              limit={200}
              cols={[
                { key: 'label', label: 'Connectivity', render: (p) => p.label },
                { key: 'bonds', label: 'Bonds', num: true, render: (p) => p.bondsCount },
                { key: 'unpaired', label: 'Unpaired', num: true, render: (p) => (p.unpaired.length ? p.unpaired.map((x) => `C${x}`).join(', ') : '–') },
                { key: 'mass', label: 'Neutral mass (Da)', num: true, render: (p) => fmt(p.neutralMass, 4) },
              ]}
            />}
          </Card>
        </>}

        {tab === 'amp' && <>
          <Callout kind="warn">Heuristic screen from simple physicochemical rules; it is not trained or validated against activity data. Antimicrobial activity must be measured.</Callout>
          <Card title="AMP heuristic" sub={`Score = points / ${AMP_MAX_POINTS}, clipped to [0, 1]; the cysteine point applies to peptides with one or two cysteines.`}>
            <DataTable
              rows={amps}
              rowKey={(a) => a.row.seq}
              onRow={(a) => { setSelected(rows.indexOf(a.row)); }}
              cols={[
                { key: 'name', label: 'Name', render: (a) => a.row.name },
                { key: 'seq', label: 'Sequence', render: (a) => <span className="mono">{a.row.seq}</span> },
                { key: 'len', label: 'Length', num: true, render: (a) => a.amp.length },
                { key: 'q', label: 'Charge pH 7.4', num: true, render: (a) => fmt(a.amp.charge, 2) },
                { key: 'hyd', label: 'Hydrophobic %', num: true, render: (a) => fmt(a.amp.hydrophobicFraction * 100, 0) },
                { key: 'mu', label: '⟨μH⟩', num: true, render: (a) => fmt(a.amp.moment, 3) },
                { key: 'score', label: 'Score', num: true, render: (a) => <strong>{fmt(a.amp.score, 2)}</strong> },
              ]}
            />
          </Card>
          <Card title={`Why ${sel.name} scores ${fmt(ampScreen(sel.seq).score, 2)}`}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ampScreen(sel.seq).reasons.map((r) => <li key={r} className="mono" style={{ fontSize: 12, marginBottom: 4 }}>{r}</li>)}
            </ul>
          </Card>
        </>}
      </>}

      <Callout kind="warn">Masses are monoisotopic neutral masses plus z protons; no isotope envelope, ion mobility or fragmentation propensity is modelled. Charge and pI use a fixed pKa set and are approximate for highly structured or modified peptides.</Callout>
    </div>
  );
}
