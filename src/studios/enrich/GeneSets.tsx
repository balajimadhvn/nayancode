import { useState } from 'react';
import { Callout, Card, DataTable, FileDrop } from '@/ui/kit';
import { parseGmt, type GeneSet } from './gmt';

interface Props {
  sets: GeneSet[];
  source: string;
  onSets(sets: GeneSet[], source: string): void;
  onDemo(): void;
}

export default function GeneSets({ sets, source, onSets, onDemo }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const apply = (raw = text, name = 'pasted GMT') => {
    const parsed = parseGmt(raw);
    if (!parsed.length) { setError('No gene sets were found. Each line needs a name, a description and at least one gene, separated by tabs.'); return; }
    setError('');
    onSets(parsed, name);
  };

  const total = new Set(sets.flatMap((s) => s.genes)).size;

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Gene sets (.gmt)">
        <div className="stack" style={{ gap: 10 }}>
          <FileDrop accept=".gmt,.txt,.tsv" onText={(t, name) => { setText(t); apply(t, name); }} label={source ? `Current: ${source}` : 'Drop a .gmt file or click to browse'} />
          <textarea className="input mono" rows={8} value={text} onChange={(e) => { setText(e.target.value); setError(''); }} spellCheck={false} placeholder={'SET_NAME\tdescription\tGENE1\tGENE2\tGENE3'} aria-label="GMT gene sets" />
          <div className="row"><button className="btn primary" disabled={!text.trim()} onClick={() => apply()}>Use these sets</button><button className="btn sm" onClick={onDemo}>Load demo sets</button></div>
          {error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>Download a collection in GMT format from MSigDB (gsea-msigdb.org), Reactome, WikiPathways or a Gene Ontology export, then drop the file here. No gene-set database is bundled, because their licences differ. Genes are compared upper-case as symbols, so keep the same identifier namespace in your list and your sets.</Callout>
    </div>
    <div className="stack">
      <Card title="Loaded collection" sub={sets.length ? `${sets.length} set(s), ${total.toLocaleString()} unique genes · ${source}` : undefined} pad={false}>
        {!sets.length ? <div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter a GMT collection or load the demo to see its sets.</div> : <DataTable rows={sets} rowKey={(s) => s.name} cols={[
          { key: 'name', label: 'Set' },
          { key: 'description', label: 'Description', render: (s) => <span className="faint">{s.description || '–'}</span> },
          { key: 'size', label: 'Genes', num: true, sort: (s) => s.genes.length, render: (s) => s.genes.length.toLocaleString() },
          { key: 'first', label: 'First genes', render: (s) => <span className="mono faint" style={{ fontSize: 11.5 }}>{s.genes.slice(0, 5).join(' ') || '–'}</span> },
        ]} />}
      </Card>
      {sets.length > 0 && <div className="faint" style={{ fontSize: 12 }}>Names and descriptions are shown exactly as imported. Empty sets are kept only if they have at least one gene; duplicates inside a set are removed.</div>}
    </div></div>
  );
}
