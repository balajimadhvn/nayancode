import { useEffect, useState } from 'react';
import { Callout, Card, DataTable, Stat, downloadText, fmt, sci, toCsv } from '@/ui/kit';
import { searchSpaceNote } from './evalue';
import type { HitRow, SearchResult } from './SearchStudio';

const COLS = [
  { key: 'rank', label: '#', num: true, sort: (r: HitRow) => r.rank },
  { key: 'id', label: 'ID', render: (r: HitRow) => <span title={r.description}>{r.id}</span> },
  { key: 'length', label: 'Length', num: true, sort: (r: HitRow) => r.length },
  { key: 'score', label: 'Score', num: true, sort: (r: HitRow) => r.score },
  { key: 'bits', label: 'Bits', num: true, sort: (r: HitRow) => r.bits, render: (r: HitRow) => fmt(r.bits, 1) },
  { key: 'e', label: 'E-value', num: true, sort: (r: HitRow) => r.e, render: (r: HitRow) => sci(r.e) },
  { key: 'identity', label: 'Identity', num: true, sort: (r: HitRow) => r.identity ?? -1, render: (r: HitRow) => (r.identity === null ? '–' : `${(r.identity * 100).toFixed(1)}%`) },
];

const wrap = (s: string, n = 70) => s.match(new RegExp(`.{1,${n}}`, 'g'))?.join('\n') ?? s;

export default function HitsTab({ result }: { result: SearchResult | null }) {
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setSel(null); }, [result]);
  if (!result) return <Callout kind="warn">Run a search first. The Hits tab shows the ranked alignments, E-values and a traceback for the selected hit.</Callout>;
  const rows = result.rows;
  const current = sel ?? rows[0]?.index ?? null;
  const al = current !== null ? result.alignments[current] : undefined;
  const row = rows.find((r) => r.index === current);
  const csv = () => downloadText('search-hits.csv', toCsv(rows.map((r) => ({ rank: r.rank, id: r.id, length: r.length, score: r.score, bits: +r.bits.toFixed(3), e_value: r.e, identity: r.identity ?? '' }))), 'text/csv');
  return (
    <div className="stack">
      {result.note && <Callout kind="warn">{result.note}</Callout>}
      <div className="cols-2" style={{ gap: 12 }}>
        <Card title="Search summary"><div className="cols-2" style={{ gap: 10 }}>
          <Stat label="Engine" value={`${result.engine.toUpperCase()} · ${result.device}`} />
          <Stat label="Time" value={`${fmt(result.ms, 0)} ms`} />
          <Stat label="GCUPS" value={result.gcups === null ? '–' : fmt(result.gcups, 3)} hint="Billion Smith-Waterman cell updates per second, including readback and traceback-free scoring." />
          <Stat label="Search space" value={`${result.query.length} × ${result.residues.toLocaleString()} residues`} />
        </div></Card>
        <Card title="Hits" actions={<button className="btn sm" onClick={csv} disabled={!rows.length}>Download CSV</button>}>
          <div className="faint" style={{ fontSize: 12 }}>{rows.length} best of {result.db.seqs.length.toLocaleString()} sequences. E-values use the search space above.</div>
        </Card>
      </div>
      <Card title="Ranked hits"><DataTable rows={rows} cols={COLS} onRow={(r) => setSel(r.index)} rowKey={(r) => `${r.index}-${r.id}`} /></Card>
      {al && row && <Card title={`Alignment · ${row.id}`} sub={`score ${row.score} · bits ${row.bits.toFixed(1)} · E ${sci(row.e)} · query starts at ${al.aStart}, target at ${al.bStart}`}>
        <div className="stack" style={{ gap: 8 }}>
          <pre className="mono" style={{ fontSize: 12, lineHeight: 1.35, overflowX: 'auto', margin: 0 }}>{`${wrap(al.a)}\n${wrap(al.mid)}\n${wrap(al.b)}`}</pre>
          <div className="faint" style={{ fontSize: 12 }}>Identity {(al.identity * 100).toFixed(1)}% over {al.length} aligned columns, {al.gaps} gap columns. The displayed traceback uses the shared local aligner; the ranked score is the exhaustive Gotoh score with gap cost 11 + k.</div>
        </div>
      </Card>}
      <div className="faint" style={{ fontSize: 12 }}>{searchSpaceNote}</div>
    </div>
  );
}
