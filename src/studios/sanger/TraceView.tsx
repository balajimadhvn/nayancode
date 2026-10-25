/** SVG electropherogram window with base letters, quality bars and mixed-peak marks. */
import type { AbifTrace } from './abif';
import type { MixedPeak } from './trim';
import { cssVar } from '@/viz/charts';

interface Props {
  trace: AbifTrace;
  start: number;
  span: number;
  mixed: MixedPeak[];
  onCenter(i: number): void;
}

const STEP = 10;

export default function TraceView({ trace, start, span, mixed, onCenter }: Props) {
  const total = trace.traces.A.length;
  const n = trace.bases.length;
  const first = Math.max(0, Math.min(start, Math.max(0, n - span)));
  const colors: Record<string, string> = { A: '#1f9d55', C: '#2563eb', G: cssVar('--text') || '#333', T: '#dc2626' };
  const mixedAt = new Map(mixed.map((m) => [m.index, m]));
  const sx = (sample: number) => 8 + ((sample - 10) / 12 - first) * STEP + STEP / 2;
  const lo = Math.max(0, Math.floor(10 + 12 * first - 12));
  const hi = Math.min(total - 1, Math.ceil(10 + 12 * (first + span) + 12));
  let max = 1;
  for (const b of ['A', 'C', 'G', 'T'] as const) for (let s = lo; s <= hi; s++) max = Math.max(max, trace.traces[b][s] ?? 0);
  const height = 330, traceTop = 8, traceH = 190, baseY = 238, qTop = 258;
  const width = 16 + span * STEP;

  return (
    <div className="table-wrap" style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} role="img" aria-label="Electropherogram" style={{ display: 'block', minWidth: width }}>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={0} x2={width} y1={traceTop + traceH * (1 - f)} y2={traceTop + traceH * (1 - f)} stroke={cssVar('--border')} strokeWidth={0.5} />)}
        {(['A', 'C', 'G', 'T'] as const).map((b) => {
          const pts: string[] = [];
          for (let s = lo; s <= hi; s++) pts.push(`${sx(s).toFixed(1)},${(traceTop + traceH - ((trace.traces[b][s] ?? 0) / max) * traceH).toFixed(1)}`);
          return <polyline key={b} points={pts.join(' ')} fill="none" stroke={colors[b]} strokeWidth={0.9} opacity={0.85} />;
        })}
        {Array.from({ length: Math.min(span, n - first) }, (_, k) => {
          const i = first + k, x = sx(trace.peaks[i] ?? 10 + 12 * i), mixedPeak = mixedAt.get(i);
          return <g key={i} onClick={() => onCenter(i)} style={{ cursor: 'pointer' }}>
            <rect x={x - STEP / 2} y={0} width={STEP} height={height} fill="transparent" />
            <text x={x} y={baseY} textAnchor="middle" fontSize={11.5} fontFamily={cssVar('--mono')} fill={mixedPeak ? '#dc2626' : colors[trace.bases[i]] ?? cssVar('--text')} fontWeight={mixedPeak ? 700 : 500}>{trace.bases[i] ?? 'N'}</text>
            {mixedPeak && <text x={x} y={baseY + 14} textAnchor="middle" fontSize={9} fill="#dc2626">{mixedPeak.code}</text>}
            <rect x={x - 2} y={qTop + (1 - Math.min(1, (trace.quality[i] ?? 0) / 60)) * 46} width={4} height={Math.min(1, (trace.quality[i] ?? 0) / 60) * 46} fill={cssVar('--chart-mute')} rx={1} />
          </g>;
        })}
        <text x={2} y={qTop + 55} fontSize={9} fill={cssVar('--text-faint')}>Q</text>
        <text x={2} y={baseY} fontSize={9} fill={cssVar('--text-faint')}>base</text>
      </svg>
    </div>
  );
}
