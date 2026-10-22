import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, Tabs, downloadText } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { annotate } from './annotate';
import { FEATURES } from './features-library';
import { parseFastaPlasmid, parseGenBank, toGenBank, type Feature, type Plasmid } from './genbank';
import MapTab from './MapTab';
import FeaturesTab from './FeaturesTab';
import RestrictionTab from './RestrictionTab';
import PrimersTab from './PrimersTab';

const TOOL: ToolInfo = { id: 'plasmid.annotations', name: 'Plasmid annotation', version: '0.1.0', engine: 'TypeScript', citations: ['yanisch1985'], describe: (p) => `Plasmid features were annotated against the built-in library of standard elements (${p.found} features found)` };

/** pUC19c (NCBI L09137.2, 2,686 bp, circular). Public domain sequence from NCBI. */
const PUC19 = 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGCGGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCTGGCTTAACTATGCGGCATCAGAGCAGATTGTACTGAGAGTGCACCATATGCGGTGTGAAATACCGCACAGATGCGTAAGGAGAAAATACCGCATCAGGCGCCATTCGCCATTCAGGCTGCGCAACTGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACGCCAGCTGGCGAAAGGGGGATGTGCTGCAAGGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGTAAAACGACGGCCAGTGAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCATAAAGTGTAAAGCCTGGGGTGCCTAATGAGTGAGCTAACTCACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCAGTCGGGAAACCTGTCGTGCCAGCTGCATTAATGAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGCTCTTCCGCTTCCTCGCTCACTGACTCGCTGCGCTCGGTCGTTCGGCTGCGGCGAGCGGTATCAGCTCACTCAAAGGCGGTAATACGGTTATCCACAGAATCAGGGGATAACGCAGGAAAGAACATGTGAGCAAAAGGCCAGCAAAAGGCCAGGAACCGTAAAAAGGCCGCGTTGCTGGCGTTTTTCCATAGGCTCCGCCCCCCTGACGAGCATCACAAAAATCGACGCTCAAGTCAGAGGTGGCGAAACCCGACAGGACTATAAAGATACCAGGCGTTTCCCCCTGGAAGCTCCCTCGTGCGCTCTCCTGTTCCGACCCTGCCGCTTACCGGATACCTGTCCGCCTTTCTCCCTTCGGGAAGCGTGGCGCTTTCTCATAGCTCACGCTGTAGGTATCTCAGTTCGGTGTAGGTCGTTCGCTCCAAGCTGGGCTGTGTGCACGAACCCCCCGTTCAGCCCGACCGCTGCGCCTTATCCGGTAACTATCGTCTTGAGTCCAACCCGGTAAGACACGACTTATCGCCACTGGCAGCAGCCACTGGTAACAGGATTAGCAGAGCGAGGTATGTAGGCGGTGCTACAGAGTTCTTGAAGTGGTGGCCTAACTACGGCTACACTAGAAGAACAGTATTTGGTATCTGCGCTCTGCTGAAGCCAGTTACCTTCGGAAAAAGAGTTGGTAGCTCTTGATCCGGCAAACAAACCACCGCTGGTAGCGGTGGTTTTTTTGTTTGCAAGCAGCAGATTACGCGCAGAAAAAAAGGATCTCAAGAAGATCCTTTGATCTTTTCTACGGGGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGATTTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTTAAATTAAAAATGAAGTTTTAAATCAATCTAAAGTATATATGAGTAAACTTGGTCTGACAGTTACCAATGCTTAATCAGTGAGGCACCTATCTCAGCGATCTGTCTATTTCGTTCATCCATAGTTGCCTGACTCCCCGTCGTGTAGATAACTACGATACGGGAGGGCTTACCATCTGGCCCCAGTGCTGCAATGATACCGCGAGACCCACGCTCACCGGCTCCAGATTTATCAGCAATAAACCAGCCAGCCGGAAGGGCCGAGCGCAGAAGTGGTCCTGCAACTTTATCCGCCTCCATCCAGTCTATTAATTGTTGCCGGGAAGCTAGAGTAAGTAGTTCGCCAGTTAATAGTTTGCGCAACGTTGTTGCCATTGCTACAGGCATCGTGGTGTCACGCTCGTCGTTTGGTATGGCTTCATTCAGCTCCGGTTCCCAACGATCAAGGCGAGTTACATGATCCCCCATGTTGTGCAAAAAAGCGGTTAGCTCCTTCGGTCCTCCGATCGTTGTCAGAAGTAAGTTGGCCGCAGTGTTATCACTCATGGTTATGGCAGCACTGCATAATTCTCTTACTGTCATGCCATCCGTAAGATGCTTTTCTGTGACTGGTGAGTACTCAACCAAGTCATTCTGAGAATAGTGTATGCGGCGACCGAGTTGCTCTTGCCCGGCGTCAATACGGGATAATACCGCGCCACATAGCAGAACTTTAAAAGTGCTCATCATTGGAAAACGTTCTTCGGGGCGAAAACTCTCAAGGATCTTACCGCTGTTGAGATCCAGTTCGATGTAACCCACTCGTGCACCCAACTGATCTTCAGCATCTTTTACTTTCACCAGCGTTTCTGGGTGAGCAAAAACAGGAAGGCAAAATGCCGCAAAAAAGGGAATAAGGGCGACACGGAAATGTTGAATACTCATACTCTTCCTTTTTCAATATTATTGAAGCATTTATCAGGGTTATTGTCTCATGAGCGGATACATATTTGAATGTATTTAGAAAAATAAACAAATAGGGGTTCCGCGCACATTTCCCCGAAAAGTGCCACCTGACGTCTAAGAAACCATTATTATCATGACATTAACCTATAAAAATAGGCGTATCACGAGGCCCTTTCGTC';

