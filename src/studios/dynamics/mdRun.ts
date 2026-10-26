/** Orchestrates the GROMACS workflow over the Nayancode Bridge. Pure of React and DOM. */
import { parseXvg, type XvgData } from '@/studios/trajectory/xvg';
import { commandPlan, mdpTemplates, normaliseOptions, parseEmPotential, validateInput, type MdOptions, type MdStep } from './gmx';

export interface MdBridge {
  createJob(): Promise<string>;
  upload(job: string, name: string, data: string): Promise<unknown>;
  list(job: string): Promise<{ name: string }[]>;
  run(job: string, tool: string, args: string[], opts: { stdin?: string; onLog?: (text: string) => void; onRunId?: (id: string) => void; signal?: AbortSignal }): Promise<{ code: number | null; state: string }>;
  download(job: string, name: string): Promise<Blob>;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'retried';
export interface MdStepState {
  label: string;
  status: StepStatus;
  startedAt?: number;
  endedAt?: number;
  ms?: number;
  note?: string;
}

export interface MdSummary {
  atoms: number;
  emPotential: number | null;
  meanTemperature: number | null;
  meanPressure: number | null;
  meanDensity: number | null;
  finalRmsd: number | null;
  meanRmsf: number | null;
  meanRg: number | null;
  models: number;
  nvtPsPerMin: number | null;
  mdPs: number;
}

export interface MdRunResult {
  job: string;
  steps: MdStepState[];
  xvg: Record<string, string>;
  trajPdb: string;
  emLog: string;
  summary: MdSummary;
  elapsedMs: number;
}

export interface MdCallbacks {
  onJob?: (job: string) => void;
  onStep?: (steps: MdStepState[]) => void;
  onLog?: (text: string) => void;
  onRunId?: (id: string | null) => void;
  signal?: AbortSignal;
}

export class MdRunError extends Error {
  job: string;
  step: string;
  constructor(message: string, job: string, step: string) {
    super(message);
    this.name = 'MdRunError';
    this.job = job;
    this.step = step;
  }
}

const lastLines = (text: string, n = 30) => text.split(/\r?\n/).filter(Boolean).slice(-n).join('\n');
const GPU_FAIL = /GPU|CUDA|HIP|OpenCL|SYCL|device/i;
const mdrunStep = (s: MdStep) => s.args[0] === 'mdrun';
const stripGpu = (args: string[]) => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (['-nb', '-pme', '-bonded'].includes(args[i]) && args[i + 1] === 'gpu') { i++; continue; }
    out.push(args[i]);
  }
  return out;
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const avgSeries = (data: XvgData, name: string, fallback: number) => {
  const i = data.series.findIndex((_, k) => data.legends[k]?.toLowerCase() === name.toLowerCase());
  return mean(data.series[i >= 0 ? i : fallback] ?? []);
};

