/** Molecule-tools worker: RDKit (WebAssembly) plus the TypeScript kernels in moltools.ts. */
import { exposeKernels, type Kernel } from '@/compute/rpc';
import { assetUrl } from '@/core/asset';
import type { RDKitModule } from '../docking/rdkitBridge';
import * as T from './moltools';

let rdkit: Promise<RDKitModule> | null = null;
const rd = () => (rdkit ??= (async () => {
  const text = await (await fetch(assetUrl('rdkit/RDKit_minimal.js'))).text();
  const init = new Function(`${text}\n;return initRDKitModule;`)() as (o: unknown) => Promise<RDKitModule>;
  return init({ locateFile: (f: string) => assetUrl(`rdkit/${f}`) });
})());

const scaffolds: Kernel<{ smiles: string[] }, { scaffold: T.Scaffold | null }[]> = async (a, ctx) => {
  const RD = await rd(); return a.smiles.map((s, i) => { if (i % 50 === 0) ctx.progress(i / a.smiles.length); return { scaffold: T.murcko(RD, s) }; });
};
const svgs: Kernel<{ smiles: string[]; smarts?: string }, string[]> = async (a) => { const RD = await rd(); return a.smiles.map((s) => (a.smarts ? T.highlight(RD, s, a.smarts) : T.svgOf(RD, s))); };
const mcs: Kernel<{ smiles: string[]; timeout: number; ringsOnly: boolean; anyElement: boolean }, T.McsResult> = async (a) => T.mcs(await rd(), a.smiles, { timeout: a.timeout, ringsOnly: a.ringsOnly, anyElement: a.anyElement });
const rgroups: Kernel<{ core: string; smiles: string[] }, ReturnType<typeof T.rgroups>> = async (a) => T.rgroups(await rd(), a.core, a.smiles);
const enumerate: Kernel<{ smarts: string; lists: string[][]; max: number }, T.Enumerated> = async (a) => T.enumerate(await rd(), a.smarts, a.lists, a.max);
const similarity: Kernel<{ query: string; smiles: string[]; method: 'pharmacophore' | 'usr' }, { s: number }[]> = async (a, ctx) => {
  const RD = await rd();
  if (a.method === 'pharmacophore') {
    const q = T.pharmacophore(RD, a.query); if (!q) throw new Error('The query SMILES is not valid.');
    return a.smiles.map((s, i) => { if (i % 25 === 0) ctx.progress(i / a.smiles.length); const p = T.pharmacophore(RD, s); return { s: p ? T.pharmSimilarity(q, p) : NaN }; });
  }
  const q = T.usrFromSmiles(RD, a.query); if (!q) throw new Error('The query could not be embedded in 3-D (needs a valid molecule with at least four heavy atoms).');
  return a.smiles.map((s, i) => { ctx.progress(i / a.smiles.length, `${i}/${a.smiles.length}`); const u = T.usrFromSmiles(RD, s); return { s: u ? T.usrSimilarity(q, u) : NaN }; });
};
const kernels = { scaffolds, svgs, mcs, rgroups, enumerate, similarity };
export type MolToolKernels = typeof kernels;
exposeKernels(kernels);
