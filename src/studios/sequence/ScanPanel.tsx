import { useMemo } from 'react';
import { Card, downloadText } from '@/ui/kit';
import { AMINO_ACIDS, heatmapMatrix, type ScanResult } from './plm';

export default function ScanPanel({ scan }: { scan: { seq: string; result: ScanResult } | null }) {
  if (!scan) {
    return (
      <Card title="Mutation heatmap" sub="Masked-marginal log-likelihood ratios">
        <div className="faint">Run a scan first to generate the heatmap.</div>
      </Card>
    );
  }
  const seq = scan.seq;
  const hm = useMemo(() => heatmapMatrix(scan.result, seq), [scan.result, seq]);

  const csv = () => {
    const rows = ['position,wild_type,' + AMINO_ACIDS.split('').join(',')];
    for (let i = 0; i < seq.length; i++) {
      const vals = [...AMINO_ACIDS].map((_a, ai) => hm[ai][i].toFixed(4));
      rows.push(`${i + 1},${seq[i]},${vals.join(',')}`);
    }
    downloadText('mutation_heatmap.csv', rows.join('\n'), 'text/csv');
  };

  return (
    <div className="stack">
      <Card title="Mutation heatmap" sub="log p(mut) - log p(wt), wild-type diagonal = 0">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ padding: 2 }}>AA</th>
                {seq.split('').map((c, i) => (
                  <th key={i} style={{ padding: 2 }}>
                    {c}
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AMINO_ACIDS.split('').map((a: string, ai: number) => (
                <tr key={a}>
                  <td style={{ padding: 2 }}>{a}</td>
                  {seq.split('').map((wt: string, i: number) => {
                    const v = hm[ai][i];
                    const isWt = a === wt;
                    const bg = isWt ? 'rgba(255,255,255,0.1)' : v > 0 ? `rgba(50,200,100,${Math.min(0.6, v / 5)})` : `rgba(200,50,50,${Math.min(0.6, -v / 5)})`;
                    return (
                      <td key={i} title={`${wt}${i + 1}${a}: ${v.toFixed(3)}`} style={{ padding: 2, background: bg, textAlign: 'center' }}>
                        {isWt ? '0.000' : v.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={csv}>
            Download heatmap CSV
          </button>
        </div>
      </Card>
    </div>
  );
}
