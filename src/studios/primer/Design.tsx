import { useState } from 'react';
import { Callout, Card, DataTable, Field, FileDrop, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { parseFasta, revComp } from '@/studios/sequence/kernels';
import { designPairs, type PrimerPair } from './design';
import { demoTemplate } from './demo';
import { DESIGN_TOOL } from './meta';

const bases = (t: string) => parseFasta(t)[0]?.seq.replace(/[^ACGT]/g, '').toUpperCase() ?? '';

export default function Design() {
  const [text, setText] = useState('');
  const [start, setStart] = useState(701), [end, setEnd] = useState(900);
  const [ampMin, setAmpMin] = useState(100), [ampMax, setAmpMax] = useState(1000);
  const [tmMin, setTmMin] = useState(57), [tmMax, setTmMax] = useState(63);
  const [lenMin, setLenMin] = useState(18), [lenMax, setLenMax] = useState(25);
  const [gcMin, setGcMin] = useState(40), [gcMax, setGcMax] = useState(60);
  const [maxTmDiff, setMaxTmDiff] = useState(2);
  const [pairs, setPairs] = useState<PrimerPair[]>([]), [seq, setSeq] = useState('');
  const [sel, setSel] = useState(0);
  const { run, busy, error } = useRunner();

  const go = (templateText = text, a = start, b = end) => {
    const t = bases(templateText);
    if (!t) { setPairs([]); return; }
    if (a < 1 || b <= a || b > t.length) { setPairs([]); return; }
    setPairs([]); setSel(0);
    void run({
      label: `Primer design · ${a}–${b}`, tool: DESIGN_TOOL,
      params: { targetStart: a, targetEnd: b, templateLen: t.length, tmMin, tmMax, lenMin, lenMax, gcMin, gcMax, maxTmDiff },
      inputs: [{ name: 'template', data: `${t.length} bp` }],
      run: async () => designPairs(t, { start: a - 1, end: b, ampMin, ampMax, tmMin, tmMax, lenMin, lenMax, gcMin, gcMax, maxTmDiff }),
      summary: (r) => `${r.length} primer pair(s) for ${a}–${b}`,
    }).then((r) => { if (r) { setPairs(r); setSeq(t); setSel(0); } });
  };

  const demo = () => { const t = demoTemplate(); setText(t); setStart(701); setEnd(900); go(t, 701, 900); };
  const p = pairs[sel];
  const ampliconSeq = p && seq ? seq.slice(p.f.start, p.r.end) : '';
  const rSite = p ? revComp(p.r.seq) : '';

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Template and target">
        <div className="stack" style={{ gap: 10 }}>
          <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => { setText(t); setPairs([]); }} label={text ? 'Template loaded' : 'FASTA or plain DNA template'} />
          <textarea className="input mono" rows={6} value={text} onChange={(e) => { setText(e.target.value); setPairs([]); }} spellCheck={false} placeholder="Paste the template DNA…" aria-label="Template sequence" />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={demo}>Demo: 2-kb template, target 701–900</button>
            <span className="faint" style={{ fontSize: 12 }}>{text ? `${bases(text).length.toLocaleString()} bp` : 'nothing loaded'}</span>
          </div>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Target start (1-based)"><input className="input" type="number" min={1} value={start} onChange={(e) => setStart(+e.target.value)} /></Field>
            <Field label="Target end (1-based, inclusive)"><input className="input" type="number" min={2} value={end} onChange={(e) => setEnd(+e.target.value)} /></Field>
          </div>
        </div>
      </Card>
      <Card title="2 · Constraints">
        <div className="cols-2" style={{ gap: 8 }}>
          <Field label="Tm min (°C)"><input className="input" type="number" value={tmMin} onChange={(e) => setTmMin(+e.target.value)} /></Field>
          <Field label="Tm max (°C)"><input className="input" type="number" value={tmMax} onChange={(e) => setTmMax(+e.target.value)} /></Field>
          <Field label="Length min (nt)"><input className="input" type="number" value={lenMin} onChange={(e) => setLenMin(+e.target.value)} /></Field>
          <Field label="Length max (nt)"><input className="input" type="number" value={lenMax} onChange={(e) => setLenMax(+e.target.value)} /></Field>
          <Field label="GC min (%)"><input className="input" type="number" value={gcMin} onChange={(e) => setGcMin(+e.target.value)} /></Field>
          <Field label="GC max (%)"><input className="input" type="number" value={gcMax} onChange={(e) => setGcMax(+e.target.value)} /></Field>
          <Field label="Amplicon min (bp)"><input className="input" type="number" value={ampMin} onChange={(e) => setAmpMin(+e.target.value)} /></Field>
          <Field label="Amplicon max (bp)"><input className="input" type="number" value={ampMax} onChange={(e) => setAmpMax(+e.target.value)} /></Field>
          <Field label="Max |ΔTm| (°C)"><input className="input" type="number" step="0.1" value={maxTmDiff} onChange={(e) => setMaxTmDiff(+e.target.value)} /></Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" disabled={busy || !text.trim()} onClick={() => go()}>{busy ? 'Designing…' : 'Design pairs'}</button></div>
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
      <Callout>Forward primers start up to 150 bp upstream of the target; reverse primers end up to 150 bp downstream. Candidates with a high-risk dimer, a homopolymer of 5+ bases or more than three G/C in the last five bases are discarded.</Callout>
    </div>
    <div className="stack">
      <Card title="Primer pairs" sub="ranked by the design score" pad={false} actions={<button className="btn sm" disabled={!pairs.length} onClick={() => downloadText('primer_pairs.csv', toCsv(pairs.map((q, i) => ({ rank: i + 1, forward: q.f.seq, forward_start_1based: q.f.start + 1, forward_tm: +q.f.tm.toFixed(2), forward_gc_percent: +(q.f.gc * 100).toFixed(1), reverse: q.r.seq, reverse_start_1based: q.r.start + 1, reverse_end_1based: q.r.end, reverse_tm: +q.r.tm.toFixed(2), reverse_gc_percent: +(q.r.gc * 100).toFixed(1), amplicon_bp: q.amplicon, score: +q.score.toFixed(3) }))), 'text/csv')}>CSV</button>}>
        {!pairs.length ? <div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter a template sequence or load the demo, then design pairs.</div> : <DataTable rows={pairs} rowKey={(q, i) => `${q.f.start}-${q.r.end}-${i}`} onRow={(q) => setSel(pairs.indexOf(q))} cols={[
          { key: 'f', label: 'Forward primer', render: (q) => <span className="mono">{q.f.seq}</span> },
          { key: 'fp', label: 'F start', num: true, sort: (q) => q.f.start, render: (q) => (q.f.start + 1).toLocaleString() },
          { key: 'ft', label: 'Tm F', num: true, render: (q) => fmt(q.f.tm, 1) },
          { key: 'r', label: 'Reverse primer', render: (q) => <span className="mono">{q.r.seq}</span> },
          { key: 'rp', label: 'R end', num: true, sort: (q) => q.r.end, render: (q) => q.r.end.toLocaleString() },
          { key: 'rt', label: 'Tm R', num: true, render: (q) => fmt(q.r.tm, 1) },
          { key: 'amp', label: 'Amplicon (bp)', num: true, sort: (q) => q.amplicon },
          { key: 'score', label: 'Score', num: true, sort: (q) => q.score, render: (q) => fmt(q.score, 2) },
        ]} />}
      </Card>
      {p && ampliconSeq && <Card title="Amplicon" sub={`${p.amplicon} bp · F ${p.f.start + 1}–${p.f.end} · R site ${p.r.start + 1}–${p.r.end}`}>
        <div className="seqbox mono" style={{ maxHeight: 'none', overflowWrap: 'anywhere', lineHeight: 1.7 }}>
          <span style={{ color: 'var(--chart-a)', fontWeight: 600 }}>{ampliconSeq.slice(0, p.f.seq.length)}</span>
          <span>{ampliconSeq.slice(p.f.seq.length, ampliconSeq.length - rSite.length)}</span>
          <span style={{ color: 'var(--chart-b)', fontWeight: 600 }}>{ampliconSeq.slice(ampliconSeq.length - rSite.length)}</span>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Blue = forward primer on the plus strand; amber = reverse-primer binding site (reverse complement of the reverse primer). The target is inside the amplicon.</div>
      </Card>}
    </div></div>
  );
}
