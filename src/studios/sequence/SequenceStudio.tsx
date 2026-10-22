import { copyText } from '@/core/clipboard';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toast } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { LineChart, cssVar } from '@/viz/charts';
import { remote } from './remote';
import { AlnView, CloningPanel, CrisprPanel, MotifPanel, PrimerDesignPanel, ProteinPanel, SangerPanel } from './SequenceTools';
import { demoCloningSet } from './demoIndex';
import { ENZYMES, composition, detectAlphabet, oligoTm, parseFasta, proteinProps, revComp, toDNA, translate, type Alignment, type Digest, type Orf, type FastaRecord } from './kernels';


const V = '0.1.0';
const TOOLS: Record<string, ToolInfo> = {
  orfs: { id: 'sequence.orfs', name: 'ORF finder', version: V, engine: 'TypeScript worker kernel', citations: [], describe: (p) => `Open reading frames (ATG to stop, six frames, standard genetic code, minimum ${p.minAa} aa) were identified` },
  composition: { id: 'sequence.composition', name: 'Sequence composition', version: V, engine: 'TypeScript worker kernel', citations: [], describe: (p) => `Nucleotide composition and sliding-window GC content (${p.win}-nt windows) were computed` },
  digest: { id: 'sequence.digest', name: 'Restriction digest', version: V, engine: 'TypeScript worker kernel', citations: [], describe: (p) => `In-silico digestion with ${(p.enzymes as string[]).join(', ')} was simulated on a ${p.circular ? 'circular' : 'linear'} template` },
  tm: { id: 'sequence.tm', name: 'Oligo thermodynamics', version: V, engine: 'TypeScript', citations: ['santalucia1998', 'owczarzy2008'], describe: (p) => `Oligonucleotide melting temperatures were calculated with the SantaLucia unified nearest-neighbour model and Owczarzy salt correction (${p.naMM} mM Na+, ${p.mgMM} mM Mg2+, ${p.primerNM} nM oligo)` },
  align: { id: 'sequence.align', name: 'Pairwise alignment', version: V, engine: 'TypeScript worker kernel (Gotoh affine-gap DP)', citations: ['needleman1970', 'smith1981', 'gotoh1982', 'henikoff1992'], describe: (p) => `Pairwise ${p.mode} alignment with affine gap penalties${p.kind === 'protein' ? ' and the BLOSUM62 matrix' : ''} was performed` },
  dotplot: { id: 'sequence.dotplot', name: 'Dotplot', version: V, engine: 'TypeScript worker kernel', citations: [], describe: (p) => `An exact k-mer dotplot (k = ${p.k}, both strands) was computed` },
};

function demoSequence(): string {
  let s = 123456789; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rnd = (n: number) => Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join('');
  const gene = (aa: number) => 'ATG' + Array.from({ length: aa }, () => ['GCC', 'CTG', 'AAA', 'GAA', 'GGC', 'ACC', 'GTG', 'CGT', 'GAT', 'TTC', 'AGC', 'CAG'][Math.floor(r() * 12)]).join('') + 'TAA';
  return `>demo_construct synthetic demonstration sequence (not a real gene)\n${(rnd(120) + 'GAATTC' + gene(140) + 'GGATCC' + rnd(150) + 'AAGCTT' + revComp(gene(95)) + rnd(90) + 'GGATCC' + rnd(110) + 'CTCGAG' + rnd(80)).replace(/(.{70})/g, '$1\n')}\n`;
}
const DEMO_PROT_A = '>query\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWSTPSELGHAGLNGDILVWNPVLEDAFELSSMGIRVDADTLKHQLALTGDEDRLELEWHQALLRGEMPQTIGGGIGQSRLTMLLLQLPHIGQVQAGVWPAAVRESVAGLL\n';
const DEMO_PROT_B = '>subject\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWSTPSELGHAGLNGDILVWNPVLEDAFELSSMGIRVDADTLKHQLALTGDEDRLELEWHQALLRGEMPQTIGGGIGQSRLTMLLLQLPHIGQVQAGVWPAAVRESVAGLL\n'.replace('KQRQISFVKSHFSRQLEERLG', 'KQRQISAVKSHFSRQMEERLG').replace('GDILVWNPV', 'GDILVYNPV');

