import { describe, expect, it } from 'vitest';
import type { BridgeHealth } from '@/compute/bridge';
import {
  chooseMdrunFlags, commandPlan, mdpTemplates, parseEmPotential, validateInput, FORCE_FIELDS, WATERS,
} from './gmx';
import { runMdPlan, MdRunError, type MdBridge, type MdStepState } from './mdRun';

const LABELS = ['pdb2gmx', 'editconf', 'solvate', 'grompp ions', 'genion', 'grompp em', 'mdrun em', 'grompp nvt', 'mdrun nvt', 'grompp npt', 'mdrun npt', 'grompp md', 'mdrun md', 'rms', 'rmsf', 'gyrate', 'energy', 'trjconv'];

function atom(serial: number, name: string, resName: string, chain: string, resSeq: number, x: number, alt = ' ', record = 'ATOM'): string {
  return `${record.padEnd(6)}${String(serial).padStart(5)} ${name.padStart(4)}${alt}${resName.padStart(3)} ${chain}${String(resSeq).padStart(4)}    ${x.toFixed(3).padStart(8)}   0.000   0.000  1.00  0.00           ${name[0]}`;
}

const pdb = [
  atom(1, 'N', 'MET', 'A', 1, 0), atom(2, 'CA', 'MET', 'A', 1, 1.4), atom(3, 'C', 'MET', 'A', 1, 2.8),
  atom(4, 'CA', 'LYS', 'A', 2, 5.2), atom(5, 'CA', 'GLY', 'A', 3, 8.8),
  atom(6, 'CA', 'GLY', 'B', 1, 12.0, 'B'), atom(7, 'CA', 'GLY', 'B', 1, 12.0, 'A'),
  atom(8, 'O', 'HOH', 'W', 1, 14.0, ' ', 'HETATM'),
].join('\n');

const health = (gpu: string, vendors: string[]): BridgeHealth => ({
  name: 'nayancode-bridge', version: '1.0.0', cpus: 8, memoryGb: 16, platform: 'linux', runsActive: 0,
  gpus: vendors.map((v) => ({ name: v, vendor: v as never, kind: 'discrete', memoryMb: 8192, driver: '1', backends: [] })),
  tools: { gmx: { path: '/usr/bin/gmx', version: 'GROMACS version: 2025.4', build: { version: '2025.4', precision: 'mixed', gpu: gpu as never, simd: 'AVX2', threading: 'OpenMP' } } },
});

