import { useEffect, useMemo, useState } from 'react';
import { Busy, Callout, Card, DataTable, Field, Stat } from '@/ui/kit';
import type { AmrLibrary, AmrLibraryRow } from './amr.worker';

interface Props {
  lib: AmrLibrary | null;
  busy: boolean;
  progress: number;
  note?: string;
  error: string | null;
  load(): void;
}

/** The reference gene set itself: symbols, products, drug classes and lengths. */
export default function LibraryTab({ lib, busy, progress, note, error, load }: Props) {
  const [query, setQuery] = useState('');
  const [cls, setCls] = useState('');

  useEffect(() => { if (!lib && !busy) load(); }, [lib, busy, load]);

  const rows = useMemo<AmrLibraryRow[]>(() => {
    if (!lib) return [];
    const q = query.trim().toLowerCase();
    const out = lib.rows.filter((r) => (!cls || r.drugClass.includes(cls))
      && (!q || r.symbol.toLowerCase().includes(q) || r.allele.toLowerCase().includes(q) || r.product.toLowerCase().includes(q) || r.accession.toLowerCase().includes(q)));
    out.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.allele.localeCompare(b.allele));
    return out;
  }, [lib, query, cls]);

  if (error && !lib) return <Callout kind="err">{error}</Callout>;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {!lib ? (
        <Card title="Reference gene library" sub="NCBI AMRFinderPlus nucleotide reference set">
          <Busy progress={progress} note={note} />
          {error && <Callout kind="err">{error}</Callout>}
        </Card>
      ) : (
        <>
          <div className="cols-4">
            <Stat label="Database version" value={lib.version} hint="as published by NCBI" />
            <Stat label="Reference genes" value={lib.rows.length.toLocaleString()} hint={`${lib.bases.toLocaleString()} bp of coding sequence`} />
            <Stat label="Drug classes" value={lib.classes.length} />
            <Stat label="Matching rows" value={rows.length.toLocaleString()} hint={query || cls ? 'after the filter below' : 'the whole catalogue'} />
          </div>
          <Card title="Genes" sub={`${rows.length.toLocaleString()} of ${lib.rows.length.toLocaleString()} reference records shown, first 300 in the table`} pad={false}>
            <div className="cols-2" style={{ gap: 8, marginBottom: 10 }}>
              <Field label="Search symbol, allele, product or accession"><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. sul1" /></Field>
              <Field label="Drug class"><select className="select" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{lib.classes.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
            </div>
            <DataTable<AmrLibraryRow> rows={rows} rowKey={(r, i) => `${r.accession}:${i}`} cols={[
              { key: 'symbol', label: 'Gene', sort: (r) => r.symbol },
              { key: 'allele', label: 'Allele / family' },
              { key: 'product', label: 'Product', render: (r) => <span className="dim">{r.product.replace(/_/g, ' ')}</span> },
              { key: 'drugClass', label: 'Drug class', render: (r) => r.drugClass || '–' },
              { key: 'subclass', label: 'Subclass', render: (r) => <span className="dim">{r.subclass || '–'}</span> },
              { key: 'length', label: 'Length (bp)', num: true, sort: (r) => r.length, render: (r) => r.length.toLocaleString() },
              { key: 'accession', label: 'Protein accession', render: (r) => <span className="dim">{r.accession}</span> },
            ]} />
          </Card>
          <Callout>Screening seeds on 15-mers and ignores a 15-mer that occurs in more than 50 reference genes, which keeps the index small enough for a browser. Large allele families therefore have no unique seed and are not detected — a gene missing here is not evidence of absence.</Callout>
        </>
      )}
    </div>
  );
}