const Colorize = ({ seq, max = 6000 }: { seq: string; max?: number }) => {
  const shown = seq.slice(0, max);
  const out: React.ReactNode[] = []; let run = ''; let cur = '';
  const flush = () => { if (run) out.push(<span key={out.length} className={`nt-${cur}`}>{run}</span>); run = ''; };
  for (const c of shown) { if (c !== cur) { flush(); cur = c; } run += c; }
  flush();
  return <div className="seqbox">{out}{seq.length > max && <span className="faint">… {(seq.length - max).toLocaleString()} more</span>}</div>;
};

function Gel({ fragments }: { fragments: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current!, dpr = window.devicePixelRatio || 1, w = el.clientWidth, h = 320;
    el.width = w * dpr; el.height = h * dpr; const g = el.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssVar('--code-bg'); g.fillRect(0, 0, w, h);
    const ladder = [10000, 8000, 6000, 5000, 4000, 3000, 2500, 2000, 1500, 1000, 750, 500, 250], all = [...ladder, ...fragments];
    const lo = Math.log10(Math.min(100, ...all) * 0.8), hi = Math.log10(Math.max(...all) * 1.2);
    const y = (bp: number) => 22 + ((hi - Math.log10(bp)) / (hi - lo)) * (h - 44);
    const lane = (x: number, bands: number[], label: string, strong?: boolean) => {
      g.fillStyle = cssVar('--text-faint'); g.font = '10.5px ' + cssVar('--mono'); g.textAlign = 'center'; g.fillText(label, x + 34, 13);
      for (const b of bands) { const yy = y(b), grad = g.createLinearGradient(x, 0, x + 68, 0); const c = strong ? '34,211,238' : '200,215,255'; grad.addColorStop(0, `rgba(${c},0)`); grad.addColorStop(0.5, `rgba(${c},${strong ? 0.95 : 0.6})`); grad.addColorStop(1, `rgba(${c},0)`); g.fillStyle = grad; g.shadowColor = `rgba(${c},.8)`; g.shadowBlur = strong ? 10 : 4; g.fillRect(x, yy - 1.5, 68, 3); g.shadowBlur = 0; }
    };
    lane(40, ladder, 'Ladder'); lane(130, fragments, 'Digest', true);
    g.textAlign = 'left'; g.fillStyle = cssVar('--text-dim'); g.font = '11px ' + cssVar('--mono');
    let lastY = -99; ladder.forEach((b) => { const yy = y(b); if (yy - lastY >= 11) { g.fillText(String(b), 4, yy + 3.5); lastY = yy; } });
    [...new Set(fragments)].forEach((b) => g.fillText(`${b.toLocaleString()} bp`, 212, y(b) + 3.5));
  }, [fragments]);
  return <div className="chart"><canvas ref={ref} style={{ height: 320, width: '100%', borderRadius: 10 }} /></div>;
}

function DotplotView({ data }: { data: { cells: Uint8Array; rows: number; cols: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current!, size = Math.min(520, el.parentElement!.clientWidth), dpr = window.devicePixelRatio || 1;
    el.style.width = el.style.height = size + 'px'; el.width = el.height = size * dpr; const g = el.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssVar('--code-bg'); g.fillRect(0, 0, size, size);
    const cw = size / data.cols, ch = size / data.rows;
    for (let r = 0; r < data.rows; r++) for (let c = 0; c < data.cols; c++) { const v = data.cells[r * data.cols + c]; if (v) { g.fillStyle = v === 1 ? cssVar('--chart-a') : cssVar('--chart-b'); g.fillRect(c * cw, r * ch, Math.max(1.5, cw), Math.max(1.5, ch)); } }
  }, [data]);
  return <div><canvas ref={ref} style={{ borderRadius: 10 }} /><div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: 'var(--chart-a)' }} />same strand</span><span><i style={{ background: 'var(--chart-b)' }} />reverse complement</span></div></div>;
};

const Proteomics = lazy(() => import('./Proteomics'));
type TabId = 'overview' | 'orfs' | 'digest' | 'design' | 'primers' | 'cloning' | 'crispr' | 'sanger' | 'protein' | 'motifs' | 'align' | 'dotplot' | 'proteomics';

