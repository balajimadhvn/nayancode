import { useEffect, useMemo, useState } from 'react';
import { assetUrl } from '@/core/asset';
import { Callout, Card, DataTable, Stat, downloadText, fmt, toCsv } from '@/ui/kit';
import { Histogram } from '@/viz/charts';
import { alignFeatures, boiledEgg, outOfDomain, predict, rules, type ModelSet } from './admet';

interface M { id: string; name: string; canon: string; mw: number; logp: number; tpsa: number; hbd: number; hba: number; rotb: number; desc: Float32Array }
let cache: Promise<ModelSet> | null = null;
const loadModels = () => (cache ??= fetch(assetUrl('data/admet/models.json')).then((r) => { if (!r.ok) throw new Error(`Could not load the property models (${r.status}).`); return r.json() as Promise<ModelSet>; }));

export default function AdmetView({ mols, descNames }: { mols: M[]; descNames: string[] }) {
  const [models, setModels] = useState<ModelSet | null>(null), [err, setErr] = useState('');
  useEffect(() => { loadModels().then(setModels, (e: Error) => setErr(e.message)); }, []);
  const rows = useMemo(() => {
    if (!models) return [];
    const mr = descNames.indexOf('CrippenMR'), ha = descNames.indexOf('NumHeavyAtoms');
    return mols.map((m) => {
      const r = rules({ mw: m.mw, logp: m.logp, tpsa: m.tpsa, hbd: m.hbd, hba: m.hba, rotb: m.rotb, mr: mr >= 0 ? m.desc[mr] : undefined, heavy: ha >= 0 ? m.desc[ha] : undefined });
      const egg = boiledEgg(m.tpsa, m.logp);
      const f = (k: string) => alignFeatures(models[k], descNames, m.desc);
      const xs = f('solubility'), xl = f('lipophilicity'), xb = f('bbb');
      return { m, rules: r, egg, logS: xs ? predict(models.solubility, xs) : NaN, logD: xl ? predict(models.lipophilicity, xl) : NaN, bbb: xb ? predict(models.bbb, xb) : NaN, ood: xs ? outOfDomain(models.solubility, xs) : 1 };
    });
  }, [models, mols, descNames]);
  if (err) return <Callout kind="err">{err}</Callout>;
  if (!models) return <Card><div className="faint" style={{ padding: 20 }}>Loading property models…</div></Card>;
  const pass = (id: string) => rows.filter((r) => r.rules.find((x) => x.id === id)?.pass).length;
  const mt = (k: string) => models[k].metrics;
  const csv = () => downloadText('admet.csv', toCsv(rows.map((r) => ({ name: r.m.name, smiles: r.m.canon, pred_logS: fmt(r.logS, 2), pred_logD74: fmt(r.logD, 2), bbb_probability: fmt(r.bbb, 2), lipinski: r.rules[0].pass, veber: r.rules[1].pass, egan: r.rules[2].pass, gi_absorbed_egg: r.egg.gi, brain_egg: r.egg.bbb, outside_training_range: r.ood > 0.15 }))), 'text/csv');
  return (
    <>
      <div className="cols-3"><Stat label="Lipinski pass" value={`${pass('lipinski')} / ${rows.length}`} /><Stat label="Veber pass" value={`${pass('veber')} / ${rows.length}`} /><Stat label="Egan pass" value={`${pass('egan')} / ${rows.length}`} /></div>
      <div className="cols-2">
        <Card title="Predicted solubility" sub="logS, mol/L"><Histogram values={rows.map((r) => r.logS).filter(Number.isFinite)} label="Predicted logS" bins={20} /></Card>
        <Card title="Predicted lipophilicity" sub="logD at pH 7.4"><Histogram values={rows.map((r) => r.logD).filter(Number.isFinite)} label="Predicted logD 7.4" bins={20} /></Card>
      </div>
      <Card title="Per-compound predictions" actions={<button className="btn sm" onClick={csv}>Download CSV</button>}>
        <DataTable rowKey={(r) => r.m.id} rows={rows} cols={[
          { key: 'name', label: 'Compound', render: (r) => r.m.name, sort: (r) => r.m.name },
          { key: 'logS', label: 'logS', num: true, render: (r) => fmt(r.logS, 2), sort: (r) => r.logS },
          { key: 'logD', label: 'logD 7.4', num: true, render: (r) => fmt(r.logD, 2), sort: (r) => r.logD },
          { key: 'bbb', label: 'P(BBB+)', num: true, render: (r) => fmt(r.bbb, 2), sort: (r) => r.bbb },
          { key: 'egg', label: 'Egg', render: (r) => `${r.egg.gi ? 'GI' : ''}${r.egg.gi && r.egg.bbb ? ' · ' : ''}${r.egg.bbb ? 'brain' : ''}` || '–' },
          { key: 'rules', label: 'Rules failed', render: (r) => r.rules.filter((x) => !x.pass).map((x) => x.name.split(' ')[0]).join(', ') || 'none' },
          { key: 'ood', label: 'Domain', render: (r) => (r.ood > 0.15 ? 'outside' : 'inside'), sort: (r) => r.ood },
        ]} />
      </Card>
      <Callout kind="warn"><div>These are screening estimates. Held-out performance on a scaffold split: solubility R² {fmt(Number(mt('solubility').r2), 2)} (RMSE {fmt(Number(mt('solubility').rmse), 2)} log units, n = {String(mt('solubility').n)}); logD R² {fmt(Number(mt('lipophilicity').r2), 2)} (RMSE {fmt(Number(mt('lipophilicity').rmse), 2)}); BBB AUC {fmt(Number(mt('bbb').auc), 2)}. Treat the BBB probability as weak evidence and prefer the BOILED-Egg region and measurement. Compounds marked “outside” lie beyond the descriptor range of the training sets. Training data: {Object.values(models).map((m) => m.source).join('; ')}.</div></Callout>
    </>
  );
}
