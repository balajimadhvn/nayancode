/** Clean-room 3D conformer generation by distance geometry (Crippen & Havel 1988; Blaney & Dixon 1994), because the bundled
 *  RDKit WebAssembly build has no ETKDG embedder. Bounds come from bond lengths, bond angles, planarity and ring geometry;
 *  the metric matrix is embedded in 3-D and refined by minimising bound violations, chirality and planarity penalties.
 *  Stereochemistry (tetrahedral centres, E/Z double bonds) is read from the 2-D coordinates and wedge bonds of the input graph.
 *  Torsions about acyclic single bonds are free: Vina samples them. Quality is reported, not assumed. */
import { ffEnergy, ffMinimise, type FFTerms, type FFTorsion } from './ff';
import { hybridisation, neighbours, type Hyb, type MolG } from './molgraph';

const RAD: Record<string, [number, number, number]> = { // covalent radii by hybridisation [sp3, sp2, sp]
  H: [0.31, 0.31, 0.31], C: [0.76, 0.73, 0.69], N: [0.71, 0.68, 0.6], O: [0.66, 0.63, 0.55], F: [0.57, 0.57, 0.57], P: [1.07, 1.0, 0.94], S: [1.05, 0.94, 0.9],
  Cl: [1.02, 1.02, 1.02], Br: [1.2, 1.2, 1.2], I: [1.39, 1.39, 1.39], B: [0.84, 0.8, 0.8], Si: [1.11, 1.11, 1.11],
};
const VDW: Record<string, number> = { H: 1.1, C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8, Cl: 1.75, Br: 1.85, I: 1.98, B: 1.92, Si: 2.1 };
const XH: Record<string, number> = { C: 1.09, N: 1.01, O: 0.97, S: 1.34, P: 1.42, B: 1.19, Si: 1.48 };
const hi = (h: Hyb) => (h === 'sp3' ? 0 : h === 'sp2' ? 1 : 2);

export interface EmbedResult { coords: number[][]; violation: number; attempts: number; chiralOk: boolean; bondRms: number }

function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

type V = [number, number, number];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Distance between atoms 1 and 4 of a chain a–b–c–d with the given bond lengths, angles (rad) at b and c, and torsion (rad). */
function d14(r1: number, r2: number, r3: number, th2: number, th3: number, phi: number): number {
  const a: V = [r1 * Math.cos(th2), r1 * Math.sin(th2), 0];
  const d: V = [r2 - r3 * Math.cos(th3), r3 * Math.sin(th3) * Math.cos(phi), r3 * Math.sin(th3) * Math.sin(phi)];
  return Math.hypot(a[0] - d[0], a[1] - d[1], a[2] - d[2]);
}

export function bondLength(m: MolG, hyb: Hyb[], k: number): number {
  const b = m.bonds[k], A = m.atoms[b.a], B = m.atoms[b.b];
  if (A.el === 'H' || B.el === 'H') { const heavy = A.el === 'H' ? B.el : A.el; return XH[heavy] ?? 1.1; }
  const ra = (RAD[A.el] ?? [1, 1, 1])[hi(hyb[b.a])], rb = (RAD[B.el] ?? [1, 1, 1])[hi(hyb[b.b])];
  const sp = (e: string) => e === 'S' || e === 'P';
  let delta = b.aromatic ? 0.07 : b.order === 2 ? 0.12 : b.order === 3 ? 0.18 : 0;
  if ((sp(A.el) && B.el === 'O' && b.order === 2) || (sp(B.el) && A.el === 'O' && b.order === 2)) delta = 0.25; // S=O, P=O
  else if ((sp(A.el) && hyb[b.a] === 'sp3' && ['N', 'O', 'C'].includes(B.el) && b.order === 1) || (sp(B.el) && hyb[b.b] === 'sp3' && ['N', 'O', 'C'].includes(A.el) && b.order === 1)) delta = 0.06;
  return ra + rb - delta;
}

