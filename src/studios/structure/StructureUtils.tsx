import { useMemo, useState } from 'react';
import type { ToolInfo } from '@/core/provenance';
import { useRunner } from '@/ui/useRunner';
import { Callout, Card, DataTable, Field, FileDrop, Stat, Tabs, downloadText, fmt, toCsv } from '@/ui/kit';
import { CurvePlot, cssVar } from '@/viz/charts';
import { MatrixHeat } from '@/viz/more';
import { parseStructure } from './geometry';
import { anm, bfactorCorrelation, caCoordinates, contactMap, rmsdMatrix, type AnmResult, type CA } from './netmodes';

const TOOL: ToolInfo = {
  id: 'structure.netmodes', name: 'Structure analysis tools', version: '0.1.0', engine: 'TypeScript (contact map, Kabsch RMSD matrix, ANM normal modes)',
  citations: ['atilgan2001', 'kabsch1976'],
  describe: (p) => `Contact map (Cα–Cα < ${p.cutoff} Å), pairwise RMSD over ${p.structures} structure${p.structures === 1 ? '' : 's'} after Kabsch superposition on shared residues, and an anisotropic network model (cutoff ${p.anmCutoff} Å, γ = 1) whose lowest ten non-zero modes and per-residue mean-square fluctuations were reported`,
};
type Sub = 'contact' | 'bfactor' | 'modes' | 'rmsd';

