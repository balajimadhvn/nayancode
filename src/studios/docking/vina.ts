/** Thin typed wrapper around the AutoDock Vina 1.2.7 WebAssembly module built by scripts/vendor_vina.sh. Runs in a worker or in Node. */
import { parsePoses, type Pose } from './pdbqt';

export interface VinaModule {
  FS: { writeFile(path: string, data: string | Uint8Array): void; unlink(path: string): void };
  UTF8ToString(ptr: number): string;
  stringToUTF8(s: string, ptr: number, max: number): void;
  lengthBytesUTF8(s: string): number;
  _malloc(n: number): number;
  _free(p: number): void;
  _vina_dock(rec: number, lig: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, exh: number, n: number, seed: number, cpu: number, range: number, sf: number): number;
  _vina_score(rec: number, lig: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, sf: number): number;
  _vina_free(p: number): void;
  onProgress?: (p: number) => void;
}
export type VinaFactory = (opts: Record<string, unknown>) => Promise<VinaModule>;

export interface DockParams { center: [number, number, number]; size: [number, number, number]; exhaustiveness: number; nPoses: number; seed: number; energyRange?: number; scoring?: 'vina' | 'vinardo' }
export interface DockResult { poses: Pose[]; seconds: number; version: string }

/** Limits shown on the page and enforced here (Vina's grid needs memory proportional to box volume). */
export const LIMITS = { maxBox: 40, minBox: 8, maxExhaustiveness: 64, maxPoses: 20, maxLigandHeavyAtoms: 70, maxRotatable: 20, maxReceptorAtoms: 20000, maxScreen: 300 };

export function validateParams(p: DockParams) {
  for (const s of p.size) if (!(s >= LIMITS.minBox && s <= LIMITS.maxBox)) throw new Error(`Search box sides must be between ${LIMITS.minBox} and ${LIMITS.maxBox} Å (got ${s.toFixed(1)}).`);
  if (!(p.exhaustiveness >= 1 && p.exhaustiveness <= LIMITS.maxExhaustiveness)) throw new Error(`Exhaustiveness must be 1–${LIMITS.maxExhaustiveness}.`);
  if (!(p.nPoses >= 1 && p.nPoses <= LIMITS.maxPoses)) throw new Error(`Number of poses must be 1–${LIMITS.maxPoses}.`);
}

export class VinaEngine {
  private recPath = '/receptor.pdbqt';
  private constructor(readonly mod: VinaModule, readonly threads: number) {}
  static async create(factory: VinaFactory, threads = 1, onLog?: (s: string) => void): Promise<VinaEngine> {
    const mod = await factory({ print: onLog ?? (() => {}), printErr: onLog ?? (() => {}) });
    return new VinaEngine(mod, Math.max(1, Math.floor(threads)));
  }
  setReceptor(pdbqt: string) { this.mod.FS.writeFile(this.recPath, pdbqt); }
  private str(s: string) { const n = this.mod.lengthBytesUTF8(s) + 1, p = this.mod._malloc(n); this.mod.stringToUTF8(s, p, n); return p; }
  private call(f: (ptrs: number[]) => number, strings: string[]): string {
    const ptrs = strings.map((s) => this.str(s));
    try { const r = f(ptrs); const out = this.mod.UTF8ToString(r); this.mod._vina_free(r); return out; } finally { ptrs.forEach((p) => this.mod._free(p)); }
  }
  dock(ligandPdbqt: string, p: DockParams, onProgress?: (f: number) => void): DockResult {
    validateParams(p);
    this.mod.onProgress = onProgress;
    const t0 = performance.now();
    const sf = p.scoring ?? 'vina';
    const out = this.call(([r, l, s]) => this.mod._vina_dock(r, l, p.center[0], p.center[1], p.center[2], p.size[0], p.size[1], p.size[2], p.exhaustiveness, p.nPoses, p.seed, this.threads, p.energyRange ?? 3, s), [this.recPath, ligandPdbqt, sf]);
    if (out.startsWith('ERROR:')) throw new Error(out.slice(6).trim());
    const poses = parsePoses(out);
    if (!poses.length) throw new Error('Vina returned no poses (the ligand may lie outside the search box or clash with the receptor).');
    return { poses, seconds: (performance.now() - t0) / 1000, version: 'AutoDock Vina 1.2.7' };
  }
  /** Score of the supplied pose and of its locally optimised pose: [total, inter, intra, torsion, intra-best-pose, unbound], kcal/mol. */
  score(ligandPdbqt: string, p: Pick<DockParams, 'center' | 'size' | 'scoring'>): { score: number[]; optimised: number[] } {
    const out = this.call(([r, l, s]) => this.mod._vina_score(r, l, p.center[0], p.center[1], p.center[2], p.size[0], p.size[1], p.size[2], s), [this.recPath, ligandPdbqt, p.scoring ?? 'vina']);
    if (out.startsWith('ERROR:')) throw new Error(out.slice(6).trim());
    const [a, b] = out.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    return { score: a, optimised: b };
  }
}
