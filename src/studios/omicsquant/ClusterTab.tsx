import { useMemo, useState } from 'react';
import { Callout, Card, Stat, fmt } from '@/ui/kit';
import { Heatmap, Scatter, cssVar, type Pt } from '@/viz/charts';
import { heatmap, quantPca } from './prep';
import type { OmicsView } from './OmicsQuantStudio';

export default function ClusterTab({ view }: { view: OmicsView }) {
  const [pcX, setPcX] = useState(0), [pcY, setPcY] = useState(1), [topN, setTopN] = useState(40);
  const pca = useMemo(() => {
    if (!view.prepared) return { res: null, error: null };
    try { return { res: quantPca(view.prepared, 4), error: null }; } catch (e) { return { res: null, error: (e as Error).message }; }
  }, [view.prepared]);
  const heat = useMemo(() => {
    if (!view.prepared) return { res: null, error: null };
    try { return { res: heatmap(view.prepared, topN), error: null }; } catch (e) { return { res: null, error: (e as Error).message }; }
  }, [view.prepared, topN]);
  const levels = view.groups ? [...new Set(view.groups)] : [];
  const palette = [cssVar('--chart-a'), cssVar('--chart-b'), cssVar('--chart-c'), cssVar('--chart-d')];
  const points: Pt[] = pca.res ? pca.res.scores.map((s, j) => ({ x: s[pcX] ?? 0, y: s[pcY] ?? 0, cat: view.groups ? Math.max(0, levels.indexOf(view.groups[j])) : 0, label: `${view.prepared!.samples[j]}${view.groups ? ` (${view.groups[j]})` : ''}` })) : [];

  if (!view.prepared) return <Card><div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Load an intensity matrix first.</div></Card>;
  return <div className="stack">
    <div className="cols-3">
      <Stat label="Features" value={view.prepared.ids.length.toLocaleString()} hint={`${view.prepared.samples.length} samples`} />
      <Stat label="PCA features" value={pca.res ? pca.res.nFeatures.toLocaleString() : '—'} hint="top-variance features" />
      <Stat label="Heat-map rows" value={heat.res ? heat.res.rows.length.toLocaleString() : '—'} hint="row z-scores, clustered" />
    </div>
    {(pca.error || heat.error) && <Callout kind="warn">{pca.error ?? heat.error}</Callout>}
    {pca.res && <Card title="Principal components" sub="samples over the top-variance features" actions={<>
      <select className="select" style={{ width: 80 }} value={pcX} onChange={(e) => setPcX(+e.target.value)}>{pca.res.varExplained.map((_, i) => <option key={i} value={i}>PC{i + 1}</option>)}</select>
      <select className="select" style={{ width: 80 }} value={pcY} onChange={(e) => setPcY(+e.target.value)}>{pca.res.varExplained.map((_, i) => <option key={i} value={i}>PC{i + 1}</option>)}</select>
    </>}>
      <Scatter points={points} colors={palette} names={levels.length ? levels : ['samples']} xLabel={`PC${pcX + 1} (${fmt((pca.res.varExplained[pcX] ?? 0) * 100, 1)}%)`} yLabel={`PC${pcY + 1} (${fmt((pca.res.varExplained[pcY] ?? 0) * 100, 1)}%)`} radius={7} height={400} exportName="omics-pca" />
    </Card>}
    <Card title="Clustered heat map" sub="row z-scores of the most variable features; rows ordered by UPGMA (1 − Pearson r)" actions={
      <select className="select" style={{ width: 110 }} value={topN} onChange={(e) => setTopN(+e.target.value)}><option value={20}>Top 20</option><option value={40}>Top 40</option><option value={60}>Top 60</option></select>
    }>
      {heat.res ? <Heatmap rows={heat.res.rows} cols={heat.res.cols} z={heat.res.z} height={Math.max(300, heat.res.rows.length * 12 + 70)} /> : <div className="faint">No heat map available.</div>}
    </Card>
    <Callout>PCA and clustering use the filtered, normalised and imputed matrix, so the choice of imputation method affects these views. Samples are coloured by the groups in the sample sheet.</Callout>
  </div>;
}
