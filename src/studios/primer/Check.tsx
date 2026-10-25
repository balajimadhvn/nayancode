import { useState } from 'react';
import { Callout, Card, DataTable, downloadText, fmt, toCsv } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { oligoTm } from '@/studios/sequence/kernels';
import { checkPair, checkPrimer, type PairCheck, type PrimerCheck, type Risk } from './dimer';
import { demoPrimerLines } from './demo';
import { CHECK_TOOL } from './meta';
import { parsePrimers } from './pcr';

interface Row extends PrimerCheck { name: string; tm: number }
interface PairRow { a: string; b: string; seqA: string; seqB: string; check: PairCheck }

const RISK_LABEL: Record<Risk, string> = { low: 'low', moderate: 'moderate', high: 'high' };
const riskCell = (r: Risk) => <span style={{ fontWeight: r === 'low' ? 400 : 600, color: r === 'high' ? 'var(--err, #c0392b)' : r === 'moderate' ? 'var(--warn, #b7791f)' : undefined }}>{RISK_LABEL[r]}</span>;

export default function Check() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]), [pairs, setPairs] = useState<PairRow[]>([]);
  const [checked, setChecked] = useState(false);
  const { run, busy, error } = useRunner();

  const go = (source = text) => {
    const primers = parsePrimers(source);
    if (!primers.length) { setRows([]); setPairs([]); setChecked(false); return; }
    void run({
      label: `Primer checks · ${primers.length} primer(s)`, tool: CHECK_TOOL,
      params: { count: primers.length },
      inputs: [{ name: 'primers', data: `${primers.length} sequence(s)` }],
      run: async () => {
        const checkedRows: Row[] = primers.map((p) => ({ ...checkPrimer(p.seq), name: p.name, tm: oligoTm(p.seq).tm }));
        const pairRows: PairRow[] = [];
        for (let i = 0; i < primers.length; i++) for (let j = i + 1; j < primers.length; j++) {
          const a = primers[i], b = primers[j];
          pairRows.push({ a: a.name, b: b.name, seqA: a.seq, seqB: b.seq, check: checkPair(a.seq, b.seq) });
        }
        return { rows: checkedRows, pairs: pairRows };
      },
      summary: (r) => `${r.rows.length} primer(s) and ${r.pairs.length} pair combination(s) checked`,
    }).then((r) => { if (r) { setRows(r.rows); setPairs(r.pairs); setChecked(true); } });
  };

  const demo = () => { setText(demoPrimerLines); go(demoPrimerLines); };
  const flagged = rows.filter((r) => r.risk !== 'low' || r.homopolymerFlag || r.gcClampFlag).length;

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Primers">
        <div className="stack" style={{ gap: 10 }}>
          <textarea className="input mono" rows={8} value={text} onChange={(e) => { setText(e.target.value); setRows([]); setPairs([]); setChecked(false); }} spellCheck={false} placeholder={'normal_20\tACGTACGTACGTACGTACGA\nGC_rich\tGCGCGCGC'} aria-label="Primers to check" />
          <div className="faint" style={{ fontSize: 12 }}>One primer per line as name + sequence, or FASTA. Only A, C, G and T are accepted.</div>
          <div className="row"><button className="btn primary" disabled={busy || !text.trim()} onClick={() => go()}>{busy ? 'Checking…' : 'Check primers'}</button><button className="btn sm" onClick={demo}>Demo: five problem primers</button></div>
          {error && <Callout kind="err">{error}</Callout>}
        </div>
      </Card>
      <Callout>These checks are sequence heuristics, not free-energy predictions: hairpins need a ≥ 4-nt stem and a ≥ 3-nt loop, dimers are the longest consecutive Watson–Crick run, and the risk bands are high at a 3′ run ≥ 4 or any run ≥ 8. Order primers for the pair table as they would appear in the reaction.</Callout>
    </div>
    <div className="stack">
      <Card title="Per-primer checks" sub={checked ? `${rows.length} primer(s), ${flagged} with a flag` : undefined} pad={false} actions={<button className="btn sm" disabled={!rows.length} onClick={() => downloadText('primer_checks.csv', toCsv(rows.map((r) => ({ name: r.name, sequence: r.seq, length: r.length, tm_c: +r.tm.toFixed(2), gc_percent: +(r.gc * 100).toFixed(1), hairpin_stem: r.hairpin?.stem ?? '', hairpin_positions: r.hairpin ? r.hairpin.positions.join('–') : '', self_dimer_run: r.selfDimer, three_prime_run: r.end3Run, gc_clamp: r.gcClamp, homopolymer: r.homopolymer, risk: r.risk, flags: [r.gcClampFlag && 'GC clamp', r.homopolymerFlag && 'homopolymer'].filter(Boolean).join('; ') }))), 'text/csv')}>CSV</button>}>
        {!checked ? <div className="faint" style={{ padding: '36px 6px', textAlign: 'center' }}>Enter primers, or load the demo, to check Tm, hairpins, dimers and sequence flags.</div> : <DataTable rows={rows} rowKey={(r, i) => `${r.name}:${i}`} cols={[
          { key: 'name', label: 'Primer' },
          { key: 'seq', label: 'Sequence', render: (r) => <span className="mono">{r.seq}</span> },
          { key: 'len', label: 'Length', num: true, sort: (r) => r.length },
          { key: 'tm', label: 'Tm (°C)', num: true, sort: (r) => r.tm, render: (r) => fmt(r.tm, 1) },
          { key: 'gc', label: 'GC (%)', num: true, sort: (r) => r.gc, render: (r) => fmt(r.gc * 100, 1) },
          { key: 'hp', label: 'Hairpin', num: true, sort: (r) => r.hairpin?.stem ?? 0, render: (r) => (r.hairpin ? `${r.hairpin.stem} nt @ ${r.hairpin.positions[0]}–${r.hairpin.positions[1]}` : '–') },
          { key: 'sd', label: 'Self-dimer', num: true, sort: (r) => r.selfDimer, render: (r) => `${r.selfDimer} nt` },
          { key: 'e3', label: '3′ run', num: true, sort: (r) => r.end3Run, render: (r) => `${r.end3Run} nt` },
          { key: 'clamp', label: 'GC clamp', num: true, sort: (r) => r.gcClamp, render: (r) => <span style={{ color: r.gcClampFlag ? 'var(--warn, #b7791f)' : undefined }}>{r.gcClamp}/5{r.gcClampFlag ? ' ✗' : ''}</span> },
          { key: 'homo', label: 'Homopolymer', num: true, sort: (r) => r.homopolymer, render: (r) => <span style={{ color: r.homopolymerFlag ? 'var(--warn, #b7791f)' : undefined }}>{r.homopolymer}{r.homopolymerFlag ? ' ✗' : ''}</span> },
          { key: 'risk', label: 'Risk', sort: (r) => r.risk, render: (r) => riskCell(r.risk) },
        ]} />}
      </Card>
      <Card title="Pair dimers" sub={checked ? `${pairs.length} combination(s)` : undefined} pad={false} actions={<button className="btn sm" disabled={!pairs.length} onClick={() => downloadText('primer_pair_dimers.csv', toCsv(pairs.map((p) => ({ primer_a: p.a, primer_b: p.b, pair_dimer_run: p.check.pairDimer, three_prime_run: p.check.end3Run, risk: p.check.risk }))), 'text/csv')}>CSV</button>}>
        {!pairs.length ? <div className="faint" style={{ padding: '30px 6px', textAlign: 'center' }}>Enter at least two primers to see every pair-dimer combination.</div> : <DataTable rows={pairs} rowKey={(p, i) => `${p.a}:${p.b}:${i}`} cols={[
          { key: 'a', label: 'Primer A' },
          { key: 'b', label: 'Primer B' },
          { key: 'run', label: 'Pair-dimer', num: true, sort: (p) => p.check.pairDimer, render: (p) => `${p.check.pairDimer} nt` },
          { key: 'e3', label: '3′ run', num: true, sort: (p) => p.check.end3Run, render: (p) => `${p.check.end3Run} nt` },
          { key: 'risk', label: 'Risk', sort: (p) => p.check.risk, render: (p) => riskCell(p.check.risk) },
        ]} />}
      </Card>
      {checked && <div className="faint" style={{ fontSize: 12 }}>Tm uses the SantaLucia nearest-neighbour model at 50 mM Na⁺, 1.5 mM Mg²⁺ and 250 nM primer. Green is not a guarantee: always BLAST and test the primers.</div>}
    </div></div>
  );
}
