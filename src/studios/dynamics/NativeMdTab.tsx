import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBridge } from '@/compute/bridge';
import BridgePanel from '@/ui/BridgePanel';
import { Busy, Callout, Card, Field, FileDrop, toast } from '@/ui/kit';
import { useRunner } from '@/ui/useRunner';
import { useHandoff } from '@/core/handoff';
import type { ToolInfo } from '@/core/provenance';
import { FORCE_FIELDS, WATERS, chooseMdrunFlags, commandPlan, validateInput, type ForceField, type MdOptions, type Water } from './gmx';
import { runMdPlan, type MdRunResult, type MdStepState } from './mdRun';
import NativeMdResults from './NativeMdResults';
import ubq from './fixtures/1ubq.pdb?raw';

const TOOL: ToolInfo = {
  id: 'dyn.native-md', name: 'All-atom MD through the Bridge', version: '0.1.0',
  engine: "GROMACS on the visitor's own machine via the Nayancode Bridge",
  citations: ['abraham2015', 'lindorff2010', 'jorgensen1983'],
  describe: (p) => `A solvated all-atom system was simulated with GROMACS using ${p.forceField} and ${p.water} at ${p.temperature} K (${p.mdSteps} production steps, ${p.mdPs} ps); the trajectory and GROMACS time series were displayed and analysed locally.`,
};
const SMALL = { fontSize: 12 } as const;
const statusClass = (s: MdStepState['status']) => s === 'done' ? 'live' : s === 'running' ? 'building' : s === 'failed' ? 'err' : s === 'retried' ? 'building' : 'planned';

