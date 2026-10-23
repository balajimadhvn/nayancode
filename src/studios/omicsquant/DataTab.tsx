import { useMemo } from 'react';
import { Callout, Card, DataTable, FileDrop, Stat, fmt } from '@/ui/kit';
import { missingnessSummary } from './prep';
import type { OmicsView } from './OmicsQuantStudio';

export default function DataTab({ view, matrixText, sheetText, onMatrix, onSheet, demo }: {
  view: OmicsView; matrixText: string; sheetText: string; onMatrix(t: string): void; onSheet(t: string): void; demo(): void;
}) {
  const summary = useMemo(() => (view.raw ? missingnessSummary(view.raw) : null), [view.raw]);
  const rows = summary && view.raw ? summary.perSample.map((s, j) => ({ ...s, group: view.groups?.[j] ?? '' })) : [];
  const anyMissing = summary ? summary.perFeature.filter((f) => f.missing > 0).length : 0;
  const mostlyMissing = summary ? summary.perFeature.filter((f) => f.pct > 50).length : 0;
  const total = view.raw ? view.raw.ids.length * view.raw.samples.length : 0;
  const missing = summary ? summary.perFeature.reduce((a, f) => a + f.missing, 0) : 0;
  const levels = view.groups ? [...new Set(view.groups)] : [];
  return (
    <div className="split"><div className="stack">
      <Card title="1 · Intensity matrix"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={onMatrix} label={matrixText ? 'Matrix loaded' : 'CSV/TSV: feature id column, then one column per sample'} />
        {view.error && <Callout kind="err">{view.error}</Callout>}
        <div className="faint" style={{ fontSize: 12 }}>Blank, NA, NaN and zero are treated as missing. MaxQuant proteinGroups.txt is detected automatically: <code>LFQ intensity</code> / <code>Intensity</code> columns become the samples and rows flagged Reverse, Potential contaminant or Only identified by site are dropped.</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={demo}>Load demo (600 features × 6 samples)</button>
          {matrixText && <button className="btn" onClick={() => { onMatrix(''); onSheet(''); }}>Clear</button>}
        </div>
      </div></Card>
      <Card title="2 · Sample sheet"><div className="stack" style={{ gap: 10 }}>
        <FileDrop accept=".csv,.tsv,.txt" onText={onSheet} label={sheetText ? 'Sample sheet loaded' : 'CSV/TSV: sample, group (an optional third column is ignored)'} />
        {view.sheetError && <Callout kind="err">{view.sheetError}</Callout>}
        {levels.length > 0 && <div className="faint" style={{ fontSize: 12 }}>{levels.length} group{levels.length > 1 ? 's' : ''}: {levels.join(' · ')}</div>}
      </div></Card>
    </div>
    <div className="stack">
      {!view.raw || !summary ? <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load an intensity matrix (or the demo) to inspect missingness.</div></Card> : <>
        <div className="cols-3">
          <Stat label="Features" value={view.raw.ids.length.toLocaleString()} hint={`${view.raw.samples.length} samples`} />
          <Stat label="Missing cells" value={`${fmt((100 * missing) / Math.max(1, total), 1)}%`} hint={`${missing.toLocaleString()} of ${total.toLocaleString()}`} />
          <Stat label="Features with missing" value={anyMissing.toLocaleString()} hint={`${mostlyMissing} are > 50% missing`} />
        </div>
        <Card title="Missingness by sample" pad={false}><DataTable rowKey={(r) => r.sample} rows={rows} cols={[
          { key: 'sample', label: 'Sample' },
          { key: 'group', label: 'Group' },
          { key: 'missing', label: 'Missing', num: true, render: (r) => r.missing.toLocaleString() },
          { key: 'pct', label: '% missing', num: true, render: (r) => fmt(r.pct, 1) },
        ]} /></Card>
        <Callout>{view.groups ? 'Next: choose normalisation and imputation on the “Normalise & impute” tab, then test a contrast on “Differential abundance”.' : 'Add a sample sheet with sample and group columns to unlock group-wise filtering and the differential test.'}</Callout>
      </>}
    </div></div>
  );
}