/** Signed volumes (chirality) from 2-D coordinates and wedge bonds. Centres with 3 or 4 neighbours; returns [centre, n1, n2, n3, sign]. */
export function chiralCentres(m: MolG, nb = neighbours(m)): [number, number, number, number, number][] {
  const out: [number, number, number, number, number][] = [];
  const wedgeOf = new Map<string, number>();
  for (const b of m.bonds) if (b.wedge === 1 || b.wedge === 6) wedgeOf.set(`${b.a}>${b.b}`, b.wedge === 1 ? 1 : -1);
  const centres = new Set<number>(); for (const k of wedgeOf.keys()) centres.add(+k.split('>')[0]);
  for (const c of centres) {
    const ns = nb[c]; if (ns.length < 3) continue;
    const z = (j: number) => wedgeOf.get(`${c}>${j}`) ?? 0;
    const p = (j: number): V => [m.atoms[j].x - m.atoms[c].x, m.atoms[j].y - m.atoms[c].y, z(j)];
    // the triple of neighbours with the largest signed volume (must include the wedged neighbour)
    let best: [number, number, number] = [ns[0], ns[1], ns[2]], bv = 0;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) for (let k = j + 1; k < ns.length; k++) { const v = dot(p(ns[i]), cross(p(ns[j]), p(ns[k]))); if (Math.abs(v) > Math.abs(bv)) { bv = v; best = [ns[i], ns[j], ns[k]]; } }
    if (Math.abs(bv) < 1e-6) continue;
    out.push([c, best[0], best[1], best[2], bv > 0 ? 1 : -1]);
  }
  return out;
}

interface Torsion { a: number; b: number; c: number; d: number; lo: number; hi: number } // degrees, |φ| range

/** Distance-geometry embedding. Strict ring-geometry bounds first; if the polycyclic system cannot satisfy them, the ring torsion ranges are relaxed. */
export function embed3d(m: MolG, opts: { seed?: number; maxAttempts?: number } = {}): EmbedResult {
  const r1 = embedCore(m, opts, false);
  if (r1.violation < 0.05 && r1.chiralOk) return r1;
  const r2 = embedCore(m, { ...opts, seed: (opts.seed ?? 42) + 7 }, true);
  return (r2.chiralOk && !r1.chiralOk) || (r2.chiralOk === r1.chiralOk && r2.violation < r1.violation) ? { ...r2, attempts: r1.attempts + r2.attempts } : { ...r1, attempts: r1.attempts + r2.attempts };
}

