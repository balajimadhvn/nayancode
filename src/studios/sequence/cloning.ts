/** Cloning simulator: restriction cloning (sticky/blunt compatibility), Golden Gate (Type IIS), Gibson (overlap assembly + primer design).
 *  Fragments are modelled as  leftOverhang + core + rightOverhang  (all in top-strand sense), which keeps junction logic exact. */
import { ENZYMES, oligoTm, revComp, toDNA, type Enzyme } from './kernels';

export type OvType = '5' | '3' | 'blunt';
export interface End { type: OvType; ov: string; native: boolean }
export interface Fragment { core: string; left: End; right: End; start: number; hasSite?: boolean }
const NATIVE: End = { type: 'blunt', ov: '', native: true };
const endFor = (type: OvType, ov: string): End => ({ type, ov, native: false });

function cutEnd(seq: string, p0: number, e: { cut: number; bot: number; site: string }): { lo: number; hi: number; end: End } {
  const lo = p0 + Math.min(e.cut, e.bot), hi = p0 + Math.max(e.cut, e.bot), type: OvType = e.cut < e.bot ? '5' : e.cut > e.bot ? '3' : 'blunt';
  return { lo, hi, end: endFor(type, seq.slice(lo, hi)) };
}
/** Digest with palindromic Type II enzymes. Circular templates give one fragment per cut (a single cut gives one linearised fragment). */
export function digestFragments(seqIn: string, names: string[], circular: boolean): Fragment[] {
  const seq = toDNA(seqIn.toUpperCase()), n = seq.length, cuts: ReturnType<typeof cutEnd>[] = [];
  for (const nm of names) { const e = ENZYMES.find((x) => x.name === nm); if (!e) throw new Error(`Unknown enzyme ${nm}`); const ext = circular ? seq + seq.slice(0, e.site.length - 1) : seq; for (let i = ext.indexOf(e.site); i >= 0 && i < n; i = ext.indexOf(e.site, i + 1)) cuts.push(cutEnd(circular ? seq + seq : seq, i, e)); }
  cuts.sort((a, b) => a.lo - b.lo);
  if (!cuts.length) return [{ core: seq, left: NATIVE, right: NATIVE, start: 0 }];
  const out: Fragment[] = [];
  if (!circular) { let prev = { hi: 0, end: NATIVE }; for (const c of cuts) { out.push({ core: seq.slice(prev.hi, c.lo), left: prev.end, right: c.end, start: prev.hi }); prev = { hi: c.hi, end: c.end }; } out.push({ core: seq.slice(prev.hi), left: prev.end, right: NATIVE, start: prev.hi }); return out.filter((f) => f.core.length > 0 || !f.left.native || !f.right.native); }
  const dbl = seq + seq;
  for (let i = 0; i < cuts.length; i++) { const a = cuts[i], b = i + 1 < cuts.length ? cuts[i + 1] : { ...cuts[0], lo: cuts[0].lo + n, hi: cuts[0].hi + n }; out.push({ core: dbl.slice(a.hi, b.lo), left: a.end, right: b.end, start: a.hi % n }); }
  return out;
}
export const flip = (f: Fragment): Fragment => ({ core: revComp(f.core), left: { ...f.right, ov: revComp(f.right.ov) }, right: { ...f.left, ov: revComp(f.left.ov) }, start: f.start, hasSite: f.hasSite });
export const compatible = (a: End, b: End) => a.type === b.type && a.ov === b.ov && (a.type === 'blunt' || (!a.native && !b.native));

