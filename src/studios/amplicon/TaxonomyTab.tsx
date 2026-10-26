import type { ToolInfo } from '@/core/provenance';
import { createRemote } from '@/compute/rpc';
import { Busy, Callout, Card, DataTable, FileDrop, Stat } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { RANKS } from './classify';
import type { AmpliconResult } from './pipeline';
import type { AmpliconKernels } from './amplicon.worker';

const remote = createRemote<AmpliconKernels>(() => new Worker(new URL('./amplicon.worker.ts', import.meta.url), { type: 'module' }));
const TOOL: ToolInfo = {
  id: 'amplicon.taxonomy', name: 'Naive Bayes amplicon taxonomy', version: '0.1.0',
  engine: 'TypeScript 8-mer naive Bayes classifier with 100 bootstrap replicates',
  citations: ['wang2007'],
  describe: (p) => `${p.seqs} ASVs were classified against a user-supplied reference FASTA with an RDP-style 8-mer naive Bayes model (P(w|taxon) = (n_w + 0.5)/(N + 1)) and 100 bootstrap replicates; ranks are reported down to the deepest rank with confidence ≥ 0.8`,
};

export default function TaxonomyTab({ result, setResult, reference, setReference, referenceName }: {
  result: AmpliconResult | null; setResult(v: AmpliconResult): void;
  reference: string; setReference(t: string, n: string): void; referenceName: string;
}) {
  const { run, busy, progress, note, error } = useRunner();
  const go = () => {
    if (!result) return;
    void run({
      label: `Amplicon taxonomy · ${result.rows.length} ASVs`, tool: TOOL,
      params: { seqs: result.rows.length, bootstrap: 100 }, inputs: [{ name: 'reference', data: reference.slice(0, 2_000_000) }],
      run: (h) => remote.taxonomy({ seqs: result.rows.map((r) => r.seq), reference, bootstrap: 100, seed: 1 }, { onProgress: h.onProgress }),
    }).then((tax) => {
      if (!tax) return;
      setResult({
        ...result, hasTaxonomy: true,
        rows: result.rows.map((r, i) => ({ ...r, taxonomy: tax.calls[i]?.lineage ?? [], confidence: tax.calls[i]?.confidences ?? [], genus: tax.calls[i]?.genus ?? '' })),
      });
    });
  };
  const depth = Math.max(1, ...(result?.rows.map((r) => r.taxonomy.length) ?? [0]));
  const rankCols = RANKS.slice(0, depth).map((rank, i) => ({
    key: `r${i}`, label: rank,
    render: (r: AmpliconResult['rows'][number]) => r.taxonomy[i]
      ? <span>{r.taxonomy[i]} <span className="faint">{Math.round((r.confidence[i] ?? 0) * 100)}%</span></span>
      : <span className="faint">–</span>,
  }));
  const classified = result ? result.rows.filter((r) => r.taxonomy.length > 0).length : 0;
  return (
    <>
      <Card title="Reference taxonomy" sub="No database is bundled. Use a FASTA whose headers are >id Kingdom;Phylum;Class;Order;Family;Genus;Species (any depth, semicolon-separated).">
        <div className="stack" style={{ gap: 10 }}>
          <FileDrop accept=".fasta,.fa,.fna,.fas,.txt" onText={(t, n) => setReference(t, n)} label={referenceName ? `Reference loaded: ${referenceName}` : 'Drop a reference FASTA (SILVA, Greengenes or UNITE export)'} />
          <div className="faint" style={{ fontSize: 11.5 }}>Download a reference from the SILVA, Greengenes or UNITE project sites and reformat the headers to carry the lineage. Check the licence before redistributing it; your file stays in this browser tab.</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={!result || !reference.trim() || busy} onClick={go}>Classify ASVs</button>
            {busy && <span className="faint">{note}</span>}
          </div>
          {busy && <Busy progress={progress} note={note} />}
          {error && <Callout kind="err">{error}</Callout>}
          {!result && <div className="faint">Run the Reads tab first; classification is applied to the called ASVs.</div>}
        </div>
      </Card>
      {result && (
        <Card title="Rank assignments" sub="Ranks are shown down to the deepest level whose 100-replicate bootstrap confidence reaches 0.8. Percentages are the fraction of replicates agreeing.">
          {classified === 0 ? <div className="faint" style={{ padding: '18px 4px' }}>No ASV has been classified yet. {referenceName ? 'Press “Classify ASVs” above.' : 'Drop a reference FASTA above.'}</div> : <>
            <div className="cols-3">
              <Stat label="ASVs classified" value={`${classified} / ${result.rows.length}`} />
              <Stat label="Reference" value={referenceName || 'loaded'} />
              <Stat label="Ranks" value={depth} />
            </div>
            <DataTable rows={result.rows} rowKey={(r) => r.id} cols={[
              { key: 'id', label: 'ASV', sort: (r) => r.id },
              { key: 'genus', label: 'Genus call', sort: (r) => r.genus, render: (r) => r.genus || <span className="faint">–</span> },
              ...rankCols,
            ]} />
            <div className="faint" style={{ marginTop: 8, fontSize: 11.5 }}>The classifier is only as good as the reference: missing taxa and wrongly formatted lineages cannot be recovered. Bootstrap confidence is not a probability that the call is correct.</div>
          </>}
        </Card>
      )}
    </>
  );
}