export default function NativeMdTab() {
  const nav = useNavigate();
  const client = useBridge((s) => s.client);
  const health = useBridge((s) => s.health);
  const connected = useBridge((s) => s.connected);
  const setMdTrajectory = useHandoff((s) => s.setMdTrajectory);
  const [pdb, setPdb] = useState(ubq), [source, setSource] = useState('1UBQ · ubiquitin (76 residues)');
  const [temperature, setTemperature] = useState(300), [emSteps, setEmSteps] = useState(5000);
  const [nvtSteps, setNvtSteps] = useState(1000), [nptSteps, setNptSteps] = useState(1000), [mdSteps, setMdSteps] = useState(2000);
  const [stride, setStride] = useState(500), [forceField, setForceField] = useState<ForceField>('amber99sb-ildn'), [water, setWater] = useState<Water>('tip3p');
  const [forceCpu, setForceCpu] = useState(false);
  const [steps, setSteps] = useState<MdStepState[]>([]), [log, setLog] = useState(''), [result, setResult] = useState<MdRunResult | null>(null);
  const [job, setJob] = useState(''), [elapsed, setElapsed] = useState(0);
  const jobRef = useRef(''), runIdRef = useRef<string | null>(null), startRef = useRef(0);
  const { run, busy, progress, note, error, cancel } = useRunner();
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const validation = useMemo(() => {
    try { return { v: validateInput(pdb), error: '' }; } catch (e) { return { v: null, error: (e as Error).message }; }
  }, [pdb]);

  const choice = health ? chooseMdrunFlags(health) : null;
  const useGpu = !!choice && choice.mode === 'gpu' && !forceCpu;
  const threads = health ? Math.max(1, health.cpus - 1) : 1;
  const opts: MdOptions = {
    temperature, emSteps, nvtSteps, nptSteps, mdSteps, stride, seed: 20261026,
    water, forceField, threads, gpuFlags: useGpu ? choice!.flags : [], dtPs: stride * 0.002,
  };
  const preview = useMemo(() => { try { return commandPlan(opts); } catch { return []; } }, [temperature, emSteps, nvtSteps, nptSteps, mdSteps, stride, water, forceField, threads, useGpu, health]);

  const nvtDone = steps.find((s) => s.label === 'mdrun nvt' && s.status === 'done');
  const nvtPs = nvtSteps * 0.002;
  const speed = nvtDone?.ms ? nvtPs / (nvtDone.ms / 60000) : null;
  const remainingPs = (nptSteps + mdSteps) * 0.002;
  const estimate = speed ? remainingPs / speed : null;

  const start = () => {
    if (!client || !health || !validation.v) return;
    setResult(null); setLog(''); setSteps([]); setJob(''); setElapsed(0); jobRef.current = ''; runIdRef.current = null; startRef.current = Date.now();
    void run({
      label: `Native MD · ${validation.v.atoms} atoms · ${mdSteps * 0.002} ps`,
      tool: TOOL,
      params: { temperature, emSteps, nvtSteps, nptSteps, mdSteps, stride, forceField, water, gpu: useGpu ? 'GPU' : 'CPU', threads, mdPs: mdSteps * 0.002 },
      inputs: [{ name: 'protein.pdb', data: validation.v.text }],
      run: async (h) => {
        const res = await runMdPlan(client, validation.v!.text, opts, {
          signal: h.signal,
          onJob: (id) => { jobRef.current = id; setJob(id); },
          onRunId: (id) => { runIdRef.current = id; },
          onLog: (text) => setLog((prev) => (prev + text).slice(-250000)),
          onStep: (next) => {
            setSteps(next);
            const done = next.filter((s) => s.status === 'done').length;
            h.onProgress(done / next.length, next.find((s) => s.status === 'running')?.label);
          },
        });
        setResult(res); setJob(res.job);
        return res;
      },
      summary: (res) => `GROMACS finished ${res.steps.filter((s) => s.status === 'done').length}/${res.steps.length} steps in ${(res.elapsedMs / 60000).toFixed(1)} min; EM potential ${res.summary.emPotential ?? '–'} kJ/mol, ${res.summary.models} trajectory frames.`,
    }).then((res) => { if (res) toast('Native MD finished'); });
  };

  const stop = () => {
    cancel();
    const id = runIdRef.current, j = jobRef.current;
    if (client && j && id) void client.cancel(j, id).catch(() => {});
  };

  const send = () => {
    if (!result) return;
    setMdTrajectory({
      pdb: result.trajPdb,
      xvg: Object.entries(result.xvg).map(([name, text]) => ({ name, text })),
      label: `Native MD · ubiquitin, ${mdSteps * 0.002} ps (${result.summary.models} frames)`,
    });
    toast('Trajectory sent to the Trajectory Studio');
    nav('/trajectory');
  };

  const deleteJob = async () => {
    if (!client || !jobRef.current) return;
    try { await client.remove(jobRef.current); toast('Job and files deleted from your computer'); }
    catch (e) { toast(`Could not delete the job: ${(e as Error).message}`); }
    setResult(null); setSteps([]); setLog(''); setJob(''); jobRef.current = '';
  };

  if (!connected || !client || !health) {
    return (
      <div className="stack">
        <Callout kind="warn">The Native MD tab drives GROMACS on your own computer through the Nayancode Bridge. Connect the Bridge below; until then this tab is disabled.</Callout>
        <BridgePanel />
        <Card title="GROMACS"><div className="stack" style={SMALL}>
          <div>Install GROMACS from <a href="https://www.gromacs.org" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>gromacs.org</a> or with your package manager:</div>
          <code className="mono" style={{ padding: 8, background: 'var(--bg-2)', borderRadius: 6 }}>sudo apt install gromacs&nbsp;&nbsp;# Debian/Ubuntu; use brew on macOS</code>
          <div>Then start the Bridge (it finds <span className="mono">gmx</span> on your PATH) and connect it above. Windows: run the Bridge inside WSL2. Apple Silicon uses the CPU.</div>
        </div></Card>
      </div>
    );
  }

  if (!health.tools.gmx) {
    return (
      <div className="stack">
        <Callout kind="err">The Bridge is connected, but GROMACS (<span className="mono">gmx</span>) was not found on its PATH. Install GROMACS and restart the Bridge with <span className="mono">--allow gmx</span> (or use the default allow list).</Callout>
        <Card title="GROMACS"><div className="stack" style={SMALL}>
          <div>Linux: <code className="mono">sudo apt install gromacs</code> or <code className="mono">conda install -c conda-forge gromacs</code>. macOS: <code className="mono">brew install gromacs</code> (CPU). Windows: install inside WSL2 and start the Bridge there. The CUDA build from gromacs.org uses an NVIDIA GPU; AMD needs HIP on Linux; Intel uses a SYCL/oneAPI build.</div>
          <div>After installing, stop and start the Bridge so its health report is refreshed.</div>
        </div></Card>
        <BridgePanel />
      </div>
    );
  }

  const gmx = health.tools.gmx;
  const gpuName = health.gpus.find((g) => ['nvidia', 'amd', 'intel'].includes(g.vendor))?.name ?? health.gpus[0]?.name;
  const gpuText = forceCpu
    ? `CPU only: you chose Force CPU; ${threads} OpenMP thread(s) will be used.`
    : choice!.mode === 'gpu'
      ? `GPU: ${gpuName ?? 'reported graphics device'} (${gmx.build?.gpu ?? 'GPU'} build); mdrun flags ${choice!.flags.join(' ')}.`
      : `CPU only: ${choice!.note}`;

  return (
    <div className="split"><div className="stack">
      <Card title="1 · Structure and options" sub={`GROMACS ${gmx.build?.version ?? gmx.version}`}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { setPdb(ubq); setSource('1UBQ · ubiquitin (76 residues)'); setResult(null); }}>Load 1UBQ demo</button>
            <span className="faint" style={SMALL}>{source}{validation.v ? ` · ${validation.v.atoms} atoms · chains ${validation.v.chains.join(', ')}` : ''}</span>
          </div>
          <FileDrop accept=".pdb,.ent,.txt" label="Drop a protein PDB (only the protein is set up; see the note below)" onText={(t, n) => { setPdb(t); setSource(n); setResult(null); }} />
          {validation.error && <Callout kind="err">{validation.error}</Callout>}
          {validation.v?.warnings.map((w) => <div key={w} className="faint" style={SMALL}>{w}</div>)}
          <div className="cols-2" style={{ gap: 8 }}>
            <Field label="Temperature (K)"><select className="select" disabled={busy} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))}><option value={300}>300</option><option value={310}>310</option></select></Field>
            <Field label="Force field"><select className="select" disabled={busy} value={forceField} onChange={(e) => setForceField(e.target.value as ForceField)}>{FORCE_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Field>
            <Field label="Water model"><select className="select" disabled={busy} value={water} onChange={(e) => setWater(e.target.value as Water)}>{WATERS.map((w) => <option key={w} value={w}>{w}</option>)}</select></Field>
            <Field label="Minimisation steps"><select className="select" disabled={busy} value={emSteps} onChange={(e) => setEmSteps(Number(e.target.value))}><option value={500}>500 (quick)</option><option value={5000}>5,000</option></select></Field>
            <Field label="NVT steps (2 fs)"><select className="select" disabled={busy} value={nvtSteps} onChange={(e) => setNvtSteps(Number(e.target.value))}><option value={1000}>1,000 · 2 ps</option><option value={5000}>5,000 · 10 ps</option><option value={25000}>25,000 · 50 ps</option></select></Field>
            <Field label="NPT steps (2 fs)"><select className="select" disabled={busy} value={nptSteps} onChange={(e) => setNptSteps(Number(e.target.value))}><option value={1000}>1,000 · 2 ps</option><option value={5000}>5,000 · 10 ps</option><option value={25000}>25,000 · 50 ps</option></select></Field>
            <Field label="Production steps (2 fs)"><select className="select" disabled={busy} value={mdSteps} onChange={(e) => setMdSteps(Number(e.target.value))}><option value={2000}>2,000 · 4 ps</option><option value={10000}>10,000 · 20 ps</option><option value={50000}>50,000 · 100 ps</option></select></Field>
            <Field label="Trajectory stride (steps)"><select className="select" disabled={busy} value={stride} onChange={(e) => setStride(Number(e.target.value))}><option value={250}>250 · 0.5 ps</option><option value={500}>500 · 1 ps</option><option value={1000}>1,000 · 2 ps</option></select></Field>
          </div>
          <div className="faint" style={SMALL}>{gpuText}</div>
          <label className="row" style={{ gap: 6, ...SMALL }}><input type="checkbox" checked={forceCpu} disabled={busy} onChange={(e) => setForceCpu(e.target.checked)} /> Force CPU (ignore the reported GPU)</label>
          <div className="faint" style={SMALL}>Threads: {threads} OpenMP (from the Bridge health report: {health.cpus} CPUs). {useGpu ? 'GPU and CPU work together.' : 'All work stays on the CPU.'}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" data-testid="md-run" disabled={busy || !validation.v} onClick={start}>{busy ? 'Running…' : 'Run on my computer'}</button>
            {busy && <button className="btn" data-testid="md-cancel" onClick={stop}>Cancel</button>}
          </div>
          {busy && <Busy progress={progress} note={note} />}
          {error && <Callout kind="err"><span data-testid="md-error">{error}</span></Callout>}
        </div>
      </Card>

      <Card title="2 · Plan and log" sub={`${job ? `job ${job} · ` : ''}${elapsed ? `elapsed ${(elapsed / 1000).toFixed(1)} s` : '18 steps, run in order'}`}
        actions={job ? <button className="btn sm" disabled={busy} onClick={() => void deleteJob()}>Delete job</button> : undefined}>
        <div className="stack" style={{ gap: 8 }}>
          <div data-testid="md-plan" style={{ display: 'grid', gap: 3, fontSize: 12 }}>
            {(steps.length ? steps : preview.map((s): MdStepState => ({ label: s.label, status: 'pending' }))).map((s, i) => (
              <div key={s.label + i} data-status={s.status} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span><span className="faint">{String(i + 1).padStart(2, '0')}</span> {s.label}{s.note ? ` · ${s.note}` : ''}</span>
                <span className={`badge ${statusClass(s.status)}`}>{s.status}{'ms' in s && s.ms ? ` · ${(s.ms / 1000).toFixed(1)} s` : ''}</span>
              </div>
            ))}
          </div>
          <div className="faint" style={SMALL} data-testid="md-estimate">
            {estimate !== null ? `Rough estimate (${useGpu ? 'GPU' : 'CPU'}, from the measured NVT speed of ${speed!.toFixed(2)} ps/min): NPT + production (${remainingPs.toFixed(1)} ps) takes about ${estimate.toFixed(1)} min. Not a promise: system size and hardware decide.` : 'Rough estimate: shown after NVT finishes, from that stage\'s measured speed. No guess is made before then.'}
          </div>
          <pre data-testid="md-log" className="mono" style={{ maxHeight: 240, overflow: 'auto', fontSize: 11, background: 'var(--bg-2)', padding: 8, borderRadius: 6, margin: 0 }}>{log || 'The GROMACS log appears here when the run starts.'}</pre>
        </div>
      </Card>
    </div>
    <div className="stack">
      {result ? <NativeMdResults result={result} onSend={send} onDelete={() => void deleteJob()} /> : (
        <Card title="Results"><div className="faint" style={{ padding: 30, textAlign: 'center' }}>Run the workflow to see the minimisation energy, temperature, density, RMSD, RMSF, Rg and the trajectory.</div></Card>
      )}
      <Callout kind="warn"><span data-testid="md-limits">Runs GROMACS on your own computer through the Bridge; nothing is sent to Solagene. This is a standard solvated protein workflow (explicit water, ions, minimisation, NVT, NPT, production). Short runs only show stability, not converged sampling. Ligands, membranes, nonstandard residues and covalent modifications are not set up by this tab.</span></Callout>
      <div className="faint" style={SMALL}>The force field and water model are the ones you choose; the topology is built by <span className="mono">gmx pdb2gmx</span>. Alternate locations are reduced to conformer A. Systems above 20,000 input atoms are refused. Results are research-grade and not clinical.</div>
    </div></div>
  );
}