function embedCore(m: MolG, opts: { seed?: number; maxAttempts?: number }, relax: boolean): EmbedResult {
  const n = m.atoms.length, nb = neighbours(m), hyb = hybridisation(m, nb).map((h, i) => ((m.atoms[i].el === 'S' || m.atoms[i].el === 'P') && nb[i].length >= 4 ? 'sp3' : h) as Hyb);
  const rnd = mulberry32(opts.seed ?? 42);
  const bl = m.bonds.map((_, k) => bondLength(m, hyb, k));
  const bondLen = new Map<string, number>(); m.bonds.forEach((b, k) => { bondLen.set(`${b.a},${b.b}`, bl[k]); bondLen.set(`${b.b},${b.a}`, bl[k]); });
  const bondOf = new Map<string, number>(); m.bonds.forEach((b, k) => { bondOf.set(`${b.a},${b.b}`, k); bondOf.set(`${b.b},${b.a}`, k); });
  const ringSize = new Map<string, number>(); // smallest ring containing the bond
  for (const r of m.rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], k = `${Math.min(a, b)},${Math.max(a, b)}`; ringSize.set(k, Math.min(ringSize.get(k) ?? 99, r.length)); }
  const rs = (a: number, b: number) => ringSize.get(`${Math.min(a, b)},${Math.max(a, b)}`) ?? 0;

  const lb = new Float64Array(n * n), ub = new Float64Array(n * n);
  const set = (i: number, j: number, lo: number, up: number) => { lb[i * n + j] = lb[j * n + i] = lo; ub[i * n + j] = ub[j * n + i] = up; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) { const lo = 0.8 * ((VDW[m.atoms[i].el] ?? 1.8) + (VDW[m.atoms[j].el] ?? 1.8)); lb[i * n + j] = Math.min(lo, 3.6); ub[i * n + j] = 1000; }
  const known = new Uint8Array(n * n);
  m.bonds.forEach((b, k) => { set(b.a, b.b, bl[k] - 0.01, bl[k] + 0.01); known[b.a * n + b.b] = known[b.b * n + b.a] = 1; });
  // 1-3
  const angle = new Map<string, number>(); // key a,b,c (b centre) → radians
  const ffAngles: FFTerms['angles'] = [];
  for (let b = 0; b < n; b++) {
    const ns = nb[b];
    for (let x = 0; x < ns.length; x++) for (let y = x + 1; y < ns.length; y++) {
      const a = ns[x], c = ns[y], r1 = bondLen.get(`${a},${b}`)!, r2 = bondLen.get(`${b},${c}`)!;
      let th = hyb[b] === 'sp' ? 180 : hyb[b] === 'sp2' ? 120 : 109.5;
      const size = Math.min(rs(a, b) || 99, rs(b, c) || 99);
      const inRing = rs(a, b) > 0 && rs(b, c) > 0 && ringSharesBothBonds(m.rings, a, b, c);
      if (inRing) { const sz = ringSharesBothBonds(m.rings, a, b, c)!; th = hyb[b] === 'sp3' && sz === 5 ? 104 : hyb[b] === 'sp3' && sz === 6 ? 111 : ((sz - 2) * 180) / sz; if (sz === 3) th = 60; if (sz === 4) th = 90; } else if (size < 99 && (rs(a, b) === 3 || rs(b, c) === 3)) th = 118; // exocyclic at a cyclopropane carbon
      if (hyb[b] === 'sp3' && ns.length === 4 && m.atoms[a].el === 'H' && m.atoms[c].el === 'H') th = 107;
      const t = (th * Math.PI) / 180, d = Math.sqrt(r1 * r1 + r2 * r2 - 2 * r1 * r2 * Math.cos(t)), tol = hyb[b] === 'sp3' && !inRing ? 0.06 * d : 0.035 * d;
      angle.set(`${a},${b},${c}`, t); angle.set(`${c},${b},${a}`, t); ffAngles.push({ a, b, c, t0: t, k: 100 });
      if (!known[a * n + c]) { set(a, c, Math.max(0.5, d - tol), d + tol); known[a * n + c] = known[c * n + a] = 2; }
    }
  }
  // 1-4 torsion ranges
  const cipherTrans = (a: number, b: number, c: number, d: number): boolean => {
    const bc: V = [m.atoms[c].x - m.atoms[b].x, m.atoms[c].y - m.atoms[b].y, 0];
    const s1 = bc[0] * (m.atoms[a].y - m.atoms[b].y) - bc[1] * (m.atoms[a].x - m.atoms[b].x), s2 = bc[0] * (m.atoms[d].y - m.atoms[c].y) - bc[1] * (m.atoms[d].x - m.atoms[c].x);
    return s1 * s2 < 0;
  };
  const dbl = (x: number, y: number) => { const k = bondOf.get(`${x},${y}`); return k != null && (m.bonds[k].order === 2); };
  const carbonylLike = (c: number) => nb[c].find((j) => (m.atoms[j].el === 'O' || m.atoms[j].el === 'S') && dbl(c, j));
  const tors: Torsion[] = [];
  const ffTors: FFTorsion[] = [];
  for (const bk of m.bonds) {
    const b = bk.a, c = bk.b;
    for (const a of nb[b]) { if (a === c) continue; for (const d of nb[c]) { if (d === b || d === a) continue;
      const th2 = angle.get(`${a},${b},${c}`) ?? 2.1, th3 = angle.get(`${b},${c},${d}`) ?? 2.1;
      const r1 = bondLen.get(`${a},${b}`)!, r2 = bondLen.get(`${b},${c}`)!, r3 = bondLen.get(`${c},${d}`)!;
      const rsz = ringSharesTorsion(m.rings, a, b, c, d);
      let lo = 0, up = 180;
      const doubleOrAromatic = bk.order === 2 || bk.aromatic;
      if (rsz) {
        const planar = hyb[b] !== 'sp3' && hyb[c] !== 'sp3';
        if (planar) { lo = 0; up = relax && rsz > 4 ? 25 : 0; } else if (rsz <= 4) { lo = 0; up = relax ? 30 : 0; } else if (rsz === 5) { lo = 0; up = relax ? 55 : 40; } else if (rsz === 6) { lo = relax ? 0 : 52; up = relax ? 70 : 62; } else { lo = 0; up = 90; }
        if (rsz === 6 && (hyb[b] === 'sp3') !== (hyb[c] === 'sp3')) { lo = 0; up = 35; } // half-chair next to a double bond
      } else if (doubleOrAromatic) {
        if (hyb[b] === 'sp' || hyb[c] === 'sp') { lo = 0; up = 180; } else { const t = cipherTrans(a, b, c, d); lo = up = t ? 180 : 0; }
      } else if (bk.order === 1 && hyb[b] === 'sp2' && hyb[c] === 'sp2') {
        // conjugated single bond: amide / ester preferences, otherwise planar either way
        const cb = carbonylLike(b), cc = carbonylLike(c);
        const [cx, x, sa, sd] = cb != null && (m.atoms[c].el === 'N' || m.atoms[c].el === 'O') ? [b, c, a, d] : cc != null && (m.atoms[b].el === 'N' || m.atoms[b].el === 'O') ? [c, b, d, a] : [-1, -1, -1, -1];
        if (cx >= 0) {
          const carbO = carbonylLike(cx)!;
          const xHeavy = nb[x].filter((j) => j !== cx && m.atoms[j].el !== 'H');
          const secondary = m.atoms[x].el === 'O' || nb[x].some((j) => m.atoms[j].el === 'H');
          if (secondary && xHeavy.length <= 1) {
            const sdIsH = m.atoms[sd].el === 'H';
            const saIsO = sa === carbO;
            // trans (Z) amide/ester: O cis to the X substituent's heavy atom for esters/amides → torsion(O=C–X–R)=0, (R1–C–X–R)=180
            lo = up = (saIsO ? !sdIsH : sdIsH) ? 0 : 180;
            if (m.atoms[x].el === 'O') lo = up = saIsO ? 0 : 180; // ester: s-cis about C(=O)–O, R trans to R1
          } else { lo = 0; up = 180; }
        } else { lo = 0; up = 180; }
      }
      const lowD = Math.min(d14(r1, r2, r3, th2, th3, (lo * Math.PI) / 180), d14(r1, r2, r3, th2, th3, (up * Math.PI) / 180));
      const hiD = Math.max(d14(r1, r2, r3, th2, th3, (lo * Math.PI) / 180), d14(r1, r2, r3, th2, th3, (up * Math.PI) / 180));
      if (lo === 0 && up === 180) { /* free: [cis, trans] */ }
      else if (rsz === 6 && lo === 52) { /* chair */ }
      const fixed = lo === up;
      const tol = fixed ? 0.05 : 0.02;
      tors.push({ a, b, c, d, lo, hi: up });
      if (lo === up && (doubleOrAromatic || (rsz > 0 && hyb[b] !== 'sp3' && hyb[c] !== 'sp3') || (bk.order === 1 && hyb[b] === 'sp2' && hyb[c] === 'sp2'))) ffTors.push({ a, b, c, d, k: doubleOrAromatic || rsz ? 12 : 6, n: 1, delta: (lo * Math.PI) / 180 + Math.PI });
      else if (hyb[b] === 'sp3' && hyb[c] === 'sp3') ffTors.push({ a, b, c, d, k: 0.4, n: 3, delta: 0 });
      else if (!rsz && bk.order === 1 && hyb[b] === 'sp2' && hyb[c] === 'sp2') ffTors.push({ a, b, c, d, k: 2, n: 2, delta: Math.PI });
      if (known[a * n + d]) { // ring closure shorter path wins: keep existing tighter bounds
        const i = a * n + d; if (known[i] === 3) { lb[i] = lb[d * n + a] = Math.max(lb[i], lowD - tol); ub[i] = ub[d * n + a] = Math.min(ub[i], hiD + tol); }
        continue;
      }
      set(a, d, Math.max(0.8, lowD - tol), hiD + tol); known[a * n + d] = known[d * n + a] = 3;
    } }
  }
  void tors; void ffEnergy;

  // triangle smoothing
  const sl = Float64Array.from(lb), su = Float64Array.from(ub);
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) { const uik = su[i * n + k]; for (let j = i + 1; j < n; j++) { const ukj = su[k * n + j]; if (uik + ukj < su[i * n + j]) su[i * n + j] = su[j * n + i] = uik + ukj; } }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const l = Math.max(sl[i * n + k] - su[k * n + j], sl[k * n + j] - su[i * n + k]); if (l > sl[i * n + j]) sl[i * n + j] = sl[j * n + i] = l; }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (sl[i * n + j] > su[i * n + j]) { const mid = (sl[i * n + j] + su[i * n + j]) / 2; sl[i * n + j] = sl[j * n + i] = su[i * n + j] = su[j * n + i] = mid; }

  const chir = chiralCentres(m, nb);
  const planarCentres = m.atoms.map((_, i) => i).filter((i) => hyb[i] === 'sp2' && nb[i].length === 3);
  const maxAttempts = opts.maxAttempts ?? (relax ? 12 : 10), wanted = 6;
  const T: FFTerms = {
    bonds: m.bonds.map((b, k) => ({ a: b.a, b: b.b, r0: bl[k] })), angles: ffAngles, torsions: ffTors,
    chiral: chir.map(([c, a, b, d, sign]) => ({ c, a, b, d, sign })), planar: planarCentres.map((c) => [c, nb[c][0], nb[c][1], nb[c][2]] as [number, number, number, number]),
    repel: [],
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!known[i * n + j]) T.repel.push([i, j, 0.9 * lb[i * n + j]]);
  let best: { x: Float64Array; viol: number; chiralOk: boolean; e: number } | null = null, attempts = 0, good = 0;
  for (; attempts < maxAttempts && good < wanted; attempts++) {
    const x = embedOnce(n, sl, su, rnd);
    minimise(x, n, sl, su, chir, planarCentres, nb);
    const flip = chiralFlipState(x, chir);
    if (flip === 'all') for (let i = 0; i < n; i++) x[3 * i] = -x[3 * i];
    const viol = violation(x, n, sl, su, chir, planarCentres, nb), ok = flip !== 'mixed';
    if (ok && viol < 0.05) { const e = ffMinimise(x, T, 800); good++; if (!best || !best.chiralOk || (best.e > e)) best = { x, viol, chiralOk: true, e }; }
    else if (!best || (ok && !best.chiralOk) || (ok === best.chiralOk && best.e === Infinity && viol < best.viol)) { if (!best || best.e === Infinity) best = { x, viol, chiralOk: ok, e: Infinity }; }
  }
  const x = best!.x;
  const coords = Array.from({ length: n }, (_, i) => [x[3 * i], x[3 * i + 1], x[3 * i + 2]]);
  let s = 0; m.bonds.forEach((b, k) => { const dx = x[3 * b.a] - x[3 * b.b], dy = x[3 * b.a + 1] - x[3 * b.b + 1], dz = x[3 * b.a + 2] - x[3 * b.b + 2]; s += (Math.hypot(dx, dy, dz) - bl[k]) ** 2; });
  return { coords, violation: best!.viol, attempts, chiralOk: best!.chiralOk, bondRms: Math.sqrt(s / Math.max(1, m.bonds.length)) };
}

