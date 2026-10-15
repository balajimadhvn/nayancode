import { motion } from 'motion/react';
import { Link } from '@/site/Link';
import { STUDIOS } from '@/core/studios';
import { useProvenance } from '@/core/provenance';
import { useUi } from '@/core/ui-store';
import { StudioIcon } from '@/ui/Icons';
import { Card } from '@/ui/kit';

export default function Overview() {
  const records = useProvenance((s) => s.records);
  const set = useUi((s) => s.set);
  const live = STUDIOS;
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="page-head"><div><h1>Welcome back</h1><p>Pick a studio, drop in your data and start. Everything runs on this device.</p></div></div>
      <div className="cols-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {live.map((s, i) => { const I = StudioIcon[s.id]; return (
          <motion.div key={s.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Link to={s.path} className="spot" style={{ ['--h' as string]: s.accent }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><I className="spot-ico" width={26} height={26} /><span className="badge live"><span className="dot" />Live</span></div>
              <h3>{s.name}</h3><p>{s.blurb}</p>
              <div className="chips">{s.analyses.slice(0, 3).map((a) => <span key={a}>{a}</span>)}</div>
            </Link>
          </motion.div>); })}
      </div>
      <div className="cols-2">
        <Card title="What still needs more than a browser" sub="hardware limits, not missing features">
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, color: 'var(--text-dim)', fontSize: 13.5 }}>
            <li>Whole human genomes: a 30× run is ~100 GB of reads, beyond a browser tab's ~4 GB of memory. Bacterial, viral, organellar and targeted data map here, with SNV and indel calling.</li>
            <li>Shotgun metagenome classification: reference databases are tens of gigabytes.</li>
            <li>Protein structure prediction: AlphaFold-class models need a GPU and gigabytes of weights. Predicted structures can be opened from AlphaFold DB.</li>
            <li>Atlas-scale single-cell integration (100,000+ cells).</li>
          </ul>
          <div className="faint" style={{ marginTop: 10, fontSize: 12.5 }}>For these, nf-core pipelines run on your own computer or institute cluster, and their outputs open here through Import. Everything in the studios above runs locally and works offline after the first visit. See <Link to="/licenses" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>licences</Link>.</div>
        </Card>
        <Card title="Recent analyses" sub={`${records.length} recorded`} actions={<button className="btn sm" onClick={() => set({ methods: true })}>Methods</button>}>
          {records.length === 0 ? <div className="faint">Nothing yet. Open a studio and load an example dataset to see provenance in action.</div> :
            <div style={{ display: 'grid', gap: 8 }}>{[...records].reverse().slice(0, 6).map((r) => <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}><span>{r.toolName}</span><span className="faint mono" style={{ fontSize: 11.5 }}>{new Date(r.startedAt).toLocaleTimeString()} · {r.durationMs} ms</span></div>)}</div>}
        </Card>
      </div>
    </div>
  );
}
