import { useEffect, useMemo, useState } from 'react';
import { createRemote } from '@/compute/rpc';
import { clearHandoffSoon, useHandoff } from '@/core/handoff';
import type { ToolInfo } from '@/core/provenance';
import { Busy, Callout, Card, DataTable, Field, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { CRISPR_NUCLEASES } from './crispr';
import { GenomePicker } from './GenomePicker';
import type { CrisprHit, OffTargetKernels } from './offtarget.worker';
import type { GenomeSource } from './offtarget.worker';
import { DEFAULT_SITE_OPTS, type SiteOpts } from './primerSearch';

const remote = createRemote<OffTargetKernels>(() => new Worker(new URL('./offtarget.worker.ts', import.meta.url), { type: 'module' }));
const PRIMER_TOOL: ToolInfo = { id: 'genome.primer-specificity', name: 'Primer specificity', version: '0.1.0', engine: 'TypeScript worker (seed k-mer index + verification)', citations: ['oleary2016', 'ye2012'],
  describe: (p) => `Primer binding sites were searched on both strands of ${p.genome} allowing up to ${p.maxMismatch} mismatches (at most ${p.max3Mismatch} within the last ${p.threeLen} bases of the 3′ end; 3′ mismatches weighted 5, 4, 3, 2, 2, then 1), using an exact-seed k-mer index with base-by-base verification; amplicons of ${p.minSize}–${p.maxSize} bp were predicted from forward and reverse sites on the same sequence (linear coordinates)` };
const CRISPR_TOOL: ToolInfo = { id: 'genome.crispr-offtarget', name: 'CRISPR off-target search', version: '0.1.0', engine: 'TypeScript worker (exhaustive PAM scan)', citations: ['doench2016', 'hsu2013', 'bae2014', 'oleary2016'],
  describe: (p) => `${p.nuclease} off-target sites were enumerated exhaustively on both strands of ${p.genome} (PAM ${p.pams}; up to ${p.maxMismatch} mismatches${p.bulges ? `, ${p.maxDnaBulge} DNA and ${p.maxRnaBulge} RNA bulges` : ''}); sites were scored with the CFD matrix of Doench et al. (2016) and the MIT position-weighted score of Hsu et al. (2013), and annotated with RefSeq genes. Results were validated against Cas-OFFinder (Bae et al. 2014) in the Workbench benchmark suite` };

interface Oligo { name: string; seq: string }
/** "name seq" lines, FASTA, or bare sequences. */
export function parseOligos(text: string, prefix: string): Oligo[] {
  const out: Oligo[] = []; let pend = '';
  for (const raw of text.split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('#')) continue;
    if (l.startsWith('>')) { pend = l.slice(1).trim().split(/\s/)[0]; continue; }
    const parts = l.split(/[\s,;\t]+/), seq = parts[parts.length - 1].toUpperCase().replace(/[^A-Z]/g, ''); if (!seq) continue;
    out.push({ name: pend || (parts.length > 1 ? parts.slice(0, -1).join('_') : `${prefix}${out.length + 1}`), seq }); pend = '';
  }
  return out;
}
const DEMO_PRIMERS = 'ecoli_F\tCCGGTTGTACTTCATGAACAAA\necoli_R\tCGGCAAACGACGACATCCGCCC\nyfg_F\tTACCAGAAATGGTGTACGGGGT\nyfg_R\tCCAGACTTGTGCAGAAATCCTC';
const DEMO_GUIDES = 'g1\tTGAGGTCACGTTGTTGGCCC\ng2\tTTGTGAAGTGAATGTGCTTC\ng3\tGACCTGGTGATTAGCAGCCA';

