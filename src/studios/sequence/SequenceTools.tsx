import { assetUrl } from '@/core/asset';
import { useNavigate } from 'react-router-dom';
import { useHandoff } from '@/core/handoff';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { BarChart, LineChart, cssVar } from '@/viz/charts';
import { Chromatogram, MultiLine, SeqLogo } from '@/viz/more';
import { buildAbif, compareToReference, parseAbif, simulateTrace, type ReadComparison, type Trace } from './abif';
import { cloneRestriction, designGibsonPrimers, gibsonAssemble, goldenGate, TYPE_IIS, type Assembly, type GibsonResult } from './cloning';
import { analyseProtein, DEFAULT_PRIMER_PARAMS, NUCLEASES, type Guide, type PrimerPair } from './design';
import { ENZYMES, findOrfs, proteinProps, toDNA, translate, type Alignment, type FastaRecord } from './kernels';
import { remote } from './remote';
import { rnd } from './demoSets';

const V = '0.2.0', ENG = 'TypeScript (clean-room implementations)';
const T = (id: string, name: string, describe: ToolInfo['describe'], citations: string[] = []): ToolInfo => ({ id, name, version: V, engine: ENG, citations, describe });
export const TOOLS2 = {
  primer: T('sequence.primer-design', 'Primer design', (p) => `PCR primer pairs were designed around a ${p.targetLen}-bp target with a Primer3-style penalty search (length ${p.minLen}–${p.maxLen} nt, Tm ${p.minTm}–${p.maxTm} °C by the SantaLucia nearest-neighbour model with Owczarzy salt correction, GC ${Math.round(Number(p.minGc) * 100)}–${Math.round(Number(p.maxGc) * 100)} %, GC clamp, self-complementarity and template-specificity checks)`, ['santalucia1998', 'owczarzy2008']),
  pcr: T('sequence.insilico-pcr', 'In-silico PCR', () => 'Amplification products were predicted by locating primer binding sites on both template strands (exact 3′ 10-mer, ≤1 mismatch elsewhere)'),
  clone: T('sequence.cloning', 'Restriction cloning simulation', (p) => `Cloning was simulated with ${p.enzymes}: fragments were modelled with explicit overhangs and ligated when overhang type and sequence were compatible, in both orientations`),
  gg: T('sequence.golden-gate', 'Golden Gate assembly', (p) => `A Golden Gate assembly with ${p.enzyme} was simulated by digesting each part, retaining site-free fragments and ordering them by matching 4-nt overhangs`, ['engler2008']),
  gibson: T('sequence.gibson', 'Gibson assembly', (p) => `Fragments were assembled by terminal overlaps of at least ${p.minOverlap} nt (either orientation)`, ['gibson2009']),
  crispr: T('sequence.crispr', 'CRISPR guide design', (p) => `${p.nuclease} guides were enumerated on both strands, ranked by a transparent rule-of-thumb score, and scanned for off-target sites with up to ${p.maxMm} mismatches against ${p.scanned} bp of background sequence; specificity used the MIT mismatch-weight scheme`, ['hsu2013']),
  sanger: T('sequence.sanger', 'Sanger trace analysis', (p) => `An ABIF trace was parsed, trimmed with Mott's algorithm (error cutoff ${p.cutoff}) and compared with a reference by local alignment on either strand`, ['ewing1998']),
  protein: T('sequence.protein', 'Protein sequence analysis', () => 'Hydropathy (Kyte–Doolittle, 19-residue window), disorder propensity (TOP-IDP scale, 21-residue window), putative transmembrane helices (windows above 1.6), charge versus pH and low-complexity regions were computed', ['kyte1982', 'campen2008']),
  motif: T('sequence.motif', 'Transcription-factor motif scan', (p) => `Sequences were scanned on both strands with JASPAR 2024 CORE position weight matrices (relative score ≥ ${p.minRel}); enrichment was compared with ${p.shuffles} mononucleotide-shuffled background copies`, ['jaspar2024']),
};

export const AlnView = ({ a }: { a: Alignment }) => {
  const W = 70, blocks: React.ReactNode[] = []; let ia = a.aStart, ib = a.bStart;
  for (let i = 0; i < a.a.length; i += W) { const A = a.a.slice(i, i + W), B = a.b.slice(i, i + W), M = a.mid.slice(i, i + W); blocks.push(<div key={i} style={{ whiteSpace: 'pre' }}><span className="faint">{String(ia).padStart(6)} </span>{A}{'\n'}<span className="faint">{' '.repeat(7)}</span><span style={{ color: 'var(--accent)' }}>{M}</span>{'\n'}<span className="faint">{String(ib).padStart(6)} </span>{B}{'\n\n'}</div>); ia += A.replace(/-/g, '').length; ib += B.replace(/-/g, '').length; }
  return <div className="seqbox" style={{ maxHeight: 420, whiteSpace: 'pre', wordBreak: 'normal' }}>{blocks}</div>;
};
const Chips = ({ names, picked, onChange }: { names: string[]; picked: string[]; onChange(v: string[]): void }) => <div className="row" style={{ gap: 5 }}>{names.map((n) => <button key={n} className={`btn sm ${picked.includes(n) ? 'primary' : ''}`} onClick={() => onChange(picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n])}>{n}</button>)}</div>;
const exportFasta = (name: string, seq: string) => downloadText(`${name}.fasta`, `>${name}\n${seq.replace(/(.{70})/g, '$1\n')}\n`);