export interface CloneProduct { sequence: string; length: number; orientation: 'forward' | 'reverse'; junctions: { label: string; context: string }[]; regeneratedSites: string[]; warnings: string[] }
export function cloneRestriction(vector: string, vectorCircular: boolean, vecEnzymes: string[], insert: string, insertCircular: boolean, insEnzymes: string[], pick: { backbone?: number; insert?: number } = {}): { products: CloneProduct[]; vectorFragments: Fragment[]; insertFragments: Fragment[]; backbone: number; insertIdx: number } {
  const vf = digestFragments(vector, vecEnzymes, vectorCircular), inf = digestFragments(insert, insEnzymes, insertCircular);
  if (vf.length < 1 || (vecEnzymes.length && vf.length === 1 && vf[0].left.native && vf[0].right.native)) throw new Error('The vector is not cut by the selected enzymes.');
  const bi = pick.backbone ?? vf.reduce((b, f, i) => (f.core.length > vf[b].core.length ? i : b), 0);
  const cutBoth = inf.map((f, i) => [f, i] as const).filter(([f]) => !f.left.native && !f.right.native);
  const ii = pick.insert ?? (cutBoth.length ? cutBoth.reduce((b, c) => (c[0].core.length > b[0].core.length ? c : b))[1] : inf.reduce((b, f, i) => (f.core.length > inf[b].core.length ? i : b), 0));
  const B = vf[bi], I0 = inf[ii]; if (!B || !I0) throw new Error('Could not select backbone / insert fragments.');
  const products: CloneProduct[] = [];
  for (const [I, orientation] of [[I0, 'forward'], [flip(I0), 'reverse']] as const) {
    if (!compatible(B.right, I.left) || !compatible(I.right, B.left)) continue;
    const seq = B.core + B.right.ov + I.core + I.right.ov, warnings: string[] = [], regenerated: string[] = [];
    const j1 = B.core.length, j2 = j1 + B.right.ov.length + I.core.length, ctx = (p: number) => { const dbl = seq + seq; return dbl.slice(p - 12 + seq.length, p + 12 + seq.length).replace(/^(.{12})(.{12})$/, '$1|$2'); };
    for (const e of ENZYMES) { for (const [label, p] of [['vector→insert', j1 + B.right.ov.length / 2], ['insert→vector', j2 + I.right.ov.length / 2]] as const) { const ext = seq + seq, w = ext.slice(Math.floor(p) - e.site.length + seq.length, Math.ceil(p) + e.site.length + seq.length); if (w.includes(e.site) && w.includes(e.site) && (vecEnzymes.includes(e.name) || insEnzymes.includes(e.name))) regenerated.push(`${e.name} at ${label}`); } }
    for (const nm of new Set([...vecEnzymes, ...insEnzymes])) { const e = ENZYMES.find((x) => x.name === nm)!, count = (seq + seq.slice(0, e.site.length - 1)).split(e.site).length - 1; if (count > 1) warnings.push(`${nm} cuts the product ${count} times: the insert may carry an internal site`); }
    if (I.core.length === 0) warnings.push('insert fragment is empty');
    products.push({ sequence: seq, length: seq.length, orientation, junctions: [{ label: 'vector → insert', context: ctx(j1 + B.right.ov.length / 2) }, { label: 'insert → vector', context: ctx(j2 + I.right.ov.length / 2) }], regeneratedSites: [...new Set(regenerated)], warnings });
  }
  if (!products.length) throw new Error(`The ends are not compatible: vector ${B.right.type}′ ${B.right.ov || 'blunt'} / ${B.left.type}′ ${B.left.ov || 'blunt'} vs insert ${I0.left.type}′ ${I0.left.ov || 'blunt'} / ${I0.right.type}′ ${I0.right.ov || 'blunt'}. Use the same enzymes (or compatible cohesive ends) on both.`);
  if (products.length === 2) for (const p of products) p.warnings.push('both orientations are possible with these ends (not directional): screen colonies, or use two different enzymes');
  return { products, vectorFragments: vf, insertFragments: inf, backbone: bi, insertIdx: ii };
}

