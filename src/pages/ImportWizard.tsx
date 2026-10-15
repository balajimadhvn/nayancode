import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHandoff } from '@/core/handoff';
import { buildSheet, convertRnaseqCounts, detect, parseMultiqc, readText, suggestGroups, type Detected } from '@/core/nfcore';
import { Callout, Card, DataTable, Field, fmt } from '@/ui/kit';

interface Item { name: string; size: number; text: string; det: Detected }
const KIND_LABEL: Record<string, string> = { 'rnaseq-counts': 'RNA-seq counts', 'tenx-matrix': '10x matrix', 'tenx-features': '10x features', 'tenx-barcodes': '10x barcodes', vcf: 'VCF', 'multiqc-general': 'MultiQC stats', samplesheet: 'Samplesheet', unknown: 'Unrecognised' };

/** Import wizard for nf-core pipeline outputs. Files are read in the browser and handed to a studio in memory; nothing is uploaded. */
export default function ImportWizard() {
  const nav = useNavigate(), hand = useHandoff();
  const [items, setItems] = useState<Item[]>([]), [err, setErr] = useState(''), [useSymbols, setUseSymbols] = useState(true), [groups, setGroups] = useState<string[]>([]);
  const by = (k: string) => items.filter((i) => i.det.kind === k);
  const counts = by('rnaseq-counts')[0], vcf = by('vcf')[0], mx = by('tenx-matrix')[0], ft = by('tenx-features')[0], bc = by('tenx-barcodes')[0], qc = by('multiqc-general')[0];
  const conv = useMemo(() => { if (!counts) return null; try { return convertRnaseqCounts(counts.text, useSymbols); } catch (e) { return { error: (e as Error).message }; } }, [counts, useSymbols]);
  const samples = conv && 'samples' in conv ? conv.samples : [];
  const suggested = useMemo(() => suggestGroups(samples), [samples]);
  const g = samples.map((_, i) => groups[i] ?? suggested[i] ?? '');
  const mqc = useMemo(() => { if (!qc) return null; try { return parseMultiqc(qc.text); } catch { return null; } }, [qc]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return; setErr('');
    try {
      const out: Item[] = [];
      for (const f of [...files]) { const text = await readText(f); out.push({ name: f.name, size: f.size, text, det: detect(f.name, text.slice(0, 2048)) }); }
      setItems(out); setGroups([]);
    } catch (e) { setErr((e as Error).message); }
  };
  const ready = { expr: conv && 'samples' in conv && g.every(Boolean) && new Set(g).size >= 2, sc: !!(mx && ft && bc), vcf: !!vcf };
  const toExpression = () => { if (!conv || !('samples' in conv)) return; hand.setExpr({ counts: conv.csv, sheet: buildSheet(conv.samples, g), label: counts!.name }); nav('/expression'); };
  const toSc = () => { hand.setSc({ mtx: mx!.text, features: ft!.text, barcodes: bc!.text, label: mx!.name.replace(/\.gz$/i, '') }); nav('/single-cell'); };
  const toVcf = () => { hand.setVcf({ text: vcf!.text, label: vcf!.name }); nav('/variants'); };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head"><div><h1>Import nf-core results</h1><p>Run the heavy pipeline anywhere (your laptop, a cluster, GitHub Actions), then drop its output here. Files are read and decompressed in your browser and passed to a studio in memory; nothing is uploaded.</p></div></div>
      <Card title="1 · Choose files">
        <label className="dropzone"><input type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} />{items.length ? `${items.length} file(s) loaded` : 'Select output files (.tsv / .csv / .vcf / .mtx, optionally .gz)'}
          <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>nf-core/rnaseq: <code>salmon.merged.gene_counts.tsv</code> · nf-core/scrnaseq: <code>matrix.mtx</code> + <code>features.tsv</code> + <code>barcodes.tsv</code> · nf-core/sarek: <code>*.vcf.gz</code> · MultiQC: <code>multiqc_general_stats.txt</code></div></label>
        {err && <div style={{ marginTop: 10 }}><Callout kind="err">{err}</Callout></div>}
        {items.length > 0 && <div style={{ marginTop: 12 }}><DataTable rows={items} rowKey={(r) => r.name} cols={[{ key: 'name', label: 'File' }, { key: 'k', label: 'Detected as', render: (r) => KIND_LABEL[r.det.kind] }, { key: 'p', label: 'Pipeline', render: (r) => r.det.pipeline || '–' }, { key: 's', label: 'Size', num: true, render: (r) => `${fmt(r.size / 1e6, 2)} MB`, sort: (r) => r.size }]} /></div>}
      </Card>
      {conv && 'error' in conv && <Callout kind="err">{conv.error}</Callout>}
      {conv && 'samples' in conv && <Card title="2 · RNA-seq counts → Expression Studio" sub={`${conv.nGenes.toLocaleString()} genes · ${conv.samples.length} samples · IDs: ${conv.idColumn}${conv.mergedDuplicates ? ` · ${conv.mergedDuplicates} duplicate symbols summed` : ''}`}>
        <div className="stack" style={{ gap: 10 }}>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={useSymbols} onChange={(e) => setUseSymbols(e.target.checked)} /> Use gene symbols (needed for pathway enrichment); untick to keep Ensembl IDs</label>
          <div className="cols-2" style={{ gap: 8 }}>{conv.samples.map((s, i) => <Field key={s} label={s}><input className="input" placeholder="group, e.g. control" value={g[i]} onChange={(e) => { const n = [...g]; n[i] = e.target.value.trim(); setGroups(n); }} /></Field>)}</div>
          {!ready.expr && <Callout>Give every sample a group and use at least two different groups. Replicate suffixes such as _REP1 are grouped automatically.</Callout>}
          <div className="row"><button className="btn primary" disabled={!ready.expr} onClick={toExpression}>Open in Expression Studio</button></div>
        </div>
      </Card>}
      {(mx || ft || bc) && <Card title="3 · Single-cell matrix → Single-Cell Studio">
        {ready.sc ? <button className="btn primary" onClick={toSc}>Open in Single-Cell Studio</button> : <Callout>Select all three of matrix.mtx, features.tsv (or genes.tsv) and barcodes.tsv together.</Callout>}
      </Card>}
      {vcf && <Card title="4 · Variants → Variant Studio" sub={vcf.name}><button className="btn primary" onClick={toVcf}>Open in Variant Studio</button></Card>}
      {mqc && <Card title="MultiQC general statistics" sub={`${mqc.rows.length} samples`}><DataTable rows={mqc.rows} rowKey={(r) => r[mqc.columns[0]]} cols={mqc.columns.slice(0, 8).map((c, i) => ({ key: c, label: c.replace(/^.*?[-_]/, ''), num: i > 0, render: (r: Record<string, string>) => r[c] }))} /></Card>}
      <Callout>Running nf-core pipelines themselves needs compute that a free static site cannot provide. Run them on your own machine or on free CI, then bring the results here for interpretation.</Callout>
    </div>
  );
}