// ---------------- Primer design ----------------
export function PrimerDesignPanel({ rec }: { rec: FastaRecord }) {
  const { run, busy, error } = useRunner(), n = rec.seq.length, nav = useNavigate(), setOligos = useHandoff((s) => s.setOligos);
  const [ts, setTs] = useState(Math.max(0, Math.floor(n / 2) - 50)), [tl, setTl] = useState(Math.min(100, Math.floor(n / 4))), [prod, setProd] = useState<[number, number]>([Math.min(150, n - 1), Math.min(600, n)]);
  const [tm, setTm] = useState<[number, number, number]>([57, 60, 63]), [gc, setGc] = useState<[number, number]>([40, 60]), [len, setLen] = useState<[number, number]>([18, 26]);
  const [res, setRes] = useState<Awaited<ReturnType<typeof remote.primers>> | null>(null), [sel, setSel] = useState(0);
  useEffect(() => { setRes(null); setTs(Math.max(0, Math.floor(n / 2) - 50)); setTl(Math.min(100, Math.floor(n / 4))); }, [rec.id, n]);
  const params = { ...DEFAULT_PRIMER_PARAMS, minProduct: prod[0], maxProduct: prod[1], minTm: tm[0], optTm: tm[1], maxTm: tm[2], minGc: gc[0] / 100, maxGc: gc[1] / 100, minLen: len[0], maxLen: len[1], optLen: Math.round((len[0] + len[1]) / 2) };
  const go = () => void run({ label: `Primer design · ${rec.id}`, tool: TOOLS2.primer, params: { ...params, targetLen: tl }, inputs: [{ name: rec.id, data: rec.seq }], run: (h) => remote.primers({ template: toDNA(rec.seq), target: { start: ts, len: tl }, params, excluded: [] }, h) }).then((r) => { if (r) { setRes(r); setSel(0); } });
  const p = res?.pairs[sel];
  return (
    <>
      <Card title="Primer design" sub="Primer3-style penalty search, clean-room implementation" actions={<button className="btn primary sm" disabled={busy} onClick={go}>Design primers</button>}>
        <div className="cols-4" style={{ gap: 10 }}>
          <Field label="Target start (0-based)"><input className="input" type="number" min={0} max={n} value={ts} onChange={(e) => setTs(+e.target.value)} /></Field><Field label="Target length"><input className="input" type="number" min={1} value={tl} onChange={(e) => setTl(+e.target.value)} /></Field>
          <Field label="Product min"><input className="input" type="number" value={prod[0]} onChange={(e) => setProd([+e.target.value, prod[1]])} /></Field><Field label="Product max"><input className="input" type="number" value={prod[1]} onChange={(e) => setProd([prod[0], +e.target.value])} /></Field>
          <Field label="Tm min / opt / max °C"><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>{[0, 1, 2].map((i) => <input key={i} className="input" type="number" value={tm[i]} onChange={(e) => { const t = [...tm] as typeof tm; t[i] = +e.target.value; setTm(t); }} />)}</div></Field>
          <Field label="GC % min / max"><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input className="input" type="number" value={gc[0]} onChange={(e) => setGc([+e.target.value, gc[1]])} /><input className="input" type="number" value={gc[1]} onChange={(e) => setGc([gc[0], +e.target.value])} /></div></Field>
          <Field label="Primer length min / max"><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input className="input" type="number" value={len[0]} onChange={(e) => setLen([+e.target.value, len[1]])} /><input className="input" type="number" value={len[1]} onChange={(e) => setLen([len[0], +e.target.value])} /></div></Field>
        </div>
        {busy && <div style={{ marginTop: 10 }}><Busy progress={0.4} note="Searching candidates…" /></div>}{error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
        <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>Tm: SantaLucia 1998 nearest-neighbour + Owczarzy salt correction (50 mM Na⁺, 1.5 mM Mg²⁺, 250 nM oligo). Confirm with your supplier's tool before ordering.</div>
      </Card>
      {res && <>
        <div className="cols-4"><Stat label="Pairs found" value={res.pairs.length} /><Stat label="Left candidates" value={res.leftCandidates} /><Stat label="Right candidates" value={res.rightCandidates} /><Stat label="Best penalty" value={fmt(res.pairs[0].penalty, 2)} /></div>
        <Card title="Primer pairs" sub="lower penalty = better" pad={false} actions={<><button className="btn sm" title="Search a bundled genome or your own FASTA for binding sites and off-target products" onClick={() => { setOligos({ primers: res.pairs.slice(0, 4).flatMap((q, i) => [{ name: `P${i + 1}_F`, seq: q.left.seq }, { name: `P${i + 1}_R`, seq: q.right.seq }]), guides: [], label: `${rec.id} primers` }); nav('/genome'); }}>Check specificity</button><button className="btn sm" onClick={() => downloadText('primers.csv', toCsv(res.pairs.flatMap((q, i) => [{ pair: i + 1, role: 'forward', seq: q.left.seq, start: q.left.start + 1, tm: q.left.tm.toFixed(1), gc: (q.left.gc * 100).toFixed(0), product: q.product }, { pair: i + 1, role: 'reverse', seq: q.right.seq, start: q.right.end, tm: q.right.tm.toFixed(1), gc: (q.right.gc * 100).toFixed(0), product: q.product }])), 'text/csv')}>CSV</button></>}>
          <DataTable<PrimerPair> rows={res.pairs} rowKey={(_, i) => String(i)} onRow={(r) => setSel(res.pairs.indexOf(r))} cols={[{ key: 'i', label: '#', render: (r) => res.pairs.indexOf(r) + 1 }, { key: 'f', label: 'Forward 5′→3′', render: (r) => <code>{r.left.seq}</code> }, { key: 'r', label: 'Reverse 5′→3′', render: (r) => <code>{r.right.seq}</code> }, { key: 'tm', label: 'Tm F/R', num: true, render: (r) => `${fmt(r.left.tm, 1)} / ${fmt(r.right.tm, 1)}` }, { key: 'gc', label: 'GC %', num: true, render: (r) => `${fmt(r.left.gc * 100, 0)} / ${fmt(r.right.gc * 100, 0)}` }, { key: 'p', label: 'Product', num: true, sort: (r) => r.product, render: (r) => `${r.product} bp` }, { key: 'pen', label: 'Penalty', num: true, sort: (r) => r.penalty, render: (r) => fmt(r.penalty, 2) }, { key: 'w', label: 'Checks', render: (r) => (r.warnings.length ? <span className="badge building" title={r.warnings.join('; ')}>{r.warnings.length} warning{r.warnings.length > 1 ? 's' : ''}</span> : <span className="badge live">ok</span>) }]} />
        </Card>
        {p && <Card title={`Pair ${sel + 1} on the template`} sub={`${rec.id} · ${n.toLocaleString()} bp`}>
          <div style={{ position: 'relative', height: 74, margin: '6px 0 14px' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 34, height: 6, background: 'var(--border-hi)', borderRadius: 3 }} />
            <div title="target" style={{ position: 'absolute', left: `${(ts / n) * 100}%`, width: `${(tl / n) * 100}%`, top: 30, height: 14, background: 'rgba(251,191,36,.35)', border: '1px solid var(--warn)', borderRadius: 4 }} />
            <div title="product" style={{ position: 'absolute', left: `${(p.left.start / n) * 100}%`, width: `${(p.product / n) * 100}%`, top: 50, height: 6, background: 'var(--accent)', opacity: 0.55, borderRadius: 3 }} />
            <div title={p.left.seq} style={{ position: 'absolute', left: `${(p.left.start / n) * 100}%`, width: `${Math.max(1.2, (p.left.len / n) * 100)}%`, top: 10, height: 12, background: 'var(--accent-3)', clipPath: 'polygon(0 0, 82% 0, 100% 50%, 82% 100%, 0 100%)' }} />
            <div title={p.right.seq} style={{ position: 'absolute', left: `${(p.right.start / n) * 100}%`, width: `${Math.max(1.2, (p.right.len / n) * 100)}%`, top: 10, height: 12, background: 'var(--chart-b)', clipPath: 'polygon(18% 0, 100% 0, 100% 100%, 18% 100%, 0 50%)' }} />
          </div>
          <div className="cols-4"><Stat label="Product" value={`${p.product} bp`} /><Stat label="Product Tm" value={`${fmt(p.productTm, 1)} °C`} hint="GC-content estimate" /><Stat label="Pair Tm diff" value={`${fmt(Math.abs(p.left.tm - p.right.tm), 1)} °C`} /><Stat label="Extra binding sites" value={p.extraSites} /></div>
          {p.warnings.length > 0 && <div style={{ marginTop: 10 }}><Callout kind="warn">{p.warnings.join(' · ')}</Callout></div>}
          <PcrCheck rec={rec} fwd={p.left.seq} rev={p.right.seq} />
        </Card>}
      </>}
    </>
  );
}
function PcrCheck({ rec, fwd, rev }: { rec: FastaRecord; fwd: string; rev: string }) {
  const { run, error } = useRunner(); const [res, setRes] = useState<Awaited<ReturnType<typeof remote.pcr>> | null>(null);
  useEffect(() => { void run({ label: 'In-silico PCR', tool: TOOLS2.pcr, params: {}, inputs: [{ name: rec.id, data: rec.seq }, { name: 'primers', data: fwd + rev }], run: () => remote.pcr({ fwd, rev, template: toDNA(rec.seq) }) }).then((r) => r && setRes(r)); }, [rec, fwd, rev, run]);
  return <div style={{ marginTop: 12 }}>{error && <Callout kind="err">{error}</Callout>}{res && <Callout kind={res.length === 1 ? undefined : 'warn'}>In-silico PCR: <b style={{ color: 'var(--text)' }}>{res.length} product{res.length === 1 ? '' : 's'}</b>{res.map((r) => ` · ${r.size} bp at ${r.start + 1}–${r.end}`).join('')}{res.length === 1 ? ' (specific on this template)' : ''}</Callout>}</div>;
}

// ---------------- Cloning ----------------
type CloneTab = 'restriction' | 'golden' | 'gibson';
export function CloningPanel({ records }: { records: FastaRecord[] }) {
  const [tab, setTab] = useState<CloneTab>('restriction');
  return (<>
    <Tabs<CloneTab> value={tab} onChange={setTab} items={[{ id: 'restriction', label: 'Restriction cloning' }, { id: 'golden', label: 'Golden Gate' }, { id: 'gibson', label: 'Gibson / HiFi' }]} />
    {records.length < 2 ? <Callout>Cloning needs at least two records (e.g. vector and insert). Use the demo buttons on the left, or paste a multi-FASTA.</Callout> : tab === 'restriction' ? <Restriction records={records} /> : tab === 'golden' ? <GoldenGatePanel records={records} /> : <GibsonPanel records={records} />}
  </>);
}
function Restriction({ records }: { records: FastaRecord[] }) {
  const { run, error } = useRunner(); const [vi, setVi] = useState(0), [ii, setIi] = useState(1), [vc, setVc] = useState(true), [ic, setIc] = useState(false), [vEnz, setVEnz] = useState<string[]>(['EcoRI', 'BamHI']), [same, setSame] = useState(true), [iEnz, setIEnz] = useState<string[]>(['EcoRI', 'BamHI']);
  const [res, setRes] = useState<ReturnType<typeof cloneRestriction> | null>(null), [err, setErr] = useState('');
  const go = () => { setErr(''); const ie = same ? vEnz : iEnz; void run({ label: `Restriction cloning · ${vEnz.join('+')}`, tool: TOOLS2.clone, params: { enzymes: [...new Set([...vEnz, ...ie])].join(', ') }, inputs: [{ name: 'vector', data: records[vi].seq }, { name: 'insert', data: records[ii].seq }], run: async () => cloneRestriction(records[vi].seq, vc, vEnz, records[ii].seq, ic, ie) }).then((r) => { if (r) setRes(r); else setRes(null); }); };
  useEffect(() => { if (error) setErr(error); }, [error]);
  const names = ENZYMES.map((e) => e.name);
  return (<>
    <Card title="Restriction cloning" sub="directional or single-enzyme, sticky or blunt" actions={<button className="btn primary sm" onClick={go}>Simulate</button>}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Vector"><select className="select" value={vi} onChange={(e) => setVi(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id} ({r.seq.length} bp)</option>)}</select></Field><label className="row dim" style={{ fontSize: 12.5 }}><input type="checkbox" checked={vc} onChange={(e) => setVc(e.target.checked)} /> circular</label><Field label="Insert"><select className="select" value={ii} onChange={(e) => setIi(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id} ({r.seq.length} bp)</option>)}</select></Field><label className="row dim" style={{ fontSize: 12.5 }}><input type="checkbox" checked={ic} onChange={(e) => setIc(e.target.checked)} /> circular</label></div>
        <div><div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Enzymes for the vector (hover for site and overhang)</div><Chips names={names} picked={vEnz} onChange={setVEnz} /></div>
        <label className="row dim" style={{ fontSize: 12.5 }}><input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} /> cut the insert with the same enzymes</label>
        {!same && <div><div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>Enzymes for the insert</div><Chips names={names} picked={iEnz} onChange={setIEnz} /></div>}
        {err && <Callout kind="err">{err}</Callout>}
      </div>
    </Card>
    {res && <><div className="cols-2"><Card title="Vector fragments" pad={false}><DataTable rows={res.vectorFragments} rowKey={(_, i) => String(i)} cols={[{ key: 'i', label: '#', render: (r) => res.vectorFragments.indexOf(r) + 1 }, { key: 'len', label: 'Core (bp)', num: true, render: (r) => r.core.length }, { key: 'l', label: 'Left end', render: (r) => (r.left.native ? 'native' : `${r.left.type}′ ${r.left.ov || 'blunt'}`) }, { key: 'r', label: 'Right end', render: (r) => (r.right.native ? 'native' : `${r.right.type}′ ${r.right.ov || 'blunt'}`) }, { key: 'u', label: '', render: (r) => (res.vectorFragments.indexOf(r) === res.backbone ? <span className="badge live">backbone</span> : '') }]} /></Card>
      <Card title="Insert fragments" pad={false}><DataTable rows={res.insertFragments} rowKey={(_, i) => String(i)} cols={[{ key: 'i', label: '#', render: (r) => res.insertFragments.indexOf(r) + 1 }, { key: 'len', label: 'Core (bp)', num: true, render: (r) => r.core.length }, { key: 'l', label: 'Left end', render: (r) => (r.left.native ? 'native' : `${r.left.type}′ ${r.left.ov || 'blunt'}`) }, { key: 'r', label: 'Right end', render: (r) => (r.right.native ? 'native' : `${r.right.type}′ ${r.right.ov || 'blunt'}`) }, { key: 'u', label: '', render: (r) => (res.insertFragments.indexOf(r) === res.insertIdx ? <span className="badge live">insert</span> : '') }]} /></Card></div>
      {res.products.map((p, i) => <Card key={i} title={`Product ${i + 1}`} sub={`${p.orientation} orientation · ${p.length.toLocaleString()} bp circular`} actions={<button className="btn sm" onClick={() => exportFasta(`clone_product_${p.orientation}`, p.sequence)}>Export FASTA</button>}>
        <div className="stack" style={{ gap: 8 }}>{p.junctions.map((j) => <div key={j.label} className="row"><span className="faint" style={{ width: 120, fontSize: 12 }}>{j.label}</span><code>{j.context}</code></div>)}{p.regeneratedSites.length > 0 && <div className="dim" style={{ fontSize: 12.5 }}>Recognition sites regenerated: {p.regeneratedSites.join(', ')}</div>}{p.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}</div></Card>)}</>}
  </>);
}
function GoldenGatePanel({ records }: { records: FastaRecord[] }) {
  const { run } = useRunner(); const [enz, setEnz] = useState('BsaI'), [pick, setPick] = useState<Record<number, boolean>>(() => Object.fromEntries(records.map((_, i) => [i, true]))), [circ, setCirc] = useState<Record<number, boolean>>({}), [res, setRes] = useState<Assembly | null>(null), [err, setErr] = useState('');
  const go = () => { setErr(''); setRes(null); const parts = records.map((r, i) => ({ r, i })).filter((x) => pick[x.i]).map(({ r, i }) => ({ name: r.id, seq: r.seq, circular: !!circ[i] })); void run({ label: `Golden Gate · ${enz}`, tool: TOOLS2.gg, params: { enzyme: enz }, inputs: parts.map((p) => ({ name: p.name, data: p.seq })), run: async () => goldenGate(parts, enz) }).then((r) => { if (r) setRes(r); }).catch((e) => setErr((e as Error).message)); };
  return (<>
    <Card title="Golden Gate assembly" sub="Type IIS digest + overhang ordering" actions={<button className="btn primary sm" onClick={go}>Assemble</button>}>
      <div className="stack" style={{ gap: 10 }}><div className="row"><Field label="Enzyme"><select className="select" value={enz} onChange={(e) => setEnz(e.target.value)}>{TYPE_IIS.map((e) => <option key={e.name} value={e.name}>{e.name} ({e.site})</option>)}</select></Field></div>
        <div className="faint" style={{ fontSize: 12 }}>The first checked record fixes the starting point; parts are ordered by matching 4-nt overhangs and the ring must close.</div>
        {records.map((r, i) => <div key={i} className="row" style={{ gap: 12 }}><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick({ ...pick, [i]: e.target.checked })} /> <b>{r.id}</b> <span className="faint">{r.seq.length} bp</span></label><label className="row dim" style={{ fontSize: 12 }}><input type="checkbox" checked={!!circ[i]} onChange={(e) => setCirc({ ...circ, [i]: e.target.checked })} /> circular</label></div>)}
        {err && <Callout kind="err">{err}</Callout>}</div>
    </Card>
    {res && <Card title="Assembled product" sub={`${res.length.toLocaleString()} bp, circular`} actions={<button className="btn sm" onClick={() => exportFasta('golden_gate_product', res.sequence)}>Export FASTA</button>}><DataTable rows={res.order} rowKey={(r) => r.name} cols={[{ key: 'name', label: 'Order → part' }, { key: 'l', label: 'Left overhang', render: (r) => <code>{r.leftOv}</code> }, { key: 'r', label: 'Right overhang', render: (r) => <code>{r.rightOv}</code> }, { key: 'f', label: 'Orientation', render: (r) => (r.flipped ? 'reverse' : 'forward') }, { key: 'n', label: 'Contribution', num: true, render: (r) => `${r.length} bp` }]} />{res.warnings.map((w) => <div key={w} style={{ marginTop: 8 }}><Callout kind="warn">{w}</Callout></div>)}</Card>}
  </>);
}
function GibsonPanel({ records }: { records: FastaRecord[] }) {
  const { run } = useRunner(); const [pick, setPick] = useState<Record<number, boolean>>(() => Object.fromEntries(records.map((_, i) => [i, true]))), [circular, setCircular] = useState(true), [minOv, setMinOv] = useState(15), [res, setRes] = useState<GibsonResult | null>(null), [err, setErr] = useState('');
  const [vi, setVi] = useState(0), [ii, setIi] = useState(Math.min(1, records.length - 1)), [pos, setPos] = useState(Math.floor(records[0].seq.length / 2)), [ov, setOv] = useState(25), [pr, setPr] = useState<ReturnType<typeof designGibsonPrimers> | null>(null), [perr, setPerr] = useState('');
  const go = () => { setErr(''); setRes(null); const fr = records.filter((_, i) => pick[i]).map((r) => ({ name: r.id, seq: r.seq })); void run({ label: 'Gibson assembly', tool: TOOLS2.gibson, params: { minOverlap: minOv }, inputs: fr.map((f) => ({ name: f.name, data: f.seq })), run: async () => gibsonAssemble(fr, circular, minOv) }).then((r) => { if (r) setRes(r); }).catch((e) => setErr((e as Error).message)); };
  const design = () => { setPerr(''); try { setPr(designGibsonPrimers(records[vi].seq, pos, records[ii].seq, ov)); } catch (e) { setPr(null); setPerr((e as Error).message); } };
  return (<>
    <Card title="Assemble fragments by overlap" sub="order and orientation found automatically" actions={<button className="btn primary sm" onClick={go}>Assemble</button>}>
      <div className="stack" style={{ gap: 10 }}>{records.map((r, i) => <label key={i} className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick({ ...pick, [i]: e.target.checked })} /> <b>{r.id}</b> <span className="faint">{r.seq.length} bp</span></label>)}
        <div className="row"><label className="row dim" style={{ fontSize: 12.5 }}><input type="checkbox" checked={circular} onChange={(e) => setCircular(e.target.checked)} /> closed circle</label><Field label="Min overlap (nt)"><input className="input" type="number" value={minOv} onChange={(e) => setMinOv(+e.target.value)} style={{ width: 90 }} /></Field></div>{err && <Callout kind="err">{err}</Callout>}</div>
    </Card>
    {res && <Card title="Assembly" sub={`${res.sequence.length.toLocaleString()} bp ${res.circular ? 'circular' : 'linear'}`} actions={<button className="btn sm" onClick={() => exportFasta('gibson_product', res.sequence)}>Export FASTA</button>}><div className="row dim" style={{ marginBottom: 8 }}>{res.order.map((o, i) => <span key={i} className="badge live">{o.name}{o.flipped ? ' (reverse)' : ''}</span>)}</div><DataTable rows={res.junctions} rowKey={(j) => j.from + j.to} cols={[{ key: 'from', label: 'Junction', render: (j) => `${j.from} → ${j.to}` }, { key: 'ov', label: 'Overlap', num: true, render: (j) => `${j.overlap} nt` }, { key: 'tm', label: 'Tm', num: true, render: (j) => `${fmt(j.tm, 1)} °C` }, { key: 'gc', label: 'GC', num: true, render: (j) => `${fmt(j.gc * 100, 0)} %` }, { key: 'w', label: 'Checks', render: (j) => (j.warnings.length ? <span className="badge building">{j.warnings.join(', ')}</span> : <span className="badge live">ok</span>) }]} /></Card>}
    <Card title="Design Gibson primers" sub="amplify the insert with vector-homologous tails" actions={<button className="btn primary sm" onClick={design}>Design</button>}>
      <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Vector"><select className="select" value={vi} onChange={(e) => setVi(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id}</option>)}</select></Field><Field label="Insertion point (after base)"><input className="input" type="number" value={pos} onChange={(e) => setPos(+e.target.value)} style={{ width: 130 }} /></Field><Field label="Insert"><select className="select" value={ii} onChange={(e) => setIi(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id}</option>)}</select></Field><Field label="Overlap (nt)"><input className="input" type="number" value={ov} onChange={(e) => setOv(+e.target.value)} style={{ width: 90 }} /></Field></div>
      {perr && <div style={{ marginTop: 10 }}><Callout kind="err">{perr}</Callout></div>}
      {pr && <div className="stack" style={{ gap: 8, marginTop: 12 }}>{(['fwd', 'rev'] as const).map((k) => <div key={k}><div className="faint" style={{ fontSize: 12 }}>{k === 'fwd' ? 'Forward' : 'Reverse'} primer · anneal Tm {fmt(pr[k].tm, 1)} °C</div><div className="seqbox" style={{ maxHeight: 'none' }}><span style={{ color: 'var(--chart-d)' }}>{pr[k].tail}</span><span style={{ color: 'var(--accent)' }}>{pr[k].anneal}</span></div></div>)}<div className="faint" style={{ fontSize: 12 }}>Yellow = homology tail to the vector, cyan = annealing region on the insert. Linearise the vector at the insertion point (restriction digest or inverse PCR). Resulting construct: {pr.length.toLocaleString()} bp.</div><button className="btn sm" onClick={() => downloadText('gibson_primers.csv', toCsv([{ name: 'Fwd', seq: pr.fwd.seq }, { name: 'Rev', seq: pr.rev.seq }]), 'text/csv')}>Export CSV</button></div>}
    </Card>
  </>);
}

