import { useMemo } from 'react';
import { Card, Field, fmt } from '@/ui/kit';
import { ScenePlot } from '@/viz/charts';
import { buildPlasmidMap } from '@/viz/figure';
import { digest, ENZYMES } from '@/studios/sequence/kernels';
import type { PlasmidTabProps } from './PlasmidStudio';

const COLORS = ['#D55E00', '#0072B2', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#8a6bc4', '#b45f5f'];

export default function MapTab({ plasmid, features }: PlasmidTabProps) {
  const circular = plasmid.topology === 'circular';
  const singles = useMemo(() => ENZYMES.map((e) => ({ name: e.name, d: digest(plasmid.seq, [e.name], circular) })).filter((x) => x.d.sites.length === 1).map((x) => ({ pos: x.d.sites[0].pos, label: x.name })).sort((a, b) => a.pos - b.pos), [plasmid.seq, circular]);
  const spec = useMemo(() => ({
    name: plasmid.name,
    length: plasmid.seq.length,
    features: features.map((f, i) => ({ start: f.start, end: f.end, strand: f.strand, label: f.label, color: COLORS[i % COLORS.length] })),
    sites: singles,
  }), [plasmid, features, singles]);
  const scene = useMemo(() => buildPlasmidMap(spec, { widthMm: 130, heightMm: 110, fontPt: 8, palette: 'shown', theme: 'light', title: '', xLabel: '', yLabel: '', labelTopN: 0, dpi: 300 }), [spec]);
  return (
    <div className="split"><div className="stack">
      <Card title="Map options"><div className="stack" style={{ gap: 8 }}>
        <Field label="Features drawn">{features.length}</Field>
        <Field label="Unique cutters shown">{singles.length}</Field>
        <div className="faint" style={{ fontSize: 11.5 }}>Position 1 is at 12 o'clock and positions increase clockwise. Arrows point in the direction of the feature; features on the minus strand run anticlockwise.</div>
      </div></Card>
    </div>
    <div className="stack">
      <Card title="Circular map" sub={`${plasmid.seq.length.toLocaleString()} bp`}>
        <ScenePlot scene={scene} build={(o) => buildPlasmidMap(spec, o)} height={420} name="plasmid-map" defaults={{ title: `${plasmid.name} map` }} />
        <div className="faint" style={{ fontSize: 11.5 }}>Use “Export figure” for SVG, PDF or PNG. Unique restriction sites are marked on the outer ring ({fmt(singles.length, 0)} of {ENZYMES.length} enzymes).</div>
      </Card>
    </div></div>
  );
}