function ringSharesBothBonds(rings: number[][], a: number, b: number, c: number): number | 0 {
  let best = 0;
  for (const r of rings) { const L = r.length, ib = r.indexOf(b); if (ib < 0) continue; const p = r[(ib + 1) % L], q = r[(ib - 1 + L) % L]; if ((p === a && q === c) || (p === c && q === a)) best = best ? Math.min(best, L) : L; }
  return best;
}
function ringSharesTorsion(rings: number[][], a: number, b: number, c: number, d: number): number {
  let best = 0;
  for (const r of rings) { const L = r.length, ib = r.indexOf(b); if (ib < 0 || r[(ib + 1) % L] !== c && r[(ib - 1 + L) % L] !== c) continue; const dir = r[(ib + 1) % L] === c ? 1 : -1; if (r[(ib - dir + L) % L] === a && r[(ib + 2 * dir + L * 2) % L] === d) best = best ? Math.min(best, L) : L; }
  return best;
}

function embedOnce(n: number, lb: Float64Array, ub: Float64Array, rnd: () => number): Float64Array {
  const D2 = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = lb[i * n + j] + rnd() * (ub[i * n + j] - lb[i * n + j]); D2[i * n + j] = D2[j * n + i] = d * d; }
  const rowMean = new Float64Array(n); let total = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += D2[i * n + j]; rowMean[i] = s / n; total += s; }
  total /= n * n;
  const G = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) G[i * n + j] = 0.5 * (rowMean[i] + rowMean[j] - D2[i * n + j] - total);
  const x = new Float64Array(3 * n);
  for (let k = 0; k < 3; k++) {
    let v = Float64Array.from({ length: n }, () => rnd() - 0.5), lam = 0;
    for (let it = 0; it < 200; it++) {
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += G[i * n + j] * v[j]; w[i] = s; }
      let norm = 0; for (let i = 0; i < n; i++) norm += w[i] * w[i]; norm = Math.sqrt(norm) || 1;
      let diff = 0; for (let i = 0; i < n; i++) { const nv = w[i] / norm; diff += Math.abs(nv - v[i]); v[i] = nv; }
      lam = norm; if (diff < 1e-9) break;
    }
    // Rayleigh quotient with sign
    let rq = 0; for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += G[i * n + j] * v[j]; rq += v[i] * s; }
    lam = rq; const sc = Math.sqrt(Math.max(lam, 0.01));
    for (let i = 0; i < n; i++) x[3 * i + k] = v[i] * sc;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) G[i * n + j] -= lam * v[i] * v[j];
  }
  return x;
}