export interface PlasmidTabProps {
  plasmid: Plasmid;
  features: Feature[];
  setFeatures(f: Feature[]): void;
}

type Tab = 'map' | 'features' | 'restriction' | 'primers';

export default function PlasmidStudio() {
  const [tab, setTab] = useState<Tab>('map');
  const [plasmid, setPlasmid] = useState<Plasmid | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const { run, error } = useRunner();

  const load = (p: Plasmid) => {
    const found = annotate(p.seq, FEATURES, { circular: p.topology === 'circular' });
    setPlasmid({ ...p, features: found });
    setFeatures(found.filter((f) => f.label !== 'source'));
    setErr('');
  };
  const demo = () => { setText(''); load({ name: 'pUC19', topology: 'circular', seq: PUC19, features: [] }); void run({ label: 'Plasmid · pUC19', tool: TOOL, params: { found: FEATURES.length }, inputs: [{ name: 'sequence', data: PUC19 }], run: async () => PUC19.length }); };
  const parse = (t: string) => {
    try {
      const p = /^LOCUS|\nORIGIN/.test(t) ? parseGenBank(t) : parseFastaPlasmid(t);
      setText(t);
      load(p);
      void run({ label: `Plasmid · ${p.name}`, tool: TOOL, params: { found: annotate(p.seq, FEATURES, { circular: p.topology === 'circular' }).length }, inputs: [{ name: 'plasmid', data: t }], run: async () => p.seq.length });
    } catch (e) { setErr((e as Error).message); setPlasmid(null); }
  };

  const props = useMemo(() => (plasmid ? { plasmid, features, setFeatures } : null), [plasmid, features]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Plasmid Studio</h1><p>Import a GenBank or FASTA plasmid, annotate the standard elements it carries, cut it in silico and check primers. Everything runs locally; the built-in element library is small and explicit.</p></div></div>
      <Card title="1 · Plasmid"><div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={demo}>Load pUC19 demo (2,686 bp)</button>
          <button className="btn" disabled={!plasmid} onClick={() => plasmid && downloadText(`${plasmid.name}.gb`, toGenBank({ ...plasmid, features }), 'chemical/seq-na-genbank')}>Download GenBank</button>
          <label className="btn" style={{ cursor: 'pointer' }}>Open GenBank / FASTA<input type="file" accept=".gb,.gbk,.genbank,.fa,.fasta,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) parse(await f.text()); e.target.value = ''; }} /></label>
        </div>
        <textarea className="input mono" rows={4} style={{ fontSize: 11 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a GenBank flat file or a FASTA sequence" />
        <div className="row" style={{ gap: 6 }}><button className="btn sm" disabled={!text.trim()} onClick={() => parse(text)}>Import pasted sequence</button>{plasmid && <span className="faint" style={{ fontSize: 12 }}>{plasmid.name} · {plasmid.seq.length.toLocaleString()} bp · {plasmid.topology} · {features.length} feature(s)</span>}</div>
        {plasmid && features.length > 0 && <div className="faint" style={{ fontSize: 12 }}>Annotated: {features.map((f) => `${f.label} (${f.start}..${f.end}${f.strand === -1 ? ', −' : ''})`).join(' · ')}</div>}
        {err && <Callout kind="err">{err}</Callout>}
        {error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      {!plasmid || !props ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load the pUC19 demo or import your own plasmid.</div></Card> : <>
        <Tabs value={tab} onChange={setTab} items={[{ id: 'map', label: 'Map' }, { id: 'features', label: 'Features' }, { id: 'restriction', label: 'Restriction map' }, { id: 'primers', label: 'Primers & checks' }]} />
        {tab === 'map' && <MapTab {...props} />}
        {tab === 'features' && <FeaturesTab {...props} />}
        {tab === 'restriction' && <RestrictionTab {...props} />}
        {tab === 'primers' && <PrimersTab {...props} />}
      </>}
      <Callout kind="warn">Automatic annotation covers only the standard elements in the built-in library; confirm important features by sequencing.</Callout>
    </div>
  );
}
