import { Card, Callout, DataTable, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import type { AmrScreenResult } from './amr.worker';

interface FamilyRow { gene: string; product: string; drugClass: string; loci: number; alleles: string; bestIdentity: number; minCoverage: number }

/** Hit table, drug-class summary by gene family and CSV export. */
export default function ResultsTab({ res }: { res: AmrScreenResult | null }) {
  if (!res) return <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Screen an assembly or run a demo to see hits here.</div></Card>;

  const totalBp = res.contigs.reduce((a, c) => a + c.length, 0);
  const families: FamilyRow[] = [...res.hits.reduce((m, h) => {
    const cur = m.get(h.gene);
    if (cur) { cur.loci++; cur.bestIdentity = Math.max(cur.bestIdentity, h.identity); cur.minCoverage = Math.min(cur.minCoverage, h.coverage); cur.alleles = [...new Set([...cur.alleles.split(', '), h.allele])].join(', '); }
    else m.set(h.gene, { gene: h.gene, product: h.product, drugClass: h.drugClass || '–', loci: 1, alleles: h.allele, bestIdentity: h.identity, minCoverage: h.coverage });
    return m;
  }, new Map<string, FamilyRow>()).values()].sort((a, b) => b.loci - a.loci || a.gene.localeCompare(b.gene));

  const recovered = res.truth
    ? res.truth.map((t) => ({ ...t, found: res.hits.some((h) => h.gene === t.gene && h.start <= t.end && h.end >= t.start) }))
    : null;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="cols-4">
        <Stat label="Sequences" value={res.contigs.length} hint={`${totalBp.toLocaleString()} bp screened`} />
        <Stat label="Hits" value={res.hits.length} hint={`≥ ${Math.round(res.minIdentity * 100)} % identity, ≥ ${Math.round(res.minCoverage * 100)} % coverage`} />
        <Stat label="Gene families" value={families.length} />
        <Stat label="Reference genes" value={res.references.toLocaleString()} hint={`AMRFinderPlus database ${res.version}`} />
      </div>
      {res.demo && <Callout><b style={{ color: 'var(--text)' }}>Demo assembly:</b>&nbsp;{res.demo}</Callout>}
      {recovered && (
        recovered.every((r) => r.found)
          ? <Callout><b style={{ color: 'var(--text)' }}>Planted-truth check:</b>&nbsp;all {recovered.length} genes recovered at their planted coordinates.</Callout>
          : <Callout kind="warn"><b style={{ color: 'var(--text)' }}>Planted-truth check:</b>&nbsp;{recovered.filter((r) => r.found).length}/{recovered.length} planted genes recovered: {recovered.filter((r) => !r.found).map((r) => r.gene).join(', ')} not found.</Callout>
      )}
      <Card title="Summary by gene family" sub="one row per gene symbol found" pad={false}
        actions={<button className="btn sm" onClick={() => downloadText('amr_summary.csv', toCsv(families), 'text/csv')}>CSV</button>}>
        <DataTable<FamilyRow> rows={families} rowKey={(r) => r.gene} cols={[
          { key: 'gene', label: 'Gene family', sort: (r) => r.gene },
          { key: 'product', label: 'Product', render: (r) => <span className="dim">{r.product.replace(/_/g, ' ')}</span> },
          { key: 'drugClass', label: 'Drug class', render: (r) => r.drugClass },
          { key: 'loci', label: 'Loci', num: true, sort: (r) => r.loci },
          { key: 'alleles', label: 'Alleles reported' },
          { key: 'bestIdentity', label: 'Best identity', num: true, sort: (r) => r.bestIdentity, render: (r) => `${fmt(r.bestIdentity * 100, 2)} %` },
          { key: 'minCoverage', label: 'Lowest coverage', num: true, sort: (r) => r.minCoverage, render: (r) => `${fmt(r.minCoverage * 100, 1)} %` },
        ]} />
      </Card>
      <Card title="Hits" sub="sorted by sequence and position" pad={false}
        actions={<button className="btn sm" onClick={() => downloadText('amr_hits.csv', toCsv(res.hits), 'text/csv')}>CSV</button>}>
        <DataTable rows={res.hits} rowKey={(h) => `${h.contig}:${h.start}:${h.accession}`} cols={[
          { key: 'gene', label: 'Gene', sort: (h) => h.gene },
          { key: 'allele', label: 'Allele' },
          { key: 'product', label: 'Product', render: (h) => <span className="dim">{h.product.replace(/_/g, ' ')}</span> },
          { key: 'contig', label: 'Sequence', sort: (h) => h.contig },
          { key: 'start', label: 'Start', num: true, sort: (h) => h.start, render: (h) => h.start.toLocaleString() },
          { key: 'end', label: 'End', num: true, render: (h) => h.end.toLocaleString() },
          { key: 'strand', label: 'Strand' },
          { key: 'identity', label: '% Identity', num: true, sort: (h) => h.identity, render: (h) => fmt(h.identity * 100, 2) },
          { key: 'coverage', label: '% Coverage', num: true, sort: (h) => h.coverage, render: (h) => fmt(h.coverage * 100, 1) },
          { key: 'drugClass', label: 'Drug class', render: (h) => h.drugClass || '–' },
          { key: 'subclass', label: 'Subclass', render: (h) => <span className="dim">{h.subclass || '–'}</span> },
          { key: 'accession', label: 'Reference', render: (h) => <span className="dim">{h.accession}</span> },
        ]} />
      </Card>
    </div>
  );
}