export default function SequenceStudio() {
  const [text, setText] = useState('');
  const [recIdx, setRecIdx] = useState(0);
  const [tab, setTab] = useState<TabId>('overview');
  const records = useMemo<FastaRecord[]>(() => (text.trim() ? (text.trim().startsWith('>') ? parseFasta(text) : parseFasta('>pasted\n' + text)) : []), [text]);
  const rec = records[Math.min(recIdx, records.length - 1)];
  const alpha = rec ? detectAlphabet(rec.seq) : 'dna';
  const dna = rec && alpha !== 'protein' ? toDNA(rec.seq) : '';
  const load = (t: string) => { setText(t); setRecIdx(0); setTab('overview'); };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Sequence Studio</h1><p>Analyse, digest, design and align DNA, RNA and protein sequences. Computation runs in a Web Worker on your device.</p></div></div>
      <div className="split">
        <div className="stack">
          <Card title="Input" sub="FASTA or raw sequence">
            <div className="stack" style={{ gap: 10 }}>
              <textarea className="input" spellCheck={false} placeholder={'>my_sequence\nATGGCC…'} value={text} onChange={(e) => { setText(e.target.value); setRecIdx(0); }} />
              <FileDrop accept=".fa,.fasta,.fna,.faa,.txt,.seq" onText={(t) => load(t)} label="Drop a FASTA file" />
              <div className="row"><button className="btn sm" onClick={() => load(demoSequence())}>Demo DNA</button><button className="btn sm" onClick={() => { load(DEMO_PROT_A + DEMO_PROT_B); setTab('align'); }}>Demo proteins</button>
              <button className="btn sm" onClick={() => { load(demoCloningSet.restriction()); setTab('cloning'); }}>Demo cloning</button><button className="btn sm" onClick={() => { load(demoCloningSet.golden()); setTab('cloning'); }}>Demo Golden Gate</button><button className="btn sm" onClick={() => { load(demoCloningSet.gibson()); setTab('cloning'); }}>Demo Gibson</button><button className="btn sm" onClick={() => { load(demoCloningSet.crispr()); setTab('crispr'); }}>Demo CRISPR</button>{text && <button className="btn sm ghost" onClick={() => load('')}>Clear</button>}</div>
              {records.length > 1 && <Field label="Record"><select className="select" value={recIdx} onChange={(e) => setRecIdx(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id} · {r.seq.length.toLocaleString()} {alpha === 'protein' ? 'aa' : 'nt'}</option>)}</select></Field>}
            </div>
          </Card>
          {rec && <div className="cols-2" style={{ gap: 10 }}><Stat label={alpha === 'protein' ? 'Residues' : 'Length (nt)'} value={rec.seq.length.toLocaleString()} /><Stat label="Type" value={alpha.toUpperCase()} /></div>}
          <Callout>Your sequences never leave this tab. All analyses run locally; the only files fetched are static reference data served by this site (e.g. JASPAR matrices).</Callout>
        </div>
        <div className="stack">
          {!rec ? <Card><div className="faint" style={{ padding: '30px 6px', textAlign: 'center' }}>Paste or drop a sequence, or load a demo, to begin.</div></Card> : <>
            <Tabs value={tab} onChange={setTab} items={[{ id: 'overview', label: 'Overview' }, { id: 'orfs', label: 'ORFs' }, { id: 'digest', label: 'Restriction' }, { id: 'design', label: 'Primer design' }, { id: 'primers', label: 'Oligo Tm' }, { id: 'cloning', label: 'Cloning' }, { id: 'crispr', label: 'CRISPR' }, { id: 'sanger', label: 'Sanger' }, { id: 'protein', label: 'Protein' }, { id: 'motifs', label: 'Motifs' }, { id: 'align', label: 'Alignment' }, { id: 'dotplot', label: 'Dotplot' }, { id: 'proteomics', label: 'Proteomics' }]} />
            {tab === 'overview' && <Overview rec={rec} alpha={alpha} dna={dna} />}
            {tab === 'orfs' && <Orfs rec={rec} dna={dna} />}
            {tab === 'digest' && <DigestPanel rec={rec} dna={dna} />}
            {tab === 'design' && (alpha === 'protein' ? <Callout>Primer design needs a nucleotide template.</Callout> : <PrimerDesignPanel rec={rec} />)}
            {tab === 'primers' && <Primers />}
            {tab === 'cloning' && <CloningPanel records={records} />}
            {tab === 'crispr' && (alpha === 'protein' ? <Callout>CRISPR design needs a nucleotide sequence.</Callout> : <CrisprPanel records={records} rec={rec} />)}
            {tab === 'sanger' && <SangerPanel records={records} />}
            {tab === 'protein' && <ProteinPanel rec={rec} dna={dna} isProtein={alpha === 'protein'} />}
            {tab === 'motifs' && <MotifPanel records={records} />}
            {tab === 'proteomics' && <Suspense fallback={null}><Proteomics initial={alpha === 'protein' ? rec.seq : undefined} /></Suspense>}
            {tab === 'align' && <AlignPanel records={records} alpha={alpha} />}
            {tab === 'dotplot' && <DotplotPanel records={records} />}
          </>}
        </div>
      </div>
    </div>
  );
}