// ---------------- CRISPR ----------------
export function CrisprPanel({ records, rec }: { records: FastaRecord[]; rec: FastaRecord }) {
  const { run, busy, progress, note, error } = useRunner(), nav = useNavigate(), setOligos = useHandoff((s) => s.setOligos); const [nuc, setNuc] = useState('spcas9'), [bg, setBg] = useState<'self' | 'others'>('self'), [maxMm, setMaxMm] = useState(3), [top, setTop] = useState(30), [res, setRes] = useState<Awaited<ReturnType<typeof remote.crispr>> | null>(null), [sel, setSel] = useState<Guide | null>(null);
  const others = records.filter((r) => r !== rec);
  const go = () => { const genome: [string, string][] = bg === 'others' && others.length ? others.map((r) => [r.id, toDNA(r.seq)] as [string, string]).concat([[rec.id, toDNA(rec.seq)]]) : []; void run({ label: `CRISPR · ${nuc}`, tool: TOOLS2.crispr, params: { nuclease: NUCLEASES.find((n) => n.id === nuc)!.name, maxMm, scanned: (genome.length ? genome.reduce((a, g) => a + g[1].length, 0) : rec.seq.length).toLocaleString() }, inputs: [{ name: rec.id, data: rec.seq }], run: (h) => remote.crispr({ seq: toDNA(rec.seq), nucleaseId: nuc, genome, maxMm, top }, h) }).then((r) => { if (r) { setRes(r); setSel(r.guides[0] ?? null); } }); };
  return (<>
    <Card title="CRISPR guide design" sub="enumeration, rule-based score, off-target scan" actions={<button className="btn primary sm" disabled={busy} onClick={go}>Find guides</button>}>
      <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Nuclease"><select className="select" value={nuc} onChange={(e) => setNuc(e.target.value)}>{NUCLEASES.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></Field><Field label="Off-target background"><select className="select" value={bg} onChange={(e) => setBg(e.target.value as 'self' | 'others')}><option value="self">this sequence only</option><option value="others" disabled={!others.length}>this + all other records (as genome)</option></select></Field><Field label="Max mismatches"><select className="select" value={maxMm} onChange={(e) => setMaxMm(+e.target.value)}>{[1, 2, 3].map((v) => <option key={v}>{v}</option>)}</select></Field><Field label="Scan best N guides"><input className="input" type="number" min={5} max={100} value={top} onChange={(e) => setTop(+e.target.value)} style={{ width: 90 }} /></Field></div>
      {busy && <div style={{ marginTop: 10 }}><Busy progress={progress} note={note} /></div>}{error && <div style={{ marginTop: 10 }}><Callout kind="err">{error}</Callout></div>}
      <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>The score is a transparent rule of thumb (GC window, TTTT terminator, homopolymers, PAM-proximal base), not a trained model. Specificity uses the MIT mismatch-position weights (Hsu et al. 2013) against the supplied background: for a whole genome, run a dedicated off-target tool (Cas-OFFinder) on a server.</div>
    </Card>
    {res && <><div className="cols-4"><Stat label="Guides found" value={res.total} /><Stat label="Scanned" value={res.guides.length} /><Stat label="Background (bp)" value={res.scanned.toLocaleString()} /><Stat label="Best specificity" value={`${fmt(Math.max(...res.guides.map((g) => g.offTargets?.specificity ?? 0)) * 100 / 100, 2)}`} hint="1.0 = no off-targets found" /></div>
      <Card title="Ranked guides" pad={false} actions={<><button className="btn sm" title="Genome-wide off-target search with CFD and MIT scores" onClick={() => { setOligos({ primers: [], guides: res.guides.slice(0, 8).map((g, i) => ({ name: `g${i + 1}_${g.start + 1}${g.strand}`, seq: g.seq })), label: `${rec.id} guides` }); nav('/genome'); }}>Genome-wide off-targets</button><button className="btn sm" onClick={() => downloadText('guides.csv', toCsv(res.guides.map((g) => ({ guide: g.seq, pam: g.pamSeq, start: g.start + 1, strand: g.strand, gc: (g.gc * 100).toFixed(0), rule_score: g.score.toFixed(0), exact_matches: g.offTargets?.mm0, mm1: g.offTargets?.mm1, mm2: g.offTargets?.mm2, mm3: g.offTargets?.mm3, specificity: g.offTargets?.specificity.toFixed(3) }))), 'text/csv')}>CSV</button></>}>
        <DataTable<Guide> rows={res.guides} rowKey={(g) => g.seq + g.start + g.strand} onRow={setSel} cols={[{ key: 'seq', label: 'Guide (5′→3′)', render: (g) => <code>{g.seq}<span style={{ color: 'var(--chart-d)' }}> {g.pamSeq}</span></code> }, { key: 'pos', label: 'Position', num: true, sort: (g) => g.start, render: (g) => `${g.start + 1}${g.strand}` }, { key: 'gc', label: 'GC %', num: true, render: (g) => fmt(g.gc * 100, 0), sort: (g) => g.gc }, { key: 'score', label: 'Rule score', num: true, sort: (g) => g.score, render: (g) => fmt(g.score, 0) }, { key: 'ot', label: 'Off-targets 0/1/2/3 mm', num: true, render: (g) => (g.offTargets ? `${g.offTargets.mm0} / ${g.offTargets.mm1} / ${g.offTargets.mm2} / ${g.offTargets.mm3}` : '–') }, { key: 'spec', label: 'Specificity', num: true, sort: (g) => g.offTargets?.specificity ?? 0, render: (g) => fmt(g.offTargets?.specificity ?? 0, 2) }, { key: 'f', label: 'Flags', render: (g) => (g.flags.length ? <span className="badge building">{g.flags.join(', ')}</span> : <span className="badge live">ok</span>) }]} />
      </Card>
      {sel?.offTargets && sel.offTargets.top.length > 0 && <Card title={`Off-target sites for ${sel.seq}`} pad={false}><DataTable rows={sel.offTargets.top} rowKey={(o) => o.contig + o.pos + o.strand} cols={[{ key: 'c', label: 'Contig', render: (o) => o.contig }, { key: 'p', label: 'Position', num: true, render: (o) => `${o.pos + 1}${o.strand}` }, { key: 'm', label: 'Mismatches', num: true, render: (o) => o.mm }, { key: 's', label: 'Site', render: (o) => <code>{[...o.seq].map((ch, i) => (ch !== sel.seq[i] ? `[${ch}]` : ch)).join('')}</code> }]} /></Card>}</>}
  </>);
}

