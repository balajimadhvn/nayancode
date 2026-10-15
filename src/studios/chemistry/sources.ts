/** Open compound & bioactivity sources: PubChem (public domain) and ChEMBL (CC BY-SA 3.0).
 *  Replaces DrugBank (commercial licence). ChEMBL results are shown with attribution; redistributing a derived dataset
 *  must keep CC BY-SA 3.0 — see /licenses. */
import { trackedFetch } from '@/core/net';

export interface PubchemHit { cid: number; smiles: string; formula: string; mw: number; iupac: string }
export function parsePubchem(j: { PropertyTable?: { Properties?: { CID: number; SMILES?: string; ConnectivitySMILES?: string; IsomericSMILES?: string; CanonicalSMILES?: string; MolecularFormula: string; MolecularWeight: string | number; IUPACName?: string }[] } }): PubchemHit | null {
  const p = j.PropertyTable?.Properties?.[0]; if (!p) return null;
  return { cid: p.CID, smiles: p.SMILES ?? p.IsomericSMILES ?? p.ConnectivitySMILES ?? p.CanonicalSMILES ?? '', formula: p.MolecularFormula, mw: Number(p.MolecularWeight), iupac: p.IUPACName ?? '' };
}
export async function pubchemByName(name: string): Promise<PubchemHit> {
  const r = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name.trim())}/property/SMILES,MolecularFormula,MolecularWeight,IUPACName/JSON`);
  if (r.status === 404) throw new Error(`PubChem has no compound named “${name}”.`); if (!r.ok) throw new Error(`PubChem responded ${r.status}`);
  const hit = parsePubchem(await r.json()); if (!hit?.smiles) throw new Error('PubChem returned no structure.'); return hit;
}

export interface ChemblTarget { id: string; name: string; organism: string; type: string }
export function parseTargets(j: { targets?: { target_chembl_id: string; pref_name: string; organism: string; target_type: string }[] }): ChemblTarget[] {
  return (j.targets ?? []).map((t) => ({ id: t.target_chembl_id, name: t.pref_name, organism: t.organism, type: t.target_type })).filter((t) => t.type === 'SINGLE PROTEIN').sort((a, b) => Number(b.organism === 'Homo sapiens') - Number(a.organism === 'Homo sapiens'));
}
export async function chemblTargets(q: string): Promise<ChemblTarget[]> { const r = await trackedFetch(`https://www.ebi.ac.uk/chembl/api/data/target/search.json?q=${encodeURIComponent(q)}&limit=25`); return parseTargets(await r.json()); }

export interface Activity { molecule_chembl_id: string; canonical_smiles: string | null; pchembl_value: string | null; standard_type: string }
/** Median pChEMBL per molecule (pChEMBL is ChEMBL's standardised −log10 molar potency), invalid structures dropped. */
export function aggregateActivities(rows: Activity[], types: string[] = []): { id: string; smiles: string; y: number; n: number }[] {
  const m = new Map<string, { smiles: string; v: number[] }>();
  for (const a of rows) { if (!a.canonical_smiles || a.pchembl_value == null) continue; if (types.length && !types.includes(a.standard_type)) continue; const v = Number(a.pchembl_value); if (!Number.isFinite(v)) continue; const e = m.get(a.molecule_chembl_id) ?? m.set(a.molecule_chembl_id, { smiles: a.canonical_smiles, v: [] }).get(a.molecule_chembl_id)!; e.v.push(v); }
  return [...m.entries()].map(([id, e]) => { const s = e.v.sort((a, b) => a - b), mid = s.length >> 1; return { id, smiles: e.smiles, y: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, n: s.length }; });
}
export async function chemblActivities(target: string, max = 2000, onProgress?: (f: number) => void): Promise<{ rows: Activity[]; total: number; release: string }> {
  const rows: Activity[] = []; let total = 0; const page = 500;
  for (let off = 0; off < max; off += page) {
    const r = await trackedFetch(`https://www.ebi.ac.uk/chembl/api/data/activity.json?target_chembl_id=${encodeURIComponent(target)}&pchembl_value__isnull=false&standard_relation=%3D&limit=${page}&offset=${off}&only=molecule_chembl_id,canonical_smiles,pchembl_value,standard_type`);
    const j = await r.json(); total = j.page_meta?.total_count ?? total; rows.push(...(j.activities ?? [])); onProgress?.(Math.min(1, rows.length / Math.min(max, total || max))); if (!j.page_meta?.next) break;
  }
  return { rows, total, release: 'ChEMBL (live API)' };
}