function Overview({ rec, alpha, dna }: { rec: FastaRecord; alpha: string; dna: string }) {
  const { run, busy, error } = useRunner();
  const [comp, setComp] = useState<ReturnType<typeof composition> | null>(null);
  const [win, setWin] = useState(100);
  useEffect(() => {
    if (alpha === 'protein') { setComp(null); return; }
    void run({ label: `Composition · ${rec.id}`, tool: TOOLS.composition, params: { win }, inputs: [{ name: rec.id, data: rec.seq }], run: () => remote.composition({ seq: dna, win }) }).then((r) => r && setComp(r));
  }, [rec, dna, alpha, win, run]);
  if (alpha === 'protein') {
    const p = proteinProps(rec.seq);
    return <Card title="Protein properties"><div className="cols-4"><Stat label="Mol. weight (kDa)" value={fmt(p.mw / 1000, 2)} /><Stat label="Isoelectric point" value={fmt(p.pI, 2)} /><Stat label="GRAVY" value={fmt(p.gravy, 3)} /><Stat label="ε280 (M⁻¹cm⁻¹)" value={p.extinction.toLocaleString()} /></div><Colorize seq={rec.seq} /></Card>;
  }
  const prot = translate(dna, 0, true);
  const pp = proteinProps(prot);
  return (
    <>
      <div className="cols-4">
        <Stat label="GC content" value={comp ? `${fmt(comp.gc * 100, 1)}%` : '…'} />
        {(['A', 'C', 'G', 'T'] as const).map((n) => <Stat key={n} label={n} value={comp ? (comp.counts[n] ?? 0).toLocaleString() : '…'} />)}
      </div>
      <Card title="GC content along the sequence" actions={<select className="select" style={{ width: 120 }} value={win} onChange={(e) => setWin(+e.target.value)}>{[50, 100, 200, 500].map((v) => <option key={v} value={v}>{v}-nt window</option>)}</select>}>
        {error && <Callout kind="err">{error}</Callout>}
        {comp && comp.windows.length > 1 ? <LineChart xs={comp.windows.map((w) => w.pos)} ys={comp.windows.map((w) => w.gc)} xLabel="Position (nt)" yLabel="GC fraction" yMin={0} yMax={1} /> : <div className="faint">{busy ? 'Computing…' : 'Sequence shorter than one window.'}</div>}
      </Card>
      <Card title="Sequence" actions={<><button className="btn sm" onClick={() => { void copyText(revComp(dna)); toast('Reverse complement copied'); }}>Copy reverse complement</button><button className="btn sm" onClick={() => downloadText(`${rec.id}.fasta`, `>${rec.id}\n${dna.replace(/(.{70})/g, '$1\n')}\n`)}>Export FASTA</button></>}>
        <Colorize seq={dna} />
      </Card>
      <Card title="Frame 1 translation" sub={`to first stop · ${pp.length} aa · ${fmt(pp.mw / 1000, 2)} kDa · pI ${fmt(pp.pI, 2)}`}><div className="seqbox">{prot || '—'}</div></Card>
    </>
  );
}