// ---------------- Sanger ----------------
export function SangerPanel({ records }: { records: FastaRecord[] }) {
  const { run, error } = useRunner(); const [trace, setTrace] = useState<Trace | null>(null), [refIdx, setRefIdx] = useState(0), [refText, setRefText] = useState(''), [cutoff, setCutoff] = useState(0.05), [cmp, setCmp] = useState<ReadComparison | null>(null), [err, setErr] = useState(''), [zoom, setZoom] = useState(1.8), [name, setName] = useState('');
  const ref = refText.trim() ? refText.replace(/[^ACGTacgt]/g, '').toUpperCase() : records[refIdx]?.seq ?? '';
  const load = async (buf: ArrayBuffer, label: string) => { try { setErr(''); setTrace(parseAbif(buf)); setName(label); setCmp(null); } catch (e) { setTrace(null); setErr((e as Error).message); } };
  const demo = () => { const r = rnd(7, 700, true), read = r.slice(120, 520).split(''); read[200] = read[200] === 'A' ? 'G' : 'A'; const t = simulateTrace(read.join(''), 9); setTrace(parseAbif(buildAbif(t))); setName('simulated_read.ab1 (synthetic)'); setRefText(r); setCmp(null); setErr(''); };
  const analyse = () => trace && void run({ label: 'Sanger comparison', tool: TOOLS2.sanger, params: { cutoff }, inputs: [{ name: name, data: trace.bases }, { name: 'reference', data: ref }], run: async () => compareToReference(trace, ref, cutoff) }).then((r) => r && setCmp(r));
  useEffect(() => { if (error) setErr(error); }, [error]);
  const trim = trace ? ((): { start: number; end: number } | undefined => { try { return cmp?.trim; } catch { return undefined; } })() : undefined;
  const q = trace?.quals ?? [], q20 = q.filter((x) => x >= 20).length / (q.length || 1), q30 = q.filter((x) => x >= 30).length / (q.length || 1);
  return (<>
    <Card title="Sanger trace (.ab1)" sub="parsed locally, never uploaded" actions={<button className="btn sm" onClick={demo}>Simulated demo trace</button>}>
      <div className="stack" style={{ gap: 10 }}>
        <label className="dropzone"><input type="file" hidden accept=".ab1,.abi,.abif" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await load(await f.arrayBuffer(), f.name); }} />Choose an ABI trace file (.ab1)</label>
        {err && <Callout kind="err">{err}</Callout>}
        {trace && <div className="cols-4"><Stat label="Sample" value={<span style={{ fontSize: 15 }}>{trace.sample || name}</span>} /><Stat label="Bases called" value={trace.bases.length} /><Stat label="≥ Q20 / ≥ Q30" value={`${fmt(q20 * 100, 0)}% / ${fmt(q30 * 100, 0)}%`} /><Stat label="Channel order" value={trace.order} /></div>}
      </div>
    </Card>
    {trace && <>
      <Card title="Chromatogram" sub="bars: base quality (green ≥ Q30, amber ≥ Q20, red < Q20). Shaded = trimmed" actions={<label className="row dim" style={{ fontSize: 12 }}>zoom <input type="range" min={0.8} max={4} step={0.2} value={zoom} onChange={(e) => setZoom(+e.target.value)} /></label>}><Chromatogram channels={trace.channels} order={trace.order} bases={trace.bases} peaks={trace.peaks} quals={trace.quals} trim={trim} pxPerSample={zoom} /></Card>
      <Card title="Compare with a reference" actions={<button className="btn primary sm" onClick={analyse} disabled={!ref}>Trim & compare</button>}>
        <div className="row" style={{ alignItems: 'flex-end' }}>{records.length > 0 && <Field label="Reference record"><select className="select" value={refIdx} onChange={(e) => { setRefIdx(+e.target.value); setRefText(''); }}>{records.map((r, i) => <option key={i} value={i}>{r.id} ({r.seq.length} bp)</option>)}</select></Field>}<Field label="Mott error cutoff"><select className="select" value={cutoff} onChange={(e) => setCutoff(+e.target.value)}>{[0.1, 0.05, 0.01, 0.001].map((v) => <option key={v}>{v}</option>)}</select></Field></div>
        {refText && <div className="faint mono" style={{ fontSize: 11, marginTop: 8 }}>Using the {refText.length} bp reference that came with the demo.</div>}{!ref && <div style={{ marginTop: 8 }}><Callout>Paste or load a reference sequence in the input panel (as a record), then compare.</Callout></div>}
      </Card>
      {cmp && <><div className="cols-4"><Stat label="Trimmed read" value={`${cmp.trimmed.length} nt`} hint={`bases ${cmp.trim.start + 1}–${cmp.trim.end}`} /><Stat label="Strand" value={cmp.strand === '+' ? 'forward' : 'reverse'} /><Stat label="Identity" value={`${fmt(cmp.identity * 100, 2)}%`} /><Stat label="Substitutions" value={cmp.mismatches.length} /></div>
        <Card title="Differences from the reference" pad={false}>{cmp.mismatches.length ? <DataTable rows={cmp.mismatches} rowKey={(m) => String(m.refPos)} cols={[{ key: 'refPos', label: 'Ref position', num: true }, { key: 'ref', label: 'Reference' }, { key: 'read', label: 'Read' }, { key: 'readPos', label: 'Read position', num: true }, { key: 'qual', label: 'Quality', num: true, render: (m) => <span style={{ color: m.qual >= 30 ? 'var(--accent-3)' : m.qual >= 20 ? 'var(--warn)' : 'var(--danger)' }}>Q{m.qual}</span> }, { key: 'call', label: 'Confidence', render: (m) => <span className={`badge ${m.qual >= 30 ? 'live' : 'building'}`}>{m.qual >= 30 ? 'confirm by peak' : 'low quality: verify'}</span> }]} /> : <div className="faint" style={{ padding: 16 }}>No substitutions in the aligned region.</div>}</Card>
        {cmp.alignment && <Card title="Alignment" sub={`reference ${cmp.refStart}–${cmp.refEnd}`}><AlnView a={cmp.alignment} /></Card>}</>}
    </>}
  </>);
}