/** Contact map, B-factor profile, normal modes and an RMSD matrix for the loaded structure. */
export function StructureUtils({ src }: { src: { text: string; label: string } }) {
  const [sub, setSub] = useState<Sub>('contact'), [cutoff, setCutoff] = useState('8'), [anmCutoff, setAnmCutoff] = useState('15'), [mode, setMode] = useState(0);
  const [extra, setExtra] = useState<{ label: string; ca: CA[] }[]>([]);
  const { run } = useRunner();
  const ca = useMemo(() => caCoordinates(parseStructure(src.text).atoms), [src.text]);
  const [errors, setErrors] = useState<string[]>([]);
  const model = useMemo<{ ok: AnmResult } | { err: string } | null>(() => {
    if (sub !== 'bfactor' && sub !== 'modes') return null;
    try { return { ok: anm(ca, Number(anmCutoff) || 15) }; } catch (e) { return { err: (e as Error).message }; }
  }, [sub, ca, anmCutoff]);
  const n = ca.length;

  const map = useMemo(() => {
    const m = contactMap(ca, Number(cutoff) || 8, 3);
    const rows: number[][] = [];
    for (let i = 0; i < n; i++) rows.push(Array.from(m.subarray(i * n, (i + 1) * n)));
    return rows;
  }, [ca, cutoff, n]);
  const contacts = useMemo(() => (sub === 'contact' ? map.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0) / 2 : 0), [map, sub]);

  const structures = useMemo(() => [{ label: src.label, ca }, ...extra], [src.label, ca, extra]);
  const rmsd = useMemo(() => {
    if (sub !== 'rmsd' || structures.length < 2) return null;
    try { return rmsdMatrix(structures.map((s) => s.ca)); } catch (e) { return { err: (e as Error).message }; }
  }, [sub, structures]);

  const record = () => void run({
    label: `Structure tools · ${src.label}`, tool: TOOL,
    params: { cutoff: Number(cutoff) || 8, anmCutoff: Number(anmCutoff) || 15, structures: structures.length },
    inputs: [{ name: 'structure', data: src.label }, ...extra.map((e) => ({ name: 'structure', data: e.label }))],
    run: async () => ({ n, sub }),
    summary: () => `Contact map (${contacts} contacts), an RMSD matrix over ${structures.length} structure(s) and normal modes were computed for ${src.label}`,
  });

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Tabs<Sub> value={sub} onChange={setSub} items={[{ id: 'contact', label: 'Contact map' }, { id: 'bfactor', label: 'B-factors' }, { id: 'modes', label: 'Modes' }, { id: 'rmsd', label: 'RMSD matrix' }]} />
      <div className="cols-3">
        <Stat label="Cα atoms" value={n.toLocaleString()} hint="first model, first alternate location" />
        <Stat label="Chains" value={[...new Set(ca.map((c) => c.chain))].length} />
        <Stat label={sub === 'contact' ? 'Contacts (< cutoff, |i−j| ≥ 3)' : 'Normal-mode limit'} value={sub === 'contact' ? contacts.toLocaleString() : '400 residues'} />
      </div>
      {sub === 'contact' && <Card title="Contact map" sub={`Cα–Cα < ${cutoff} Å · residues ≥ 3 apart · ${src.label}`}
        actions={<><Field label="Cutoff (Å)"><input className="input" style={{ width: 70 }} value={cutoff} onChange={(e) => setCutoff(e.target.value)} /></Field><button className="btn sm" onClick={() => downloadText('contact_map.csv', toCsv(map.map((r, i) => ({ residue: `${ca[i].res}${ca[i].seq}`, ...Object.fromEntries(r.map((v, j) => [`${j + 1}`, v])) }))), 'text/csv')}>CSV</button></>}>
        <MatrixHeat labels={ca.map((c) => `${c.res}${c.seq}`)} m={map} min={0} max={1} fmt={() => ''} cell={Math.max(2, Math.min(12, Math.floor(520 / Math.max(1, n))))} />
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Rows and columns are residues in file order; a dark cell is a pair of Cα atoms closer than {cutoff} Å. Contacts between residues close in sequence are hidden (|i − j| ≥ 3).</div>
      </Card>}
      {(sub === 'bfactor' || sub === 'modes') && (!model ? null : 'err' in model ? <Callout kind="err">{model.err}</Callout> : <>
        <div className="cols-4">
          <Stat label="Method" value={model.ok.method === 'jacobi' ? 'Jacobi' : 'Inverse subspace'} hint="Jacobi ≤ 100 residues; subspace iteration above" />
          <Stat label="Modes reported" value={model.ok.modes.length} />
          <Stat label="Slowest frequency" value={fmt(model.ok.modes[0]?.frequency ?? NaN, 3)} hint="√λ in the reduced units of the model (γ = 1)" />
          {sub === 'bfactor' && <Stat label="B-factor correlation" value={fmt(bfactorCorrelation(model.ok.msf, ca.map((c) => c.b)), 2)} hint="Pearson r between predicted fluctuations and deposited B-factors" />}
        </div>
        {sub === 'bfactor' && <Card title="B-factors" sub={`deposited B-factors against predicted ⟨Δr²⟩ (scaled to the same mean) · ${src.label}`}>
          <CurvePlot height={320} exportName="bfactor-profile" spec={{
            series: [
              { name: 'experimental B', color: cssVar('--chart-b'), points: ca.map((c, i) => ({ x: i + 1, y: c.b })) },
              { name: 'ANM prediction', color: cssVar('--chart-a'), points: scaled(model.ok.msf, ca.map((c) => c.b)) },
            ], xLabel: 'Residue', yLabel: 'B-factor / arbitrary units',
          }} />
          <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>ANM fluctuations are only defined up to a scale; they are rescaled to the mean experimental B-factor. A correlation of 0.4–0.7 is typical. Elastic-network models capture large-scale flexibility only; they are not molecular dynamics.</div>
        </Card>}
        {sub === 'modes' && <>
          <Card title="Slowest non-zero modes" sub={`cutoff ${anmCutoff} Å · γ = 1`} pad={false}
            actions={<Field label="ANM cutoff (Å)"><input className="input" style={{ width: 70 }} value={anmCutoff} onChange={(e) => setAnmCutoff(e.target.value)} /></Field>}>
            <DataTable rows={model.ok.modes.map((m, i) => ({ i: i + 1, lambda: m.lambda, freq: m.frequency }))} rowKey={(r) => String(r.i)} cols={[
              { key: 'i', label: 'Mode', num: true },
              { key: 'lambda', label: 'Eigenvalue λ', num: true, render: (r) => fmt(r.lambda, 4) },
              { key: 'freq', label: '√λ', num: true, render: (r) => fmt(r.freq, 4) },
            ]} />
          </Card>
          <Card title={`Mode ${mode + 1}`} sub="squared displacement per residue" actions={<select className="select" style={{ width: 110 }} value={mode} onChange={(e) => setMode(+e.target.value)}>{model.ok.modes.map((_, i) => <option key={i} value={i}>Mode {i + 1}</option>)}</select>}>
            <CurvePlot height={300} exportName="anm-mode" spec={{
              series: [{
                name: `mode ${mode + 1}`, color: cssVar('--chart-a'),
                points: Array.from({ length: Math.min(n, model.ok.modes[mode]!.vector.length / 3) }, (_, i) => { const v = model.ok.modes[mode]!.vector; return { x: i + 1, y: v[3 * i] ** 2 + v[3 * i + 1] ** 2 + v[3 * i + 2] ** 2 }; }),
              }], xLabel: 'Residue', yLabel: '|Δr|² (normalised mode)',
            }} />
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Peaks mark the residues that move most in this collective mode. Only the ten slowest non-zero modes are computed: the six zero modes are rigid-body motion.</div>
          </Card>
        </>}
      </>)}
      {sub === 'rmsd' && <Card title="RMSD matrix" sub="Cα RMSD after Kabsch superposition on residues shared by each pair">
        <FileDrop accept=".pdb,.cif,.mmcif,.ent,.txt" onText={(t, name) => { try { const c = caCoordinates(parseStructure(t).atoms); if (c.length < 10) throw new Error('fewer than 10 Cα atoms'); setExtra((x) => [...x, { label: name, ca: c }]); setErrors([]); } catch (e) { setErrors((x) => [...x, `${name}: ${(e as Error).message}`]); } }} label="Add another structure (PDB / mmCIF) to compare" />
        {errors.map((e) => <Callout key={e} kind="err">{e}</Callout>)}
        {extra.length > 0 && <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setExtra([])}>Clear the other {extra.length} structure{extra.length === 1 ? '' : 's'}</button></div>}
        <div style={{ marginTop: 10 }}>
          {!rmsd ? <div className="faint">Add at least one more structure to compare. Residues are matched by chain and residue number, so isoforms and mutants are compared on what they share.</div>
            : 'err' in rmsd ? <Callout kind="err">{rmsd.err}</Callout> : <>
              <MatrixHeat labels={structures.map((s) => s.label)} m={rmsd} min={0} max={Math.max(1, ...rmsd.flat())} fmt={(v) => v.toFixed(1)} cell={70} />
              <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Values in Å; the diagonal is 0. Structures that differ only by a rigid-body motion give ~0.</div>
            </>}
        </div>
      </Card>}
      <div className="row"><button className="btn sm" onClick={record}>Add to methods log</button></div>
      <Callout>Elastic-network models capture large-scale flexibility only; they are not molecular dynamics.</Callout>
    </div>
  );
}

/** Scale predicted fluctuations to the mean experimental B-factor; B = (8π²/3)⟨Δr²⟩ up to a constant. */
function scaled(msf: number[], b: number[]): { x: number; y: number }[] {
  const mb = b.reduce((a, x) => a + x, 0) / Math.max(1, b.length), mm = msf.reduce((a, x) => a + x, 0) / Math.max(1, msf.length) || 1;
  return msf.map((v, i) => ({ x: i + 1, y: (v / mm) * mb }));
}
