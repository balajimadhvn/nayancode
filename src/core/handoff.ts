import { create } from 'zustand';

/** In-memory hand-off between studios (never persisted, never sent anywhere): e.g. Genome Studio → Variant Studio, nf-core import → any studio. */
export interface ExprHand { counts: string; sheet: string; label: string }
export interface ScHand { mtx: string; features: string; barcodes: string; label: string }
interface Handoff {
  vcf: { text: string; label: string } | null; setVcf(v: { text: string; label: string } | null): void;
  structure: { kind: 'af' | 'pdb'; id: string } | null; setStructure(v: { kind: 'af' | 'pdb'; id: string } | null): void;
  expr: ExprHand | null; setExpr(v: ExprHand | null): void;
  sc: ScHand | null; setSc(v: ScHand | null): void;
}
/** The shell animates route changes with AnimatePresence, and the exiting node renders the NEW route, so a studio can mount twice
 *  in quick succession. Clearing a hand-off at the first consume would leave the second (real) mount empty, so clear after the transition. */
export function clearHandoffSoon(key: 'vcf' | 'structure' | 'expr' | 'sc') { setTimeout(() => useHandoff.setState({ [key]: null }), 1500); }
export const useHandoff = create<Handoff>((set) => ({
  vcf: null, setVcf: (vcf) => set({ vcf }), structure: null, setStructure: (structure) => set({ structure }),
  expr: null, setExpr: (expr) => set({ expr }), sc: null, setSc: (sc) => set({ sc }),
}));