// ---------------- Protein ----------------
export function ProteinPanel({ rec, dna, isProtein }: { rec: FastaRecord; dna: string; isProtein: boolean }) {
  const orfs = useMemo(() => (isProtein ? [] : findOrfs(dna, 30).filter((o) => o.strand === 1).slice(0, 8)), [dna, isProtein]), [oi, setOi] = useState(0);
  const prot = isProtein ? rec.seq : orfs[oi]?.protein ?? translate(dna, 0, true);
  const { run, error } = useRunner(); const [a, setA] = useState<ReturnType<typeof analyseProtein> | null>(null);
  useEffect(() => { setA(null); if (prot.length >= 10) void run({ label: 'Protein analysis', tool: TOOLS2.protein, params: {}, inputs: [{ name: rec.id, data: prot }], run: async () => analyseProtein(prot) }).then((r) => r && setA(r)); }, [prot, rec.id, run]);
  const pp = prot.length >= 10 ? proteinProps(prot) : null, xs = a ? a.hydropathy.map((_, i) => i + 1) : [];
  return (<>
    <Card title="Protein analysis" sub={isProtein ? rec.id : `${rec.id}: forward-strand ORF`} actions={!isProtein && orfs.length > 0 ? <select className="select" style={{ width: 220 }} value={oi} onChange={(e) => setOi(+e.target.value)}>{orfs.map((o, i) => <option key={i} value={i}>ORF {o.start}–{o.end} ({o.lengthAa} aa)</option>)}</select> : undefined}>
      {error && <Callout kind="err">{error}</Callout>}{prot.length < 10 && <Callout>No protein to analyse (need ≥ 10 residues). For DNA, load a sequence that contains an ORF.</Callout>}
      {pp && <div className="cols-4"><Stat label="Residues" value={pp.length} /><Stat label="Mass (kDa)" value={fmt(pp.mw / 1000, 2)} /><Stat label="pI" value={fmt(pp.pI, 2)} /><Stat label="GRAVY" value={fmt(pp.gravy, 2)} /></div>}
    </Card>
    {a && <>
      <div className="cols-2">
        <Card title="Hydropathy" sub="Kyte–Doolittle, 19-residue window; > 1.6 suggests a membrane-spanning helix"><LineChart xs={xs} ys={a.hydropathy} xLabel="Residue" yLabel="Mean hydropathy" height={210} /><div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{a.tmHelices.length ? `Putative TM helices: ${a.tmHelices.map((h) => `${h.start}–${h.end}`).join(', ')}` : 'No transmembrane segment predicted.'}</div></Card>
        <Card title="Disorder propensity" sub="TOP-IDP scale, 21-residue window; > 0 leans disordered"><LineChart xs={xs} ys={a.disorder} xLabel="Residue" yLabel="Propensity" height={210} /><div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{fmt(a.disorderedFrac * 100, 0)}% of residues above 0.1. A coarse composition-based indicator, not a structure prediction.</div></Card>
        <Card title="Net charge vs pH"><MultiLine xs={a.chargeCurve.map((c) => c.ph)} xLabel="pH" yLabel="Net charge" height={210} series={[{ name: 'net charge', ys: a.chargeCurve.map((c) => c.charge), color: cssVar('--chart-b') }]} /></Card>
        <Card title="Amino-acid composition"><BarChart labels={a.composition.map((c) => c.aa)} values={a.composition.map((c) => c.frac * 100)} colors={[cssVar('--chart-c')]} yLabel="%" height={210} fmt={(v) => v.toFixed(0)} /></Card>
      </div>
      {a.lowComplexity.length > 0 && <Callout>Low-complexity regions (≤ 3 distinct residues in 12): {a.lowComplexity.map((l) => `${l.start}–${l.end}`).join(', ')}</Callout>}
      <Callout>Signal-peptide and TM topology predictors such as SignalP, TMHMM and DeepTMHMM are not used because their licences restrict commercial use. The methods here are published, open and transparent; use InterPro/UniProt annotations for authoritative features.</Callout>
    </>}
  </>);
}

