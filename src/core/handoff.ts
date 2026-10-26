import { create } from 'zustand';

/** In-memory hand-off between studios (never persisted, never sent anywhere): e.g. Genome Studio → Variant Studio, nf-core import → any studio. */
export interface ExprHand { counts: string; sheet: string; label: string }
export interface ScHand { mtx: string; features: string; barcodes: string; label: string }
/** Oligos sent from Sequence Studio to Genome Studio's specificity tools. */
export interface OligoHand { primers: { name: string; seq: string }[]; guides: { name: string; seq: string }[]; label: string }
/** ASV feature table sent from Amplicon Studio to the Microbiome Studio. */
export interface AmpliconHand { table: string; label: string }
/** Native MD trajectory (multi-model PDB) and its GROMACS time series, sent to the Trajectory Studio. */
export interface MdHand { pdb: string; xvg: { name: string; text: string }[]; label: string }
/** Files queued for the Genome Studio viewer (e.g. the VCF open in Variant Studio). */
export interface ViewItem { name: string; file?: File; text?: string }
interface Handoff {
  view: ViewItem[] | null; setView(v: ViewItem[] | null): void;
  oligos: OligoHand | null; setOligos(v: OligoHand | null): void;
  vcf: { text: string; label: string } | null; setVcf(v: { text: string; label: string } | null): void;
  structure: { kind: 'af' | 'pdb'; id: string } | null; setStructure(v: { kind: 'af' | 'pdb'; id: string } | null): void;
  expr: ExprHand | null; setExpr(v: ExprHand | null): void;
  sc: ScHand | null; setSc(v: ScHand | null): void;
  amplicon: AmpliconHand | null; setAmplicon(v: AmpliconHand | null): void;
  mdTrajectory: MdHand | null; setMdTrajectory(v: MdHand | null): void;
}
/** The shell animates route changes with AnimatePresence, and the exiting node renders the NEW route, so a studio can mount twice
 *  in quick succession. Clearing a hand-off at the first consume would leave the second (real) mount empty, so clear after the transition. */
export function clearHandoffSoon(key: 'vcf' | 'structure' | 'expr' | 'sc' | 'oligos' | 'view' | 'amplicon' | 'mdTrajectory') { setTimeout(() => useHandoff.setState({ [key]: null }), 1500); }
export const useHandoff = create<Handoff>((set) => ({
  view: null, setView: (view) => set({ view }),
  oligos: null, setOligos: (oligos) => set({ oligos }),
  vcf: null, setVcf: (vcf) => set({ vcf }), structure: null, setStructure: (structure) => set({ structure }),
  expr: null, setExpr: (expr) => set({ expr }), sc: null, setSc: (sc) => set({ sc }),
  amplicon: null, setAmplicon: (amplicon) => set({ amplicon }),
  mdTrajectory: null, setMdTrajectory: (mdTrajectory) => set({ mdTrajectory }),
}));