/** Run the full plan, stop honestly at the first failure, and retry a GPU failure once on the CPU. */
export async function runMdPlan(bridge: MdBridge, pdbText: string, input: Partial<MdOptions>, cb: MdCallbacks = {}): Promise<MdRunResult> {
  const validation = validateInput(pdbText);
  if (!validation.atoms) throw new Error('No ATOM or HETATM records were found in the protein PDB.');
  const opts = normaliseOptions(input);
  const attempt = commandPlan(opts);
  const states: MdStepState[] = attempt.map((s) => ({ label: s.label, status: 'pending' }));
  const started = performance.now();
  const emit = () => cb.onStep?.(states.map((s) => ({ ...s })));
  emit();

  const job = await bridge.createJob();
  cb.onJob?.(job);
  const mdps = mdpTemplates(opts);
  await bridge.upload(job, 'protein.pdb', validation.text);
  for (const [name, text] of Object.entries(mdps)) await bridge.upload(job, name, text);

  let gpuEnabled = (opts.gpuFlags?.length ?? 0) > 0;
  try {
    for (let i = 0; i < attempt.length; i++) {
      const step = attempt[i];
      const state = states[i];
      const runArgs = gpuEnabled && mdrunStep(step) ? step.args : stripGpu(step.args);
      const t0 = performance.now();
      state.status = 'running'; state.startedAt = t0; emit();
      let text = '';
      const runOnce = async (args: string[]) => {
        cb.onRunId?.(null);
        return await bridge.run(job, step.tool, args, {
          stdin: step.stdin,
          signal: cb.signal,
          onRunId: (id) => cb.onRunId?.(id),
          onLog: (chunk) => { text += chunk; cb.onLog?.(chunk); },
        });
      };
      let result = await runOnce(runArgs);
      const gpuAttempt = gpuEnabled && mdrunStep(step) && runArgs.includes('-nb');
      if ((result.code !== 0 || result.state !== 'exited') && gpuAttempt && GPU_FAIL.test(text)) {
        state.status = 'retried'; state.note = 'GPU run failed; retrying this stage on the CPU once.'; emit();
        cb.onLog?.(`\n[native-md] GPU failure in ${step.label}; retrying on the CPU.\n`);
        gpuEnabled = false;
        text = '';
        result = await runOnce(stripGpu(step.args));
      }
      state.endedAt = performance.now(); state.ms = state.endedAt - t0;
      if (result.code !== 0 || result.state !== 'exited') {
        state.status = 'failed'; emit();
        throw new MdRunError(`Step "${step.label}" failed (${result.state}, exit ${result.code ?? 'none'}).\nLast lines:\n${lastLines(text)}`, job, step.label);
      }
      const names = new Set((await bridge.list(job)).map((f) => f.name));
      const missing = step.expects.filter((f) => !names.has(f));
      if (missing.length) {
        state.status = 'failed'; emit();
        throw new MdRunError(`Step "${step.label}" finished but did not create: ${missing.join(', ')}`, job, step.label);
      }
      state.status = 'done'; emit();
    }

    const wanted = ['rmsd.xvg', 'rmsf.xvg', 'gyrate.xvg', 'energy.xvg', 'traj.pdb', 'em.log'];
    const xvg: Record<string, string> = {};
    let trajPdb = '', emLog = '';
    for (const name of wanted) {
      const blob = await bridge.download(job, name);
      const text = await blob.text();
      if (name.endsWith('.xvg')) xvg[name] = text;
      else if (name === 'traj.pdb') trajPdb = text;
      else emLog = text;
    }
    const rmsd = parseXvg(xvg['rmsd.xvg']);
    const rmsf = parseXvg(xvg['rmsf.xvg']);
    const gyrate = parseXvg(xvg['gyrate.xvg']);
    const energy = parseXvg(xvg['energy.xvg']);
    const nvt = states.find((s) => s.label === 'mdrun nvt');
    const nvtPs = opts.nvtSteps * 0.002;
    const mdPs = opts.mdSteps * 0.002;
    const summary: MdSummary = {
      atoms: validation.atoms,
      emPotential: parseEmPotential(emLog),
      meanTemperature: avgSeries(energy, 'Temperature', 1),
      meanPressure: avgSeries(energy, 'Pressure', 2),
      meanDensity: avgSeries(energy, 'Density', 3),
      finalRmsd: rmsd.series[0]?.at(-1) ?? null,
      meanRmsf: mean(rmsf.series[0] ?? []),
      meanRg: mean(gyrate.series[0] ?? []),
      models: (trajPdb.match(/^MODEL/mg) ?? []).length,
      nvtPsPerMin: nvt?.ms ? nvtPs / (nvt.ms / 60000) : null,
      mdPs,
    };
    return { job, steps: states, xvg, trajPdb, emLog, summary, elapsedMs: performance.now() - started };
  } catch (e) {
    if (e instanceof MdRunError) throw e;
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new MdRunError(e instanceof Error ? e.message : String(e), job, states.find((s) => s.status === 'running')?.label ?? '');
  }
}