function Orfs({ rec, dna }: { rec: FastaRecord; dna: string }) {
  const { run, busy, error } = useRunner();
  const [min, setMin] = useState(50);
  const [orfs, setOrfs] = useState<Orf[]>([]);
  const [sel, setSel] = useState<Orf | null>(null);
  useEffect(() => { if (!dna) return; void run({ label: `ORFs · ${rec.id}`, tool: TOOLS.orfs, params: { minAa: min }, inputs: [{ name: rec.id, data: rec.seq }], run: () => remote.orfs({ seq: dna, minAa: min }) }).then((r) => { if (r) { setOrfs(r); setSel(r[0] ?? null); } }); }, [dna, min, rec, run]);
  if (!dna) return <Callout>ORF finding needs a nucleotide sequence.</Callout>;
  const p = sel ? proteinProps(sel.protein) : null;
  return (
    <>
      <Card title="Open reading frames" sub={`${orfs.length} found · ATG to stop · all six frames`} actions={<label className="row dim" style={{ fontSize: 12 }}>min length <input type="range" min={20} max={300} value={min} onChange={(e) => setMin(+e.target.value)} /> <b className="mono">{min} aa</b></label>} pad={false}>
        {error && <Callout kind="err">{error}</Callout>}
        <DataTable rows={orfs} rowKey={(r, i) => `${r.start}-${r.strand}-${i}`} onRow={(r: Orf) => setSel(r)} cols={[
          { key: 'strand', label: 'Strand', render: (r) => (r.strand === 1 ? '+' : '−'), sort: (r) => r.strand },
          { key: 'frame', label: 'Frame', sort: (r) => r.frame }, { key: 'start', label: 'Start', num: true, sort: (r) => r.start }, { key: 'end', label: 'End', num: true, sort: (r) => r.end },
          { key: 'lengthAa', label: 'Length (aa)', num: true, sort: (r) => r.lengthAa }, { key: 'protein', label: 'Protein', render: (r) => <code>{r.protein.slice(0, 28)}{r.protein.length > 28 ? '…' : ''}</code> },
        ]} />
        {busy && <div className="faint" style={{ padding: 12 }}>Searching…</div>}
      </Card>
      {sel && p && <Card title="Selected ORF" sub={`${sel.strand === 1 ? '+' : '−'} strand, ${sel.start}–${sel.end}`} actions={<button className="btn sm" onClick={() => downloadText('orf.faa', `>${rec.id}_orf_${sel.start}-${sel.end}\n${sel.protein}\n`)}>Export FASTA</button>}>
        <div className="cols-4"><Stat label="Residues" value={p.length} /><Stat label="kDa" value={fmt(p.mw / 1000, 2)} /><Stat label="pI" value={fmt(p.pI, 2)} /><Stat label="GRAVY" value={fmt(p.gravy, 2)} /></div>
        <div className="seqbox" style={{ marginTop: 12 }}>{sel.protein}</div></Card>}
    </>
  );
}

function DigestPanel({ rec, dna }: { rec: FastaRecord; dna: string }) {
  const { run, error } = useRunner();
  const [picked, setPicked] = useState<string[]>(['EcoRI', 'BamHI']);
  const [circ, setCirc] = useState(false);
  const [res, setRes] = useState<Digest | null>(null);
  useEffect(() => { if (!dna || !picked.length) { setRes(null); return; } void run({ label: `Digest · ${picked.join('+')}`, tool: TOOLS.digest, params: { enzymes: picked, circular: circ }, inputs: [{ name: rec.id, data: rec.seq }], run: () => remote.digest({ seq: dna, enzymes: picked, circular: circ }) }).then((r) => r && setRes(r)); }, [dna, picked, circ, rec, run]);
  if (!dna) return <Callout>Restriction analysis needs a nucleotide sequence.</Callout>;
  return (
    <>
      <Card title="Enzymes" actions={<label className="row dim" style={{ fontSize: 12 }}><input type="checkbox" checked={circ} onChange={(e) => setCirc(e.target.checked)} /> circular template</label>}>
        <div className="row" style={{ gap: 6 }}>{ENZYMES.map((e) => <button key={e.name} className={`btn sm ${picked.includes(e.name) ? 'primary' : ''}`} title={`${e.site} · ${e.overhang}`} onClick={() => setPicked((p) => (p.includes(e.name) ? p.filter((x) => x !== e.name) : [...p, e.name]))}>{e.name}</button>)}</div>
      </Card>
      {error && <Callout kind="err">{error}</Callout>}
      {res && <div className="cols-2">
        <Card title="Virtual agarose gel" sub={`${res.fragments.length} fragment${res.fragments.length === 1 ? '' : 's'}`}><Gel fragments={res.fragments} /></Card>
        <Card title="Cut sites" pad={false}>
          <DataTable rows={res.sites} rowKey={(r, i) => `${r.enzyme}${r.pos}${i}`} cols={[{ key: 'enzyme', label: 'Enzyme', sort: (r) => r.enzyme }, { key: 'pos', label: 'Site position', num: true, sort: (r) => r.pos }, { key: 'site', label: 'Recognition', render: (r) => <code>{ENZYMES.find((e) => e.name === r.enzyme)?.site}</code> }]} />
          <div style={{ padding: '10px 18px 16px' }} className="dim">Fragments: <span className="mono">{res.fragments.map((f) => f.toLocaleString()).join(', ')} bp</span></div>
        </Card>
      </div>}
    </>
  );
}

