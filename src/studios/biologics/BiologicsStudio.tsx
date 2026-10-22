import { useEffect, useMemo, useRef, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { Callout, Card, Tabs } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { analyseAntibody, type ChainAnalysis } from './liabilities';
import ChainsTab from './ChainsTab';
import DevelopabilityTab from './DevelopabilityTab';
import CompareTab from './CompareTab';

const TRASTUZUMAB = 'EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS\nDIQMTQSPSSLSASVGDRVTITCRASQDVNTAVAWYQQKPGKAPKLLIYSASFLYSGVPSRFSGSRSGTDFTLTISSLQPEDFATYYCQQHYTTPPTFGQGTKVEIK';
const ADALIMUMAB = 'EVQLVESGGGLVQPGRSLRLSCAASGFTFDDYAMHWVRQAPGKGLEWVSAITWNSGHIDYADSVEGRFTISRDNAKNSLYLQMNSLRAEDTAVYYCAKVSYLSTASSLDYWGQGTLVTVSS\nDIQMTQSPSSLSASVGDRVTITCRASQGIRNYLAWYQQKPGKAPKLLIYAASTLQSGVPSRFSGSGSGTDFTLTISSLQPEDVATYYCQRYNRAPYTFGQGTKVEIK';

type Tab = 'chains' | 'dev' | 'compare';

const TOOL: ToolInfo = {
  id: 'biologics.developability', name: 'Antibody developability screen', version: '0.1.0', engine: 'TypeScript', citations: ['kabat1991', 'raybould2019'],
  describe: (p) => `Kabat-style CDRs were identified from sequence with fixed heuristic rules and ${p.chains} chain(s) were screened for sequence liabilities (deamidation, isomerisation, glycosylation, oxidation, free cysteine) and simple properties (pI, charge at pH 7.4, GRAVY, CDR composition).`,
};

export default function BiologicsStudio() {
  const [tab, setTab] = useState<Tab>('chains');
  const [text, setText] = useState('');
  const { run, error } = useRunner();
  const recorded = useRef('');
  const chains: ChainAnalysis[] = useMemo(() => {
    if (!text.trim()) return [];
    try { return analyseAntibody(text); } catch { return []; }
  }, [text]);
  const err = useMemo(() => {
    if (!text.trim()) return '';
    try { const c = analyseAntibody(text); return c.some((x) => x.cdr.chain === null) ? 'Not recognised as a VH or VL domain. Paste a VH or VL sequence (one chain per line), or an scFv with a GGGGS linker.' : ''; } catch (e) { return (e as Error).message; }
  }, [text]);
  useEffect(() => {
    if (!text.trim() || recorded.current === text) return;
    const t = setTimeout(() => {
      try {
        const c = analyseAntibody(text);
        if (!c.length || c.some((x) => !x.cdr.chain)) return;
        recorded.current = text;
        void run({ label: `Biologics · ${c.length} chain(s)`, tool: TOOL, params: { chains: c.length }, inputs: [{ name: 'antibody sequences', data: text }], run: async () => c.length, summary: () => `CDRs and liabilities were computed for ${c.length} chain(s)` });
      } catch { /* the visible error from the render already explains why */ }
    }, 900);
    return () => clearTimeout(t);
  }, [text, run]);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Biologics Studio</h1><p>Find the Kabat CDRs of a VH or VL domain and screen its sequence liabilities and simple developability properties. Rule-based: confirm everything experimentally.</p></div></div>
      <Card title="1 · Antibody sequence"><div className="stack" style={{ gap: 10 }}>
        <textarea className="input mono" rows={5} style={{ fontSize: 11.5 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste VH and VL (one chain per line) or a single chain" />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setText(TRASTUZUMAB)}>Load trastuzumab</button>
          <button className="btn" onClick={() => setText(ADALIMUMAB)}>Load adalimumab</button>
          <button className="btn ghost" onClick={() => setText('')}>Clear</button>
        </div>
        {text.trim() !== '' && <div className="faint" style={{ fontSize: 12 }}>{chains.length} chain(s): {chains.map((c) => `${c.cdr.chain ?? 'unrecognised'} (${c.seq.length} aa)`).join(' · ')}</div>}
        {err && <Callout kind="err">{err}</Callout>}
        {error && <Callout kind="err">{error}</Callout>}
      </div></Card>
      {chains.length > 0 && chains.every((c) => c.cdr.chain) && <>
        <Tabs value={tab} onChange={setTab} items={[{ id: 'chains', label: 'Chains & CDRs' }, { id: 'dev', label: 'Developability' }, { id: 'compare', label: 'Compare' }]} />
        {tab === 'chains' && <ChainsTab chains={chains} />}
        {tab === 'dev' && <DevelopabilityTab chains={chains} />}
        {tab === 'compare' && <CompareTab />}
      </>}
      <Callout kind="warn">Rule-based screen of sequence liabilities and simple properties. It does not predict immunogenicity, aggregation or expression; confirm experimentally. CDRs use a heuristic Kabat definition (no numbering database).</Callout>
    </div>
  );
}