// ---------------- Golden Gate (Type IIS) ----------------
export interface TypeIIS { name: string; site: string; top: number; bot: number }
/** Cut offsets are measured from the end of the recognition site. */
export const TYPE_IIS: TypeIIS[] = [{ name: 'BsaI', site: 'GGTCTC', top: 1, bot: 5 }, { name: 'BsmBI', site: 'CGTCTC', top: 1, bot: 5 }, { name: 'Esp3I', site: 'CGTCTC', top: 1, bot: 5 }, { name: 'BbsI', site: 'GAAGAC', top: 2, bot: 6 }, { name: 'SapI', site: 'GCTCTTC', top: 1, bot: 4 }];
export function digestTypeIIS(seqIn: string, e: TypeIIS, circular: boolean): Fragment[] {
  const seq = toDNA(seqIn.toUpperCase()), n = seq.length, L = e.site.length, rcSite = revComp(e.site), cuts: { lo: number; hi: number; end: End; siteAt: number }[] = [];
  const dbl = circular ? seq + seq : seq, lim = circular ? n : n;
  for (let i = dbl.indexOf(e.site); i >= 0 && i < lim; i = dbl.indexOf(e.site, i + 1)) { const t = i + L + e.top, b = i + L + e.bot; if (circular || b <= n) cuts.push({ lo: t, hi: b, end: endFor('5', dbl.slice(t, b)), siteAt: i }); }
  for (let i = dbl.indexOf(rcSite); i >= 0 && i < lim; i = dbl.indexOf(rcSite, i + 1)) { const t = i - e.bot, b = i - e.top; if (circular || t >= 0) { const tt = circular ? t + n : t, bb = circular ? b + n : b, dd = circular ? seq + seq + seq : seq; cuts.push({ lo: tt, hi: bb, end: endFor('5', dd.slice(tt, bb)), siteAt: i }); } }
  if (circular) for (const c of cuts) { while (c.lo >= n) { c.lo -= n; c.hi -= n; } }
  cuts.sort((a, b) => a.lo - b.lo);
  const sites = (frag: string) => frag.includes(e.site) || frag.includes(rcSite);
  if (!cuts.length) return [{ core: seq, left: NATIVE, right: NATIVE, start: 0, hasSite: false }];
  const out: Fragment[] = [], d3 = seq + seq;
  if (!circular) { let prev: { hi: number; end: End } = { hi: 0, end: NATIVE }; for (const c of cuts) { const core = seq.slice(prev.hi, c.lo); out.push({ core, left: prev.end, right: c.end, start: prev.hi, hasSite: sites(core) }); prev = c; } const last = seq.slice(prev.hi); out.push({ core: last, left: prev.end, right: NATIVE, start: prev.hi, hasSite: sites(last) }); return out; }
  for (let i = 0; i < cuts.length; i++) { const a = cuts[i], b = i + 1 < cuts.length ? cuts[i + 1] : { ...cuts[0], lo: cuts[0].lo + n, hi: cuts[0].hi + n }, core = d3.slice(a.hi, b.lo); out.push({ core, left: a.end, right: b.end, start: a.hi, hasSite: sites(core) }); }
  return out;
}
export interface Assembly { sequence: string; length: number; order: { part: number; name: string; flipped: boolean; leftOv: string; rightOv: string; length: number }[]; warnings: string[] }
/** Golden Gate: digest every part with one Type IIS enzyme, keep the site-free fragments with two cut ends, and order them by overhang matching. */
export function goldenGate(parts: { name: string; seq: string; circular: boolean }[], enzymeName: string): Assembly {
  const e = TYPE_IIS.find((x) => x.name === enzymeName); if (!e) throw new Error(`Unknown enzyme ${enzymeName}`);
  const cands = parts.map((p, pi) => ({ pi, name: p.name, frags: digestTypeIIS(p.seq, e, p.circular).filter((f) => !f.hasSite && !f.left.native && !f.right.native && f.left.ov.length === e.bot - e.top && f.right.ov.length === e.bot - e.top) }));
  for (const c of cands) { if (!c.frags.length) throw new Error(`Part “${c.name}” yields no usable ${enzymeName} fragment (needs two ${enzymeName} sites flanking a site-free insert).`); if (c.frags.length > 1) throw new Error(`Part “${c.name}” yields ${c.frags.length} candidate fragments; remove extra ${enzymeName} sites.`); }
  const nodes = cands.map((c) => c.frags[0]), N = nodes.length, warnings: string[] = [];
  const seen = new Map<string, number>(); for (const f of nodes) { seen.set(f.left.ov, (seen.get(f.left.ov) ?? 0) + 1); }
  for (const [ov, k] of seen) if (k > 1) throw new Error(`Overhang ${ov} appears on ${k} parts' left ends: the assembly would be ambiguous. Redesign the overhangs.`);
  const ordered: { i: number; flipped: boolean }[] = [];
  const dfs = (cur: { i: number; flipped: boolean }, used: Set<number>): boolean => {
    ordered.push(cur); used.add(cur.i); const f = cur.flipped ? flip(nodes[cur.i]) : nodes[cur.i];
    if (used.size === N) { const first = ordered[0], ff = first.flipped ? flip(nodes[first.i]) : nodes[first.i]; if (f.right.ov === ff.left.ov) return true; }
    else for (let j = 0; j < N; j++) { if (used.has(j)) continue; for (const fl of [false, true]) { const g = fl ? flip(nodes[j]) : nodes[j]; if (f.right.ov === g.left.ov && dfs({ i: j, flipped: fl }, used)) return true; } }
    ordered.pop(); used.delete(cur.i); return false;
  };
  let ok = false; for (const fl of [false]) if (dfs({ i: 0, flipped: fl }, new Set())) { ok = true; break; }
  if (!ok) throw new Error('The overhangs do not form a single circular assembly. Check that each part\'s right overhang matches the next part\'s left overhang and the last part closes onto the first.');
  let seq = ''; const order = ordered.map(({ i, flipped }) => { const f = flipped ? flip(nodes[i]) : nodes[i]; seq += f.core + f.right.ov; return { part: i, name: cands[i].name, flipped, leftOv: f.left.ov, rightOv: f.right.ov, length: f.core.length + f.right.ov.length }; });
  if (seq.includes(e.site) || seq.includes(revComp(e.site))) warnings.push(`the product still contains a ${enzymeName} site (it will be re-cut during the reaction)`);
  return { sequence: seq, length: seq.length, order, warnings };
}