describe('mdp and command plan', () => {
  it('produces the 18 steps in the required order', () => {
    const plan = commandPlan();
    expect(plan.map((s) => s.label)).toEqual(LABELS);
    expect(plan).toHaveLength(18);
    for (const s of plan) {
      expect(s.args.every((a) => typeof a === 'string')).toBe(true);
      expect(s.args.some((a) => /[;&|`$><]/.test(a))).toBe(false);
    }
    expect(plan[0].args).toContain('amber99sb-ildn');
    expect(plan[0].args).toContain('tip3p');
    expect(plan.find((s) => s.label === 'genion')?.stdin).toBe('SOL\n');
    expect(plan.find((s) => s.label === 'rms')?.stdin).toBe('Backbone\nBackbone\n');
    expect(plan.find((s) => s.label === 'energy')?.stdin).toBe('Potential\nTemperature\nPressure\nDensity\n0\n');
  });

  it('restricts force fields and water models and rejects injection', () => {
    expect(FORCE_FIELDS).toEqual(['amber99sb-ildn', 'amber99sb', 'charmm27', 'oplsaa']);
    expect(WATERS).toEqual(['tip3p', 'tip4p', 'spc', 'spce']);
    expect(() => commandPlan({ forceField: 'tip3p; rm -rf /' as never })).toThrow(/force field/);
    expect(() => commandPlan({ water: 'tip3p && whoami' as never })).toThrow(/water/);
    expect(commandPlan({ forceField: 'oplsaa', water: 'spce' })[0].args).toEqual(expect.arrayContaining(['oplsaa', 'spce']));
  });

  it('fills temperatures, steps and stage-specific settings', () => {
    const m = mdpTemplates({ temperature: 310, nvtSteps: 111, nptSteps: 222, mdSteps: 333, emSteps: 444, stride: 50 });
    expect(m['nvt.mdp']).toContain('ref_t = 310 310');
    expect(m['nvt.mdp']).toContain('nsteps = 111');
    expect(m['nvt.mdp']).toContain('define = -DPOSRES');
    expect(m['npt.mdp']).toContain('pcoupl = C-rescale');
    expect(m['npt.mdp']).toContain('nsteps = 222');
    expect(m['npt.mdp']).toContain('continuation = yes');
    expect(m['md.mdp']).toContain('nsteps = 333');
    expect(m['md.mdp']).not.toContain('define = -DPOSRES');
    expect(m['md.mdp']).toContain('nstxout-compressed = 50');
    expect(m['em.mdp']).toContain('nsteps = 444');
    expect(m['em.mdp']).toContain('coulombtype = PME');
    expect(m['ions.mdp']).toContain('coulombtype = cutoff');
  });
});

describe('validation', () => {
  it('counts atoms, strips non-A altlocs and warns about ligands', () => {
    const v = validateInput(pdb);
    expect(v.atoms).toBe(7);
    expect(v.hetatm).toBe(1);
    expect(v.altlocs).toBe(1);
    expect(v.text).toContain('CA GLY B');
    expect(v.text.split(/\r?\n/).filter((l) => l.includes('GLY B')).length).toBe(1);
    expect(v.chains).toEqual(['A', 'B', 'W']);
    expect(v.warnings.join(' ')).toMatch(/HETATM/);
    expect(v.warnings.join(' ')).toMatch(/alternate-location/);
  });

  it('rejects more than 20,000 atoms with the required wording', () => {
    const many = Array.from({ length: 20001 }, (_, i) => atom(i + 1, 'CA', 'ALA', 'A', 1, i)).join('\n');
    expect(() => validateInput(many)).toThrow('Use a smaller system or run GROMACS directly');
  });

  it('reports chain breaks', () => {
    const broken = [atom(1, 'CA', 'ALA', 'A', 1, 0), atom(2, 'CA', 'ALA', 'A', 9, 40)].join('\n');
    expect(validateInput(broken).warnings.join(' ')).toMatch(/chain break/);
  });
});

describe('GPU choice and energy parsing', () => {
  it('mirrors the vendor table for all seven combinations', () => {
    expect(chooseMdrunFlags(health('CUDA', ['nvidia']))).toMatchObject({ mode: 'gpu', flags: ['-nb', 'gpu', '-pme', 'gpu', '-bonded', 'gpu'] });
    expect(chooseMdrunFlags(health('HIP', ['amd']))).toMatchObject({ mode: 'gpu', flags: ['-nb', 'gpu', '-pme', 'gpu'] });
    expect(chooseMdrunFlags(health('SYCL', ['intel'])).mode).toBe('gpu');
    expect(chooseMdrunFlags(health('OpenCL', ['amd'])).mode).toBe('gpu');
    expect(chooseMdrunFlags(health('CUDA', ['apple'])).mode).toBe('cpu');
    expect(chooseMdrunFlags(health('disabled', ['nvidia'])).mode).toBe('cpu');
    const noGpu = chooseMdrunFlags(health('CUDA', []));
    expect(noGpu.mode).toBe('cpu');
    expect(noGpu.note).toMatch(/only option/);
    const mismatch = chooseMdrunFlags(health('CUDA', ['amd']));
    expect(mismatch.mode).toBe('cpu');
    expect(mismatch.note).toMatch(/HIP/);
  });

  it('reads the final minimisation energy', () => {
    expect(parseEmPotential('step 10\nPotential Energy  = -1.23456e+05\nMaximum force = 9e+02\n')).toBe(-123456);
    expect(parseEmPotential('nothing')).toBeNull();
  });
});

type FakeOpts = { failAt?: string; gpuFailOnce?: boolean };
function fakeBridge(opts: FakeOpts = {}) {
  const calls: { args: string[]; stdin?: string }[] = [];
  const uploads: string[] = [];
  const plan = commandPlan();
  const files = new Set(plan.flatMap((s) => s.expects).concat('em.log'));
  const contents: Record<string, string> = {
    'rmsd.xvg': '@ s0 legend "Backbone"\n0 0.1\n1 0.2\n',
    'rmsf.xvg': '@ s0 legend "RMSF"\n1 0.08\n2 0.08\n',
    'gyrate.xvg': '@ s0 legend "Rg"\n0 1.2\n1 1.2\n',
    'energy.xvg': '@ s0 legend "Potential"\n@ s1 legend "Temperature"\n@ s2 legend "Pressure"\n@ s3 legend "Density"\n0 -100000 300 1 1000\n1 -100000 300 1 1000\n',
    'traj.pdb': 'MODEL\nENDMDL\nMODEL\nENDMDL\n',
    'em.log': 'Potential Energy  = -1.234e+05\n',
  };
  let gpuFailed = false;
  const bridge: MdBridge = {
    createJob: async () => 'job123',
    upload: async (_job, name) => { uploads.push(name); return { name }; },
    list: async () => [...files].map((name) => ({ name })),
    run: async (_job, _tool, args, o) => {
      calls.push({ args, stdin: o.stdin });
      o.onRunId?.('run' + calls.length);
      const isGrompp = args[0] === 'grompp' && opts.failAt?.startsWith('grompp') && args.includes(opts.failAt.split(' ')[1] + '.mdp');
      if (isGrompp) {
        o.onLog?.(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'));
        return { code: 1, state: 'exited' };
      }
      if (opts.gpuFailOnce && !gpuFailed && args[0] === 'mdrun' && args.includes('nvt') && args.includes('-nb')) {
        gpuFailed = true;
        o.onLog?.('CUDA error: no CUDA-capable device is detected');
        return { code: 1, state: 'exited' };
      }
      o.onLog?.(`ok ${args[0]}\n`);
      return { code: 0, state: 'exited' };
    },
    download: async (_job, name) => new Blob([contents[name] ?? '']),
  };
  return { bridge, calls, uploads, contents };
}

describe('orchestrator', () => {
  it('runs every step in order, passes stdin and collects the xvg results', async () => {
    const { bridge, calls, uploads } = fakeBridge();
    const seen: string[] = [];
    const result = await runMdPlan(bridge, pdb, {}, { onLog: (t) => seen.push(t) });
    expect(calls).toHaveLength(18);
    expect(calls.map((c) => c.args[0])).toEqual(['pdb2gmx', 'editconf', 'solvate', 'grompp', 'genion', 'grompp', 'mdrun', 'grompp', 'mdrun', 'grompp', 'mdrun', 'grompp', 'mdrun', 'rms', 'rmsf', 'gyrate', 'energy', 'trjconv']);
    expect(calls.find((c) => c.args[0] === 'genion')?.stdin).toBe('SOL\n');
    expect(calls.find((c) => c.args[0] === 'energy')?.stdin).toContain('Density');
    expect(uploads).toEqual(['protein.pdb', 'ions.mdp', 'em.mdp', 'nvt.mdp', 'npt.mdp', 'md.mdp']);
    expect(seen.join('')).toContain('ok mdrun');
    expect(result.steps.every((s: MdStepState) => s.status === 'done')).toBe(true);
    expect(result.summary).toMatchObject({ atoms: 7, emPotential: -123400, meanTemperature: 300, meanDensity: 1000, finalRmsd: 0.2, models: 2 });
    expect(result.xvg['rmsd.xvg']).toContain('0.2');
  });

  it('stops at the first failing step and keeps the last 30 log lines', async () => {
    const { bridge, calls } = fakeBridge({ failAt: 'grompp em' });
    const err = await runMdPlan(bridge, pdb, {}).catch((e) => e);
    expect(err).toBeInstanceOf(MdRunError);
    expect(err.message).toContain('grompp em');
    expect(err.message).toContain('line 40');
    expect(err.message).not.toContain('line 9');
    expect(calls).toHaveLength(6);
    expect(calls.some((c) => c.args[0] === 'mdrun')).toBe(false);
  });

  it('retries a GPU mdrun failure once on the CPU and keeps later stages on the CPU', async () => {
    const { bridge, calls } = fakeBridge({ gpuFailOnce: true });
    const logs: string[] = [];
    const result = await runMdPlan(bridge, pdb, { gpuFlags: ['-nb', 'gpu', '-pme', 'gpu', '-bonded', 'gpu'], nvtSteps: 100, nptSteps: 100, mdSteps: 100 }, { onLog: (t) => logs.push(t) });
    const nvt = calls.filter((c) => c.args[0] === 'mdrun' && c.args.includes('nvt'));
    expect(nvt).toHaveLength(2);
    expect(nvt[0].args).toContain('-nb');
    expect(nvt[1].args).not.toContain('-nb');
    expect(calls.filter((c) => c.args[0] === 'mdrun' && c.args.includes('npt'))[0].args).not.toContain('-nb');
    expect(result.steps.find((s) => s.label === 'mdrun nvt')?.note).toMatch(/GPU/);
    expect(logs.join('')).toContain('retrying on the CPU');
  });
});