function Primers() {
  const { run, error } = useRunner();
  const [text, setText] = useState('M13F\tGTAAAACGACGGCCAGT\nM13R\tCAGGAAACAGCTATGAC\nT7\tTAATACGACTCACTATAGGG\nlac_rev\tAGCGGATAACAATTTCACACAGGA');
  const [na, setNa] = useState(50), [mg, setMg] = useState(1.5), [conc, setConc] = useState(250);
  const [rows, setRows] = useState<{ name: string; seq: string; p: ReturnType<typeof oligoTm> }[]>([]);
  const calc = () => {
    const list = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => { const f = l.split(/[\t, ]+/); return f.length > 1 ? { name: f[0], seq: f[1].toUpperCase() } : { name: `oligo${i + 1}`, seq: f[0].toUpperCase() }; });
    void run({ label: `Oligo Tm · ${list.length}`, tool: TOOLS.tm, params: { naMM: na, mgMM: mg, primerNM: conc }, inputs: [{ name: 'oligos', data: text }], run: async () => list.map((o) => ({ ...o, p: oligoTm(o.seq, { naMM: na, mgMM: mg, primerNM: conc }) })) }).then((r) => r && setRows(r));
  };
  useEffect(calc, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cols-2 split--narrow">
      <Card title="Oligos" sub="name, sequence per line">
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="cols-3" style={{ gap: 8 }}><Field label="Na⁺ mM"><input className="input" type="number" value={na} onChange={(e) => setNa(+e.target.value)} /></Field><Field label="Mg²⁺ mM"><input className="input" type="number" step={0.1} value={mg} onChange={(e) => setMg(+e.target.value)} /></Field><Field label="Oligo nM"><input className="input" type="number" value={conc} onChange={(e) => setConc(+e.target.value)} /></Field></div>
          <button className="btn primary" onClick={calc}>Calculate</button>
          <div className="faint" style={{ fontSize: 11.5 }}>SantaLucia (1998) nearest-neighbour model with Owczarzy salt correction. Compare with your supplier's tool before ordering.</div>
        </div>
      </Card>
      <Card title="Results" pad={false}>
        {error && <Callout kind="err">{error}</Callout>}
        <DataTable rows={rows} rowKey={(r) => r.name} cols={[
          { key: 'name', label: 'Name', sort: (r) => r.name }, { key: 'seq', label: 'Sequence', render: (r) => <code>{r.seq}</code> }, { key: 'len', label: 'nt', num: true, render: (r) => r.p.length },
          { key: 'tm', label: 'Tm °C', num: true, render: (r) => fmt(r.p.tm, 1), sort: (r) => r.p.tm }, { key: 'gc', label: 'GC %', num: true, render: (r) => fmt(r.p.gc * 100, 0), sort: (r) => r.p.gc },
          { key: 'dg', label: 'ΔG37', num: true, render: (r) => fmt(r.p.dG37, 1) },
          { key: 'flags', label: 'Checks', render: (r) => (Number.isNaN(r.p.tm) ? <span style={{ color: 'var(--danger)' }}>invalid bases</span> : <span className="row" style={{ gap: 5 }}>{r.p.hairpinRisk && <span className="badge building">hairpin?</span>}{r.p.selfDimerRisk && <span className="badge building">3′ dimer?</span>}{r.p.threePrimeGC > 3 && <span className="badge building">GC clamp</span>}{!r.p.hairpinRisk && !r.p.selfDimerRisk && r.p.threePrimeGC <= 3 && <span className="badge live">ok</span>}</span>) },
        ]} />
      </Card>
    </div>
  );
}