// ---------------- Gibson / HiFi ----------------
export interface GibsonResult { sequence: string; circular: boolean; junctions: { from: string; to: string; overlap: number; tm: number; gc: number; seq: string; warnings: string[] }[]; order: { name: string; flipped: boolean }[] }
function overlapLen(a: string, b: string, min: number, max = 200): number { for (let k = Math.min(max, a.length, b.length); k >= min; k--) if (a.slice(-k) === b.slice(0, k)) return k; return 0; }
/** Assemble fragments by terminal overlaps (either orientation); finds the order automatically. Fragment 0 fixes the orientation. */
export function gibsonAssemble(frags: { name: string; seq: string }[], circular = true, minOverlap = 15): GibsonResult {
  const F = frags.map((f) => ({ name: f.name, seq: toDNA(f.seq.toUpperCase().replace(/\s/g, '')) })); const N = F.length; if (N < 2) throw new Error('Need at least two fragments.');
  const get = (i: number, fl: boolean) => (fl ? revComp(F[i].seq) : F[i].seq), path: { i: number; fl: boolean; ov: number }[] = [];
  const dfs = (cur: { i: number; fl: boolean }, used: Set<number>): boolean => {
    used.add(cur.i); const s = get(cur.i, cur.fl);
    if (used.size === N) { if (!circular) { path.push({ ...cur, ov: 0 }); return true; } const first = path[0], ov = overlapLen(s, get(first.i, first.fl), minOverlap); if (ov) { path.push({ ...cur, ov }); return true; } }
    else for (let j = 0; j < N; j++) { if (used.has(j)) continue; for (const fl of [false, true]) { const ov = overlapLen(s, get(j, fl), minOverlap); if (ov) { path.push({ ...cur, ov }); if (dfs({ i: j, fl }, used)) return true; path.pop(); } } }
    used.delete(cur.i); return false;
  };
  if (!dfs({ i: 0, fl: false }, new Set())) throw new Error(`No assembly found: fragments must share ≥ ${minOverlap}-bp end overlaps${circular ? ' in a closed circle' : ''}. Check overlaps or use the primer designer.`);
  // path[k].ov is the overlap with the next element; the last entry's ov closes the circle.
  let seq = ''; const junctions: GibsonResult['junctions'] = [], order = path.map((p) => ({ name: F[p.i].name, flipped: p.fl }));
  path.forEach((p, k) => { const s = get(p.i, p.fl), nextOv = k < path.length - 1 ? p.ov : circular ? p.ov : 0, take = k === 0 ? s : s.slice(path[k - 1].ov); seq += k === path.length - 1 && circular ? take.slice(0, take.length - p.ov) : take; if (nextOv) { const ovSeq = s.slice(-nextOv), o = oligoTm(ovSeq), w: string[] = []; if (o.tm < 48) w.push('low overlap Tm'); if (o.gc < 0.3 || o.gc > 0.7) w.push('extreme GC'); junctions.push({ from: F[p.i].name, to: F[path[(k + 1) % path.length].i].name, overlap: nextOv, tm: o.tm, gc: o.gc, seq: ovSeq, warnings: w }); } });
  return { sequence: seq, circular, junctions, order };
}
export interface GibsonPrimers { fwd: { seq: string; tail: string; anneal: string; tm: number }; rev: { seq: string; tail: string; anneal: string; tm: number }; product: string; length: number }
/** Primers that amplify `insert` with `overlap`-nt tails homologous to the vector either side of the insertion point (vector[pos-overlap, pos) and [pos, pos+overlap)). */
export function designGibsonPrimers(vector: string, pos: number, insert: string, overlap = 25, targetTm = 60): GibsonPrimers {
  const V = toDNA(vector.toUpperCase()), I = toDNA(insert.toUpperCase()); if (pos < overlap || pos > V.length - overlap) throw new Error(`Insertion point must be ≥ ${overlap} bp from each vector end (or use a circular vector rotated so it is).`);
  const pick = (s: string) => { let len = 18; while (len < 35 && len < s.length && oligoTm(s.slice(0, len)).tm < targetTm) len++; return s.slice(0, len); };
  const aF = pick(I), aR = pick(revComp(I)), tF = V.slice(pos - overlap, pos), tR = revComp(V.slice(pos, pos + overlap));
  return { fwd: { seq: tF + aF, tail: tF, anneal: aF, tm: oligoTm(aF).tm }, rev: { seq: tR + aR, tail: tR, anneal: aR, tm: oligoTm(aR).tm }, product: V.slice(0, pos) + I + V.slice(pos), length: V.length + I.length };
}
export type { Enzyme };
