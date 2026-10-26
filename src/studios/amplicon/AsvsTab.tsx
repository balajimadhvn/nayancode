import { Callout, Card, DataTable, Stat, downloadText } from '@/ui/kit';
import type { AmpliconResult } from './pipeline';

type Row = AmpliconResult['rows'][number];

export default function AsvsTab({ result }: { result: AmpliconResult | null }) {
  if (!result) return <Card><div className="faint" style={{ padding: '30px 6px', textAlign: 'center' }}>Run the Reads tab (or load the demo) to call ASVs.</div></Card>;
  const rows: Row[] = [...result.rows, ...result.chimeras].sort((a, b) => b.abundance - a.abundance || a.id.localeCompare(b.id));
  return (
    <>
      <Card title="Amplicon sequence variants" sub={`${result.rows.length} kept · ${result.chimeras.length} chimera${result.chimeras.length === 1 ? '' : 's'} removed · ${result.samples.length} sample${result.samples.length === 1 ? '' : 's'}`}
        actions={<button className="btn sm" onClick={() => downloadText('amplicon_asvs.fasta', result.fasta)}>FASTA</button>}>
        <div className="cols-3">
          <Stat label="ASVs" value={result.rows.length} />
          <Stat label="Non-chimeric reads" value={result.stages.merged.toLocaleString()} />
          <Stat label="Chimeras" value={result.chimeras.length} hint="two-parent UCHIME-style model" />
        </div>
        <DataTable rows={rows} rowKey={(r) => r.id} cols={[
          { key: 'id', label: 'ASV', sort: (r) => r.id },
          { key: 'length', label: 'Length', num: true, sort: (r) => r.length, render: (r) => `${r.length} bp` },
          { key: 'abundance', label: 'Abundance', num: true, sort: (r) => r.abundance, render: (r) => r.abundance.toLocaleString() },
          { key: 'genus', label: 'Genus', render: (r) => r.genus ? <span className="dim">{r.genus}</span> : <span className="faint">–</span> },
          { key: 'chimera', label: 'Status', render: (r) => <span className="badge" style={r.chimera ? { color: 'var(--chart-b)' } : undefined}>{r.chimera ? 'chimera · removed' : 'kept'}</span> },
        ]} />
        <div className="faint" style={{ marginTop: 8, fontSize: 11.5 }}>FASTA contains the kept ASVs only; chimeras are listed here so the removal can be audited. Abundances pool every sample and merged read.</div>
        {result.chimeras.length > 0 && <Callout kind="warn">Chimeras are excluded from the feature table, but their read counts remain in the stage totals above.</Callout>}
      </Card>
    </>
  );
}
