/** Pure command and .mdp generators for the Native MD tab (GROMACS through the Nayancode Bridge). */
import type { BridgeHealth } from '@/compute/bridge';

export const FORCE_FIELDS = ['amber99sb-ildn', 'amber99sb', 'charmm27', 'oplsaa'] as const;
export const WATERS = ['tip3p', 'tip4p', 'spc', 'spce'] as const;
export type ForceField = (typeof FORCE_FIELDS)[number];
export type Water = (typeof WATERS)[number];

export interface MdOptions {
  temperature: number;
  emSteps: number;
  nvtSteps: number;
  nptSteps: number;
  mdSteps: number;
  stride: number;
  seed: number;
  water: Water;
  forceField: ForceField;
  threads: number;
  gpuFlags?: string[];
  dtPs: number;
}

export interface MdStep {
  label: string;
  tool: 'gmx';
  args: string[];
  stdin?: string;
  expects: string[];
}

const int = (v: number, name: string, min = 1, max = 1e9) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return v;
};
const num = (v: number, name: string) => {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} must be a positive number`);
  return v;
};

export function normaliseOptions(input: Partial<MdOptions> = {}): MdOptions {
  const o: MdOptions = {
    temperature: input.temperature ?? 300,
    emSteps: input.emSteps ?? 5000,
    nvtSteps: input.nvtSteps ?? 25000,
    nptSteps: input.nptSteps ?? 25000,
    mdSteps: input.mdSteps ?? 50000,
    stride: input.stride ?? 500,
    seed: input.seed ?? 20261026,
    water: input.water ?? 'tip3p',
    forceField: input.forceField ?? 'amber99sb-ildn',
    threads: input.threads ?? 1,
    gpuFlags: input.gpuFlags ?? [],
    dtPs: input.dtPs ?? (input.stride ?? 500) * 0.002,
  };
  num(o.temperature, 'temperature');
  int(o.emSteps, 'emSteps');
  int(o.nvtSteps, 'nvtSteps');
  int(o.nptSteps, 'nptSteps');
  int(o.mdSteps, 'mdSteps');
  int(o.stride, 'stride');
  int(o.seed, 'seed', 0, 2147483647);
  int(o.threads, 'threads', 1, 256);
  num(o.dtPs, 'dtPs');
  if (!WATERS.includes(o.water)) throw new Error(`water must be one of ${WATERS.join(', ')}`);
  if (!FORCE_FIELDS.includes(o.forceField)) throw new Error(`force field must be one of ${FORCE_FIELDS.join(', ')}`);
  for (const f of o.gpuFlags ?? []) if (!['-nb', '-pme', '-bonded', 'gpu'].includes(f)) throw new Error('GPU flags can only be mdrun flags');
  return o;
}

const lines = (items: string[]) => items.join('\n') + '\n';
const base = (coulomb: 'cutoff' | 'PME', nsteps: number) => [
  'integrator = steep',
  'emtol = 1000.0',
  'emstep = 0.01',
  `nsteps = ${nsteps}`,
  'cutoff-scheme = Verlet',
  'nstlist = 10',
  `coulombtype = ${coulomb}`,
  'rcoulomb = 1.0',
  'vdwtype = cutoff',
  'rvdw = 1.0',
  'pbc = xyz',
];

/** The five .mdp files, written exactly as the item specifies. */
export function mdpTemplates(input: Partial<MdOptions> = {}): Record<string, string> {
  const o = normaliseOptions(input);
  const nvt = [
    'define = -DPOSRES',
    'integrator = md',
    'dt = 0.002',
    `nsteps = ${o.nvtSteps}`,
    'continuation = no',
    'constraint_algorithm = lincs',
    'constraints = h-bonds',
    'lincs_iter = 1',
    'lincs_order = 4',
    'cutoff-scheme = Verlet',
    'nstlist = 20',
    'coulombtype = PME',
    'pme_order = 4',
    'fourierspacing = 0.16',
    'rcoulomb = 1.0',
    'rvdw = 1.0',
    'DispCorr = EnerPres',
    'tcoupl = V-rescale',
    'tc-grps = Protein Non-Protein',
    'tau_t = 0.1 0.1',
    `ref_t = ${o.temperature} ${o.temperature}`,
    'pcoupl = no',
    'gen_vel = yes',
    `gen_temp = ${o.temperature}`,
    `gen_seed = ${o.seed}`,
    'pbc = xyz',
    'nstenergy = 100',
    'nstlog = 500',
    'nstxout-compressed = 0',
  ];
  const npt = nvt.map((l) => {
    if (l.startsWith('nsteps =')) return `nsteps = ${o.nptSteps}`;
    if (l === 'gen_vel = yes') return 'gen_vel = no';
    if (l === 'continuation = no') return 'continuation = yes';
    if (l === 'pcoupl = no') return 'pcoupl = C-rescale';
    return l;
  }).concat(['pcoupltype = isotropic', 'tau_p = 2.0', 'ref_p = 1.0', 'compressibility = 4.5e-5', 'refcoord_scaling = com']);
  const md = npt.filter((l) => l !== 'define = -DPOSRES').map((l) => l.startsWith('nsteps =') ? `nsteps = ${o.mdSteps}` : l === 'nstxout-compressed = 0' ? `nstxout-compressed = ${o.stride}` : l);
  md.push('compressed-x-grps = Protein');
  return {
    'ions.mdp': lines(base('cutoff', 50000)),
    'em.mdp': lines(base('PME', o.emSteps)),
    'nvt.mdp': lines(nvt),
    'npt.mdp': lines(npt),
    'md.mdp': lines(md),
  };
}

/** The complete 18-step workflow, in the order the item requires. */
export function commandPlan(input: Partial<MdOptions> = {}): MdStep[] {
  const o = normaliseOptions(input);
  const mdrun = (deffnm: string, extra: string[] = []): MdStep => ({
    label: `mdrun ${deffnm}`, tool: 'gmx',
    args: ['mdrun', '-deffnm', deffnm, '-ntmpi', '1', '-ntomp', String(o.threads), ...extra],
    expects: [`${deffnm}.gro`, `${deffnm}.log`, `${deffnm}.edr`],
  });
  const gpu = o.gpuFlags ?? [];
  return [
    { label: 'pdb2gmx', tool: 'gmx', args: ['pdb2gmx', '-f', 'protein.pdb', '-o', 'processed.gro', '-p', 'topol.top', '-i', 'posre.itp', '-water', o.water, '-ff', o.forceField, '-ignh'], expects: ['processed.gro', 'topol.top', 'posre.itp'] },
    { label: 'editconf', tool: 'gmx', args: ['editconf', '-f', 'processed.gro', '-o', 'boxed.gro', '-c', '-d', '1.0', '-bt', 'dodecahedron'], expects: ['boxed.gro'] },
    { label: 'solvate', tool: 'gmx', args: ['solvate', '-cp', 'boxed.gro', '-cs', 'spc216.gro', '-o', 'solv.gro', '-p', 'topol.top'], expects: ['solv.gro', 'topol.top'] },
    { label: 'grompp ions', tool: 'gmx', args: ['grompp', '-f', 'ions.mdp', '-c', 'solv.gro', '-p', 'topol.top', '-o', 'ions.tpr'], expects: ['ions.tpr'] },
    { label: 'genion', tool: 'gmx', args: ['genion', '-s', 'ions.tpr', '-o', 'solv_ions.gro', '-p', 'topol.top', '-pname', 'NA', '-nname', 'CL', '-neutral', '-conc', '0.15'], stdin: 'SOL\n', expects: ['solv_ions.gro', 'topol.top'] },
    { label: 'grompp em', tool: 'gmx', args: ['grompp', '-f', 'em.mdp', '-c', 'solv_ions.gro', '-p', 'topol.top', '-o', 'em.tpr'], expects: ['em.tpr'] },
    mdrun('em'),
    { label: 'grompp nvt', tool: 'gmx', args: ['grompp', '-f', 'nvt.mdp', '-c', 'em.gro', '-r', 'em.gro', '-p', 'topol.top', '-o', 'nvt.tpr'], expects: ['nvt.tpr'] },
    mdrun('nvt', gpu),
    { label: 'grompp npt', tool: 'gmx', args: ['grompp', '-f', 'npt.mdp', '-c', 'nvt.gro', '-t', 'nvt.cpt', '-r', 'nvt.gro', '-p', 'topol.top', '-o', 'npt.tpr'], expects: ['npt.tpr'] },
    mdrun('npt', gpu),
    { label: 'grompp md', tool: 'gmx', args: ['grompp', '-f', 'md.mdp', '-c', 'npt.gro', '-t', 'npt.cpt', '-p', 'topol.top', '-o', 'md.tpr'], expects: ['md.tpr'] },
    mdrun('md', gpu),
    { label: 'rms', tool: 'gmx', args: ['rms', '-s', 'md.tpr', '-f', 'md.xtc', '-o', 'rmsd.xvg', '-tu', 'ns'], stdin: 'Backbone\nBackbone\n', expects: ['rmsd.xvg'] },
    { label: 'rmsf', tool: 'gmx', args: ['rmsf', '-s', 'md.tpr', '-f', 'md.xtc', '-o', 'rmsf.xvg', '-res'], stdin: 'Backbone\n', expects: ['rmsf.xvg'] },
    { label: 'gyrate', tool: 'gmx', args: ['gyrate', '-s', 'md.tpr', '-f', 'md.xtc', '-o', 'gyrate.xvg'], stdin: 'Protein\n', expects: ['gyrate.xvg'] },
    { label: 'energy', tool: 'gmx', args: ['energy', '-f', 'md.edr', '-o', 'energy.xvg'], stdin: 'Potential\nTemperature\nPressure\nDensity\n0\n', expects: ['energy.xvg'] },
    { label: 'trjconv', tool: 'gmx', args: ['trjconv', '-s', 'md.tpr', '-f', 'md.xtc', '-o', 'traj.pdb', '-pbc', 'mol', '-center', '-dt', String(o.dtPs)], stdin: 'Protein\nProtein\n', expects: ['traj.pdb'] },
  ];
}

export interface ValidationResult {
  text: string;
  atoms: number;
  hetatm: number;
  altlocs: number;
  chains: string[];
  warnings: string[];
}

/** Clean altlocs, warn about ligands and chain breaks, and cap the atom count. */
export function validateInput(pdbText: string): ValidationResult {
  const raw = pdbText.split(/\r?\n/);
  const atomLines = raw.filter((l) => /^(ATOM  |HETATM)/.test(l));
  if (atomLines.length > 20000) throw new Error('Use a smaller system or run GROMACS directly');
  let hetatm = 0, altlocs = 0;
  const chains = new Set<string>();
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of raw) {
    if (!/^(ATOM  |HETATM)/.test(line)) { kept.push(line); continue; }
    const record = line.slice(0, 6).trim();
    const alt = line[16] ?? ' ';
    const chain = line[21] ?? ' ';
    const resSeq = line.slice(22, 26).trim();
    const resName = line.slice(17, 20).trim();
    const atomName = line.slice(12, 16).trim();
    if (record === 'HETATM') hetatm++;
    if (alt !== ' ' && alt !== 'A') { altlocs++; continue; }
    const key = `${chain}|${resSeq}|${resName}|${atomName}`;
    if (seen.has(key)) { altlocs++; continue; }
    seen.add(key);
    chains.add(chain);
    kept.push(alt === 'A' ? line.slice(0, 16) + ' ' + line.slice(17) : line);
  }
  const warnings: string[] = [];
  if (hetatm) warnings.push(`${hetatm} HETATM record(s): ligands, ions or modified residues need parameters this tab cannot generate; GROMACS may stop at pdb2gmx.`);
  if (altlocs) warnings.push(`${altlocs} alternate-location record(s) were removed; the A conformer was kept.`);
  let breaks = 0;
  let prev: { chain: string; res: number; x: number; y: number; z: number } | null = null;
  for (const line of kept) {
    if (!/^ATOM  /.test(line) || line.slice(12, 16).trim() !== 'CA') continue;
    const cur = { chain: line[21] ?? ' ', res: Number(line.slice(22, 26)), x: Number(line.slice(30, 38)), y: Number(line.slice(38, 46)), z: Number(line.slice(46, 54)) };
    if (prev && prev.chain === cur.chain) {
      const d = Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
      if (Math.abs(cur.res - prev.res) > 1 || (Number.isFinite(d) && d > 4.5)) breaks++;
    }
    prev = cur;
  }
  if (breaks) warnings.push(`${breaks} chain break(s) or numbering gap(s) detected; GROMACS will still build the topology but the geometry may be strained.`);
  return { text: kept.join('\n'), atoms: kept.filter((l) => /^(ATOM  |HETATM)/.test(l)).length, hetatm, altlocs, chains: [...chains], warnings };
}

export interface MdrunChoice { mode: 'gpu' | 'cpu'; flags: string[]; note: string }
const has = (h: BridgeHealth, v: string) => h.gpus.some((g) => g.vendor === v);

/** Browser twin of the Bridge's pickGmxGpuMode, using only the health report. */
export function chooseMdrunFlags(health: BridgeHealth): MdrunChoice {
  const build = health.tools.gmx?.build?.gpu ?? health.tools.gmx_mpi?.build?.gpu ?? 'unknown';
  const apple = has(health, 'apple');
  if (apple && !has(health, 'nvidia') && !has(health, 'amd')) return { mode: 'cpu', flags: [], note: 'GROMACS uses the CPU on Apple Silicon (fast for small systems).' };
  if (build === 'CUDA' && has(health, 'nvidia')) return { mode: 'gpu', flags: ['-nb', 'gpu', '-pme', 'gpu', '-bonded', 'gpu'], note: 'CUDA build with an NVIDIA GPU.' };
  if (build === 'HIP' && has(health, 'amd')) return { mode: 'gpu', flags: ['-nb', 'gpu', '-pme', 'gpu'], note: 'HIP build with an AMD GPU.' };
  if (build === 'SYCL' && (has(health, 'intel') || has(health, 'amd') || has(health, 'nvidia'))) return { mode: 'gpu', flags: ['-nb', 'gpu'], note: 'SYCL build: GPU offload of nonbonded forces only.' };
  if (build === 'OpenCL' && (has(health, 'amd') || has(health, 'intel'))) return { mode: 'gpu', flags: ['-nb', 'gpu'], note: 'OpenCL build: slower than CUDA/HIP; verify performance.' };
  const vendor = has(health, 'nvidia') ? 'NVIDIA: a CUDA build would use it.' : has(health, 'amd') ? 'AMD: a HIP build (Linux) or a SYCL build would use it.' : has(health, 'intel') ? 'Intel: a SYCL (oneAPI) build would use it.' : has(health, 'apple') ? 'Apple Silicon: GROMACS uses the CPU.' : 'No GPU was reported; the CPU is the only option.';
  return { mode: 'cpu', flags: [], note: `This GROMACS build has no GPU support for your hardware; running on the CPU. ${vendor}` };
}

/** GROMACS writes the final minimisation energy in em.log. */
export function parseEmPotential(log: string): number | null {
  const matches = [...String(log).matchAll(/Potential Energy\s*=\s*(-?[\d.]+(?:[eE][+-]?\d+)?)/g)];
  if (!matches.length) return null;
  const v = Number(matches[matches.length - 1][1]);
  return Number.isFinite(v) ? v : null;
}