function AlignPanel({ records, alpha }: { records: FastaRecord[]; alpha: string }) {
  const { run, busy, progress, note, error, cancel } = useRunner();
  const [ia, setIa] = useState(0), [ib, setIb] = useState(Math.min(1, records.length - 1));
  const [mode, setMode] = useState<'global' | 'local'>('global');
  const [res, setRes] = useState<Alignment | null>(null);
  const a = records[ia], b = records[ib];
  const kind = alpha === 'protein' ? 'protein' : 'dna';
  const go = () => {
    if (!a || !b) return;
    const A = kind === 'dna' ? toDNA(a.seq) : a.seq, B = kind === 'dna' ? toDNA(b.seq) : b.seq;
    void run({ label: `${mode} alignment · ${a.id} vs ${b.id}`, tool: TOOLS.align, params: { mode, kind }, inputs: [{ name: a.id, data: A }, { name: b.id, data: B }], run: (h) => remote.align({ a: A, b: B, opts: { mode, kind } }, { onProgress: h.onProgress, signal: h.signal }) }).then((r) => r && setRes(r));
  };
  if (records.length < 2) return <Callout>Pairwise alignment needs two records. Paste two FASTA entries in the input box, or load "Demo proteins".</Callout>;
  return (
    <>
      <Card title="Pairwise alignment" sub="Gotoh affine gaps">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Sequence A"><select className="select" value={ia} onChange={(e) => setIa(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id}</option>)}</select></Field>
          <Field label="Sequence B"><select className="select" value={ib} onChange={(e) => setIb(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id}</option>)}</select></Field>
          <Field label="Mode"><select className="select" value={mode} onChange={(e) => setMode(e.target.value as 'global' | 'local')}><option value="global">Global (Needleman–Wunsch)</option><option value="local">Local (Smith–Waterman)</option></select></Field>
          <button className="btn primary" onClick={go} disabled={busy}>Align</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}
        </div>
        {busy && <div style={{ marginTop: 12 }}><Busy progress={progress} note={note} /></div>}
        {error && <div style={{ marginTop: 12 }}><Callout kind="err">{error}</Callout></div>}
      </Card>
      {res && <><div className="cols-4"><Stat label="Score" value={fmt(res.score, 0)} /><Stat label="Identity" value={`${fmt(res.identity * 100, 1)}%`} /><Stat label="Similarity" value={`${fmt(res.similarity * 100, 1)}%`} /><Stat label="Gaps" value={res.gaps} /></div>
        <Card title="Alignment" actions={<button className="btn sm" onClick={() => downloadText('alignment.txt', `${a.id}\t${res.a}\n${b.id}\t${res.b}\n`)}>Export</button>}><AlnView a={res} /></Card></>}
    </>
  );
}

function DotplotPanel({ records }: { records: FastaRecord[] }) {
  const { run, error, busy } = useRunner();
  const [ia, setIa] = useState(0), [ib, setIb] = useState(0), [k, setK] = useState(10);
  const [data, setData] = useState<{ cells: Uint8Array; rows: number; cols: number } | null>(null);
  const go = () => { const a = toDNA(records[ia].seq), b = toDNA(records[ib].seq); void run({ label: 'Dotplot', tool: TOOLS.dotplot, params: { k }, inputs: [{ name: records[ia].id, data: a }, { name: records[ib].id, data: b }], run: () => remote.dotplot({ a, b, k }) }).then((r) => r && setData(r)); };
  return (
    <Card title="Dotplot" sub="exact k-mer matches, both strands">
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <Field label="X axis"><select className="select" value={ia} onChange={(e) => setIa(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id}</option>)}</select></Field>
        <Field label="Y axis"><select className="select" value={ib} onChange={(e) => setIb(+e.target.value)}>{records.map((r, i) => <option key={i} value={i}>{r.id}</option>)}</select></Field>
        <Field label={`k-mer length: ${k}`}><input type="range" min={4} max={24} value={k} onChange={(e) => setK(+e.target.value)} /></Field>
        <button className="btn primary" onClick={go} disabled={busy}>Plot</button>
      </div>
      {error && <Callout kind="err">{error}</Callout>}
      {data ? <DotplotView data={data} /> : <div className="faint">Pick sequences and press Plot. Self-comparison reveals repeats and inverted repeats.</div>}
    </Card>
  );
}
