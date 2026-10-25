import { useEffect, useState } from 'react';
import { Callout, Card } from '@/ui/kit';
import type { FcsFile } from './fcs';
import { compensate } from './transform';

interface Props { parsed: FcsFile | null; columns: Float64Array[]; setColumns(c: Float64Array[]): void }

export default function CompensationTab({ parsed, columns, setColumns }: Props) {
  const [matrix, setMatrix] = useState<number[][]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (parsed?.spill) { setMatrix(parsed.spill.matrix.map((r) => r.slice())); setSelected(parsed.spill.names); }
    else { setMatrix([]); setSelected([]); }
    setError('');
  }, [parsed]);

  if (!parsed) return <Card title="Compensation"><div className="faint" style={{ padding: 24, textAlign: 'center' }}>Load an FCS file in the Data tab first.</div></Card>;
  if (!parsed.spill) return (
    <Card title="Compensation">
      <Callout>This file has no <span className="mono">$SPILLOVER</span> matrix, so no compensation is available. You can still gate the uncompensated data.</Callout>
    </Card>
  );

  const names = parsed.spill.names;
  const setCell = (r: number, c: number, v: number) => setMatrix((m) => m.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)));
  const toggle = (name: string) => setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));

  const apply = () => {
    setError('');
    if (!selected.length) { setError('Select at least one channel to compensate.'); return; }
    const indices = selected.map((name) => parsed.params.findIndex((p) => p.name === name));
    if (indices.some((i) => i < 0)) { setError('A selected channel is missing from this file.'); return; }
    try {
      const sub = indices.map((r) => indices.map((c) => matrix[r][c]));
      const result = compensate(indices.map((i) => columns[i]), sub);
      const next = columns.slice();
      indices.forEach((ci, k) => { next[ci] = result[k]; });
      setColumns(next);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="stack">
      <Card title="Spillover matrix" sub="Rows are true sources and columns are detectors (observed = true × S). Edit cells, choose channels, then apply the inverse.">
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
          {names.map((name) => <label key={name} className="row" style={{ gap: 5, fontSize: 13 }}><input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} /> <span className="mono">{name}</span></label>)}
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th></th>{names.map((n) => <th key={n} className="num">{n}</th>)}</tr></thead>
            <tbody>{names.map((row, r) => (
              <tr key={row}><th>{row}</th>{names.map((col, c) => (
                <td key={col} className="num"><input type="number" step={0.01} value={matrix[r][c]} onChange={(e) => setCell(r, c, Number(e.target.value))} style={{ width: 86 }} aria-label={`${row} into ${col}`} /></td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={apply}>Apply compensation</button>
          <button className="btn sm" onClick={() => setColumns(parsed.events.map((c) => Float64Array.from(c)))}>Reset to file values</button>
          <span className="faint" style={{ fontSize: 12 }}>{selected.length} of {names.length} channels selected. Statistics use the compensated values.</span>
        </div>
        {error && <Callout kind="err">{error}</Callout>}
      </Card>
      <Card title="What compensation does">
        <p style={{ margin: 0 }}>The file records how much of each fluorochrome leaks into the other detectors. Compensation multiplies the observed values by the inverse of that matrix, so a bright FITC signal no longer appears as false PE. Applying twice would over-correct; use “Reset to file values” first if you change your mind.</p>
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>A singular matrix has no unique inverse and is rejected. Check the panel settings if that happens.</div>
      </Card>
    </div>
  );
}