// ---------------- Motifs ----------------
export function MotifPanel({ records }: { records: FastaRecord[] }) {
  const { run, busy, progress, note, error } = useRunner(); const [q, setQ] = useState('CTCF'), [list, setList] = useState<{ id: string; name: string; consensus: string; len: number }[]>([]), [picked, setPicked] = useState<string[]>([]), [minRel, setMinRel] = useState(0.9), [res, setRes] = useState<Awaited<ReturnType<typeof remote.motifs>> | null>(null), [active, setActive] = useState(0), [meta, setMeta] = useState<{ license: string; attribution: string; n: number } | null>(null);
  const dataBase = assetUrl('data/'), seqs = records.map((r) => ({ id: r.id, seq: toDNA(r.seq) })).filter((s) => /^[ACGTN]+$/.test(s.seq.slice(0, 200)));
  const search = () => void run({ label: 'JASPAR search', tool: TOOLS2.motif, params: { minRel, shuffles: 0 }, inputs: [], run: () => remote.motifs({ dataBase, ids: [], query: q, seqs: [], minRel, shuffles: 0 }) }).then((r) => { if (r) { setList(r.list ?? []); setMeta(r.meta); } });
  const scan = () => void run({ label: `Motif scan · ${picked.length} matrices`, tool: TOOLS2.motif, params: { minRel, shuffles: 5 }, inputs: [{ name: 'sequences', data: seqs.map((s) => s.seq).join('').slice(0, 200000) }, { name: 'matrices', data: picked.join(',') }], run: (h) => remote.motifs({ dataBase, ids: picked, query: '', seqs, minRel, shuffles: 5 }, h) }).then((r) => { if (r) { setRes(r); setActive(0); } });
  useEffect(() => { search(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const r = res?.results[active];
  return (<>
    <Card title="Transcription-factor motif scan" sub="JASPAR 2024 CORE vertebrates (CC BY 4.0), bundled offline" actions={<button className="btn primary sm" disabled={busy || !picked.length || !seqs.length} onClick={scan}>Scan {seqs.length} sequence{seqs.length === 1 ? '' : 's'}</button>}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Search by TF name, ID or consensus (e.g. CTCF, MA0139, TATAAA)"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /></Field><button className="btn" onClick={search}>Search</button><Field label={`Relative score ≥ ${minRel}`}><input type="range" min={0.8} max={1} step={0.01} value={minRel} onChange={(e) => setMinRel(+e.target.value)} /></Field></div>
        {list.length > 0 && <div className="row" style={{ gap: 6 }}>{list.map((m) => <button key={m.id} className={`btn sm ${picked.includes(m.id) ? 'primary' : ''}`} title={`${m.id} · ${m.consensus}`} onClick={() => setPicked(picked.includes(m.id) ? picked.filter((x) => x !== m.id) : [...picked.slice(-4), m.id])}>{m.name} <span className="faint mono" style={{ fontSize: 10 }}>{m.id}</span></button>)}</div>}
        {meta && <div className="faint" style={{ fontSize: 11.5 }}>{meta.n} matrices · {meta.license} · JASPAR 2024. Pick up to 5. Not using MEME Suite or HOMER (licence restrictions); scanning is a clean-room PWM log-odds scan.</div>}
        {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}{!seqs.length && <Callout kind="warn">No nucleotide records loaded.</Callout>}
      </div>
    </Card>
    {res && res.results.length > 0 && <>
      <Tabs<string> value={String(active)} onChange={(v) => setActive(+v)} items={res.results.map((m, i) => ({ id: String(i), label: m.name }))} />
      {r && <><div className="cols-4"><Stat label="Hits" value={r.hits.length >= 500 ? '≥ 500' : r.hits.length} /><Stat label="Expected (shuffled)" value={fmt(r.expected, 1)} /><Stat label="Fold enrichment" value={Number.isFinite(r.fold) ? fmt(r.fold, 2) : '–'} hint="hits in your sequences ÷ mean hits in 5 mononucleotide-shuffled copies" /><Stat label="Matrix" value={<span style={{ fontSize: 14 }}>{r.id}</span>} /></div>
        <Card title={`${r.name} · ${r.consensus}`} sub="information content"><SeqLogo pfm={r.pfm} /></Card>
        <Card title="Hits" pad={false} actions={<button className="btn sm" onClick={() => downloadText('motif_hits.csv', toCsv(r.hits.map((h) => ({ sequence: h.seqId, position: h.pos + 1, strand: h.strand, relative_score: h.rel.toFixed(3), site: h.seq }))), 'text/csv')}>CSV</button>}><DataTable rows={r.hits} rowKey={(h, i) => h.seqId + h.pos + h.strand + i} cols={[{ key: 's', label: 'Sequence', render: (h) => h.seqId }, { key: 'p', label: 'Position', num: true, sort: (h) => h.pos, render: (h) => h.pos + 1 }, { key: 'st', label: 'Strand' }, { key: 'rel', label: 'Rel. score', num: true, sort: (h) => h.rel, render: (h) => fmt(h.rel, 3) }, { key: 'site', label: 'Site', render: (h) => <code>{h.seq}</code> }]} /></Card></>}
    </>}
  </>);
}
void FileDrop; void useRef;