export function PrimerSpecificityPanel() {
  const { run, busy, progress, note, error, cancel } = useRunner(), hand = useHandoff((s) => s.oligos);
  const [src, setSrc] = useState<GenomeSource | null>(null), [text, setText] = useState(''), [o, setO] = useState<SiteOpts>(DEFAULT_SITE_OPTS), [size, setSize] = useState<[number, number]>([50, 3000]);
  const [res, setRes] = useState<Awaited<ReturnType<typeof remote.primers>> | null>(null), [names, setNames] = useState<Oligo[]>([]);
  useEffect(() => { if (hand?.primers.length) { setText(hand.primers.map((p) => `${p.name}\t${p.seq}`).join('\n')); clearHandoffSoon('oligos'); } }, [hand]);
  const primers = useMemo(() => parseOligos(text, 'primer'), [text]);
  const go = () => {
    if (!src) return; const pairs: [number, number][] = []; for (let i = 0; i + 1 < primers.length; i += 2) pairs.push([i, i + 1]);
    void run({ label: `Primer specificity · ${primers.length} primers`, tool: PRIMER_TOOL, params: { genome: src.kind === 'bundled' ? src.id : src.name, ...o, minSize: size[0], maxSize: size[1] }, inputs: [{ name: 'primers', data: text }], run: (h) => remote.primers({ src, primers, pairs, opts: o, minSize: size[0], maxSize: size[1] }, h) }).then((r) => { if (r) { setRes(r); setNames(primers); } });
  };
  const nm = (i: number) => names[i]?.name ?? `#${i + 1}`, v = res?.summary.verdict;
  return (
    <div className="split"><div className="stack">
      <Card title="Primers" sub="forward then reverse, 5′→3′">
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={'name<TAB>SEQUENCE, one per line\nPairs are read in order: 1+2, 3+4, …'} aria-label="Primers" />
          <div className="row"><button className="btn sm" onClick={() => setText(DEMO_PRIMERS)}>Demo: E. coli K-12 primers</button><span className="faint" style={{ fontSize: 12 }}>{primers.length} primer{primers.length === 1 ? '' : 's'}</span></div>
          <GenomePicker onChange={setSrc} />
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Max mismatches"><select className="select" value={o.maxMismatch} onChange={(e) => setO({ ...o, maxMismatch: +e.target.value })}>{[0, 1, 2, 3, 4, 5, 6].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label={`Max in last ${o.threeLen} bases (3′)`}><select className="select" value={o.max3Mismatch} onChange={(e) => setO({ ...o, max3Mismatch: +e.target.value })}>{[0, 1, 2].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Product min (bp)"><input className="input" type="number" value={size[0]} onChange={(e) => setSize([+e.target.value, size[1]])} /></Field>
            <Field label="Product max (bp)"><input className="input" type="number" value={size[1]} onChange={(e) => setSize([size[0], +e.target.value])} /></Field>
          </div>
          <div className="row"><button className="btn primary" disabled={busy || primers.length < 1 || !src} onClick={go}>Check specificity</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
          {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>Limits: binding sites are ungapped matches (mismatches only, no indels) on a linear sequence, so products spanning the origin of a circular genome are not predicted. A site is kept when it has at most the chosen mismatches overall and at most the chosen number in the last 5 bases of the 3′ end, where mismatches matter most for extension. This is a screening tool for small genomes (up to a few tens of Mb), not a thermodynamic model: confirm critical designs with Primer-BLAST or a melt-curve check.</Callout>
    </div>
    <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Paste primers (or send them from Sequence Studio), choose a genome and check specificity.</div></Card> : <>
      <div className="cols-4"><Stat label="Genome" value={res.genome.name.split(' ').slice(0, 2).join(' ')} hint={res.genome.name} /><Stat label="Binding sites" value={res.sites.length} /><Stat label="Predicted products" value={res.products.length} /><Stat label="Search time" value={`${fmt(res.ms / 1000, 2)} s`} /></div>
      <Callout kind={v === 'specific' ? undefined : 'warn'}>{v === 'specific' ? <><b style={{ color: 'var(--text)' }}>Specific:</b> each pair gives exactly one product, from perfectly matching primers, and nothing else is predicted.</> : v === 'no product' ? <><b style={{ color: 'var(--text)' }}>No product predicted</b> with these primers and size limits. Check orientation (forward then reverse) and the product range.</> : <><b style={{ color: 'var(--text)' }}>{res.summary.offTargetProducts} additional or imperfect product{res.summary.offTargetProducts === 1 ? '' : 's'}</b> predicted ({res.summary.intendedPerfect} intended perfect product). Review the table below.</>}{res.truncated && ' Product list truncated at 5,000.'}</Callout>
      <Card title="Predicted products" pad={false} actions={<button className="btn sm" onClick={() => downloadText('primer_products.csv', toCsv(res.products.map((p) => ({ sequence: p.contigName, start: p.start + 1, end: p.end, size: p.size, forward: nm(p.fwdPrimer), reverse: nm(p.revPrimer), mismatches_fwd: p.fwdMm, mismatches_rev: p.revMm, intended_pair: p.intended, genes: p.gene }))), 'text/csv')}>CSV</button>}>
        <DataTable rows={res.products} rowKey={(p, i) => `${p.contig}${p.start}${p.fwdPrimer}${p.revPrimer}${i}`} cols={[{ key: 'c', label: 'Sequence', render: (p) => p.contigName }, { key: 's', label: 'Start–end', num: true, sort: (p) => p.start, render: (p) => `${(p.start + 1).toLocaleString()}–${p.end.toLocaleString()}` }, { key: 'z', label: 'Size', num: true, sort: (p) => p.size }, { key: 'f', label: 'Forward', render: (p) => `${nm(p.fwdPrimer)} (${p.fwdMm} mm)` }, { key: 'r', label: 'Reverse', render: (p) => `${nm(p.revPrimer)} (${p.revMm} mm)` }, { key: 'pen', label: '3′ penalty', num: true, sort: (p) => p.penalty, render: (p) => p.fwdPen + p.revPen }, { key: 'k', label: 'Class', render: (p) => (p.perfect && p.intended ? <span className="badge live">intended</span> : p.perfect ? <span className="badge building">perfect, other pair</span> : <span className="badge building">off-target</span>) }, { key: 'g', label: 'Genes', render: (p) => p.gene }]} />
      </Card>
      <Card title="Binding sites" pad={false} actions={<button className="btn sm" onClick={() => downloadText('primer_sites.csv', toCsv(res.sites.map((s) => ({ primer: nm(s.primer), sequence: s.contigName, start: s.pos + 1, end: s.pos + s.length, strand: s.strand, mismatches: s.mismatches, mismatches_3prime: s.mismatches3, penalty_3prime: s.penalty, gene: s.gene }))), 'text/csv')}>CSV</button>}>
        <DataTable rows={res.sites} rowKey={(s, i) => `${s.primer}${s.contig}${s.pos}${s.strand}${i}`} cols={[{ key: 'p', label: 'Primer', render: (s) => nm(s.primer) }, { key: 'c', label: 'Sequence', render: (s) => s.contigName }, { key: 's', label: 'Position', num: true, sort: (s) => s.pos, render: (s) => `${(s.pos + 1).toLocaleString()}${s.strand}` }, { key: 'm', label: 'Mismatches', num: true, sort: (s) => s.mismatches }, { key: 'm3', label: '3′ mm', num: true, render: (s) => s.mismatches3 }, { key: 'pen', label: '3′ penalty', num: true, sort: (s) => s.penalty }, { key: 'g', label: 'Gene', render: (s) => s.gene }]} />
      </Card>
    </>}</div></div>
  );
}

