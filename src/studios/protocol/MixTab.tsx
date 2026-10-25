import { useMemo, useState } from 'react';
import { Callout, Card, Field, downloadText, fmt, toCsv } from '@/ui/kit';
import { masterMix, type MixReagent } from './mix';
import { TEMPLATES } from './templates';

const pcr = TEMPLATES[0].mix!;
const colony = TEMPLATES[1].mix!;

export default function MixTab() {
  const [reagents, setReagents] = useState<MixReagent[]>(pcr.reagents.map((r) => ({ ...r })));
  const [finalVolume, setFinalVolume] = useState(pcr.finalVolume);
  const [reactions, setReactions] = useState(pcr.reactions);
  const [overagePct, setOveragePct] = useState(pcr.overagePct);
  const [templatePerRxn, setTemplatePerRxn] = useState(pcr.templatePerRxn ?? 0);
  const [copied, setCopied] = useState(false);

  const out = useMemo(() => {
    try {
      return { mix: masterMix({ reagents, finalVolume, reactions, overagePct, templatePerRxn }) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [reagents, finalVolume, reactions, overagePct, templatePerRxn]);

  const setRow = (i: number, patch: Partial<MixReagent>) => setReagents((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const load = (mix: typeof pcr) => {
    setReagents(mix.reagents.map((r) => ({ ...r })));
    setFinalVolume(mix.finalVolume); setReactions(mix.reactions); setOveragePct(mix.overagePct); setTemplatePerRxn(mix.templatePerRxn ?? 0);
  };
  const copy = () => {
    if (!out.mix) return;
    const text = ['Reagent\tPer reaction\tTotal', ...out.mix.rows.map((r) => `${r.name}\t${r.perRxnLabel}\t${r.totalLabel}`)].join('\n');
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => setCopied(false));
  };

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Reactions and overage">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => load(pcr)}>PCR (Taq) template</button>
            <button className="btn sm" onClick={() => load(colony)}>Colony PCR template</button>
          </div>
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Reactions"><input className="input" type="number" min={1} value={reactions} onChange={(e) => setReactions(+e.target.value)} /></Field>
            <Field label="Overage (%)"><input className="input" type="number" min={0} step="1" value={overagePct} onChange={(e) => setOveragePct(+e.target.value)} /></Field>
            <Field label="Final volume (µL)"><input className="input" type="number" min={0} step="0.1" value={finalVolume} onChange={(e) => setFinalVolume(+e.target.value)} /></Field>
            <Field label="Template per tube (µL)"><input className="input" type="number" min={0} step="0.1" value={templatePerRxn} onChange={(e) => setTemplatePerRxn(+e.target.value)} /></Field>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>{out.mix ? `${fmt(out.mix.effectiveReactions, 2)} effective reaction(s) with overage` : 'Fix the volumes to see the scaled mix.'}</div>
        </div>
      </Card>
      <Card title="2 · Reagents" actions={<button className="btn sm" onClick={() => setReagents((rs) => [...rs, { name: `Reagent ${rs.length + 1}`, perRxn: 1, unit: 'uL' }])}>Add row</button>}>
        <div className="table-wrap"><table className="t"><thead><tr><th>Reagent</th><th className="num">Per reaction</th><th>Unit</th><th /></tr></thead><tbody>
          {reagents.map((r, i) => <tr key={i}>
            <td><input className="input" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} aria-label={`Reagent ${i + 1} name`} /></td>
            <td><input className="input" type="number" min={0} step="0.1" value={r.perRxn} onChange={(e) => setRow(i, { perRxn: +e.target.value })} aria-label={`Reagent ${i + 1} volume`} /></td>
            <td><select className="select" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value as 'uL' | 'mL' })} aria-label={`Reagent ${i + 1} unit`}><option value="uL">µL</option><option value="mL">mL</option></select></td>
            <td><button className="btn sm" onClick={() => setReagents((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove ${r.name}`}>×</button></td>
          </tr>)}
        </tbody></table></div>
      </Card>
      <Callout>Volumes are scaled by reactions × (1 + overage). Water is the remainder of the final volume after the listed reagents. The template is added separately, so the master mix dispensed per tube is the final volume minus the template volume.</Callout>
    </div>
    <div className="stack">
      <Card title="Scaled master mix" sub={out.mix ? `${fmt(out.mix.effectiveReactions, 2)} reaction(s) · ${out.mix.perRxnTotal} µL each` : undefined} pad={false} actions={<div className="row" style={{ gap: 6 }}><button className="btn sm" disabled={!out.mix} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button><button className="btn sm" disabled={!out.mix} onClick={() => out.mix && downloadText('master_mix.csv', toCsv(out.mix.rows.map((r) => ({ reagent: r.name, per_reaction: r.perRxnLabel, total: r.totalLabel, per_reaction_uL: +r.perRxnUl.toFixed(4), total_uL: +r.totalUl.toFixed(4) }))), 'text/csv')}>CSV</button></div>}>
        {!out.mix ? <div style={{ padding: 16 }}><Callout kind="err">{out.error}</Callout></div> : <div className="table-wrap"><table className="t"><thead><tr><th>Reagent</th><th className="num">Per reaction</th><th className="num">Total</th></tr></thead><tbody>
          {out.mix.rows.map((r) => <tr key={r.name}><td>{r.name}{r.kind === 'water' && <span className="faint"> (to volume)</span>}</td><td className="num">{r.perRxnLabel}</td><td className="num">{r.totalLabel}</td></tr>)}
        </tbody></table></div>}
      </Card>
      {out.mix && <div className="cols-3">
        <div className="stat"><div className="stat-label">Master mix total</div><div className="stat-value">{fmt(out.mix.masterTotal, 1)} µL</div></div>
        <div className="stat"><div className="stat-label">Dispense per tube</div><div className="stat-value">{fmt(out.mix.dispensePerTube, 2)} µL</div></div>
        <div className="stat"><div className="stat-label">Water total</div><div className="stat-value">{fmt(out.mix.waterTotal, 1)} µL</div></div>
      </div>}
      {out.mix && <div className="faint" style={{ fontSize: 12 }}>Add {fmt(out.mix.dispensePerTube, 2)} µL of master mix to each tube, then {templatePerRxn ? `the ${fmt(templatePerRxn, 2)} µL template` : 'the template'}.</div>}
    </div></div>
  );
}
