import { useNavigate } from 'react-router-dom';
import { useHandoff } from '@/core/handoff';
import { Callout, Card, DataTable, downloadText, toast } from '@/ui/kit';
import { tableFromRows, type AmpliconResult } from './pipeline';
import type { AmpliconInput } from './AmpliconStudio';

export default function TableTab({ result, input }: { result: AmpliconResult | null; input: AmpliconInput | null }) {
  const nav = useNavigate(), setAmplicon = useHandoff((s) => s.setAmplicon);
  if (!result) return <Card><div className="faint" style={{ padding: '30px 6px', textAlign: 'center' }}>Run the Reads tab (or load the demo) to build the ASV table.</div></Card>;
  const table = tableFromRows(result.rows, result.samples);
  const handoff = () => {
    setAmplicon({ table, label: `Amplicon ASV table · ${result.rows.length} ASVs` });
    toast('ASV table sent to the Microbiome Studio');
    nav('/microbiome');
  };
  const sampleCols = result.samples.map((s) => ({
    key: s, label: s, num: true,
    sort: (r: AmpliconResult['rows'][number]) => r.samples[s] ?? 0,
    render: (r: AmpliconResult['rows'][number]) => (r.samples[s] ?? 0).toLocaleString(),
  }));
  return (
    <>
      <Card title="ASV feature table" sub={`${result.rows.length} ASVs × ${result.samples.length} samples${result.hasTaxonomy ? ' · taxonomy assigned' : ' · no taxonomy reference'}`}
        actions={<button className="btn sm" onClick={() => downloadText('amplicon_feature_table.csv', table, 'text/csv')}>CSV</button>}>
        <DataTable rows={result.rows} rowKey={(r) => r.id} cols={[
          { key: 'id', label: 'ASV', sort: (r) => r.id },
          ...sampleCols,
          { key: 'taxonomy', label: 'taxonomy', render: (r) => <span className="dim" style={{ fontSize: 11.5 }}>{r.taxonomy.join(';') || 'Unclassified'}</span> },
        ]} />
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn primary" onClick={handoff}>Open in Microbiome Studio</button>
          <span className="faint" style={{ fontSize: 11.5 }}>The table is passed in memory (nothing is uploaded) and can be analysed directly for diversity and differential abundance.</span>
        </div>
        {!result.hasTaxonomy && <Callout kind="warn">The taxonomy column says “Unclassified” because no reference was supplied. Add one in the Taxonomy tab and classify, then export again.</Callout>}
      </Card>
      {input?.demo && (
        <Card title="Planted truth (synthetic demo)" sub="The demo mixes were written by the simulator, so the table can be checked against them.">
          <div className="faint" style={{ fontSize: 12 }}>
            {input.demo.mixes.map((mix, i) => `sample${i + 1}: ${mix.map((n, j) => `${input.demo!.genera[j]} ${n}`).join(' · ')}`).join('  |  ')}
          </div>
          <div className="faint" style={{ marginTop: 6, fontSize: 11.5 }}>Denoising merges sequencing errors into their parent ASV, so recovered counts are expected to sit within about 3 % of these planted values.</div>
        </Card>
      )}
    </>
  );
}