const marked = (t: string) => <code>{[...t].map((c, i) => (/[a-z]/.test(c) ? <span key={i} style={{ color: 'var(--chart-d)', fontWeight: 700 }}>{c.toUpperCase()}</span> : c === '-' ? <span key={i} style={{ color: 'var(--warn)' }}>-</span> : c))}</code>;

export function CrisprOffTargetPanel() {
  const { run, busy, progress, note, error, cancel } = useRunner(), hand = useHandoff((s) => s.oligos);
  const [src, setSrc] = useState<GenomeSource | null>(null), [text, setText] = useState(''), [nuc, setNuc] = useState('spcas9'), [nag, setNag] = useState(true), [mm, setMm] = useState(4), [dna, setDna] = useState(0), [rna, setRna] = useState(0);
  const [res, setRes] = useState<Awaited<ReturnType<typeof remote.crispr>> | null>(null), [snap, setSnap] = useState<{ guides: Oligo[]; nuc: string }>({ guides: [], nuc: '' }), [pick, setPick] = useState<number | 'all'>('all');
  useEffect(() => { if (hand?.guides.length) { setText(hand.guides.map((p) => `${p.name}\t${p.seq}`).join('\n')); clearHandoffSoon('oligos'); } }, [hand]);
  const N = CRISPR_NUCLEASES.find((n) => n.id === nuc)!, L = N.protoLen;
  // A guide pasted with its PAM (e.g. 23 nt for SpCas9) is trimmed to the protospacer.
  const guides = useMemo(() => parseOligos(text, 'guide').map((g) => ({ ...g, seq: N.pamSide === '3' && g.seq.length === L + 3 ? g.seq.slice(0, L) : g.seq })), [text, N, L]);
  const badLen = guides.some((g) => g.seq.length !== L || /[^ACGT]/.test(g.seq));
  const pams = N.pams.filter((p) => p.primary || nag).map((p) => p.pam);
  const go = () => src && void run({ label: `CRISPR off-targets · ${guides.length} guides`, tool: CRISPR_TOOL, params: { genome: src.kind === 'bundled' ? src.id : src.name, nuclease: N.name, pams: pams.join('/'), maxMismatch: mm, maxDnaBulge: dna, maxRnaBulge: rna, bulges: dna + rna > 0 }, inputs: [{ name: 'guides', data: text }], run: (h) => remote.crispr({ src, guides, nucleaseId: nuc, pams, maxMismatch: mm, maxDnaBulge: dna, maxRnaBulge: rna }, h) }).then((r) => { if (r) { setRes(r); setSnap({ guides, nuc }); setPick('all'); } });
  const rows = res ? res.hits.filter((h) => pick === 'all' || h.guide === pick) : [];
  return (
    <div className="split"><div className="stack">
      <Card title="Guides" sub={`${L}-nt protospacers, 5′→3′ (PAM optional)`}>
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={'name<TAB>GUIDESEQUENCE, one per line'} aria-label="Guides" />
          <div className="row"><button className="btn sm" onClick={() => { setNuc('spcas9'); setText(DEMO_GUIDES); }}>Demo: 3 SpCas9 guides</button><span className="faint" style={{ fontSize: 12 }}>{guides.length} guide{guides.length === 1 ? '' : 's'}</span></div>
          {badLen && guides.length > 0 && <Callout kind="warn">Every guide must be {L} nt of A, C, G, T for {N.name}.</Callout>}
          <GenomePicker onChange={setSrc} />
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Nuclease"><select className="select" value={nuc} onChange={(e) => setNuc(e.target.value)}>{CRISPR_NUCLEASES.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.pams[0].label})</option>)}</select></Field>
            <Field label="Max mismatches"><select className="select" value={mm} onChange={(e) => setMm(+e.target.value)}>{[1, 2, 3, 4, 5, 6].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="DNA bulges (max)"><select className="select" value={dna} onChange={(e) => setDna(+e.target.value)}>{[0, 1, 2].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="RNA bulges (max)"><select className="select" value={rna} onChange={(e) => setRna(+e.target.value)}>{[0, 1, 2].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          {nuc === 'spcas9' && <label className="row" style={{ fontSize: 13, gap: 6 }}><input type="checkbox" checked={nag} onChange={(e) => setNag(e.target.checked)} /> Also accept NAG PAMs (weak, CFD weight 0.26)</label>}
          <div className="row"><button className="btn primary" disabled={busy || !guides.length || badLen || !src} onClick={go}>Find off-targets</button>{busy && <button className="btn" onClick={cancel}>Cancel</button>}</div>
          {busy && <Busy progress={progress} note={note} />}{error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>Limits: the search is exhaustive (every PAM site on both strands, no heuristics) for genomes up to a few tens of Mb. Non-ACGT genome bases count as mismatches. CFD (Doench 2016) and MIT (Hsu 2013) scores are defined for 20-nt SpCas9 guides only; bulged sites and other nucleases are listed without scores. Scores rank risk; they do not prove cutting. Bulges multiply the search time. For human-scale genomes use Cas-OFFinder or CRISPOR on your computer.</Callout>
    </div>
    <div className="stack">{!res ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Paste guides (or send them from Sequence Studio), choose a genome and find off-targets.</div></Card> : <>
      <div className="cols-4"><Stat label="Genome" value={res.genome.name.split(' ').slice(0, 2).join(' ')} hint={res.genome.name} /><Stat label="PAM sites scanned" value={res.pamSites.toLocaleString()} /><Stat label="Sites found" value={res.total} hint={res.total > res.shown ? `showing the best ${res.shown}` : undefined} /><Stat label="Search time" value={`${fmt(res.ms / 1000, 2)} s`} /></div>
      {res.truncated.some(Boolean) && <Callout kind="warn">A guide reached the 50,000-site cap; its list is incomplete. Use fewer mismatches.</Callout>}
      <Card title="Per-guide specificity" pad={false} actions={<button className="btn sm" onClick={() => downloadText('crispr_guide_summary.csv', toCsv(res.perGuide.map((p) => ({ guide: snap.guides[p.guide].name, sequence: snap.guides[p.guide].seq, on_target_sites: p.onTargets, off_target_sites: p.offTargets, cfd_specificity: p.cfdSpecificity?.toFixed(1) ?? '', mit_specificity: p.mitSpecificity?.toFixed(1) ?? '' }))), 'text/csv')}>CSV</button>}>
        <DataTable rows={res.perGuide} rowKey={(p) => String(p.guide)} onRow={(p) => setPick(p.guide)} cols={[{ key: 'n', label: 'Guide', render: (p) => <span><b>{snap.guides[p.guide].name}</b> <code>{snap.guides[p.guide].seq}</code></span> }, { key: 'on', label: 'On-target sites', num: true, sort: (p) => p.onTargets }, { key: 'off', label: 'Off-target sites', num: true, sort: (p) => p.offTargets }, { key: 'cfd', label: 'CFD specificity', num: true, sort: (p) => p.cfdSpecificity ?? -1, render: (p) => (p.cfdSpecificity === null ? '–' : fmt(p.cfdSpecificity, 1)) }, { key: 'mit', label: 'MIT specificity', num: true, sort: (p) => p.mitSpecificity ?? -1, render: (p) => (p.mitSpecificity === null ? '–' : fmt(p.mitSpecificity, 1)) }]} />
        <div className="faint" style={{ fontSize: 11.5, padding: '6px 14px' }}>Specificity = 100/(100 + Σ site scores) over off-target sites; 100 means no off-target found, lower is worse. The first perfect NGG site of each guide is taken as the on-target.</div>
      </Card>
      <Card title="Sites" sub={pick === 'all' ? 'all guides (click a guide above to filter)' : snap.guides[pick].name} pad={false} actions={<><button className="btn sm" onClick={() => setPick('all')}>All</button><button className="btn sm" onClick={() => downloadText('crispr_offtargets.csv', toCsv(res.hits.map((h: CrisprHit) => ({ guide: snap.guides[h.guide].name, sequence: h.contigName, start: h.start + 1, end: h.end, strand: h.strand, pam: h.pam, mismatches: h.mismatches, dna_bulges: h.dnaBulge, rna_bulges: h.rnaBulge, site: h.target, cfd: h.cfd?.toFixed(4) ?? '', mit: h.mit?.toFixed(2) ?? '', on_target: h.onTarget, context: h.where, gene: h.gene, product: h.product }))), 'text/csv')}>CSV</button></>}>
        <DataTable rows={rows} rowKey={(h, i) => `${h.guide}${h.contig}${h.siteStart}${h.strand}${i}`} cols={[{ key: 'g', label: 'Guide', render: (h) => snap.guides[h.guide].name }, { key: 'loc', label: 'Locus', num: true, sort: (h) => h.start, render: (h) => `${h.contigName}:${(h.start + 1).toLocaleString()}${h.strand}` }, { key: 'mm', label: 'Mm', num: true, sort: (h) => h.mismatches, render: (h) => h.mismatches }, { key: 'bu', label: 'Bulges', num: true, render: (h) => (h.dnaBulge || h.rnaBulge ? `${h.dnaBulge}D/${h.rnaBulge}R` : '–') }, { key: 'site', label: 'Site (mismatches in bold)', render: (h) => <span>{marked(snap.nuc === 'cas12a' ? '' : h.target)}<code style={{ color: 'var(--chart-d)' }}> {h.pam}</code>{snap.nuc === 'cas12a' && marked(h.target)}</span> }, { key: 'cfd', label: 'CFD', num: true, sort: (h) => h.cfd ?? -1, render: (h) => (h.cfd === null ? '–' : fmt(h.cfd, 3)) }, { key: 'mit', label: 'MIT', num: true, sort: (h) => h.mit ?? -1, render: (h) => (h.mit === null ? '–' : fmt(h.mit, 1)) }, { key: 'ctx', label: 'Context', render: (h) => (h.onTarget ? <span className="badge live">on-target</span> : h.where) }, { key: 'gene', label: 'Gene', render: (h) => h.gene }]} />
      </Card>
    </>}</div></div>
  );
}