type Chir = [number, number, number, number, number][];
const vol3 = (x: Float64Array, c: number, a: number, b: number, d: number) => {
  const ax = x[3 * a] - x[3 * c], ay = x[3 * a + 1] - x[3 * c + 1], az = x[3 * a + 2] - x[3 * c + 2];
  const bx = x[3 * b] - x[3 * c], by = x[3 * b + 1] - x[3 * c + 1], bz = x[3 * b + 2] - x[3 * c + 2];
  const dx = x[3 * d] - x[3 * c], dy = x[3 * d + 1] - x[3 * c + 1], dz = x[3 * d + 2] - x[3 * c + 2];
  return ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx);
};
function chiralFlipState(x: Float64Array, chir: Chir): 'ok' | 'all' | 'mixed' {
  if (!chir.length) return 'ok';
  let bad = 0; for (const [c, a, b, d, s] of chir) if (vol3(x, c, a, b, d) * s < 0) bad++;
  return bad === 0 ? 'ok' : bad === chir.length ? 'all' : 'mixed';
}

/** Energy and gradient: squared bound violations + chirality + planarity. */
function energyGrad(x: Float64Array, n: number, lb: Float64Array, ub: Float64Array, chir: Chir, planar: number[], nb: number[][], g: Float64Array | null): number {
  let e = 0; if (g) g.fill(0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = x[3 * i] - x[3 * j], dy = x[3 * i + 1] - x[3 * j + 1], dz = x[3 * i + 2] - x[3 * j + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-12, up = ub[i * n + j], lo = lb[i * n + j];
    let v = 0; if (d > up) v = d - up; else if (d < lo) v = d - lo; else continue;
    e += v * v;
    if (g) { const f = (2 * v) / d; g[3 * i] += f * dx; g[3 * i + 1] += f * dy; g[3 * i + 2] += f * dz; g[3 * j] -= f * dx; g[3 * j + 1] -= f * dy; g[3 * j + 2] -= f * dz; }
  }
  const volTerm = (c: number, a: number, b: number, d: number, target: number, sgn: number, w: number) => {
    const v = vol3(x, c, a, b, d), r = sgn === 0 ? v : Math.min(0, sgn * v - target);
    if (r === 0) return; e += w * r * r;
    if (g) {
      const ax = x[3 * a] - x[3 * c], ay = x[3 * a + 1] - x[3 * c + 1], az = x[3 * a + 2] - x[3 * c + 2];
      const bx = x[3 * b] - x[3 * c], by = x[3 * b + 1] - x[3 * c + 1], bz = x[3 * b + 2] - x[3 * c + 2];
      const dx = x[3 * d] - x[3 * c], dy = x[3 * d + 1] - x[3 * c + 1], dz = x[3 * d + 2] - x[3 * c + 2];
      const k = 2 * w * r * (sgn === 0 ? 1 : sgn);
      const ga = [by * dz - bz * dy, bz * dx - bx * dz, bx * dy - by * dx], gb = [dy * az - dz * ay, dz * ax - dx * az, dx * ay - dy * ax], gd = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
      for (let t = 0; t < 3; t++) { g[3 * a + t] += k * ga[t]; g[3 * b + t] += k * gb[t]; g[3 * d + t] += k * gd[t]; g[3 * c + t] -= k * (ga[t] + gb[t] + gd[t]); }
    }
  };
  for (const [c, a, b, d, s] of chir) volTerm(c, a, b, d, 1.2, s, 1);
  for (const c of planar) volTerm(c, nb[c][0], nb[c][1], nb[c][2], 0, 0, 0.5);
  return e;
}
function violation(x: Float64Array, n: number, lb: Float64Array, ub: Float64Array, chir: Chir, planar: number[], nb: number[][]) { return energyGrad(x, n, lb, ub, chir, planar, nb, null); }

function minimise(x: Float64Array, n: number, lb: Float64Array, ub: Float64Array, chir: Chir, planar: number[], nb: number[][], maxIter = 1500) {
  const g = new Float64Array(3 * n), gp = new Float64Array(3 * n), dir = new Float64Array(3 * n), xt = new Float64Array(3 * n);
  let e = energyGrad(x, n, lb, ub, chir, planar, nb, g);
  for (let i = 0; i < 3 * n; i++) dir[i] = -g[i];
  for (let it = 0; it < maxIter && e > 1e-6; it++) {
    let slope = 0; for (let i = 0; i < 3 * n; i++) slope += g[i] * dir[i];
    if (slope >= 0) { for (let i = 0; i < 3 * n; i++) dir[i] = -g[i]; slope = -g.reduce((s, v) => s + v * v, 0); }
    let step = 0.25, ok = false, en = e;
    for (let ls = 0; ls < 25; ls++) { for (let i = 0; i < 3 * n; i++) xt[i] = x[i] + step * dir[i]; en = energyGrad(xt, n, lb, ub, chir, planar, nb, null); if (en <= e + 1e-4 * step * slope) { ok = true; break; } step *= 0.5; }
    if (!ok) break;
    x.set(xt); gp.set(g); e = energyGrad(x, n, lb, ub, chir, planar, nb, g);
    let num = 0, den = 0; for (let i = 0; i < 3 * n; i++) { num += g[i] * (g[i] - gp[i]); den += gp[i] * gp[i]; }
    const beta = Math.max(0, num / (den || 1));
    for (let i = 0; i < 3 * n; i++) dir[i] = -g[i] + beta * dir[i];
  }
}
