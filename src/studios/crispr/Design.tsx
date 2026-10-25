import { useMemo } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { Scatter, cssVar } from '@/viz/charts';
import type { DesignResult, LabelledGuide, ScanResult } from './crispr.worker';
import { demoSequence } from './demo';
import type { NucleaseId } from './guides';
import { DESIGN_TOOL, remote } from './remote';

interface Props {
  design: DesignResult | null;
  text: string;
  setText(t: string): void;
  onResult(r: DesignResult | null): void;
  nuclease: NucleaseId;
  setNuclease(n: NucleaseId): void;
  selected: string | null;
  setSelected(id: string | null): void;
  scans: Record<string, ScanResult>;
}

export default function Design({ design, onResult, text, setText, nuclease, setNuclease, selected, setSelected, scans }: Props) {
  const { run, busy, progress, note, error, cancel } = useRunner();
  const guides = design?.guides ?? [];

  const go = (seqText: string, nuc: NucleaseId = nuclease) => {
    if (!seqText.trim()) return;
    const length = seqText.replace(/[^ACGTacgt]/g, '').length;
    const tool: ToolInfo = DESIGN_TOOL;
    void run({
      label: `CRISPR guides · ${nuc}`, tool, params: { nuclease: nuc, length },
      inputs: [{ name: 'sequence', data: seqText.slice(0, 2000) }],
      run: (h) => remote.design({ text: seqText, nuclease: nuc }, h),
      summary: (r) => `${r.guides.length} ${nuc} guides in ${r.length.toLocaleString()} bp (${r.records} sequence${r.records === 1 ? '' : 's'})`,
    }).then((r) => { if (r) onResult(r); });
  };

  const rows = useMemo(() => [...guides].sort((a, b) => b.score - a.score || (scans[b.id]?.specificity ?? -1) - (scans[a.id]?.specificity ?? -1) || a.start - b.start), [guides, scans]);
  const mean = guides.length ? guides.reduce((n, g) => n + g.score, 0) / guides.length : NaN;
  const points = guides.map((g) => ({ x: g.start, y: g.score, cat: g.strand === 1 ? 0 : 1, label: `${g.protospacer} · ${g.strand === 1 ? '+' : '−'}${g.start}` }));

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Sequence">
        <div className="stack" style={{ gap: 10 }}>
          <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => { setText(t); onResult(null); go(t); }} label={text ? 'Sequence loaded' : 'FASTA or plain DNA (≤ 50 kb)'} />
          <textarea className="input mono" rows={7} value={text} onChange={(e) => { setText(e.target.value); onResult(null); }} spellCheck={false} placeholder="Paste a DNA sequence or FASTA here…" aria-label="DNA sequence" />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => { const d = demoSequence(); setText(d); onResult(null); go(d); }}>Demo: 600-bp synthetic sequence</button>
            <span className="faint" style={{ fontSize: 12 }}>{text ? `${text.replace(/[^ACGTacgt]/g, '').length.toLocaleString()} nt` : 'nothing loaded'}</span>
          </div>
        </div>
      </Card>
      <Card title="2 · Nuclease">
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Nuclease"><select className="select" value={nuclease} onChange={(e) => { const n = e.target.value as NucleaseId; setNuclease(n); onResult(null); if (text) go(text, n); }}>
            <option value="SpCas9">SpCas9 · 20-nt protospacer + NGG</option>
            <option value="Cas12a">Cas12a · TTTV + 23-nt protospacer</option>
          </select></Field>
          <div className="row"><button className="btn primary" disabled={busy || !text.trim()} onClick={() => go(text)}>{busy ? 'Finding…' : 'Find guides'}</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
          {busy && <div className="faint" style={{ fontSize: 12 }}>{Math.round(progress * 100)} % {note ? `· ${note}` : ''}</div>}
          {error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>Scores are a transparent five-rule heuristic (GC, TTTT, GGGG+, and the base next to the PAM); they rank sites but are not a trained cutting-efficiency model. Off-target numbers appear after the Off-targets tab scans a background.</Callout>
    </div>
    <div className="stack">
      {!design ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter a DNA sequence, drop a FASTA file, or load the demo to find guides.</div></Card> : <>
        <div className="cols-4">
          <Stat label="Guides" value={rows.length} />
          <Stat label="Best score" value={rows[0]?.score ?? '—'} />
          <Stat label="Mean score" value={fmt(mean, 1)} />
          <Stat label="Sequence" value={`${design.length.toLocaleString()} bp`} hint={`${design.records} FASTA record${design.records === 1 ? '' : 's'}`} />
        </div>
        <Card title="Guides" sub="ranked by heuristic score, then specificity" pad={false} actions={<button className="btn sm" disabled={!rows.length} onClick={() => downloadText('crispr_guides.csv', toCsv(rows.map((g) => ({ strand: g.strand === 1 ? '+' : '-', start: g.start, protospacer: g.protospacer, pam: g.pam, gc_percent: +(g.gc * 100).toFixed(1), score: g.score, specificity: scans[g.id] ? +scans[g.id].specificity.toFixed(2) : '', off_targets_0_2: scans[g.id]?.off0to2 ?? '', off_targets_3_4: scans[g.id]?.off3to4 ?? '', flags: g.flags.join('; ') }))), 'text/csv')}>CSV</button>}>
          <DataTable rows={rows} rowKey={(g) => g.id} onRow={(g) => setSelected(g.id)} cols={[
            { key: 'strand', label: 'Strand', render: (g: LabelledGuide) => (g.strand === 1 ? '+' : '−'), sort: (g) => g.strand },
            { key: 'pos', label: 'Start', num: true, sort: (g) => g.start, render: (g) => g.start.toLocaleString() },
            { key: 'proto', label: 'Protospacer', render: (g) => <span className={selected === g.id ? 'mono' : 'mono faint'}>{g.protospacer}</span> },
            { key: 'pam', label: 'PAM', render: (g) => g.pam },
            { key: 'gc', label: 'GC', num: true, sort: (g) => g.gc, render: (g) => `${Math.round(g.gc * 100)} %` },
            { key: 'score', label: 'Score', num: true, sort: (g) => g.score },
            { key: 'spec', label: 'Specificity', num: true, sort: (g) => scans[g.id]?.specificity ?? -1, render: (g) => (scans[g.id] ? fmt(scans[g.id].specificity, 2) : '—') },
            { key: 'off', label: 'Off-targets 0–2 / 3–4', num: true, render: (g) => (scans[g.id] ? `${scans[g.id].off0to2} / ${scans[g.id].off3to4}` : '—') },
            { key: 'flags', label: 'Penalties', render: (g) => (g.flags.length ? g.flags.join(', ') : 'none') },
          ]} />
        </Card>
        <Card title="Position vs score" sub="both strands"><Scatter points={points} colors={[cssVar('--chart-a'), cssVar('--chart-b')]} names={['plus strand', 'minus strand']} xLabel="Protospacer start (bp)" yLabel="On-target score" height={280} radius={3.4} /></Card>
      </>}
    </div></div>
  );
}
