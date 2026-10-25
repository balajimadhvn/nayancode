import { useEffect, useState } from 'react';
import { Callout, Card, DataTable, Field, FileDrop, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import type { DesignResult, ScanResult } from './crispr.worker';
import type { NucleaseId } from './guides';
import { OFF_TARGET_TOOL, remote } from './remote';

const BUNDLED: Record<string, { label: string; bp: number }> = {
  lambda: { label: 'Phage lambda (48.5 kb)', bp: 48502 },
  'ecoli-k12': { label: 'E. coli K-12 MG1655 (4.6 Mb)', bp: 4641652 },
  'bsubtilis-168': { label: 'B. subtilis 168 (4.2 Mb)', bp: 4215606 },
  'mtb-h37rv': { label: 'M. tuberculosis H37Rv (4.4 Mb)', bp: 4411532 },
};

interface Props {
  design: DesignResult | null;
  source: string;
  setSource(s: string): void;
  bgText: string;
  setBgText(t: string): void;
  maxMm: number;
  setMaxMm(n: number): void;
  nuclease: NucleaseId;
  selected: string | null;
  setSelected(id: string | null): void;
  scans: Record<string, ScanResult>;
  onScan(r: ScanResult): void;
}

export default function Offtargets({ design, nuclease, selected, setSelected, scans, onScan, source, setSource, bgText, setBgText, maxMm, setMaxMm }: Props) {
  const [guideId, setGuideId] = useState('');
  const { run, busy, progress, note, error, cancel } = useRunner();

  useEffect(() => {
    if (!design) { setGuideId(''); return; }
    if (!design.guides.some((g) => g.id === guideId)) setGuideId(selected && design.guides.some((g) => g.id === selected) ? selected : (design.guides[0]?.id ?? ''));
  }, [design, selected, guideId]);

  const guide = design?.guides.find((g) => g.id === guideId) ?? null;
  const current = guide ? scans[guide.id] : undefined;
  const cas12 = nuclease === 'Cas12a';
  const ready = !!guide && !cas12 && (source !== 'none') && (source !== 'paste' || bgText.trim().length > 0);

  const go = () => {
    if (!guide || source === 'none') return;
    const background = source === 'paste' ? { kind: 'text' as const, text: bgText } : { kind: 'bundled' as const, id: source };
    const label = source === 'paste' ? 'pasted FASTA' : (BUNDLED[source]?.label ?? source);
    const length = source === 'paste' ? bgText.replace(/[^ACGTacgt]/g, '').length : (BUNDLED[source]?.bp ?? 0);
    void run({
      label: `CRISPR off-targets · ${guide.protospacer}`, tool: OFF_TARGET_TOOL,
      params: { guide: guide.protospacer, background: label, maxMm, length },
      inputs: [{ name: 'guide', data: guide.protospacer }, { name: 'background', data: label }],
      run: (h) => remote.scan({ guide: guide.protospacer, guideId: guide.id, seqId: guide.seqId, pos: guide.start, strand: guide.strand, background, maxMm }, h),
      summary: (r) => `${r.sites} site(s) with ≤ ${maxMm} mismatches in ${label}; specificity ${fmt(r.specificity, 2)}`,
    }).then((r) => { if (r) { onScan(r); setSelected(r.guideId); } });
  };

  if (!design || !design.guides.length) return <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter a DNA sequence in the Design tab first; off-target scanning starts from one of its guides.</div></Card>;

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Guide">
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Guide"><select className="select" value={guideId} onChange={(e) => { setGuideId(e.target.value); setSelected(e.target.value); }}>
            {design.guides.map((g) => <option key={g.id} value={g.id}>{g.strand === 1 ? '+' : '−'}{g.start} · {g.protospacer} · {g.pam} · score {g.score}</option>)}
          </select></Field>
          {guide && <div className="faint mono" style={{ fontSize: 12 }}>{guide.protospacer} <span style={{ color: 'var(--chart-b)' }}>{guide.pam}</span> · GC {Math.round(guide.gc * 100)} % · cut after {guide.cutPos}</div>}
          {cas12 && <Callout kind="warn">Off-target scanning in this studio is implemented for SpCas9 guides only (20-nt protospacer + NGG PAM). Switch the Design tab to SpCas9 to scan a background.</Callout>}
        </div>
      </Card>
      <Card title="2 · Background">
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Bundled genome or pasted FASTA"><select className="select" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Off-target background">
            <option value="none">none (do not estimate specificity)</option>
            {Object.entries(BUNDLED).map(([id, b]) => <option key={id} value={id}>{b.label}</option>)}
            <option value="paste">pasted FASTA (≤ 5 Mb)</option>
          </select></Field>
          {source === 'paste' && <>
            <FileDrop accept=".fa,.fasta,.fna,.txt" onText={(t) => setBgText(t)} label={bgText ? 'Background loaded' : 'Background FASTA or plain DNA'} />
            <textarea className="input mono" rows={4} value={bgText} onChange={(e) => setBgText(e.target.value)} spellCheck={false} placeholder="Paste background DNA or FASTA…" aria-label="Background sequence" />
            <div className="faint" style={{ fontSize: 12 }}>{bgText.replace(/[^ACGTacgt]/g, '').length.toLocaleString()} nt</div>
          </>}
          <Field label="Maximum mismatches"><select className="select" value={maxMm} onChange={(e) => setMaxMm(+e.target.value)}>{[0, 1, 2, 3, 4].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <div className="row"><button className="btn primary" disabled={busy || !ready} onClick={go}>{busy ? 'Scanning…' : 'Scan background'}</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
          {busy && <div className="faint" style={{ fontSize: 12 }}>{Math.round(progress * 100)} % {note ? `· ${note}` : ''}</div>}
          {error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>Ungapped search: substitutions only, no DNA or RNA bulges, and only NGG PAM sites. A 5 Mb background runs in a worker; the first scan of a bundled genome also downloads and decompresses it.</Callout>
    </div>
    <div className="stack">
      {!current ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Choose a background and scan to count off-target sites and estimate specificity.</div></Card> : <>
        <div className="cols-4">
          <Stat label="Off-target sites" value={current.sites} hint={`≤ ${current.maxMm} mismatches; the exact on-target copy is excluded`} />
          <Stat label="Specificity" value={fmt(current.specificity, 2)} hint="MIT position-weighted score (0–100)" />
          <Stat label="0–2 mismatches" value={current.off0to2} />
          <Stat label="3–4 mismatches" value={current.off3to4} />
        </div>
        <Callout kind={current.sites > 0 ? 'warn' : undefined}>
          <b style={{ color: 'var(--text)' }}>{current.background}</b> · {current.length.toLocaleString()} bp · searched in {fmt(current.ms / 1000, 2)} s.
          {current.sites === 0 ? ' No NGG site with at most the chosen mismatches was found; the MIT specificity is 100 by definition.' : ` ${current.sites} site(s) found. Specificity uses only sites with at least one mismatch, as in the MIT formula.`}
          {current.truncated && ' The table is capped at 5,000 hits.'}
        </Callout>
        <Card title="Off-target sites" sub={`guide ${guide?.protospacer ?? ''}`} pad={false} actions={<button className="btn sm" onClick={() => downloadText('crispr_offtargets.csv', toCsv(current.hits.map((h) => ({ sequence: h.seq, position: h.pos, strand: h.strand === 1 ? '+' : '-', mismatches: h.mismatches.length, mismatch_positions: h.mismatches.join(';'), site: h.site }))), 'text/csv')}>CSV</button>}>
          <DataTable rows={current.hits} rowKey={(h, i) => `${h.seq}:${h.pos}:${h.strand}:${i}`} cols={[
            { key: 'seq', label: 'Sequence' },
            { key: 'pos', label: 'Start', num: true, sort: (h) => h.pos, render: (h) => `${h.pos.toLocaleString()}${h.strand === 1 ? '+' : '−'}` },
            { key: 'mm', label: 'Mismatches', num: true, sort: (h) => h.mismatches.length, render: (h) => (h.mismatches.length ? `${h.mismatches.length} (${h.mismatches.join(', ')})` : '0 (exact copy)') },
            { key: 'site', label: 'Protospacer + PAM', render: (h) => <span className="mono">{h.site}</span> },
          ]} />
        </Card>
      </>}
    </div></div>
  );
}
