/** ComBat batch correction (Johnson, Li & Rabinovic 2007), parametric empirical Bayes, clean-room TypeScript.
 *  Input: log-scale matrix (genes × samples, row-major). The biological `groups` are kept as a protected covariate. */

export interface CombatResult { x: Float64Array; batches: string[]; nBatches: number; gammaStar: number[][]; deltaStar: number[][] }

/** Solve A·X = B for symmetric positive-definite A (small, p×p) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], B: number[][]): number[][] {
  const p = A.length, m = B[0].length, M = A.map((r, i) => [...r, ...B[i]]);
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-10) throw new Error('Batch and group are perfectly confounded (or a batch has no usable samples); ComBat cannot separate them. Re-design the experiment or drop the group covariate.');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k < p + m; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r.slice(p).map((v) => v / M[i][i]));
}

export function combat(x: Float64Array, G: number, S: number, batch: string[], groups?: string[]): CombatResult {
  const batches = [...new Set(batch)], nb = batches.length, bi = batch.map((b) => batches.indexOf(b));
  if (nb < 2) throw new Error('ComBat needs at least two batches.');
  const nPer = batches.map((_, b) => bi.filter((v) => v === b).length);
  if (nPer.some((n) => n < 2)) throw new Error(`Every batch needs ≥ 2 samples for ComBat (batch “${batches[nPer.findIndex((n) => n < 2)]}” has 1).`);
  const levels = groups ? [...new Set(groups)] : [], nc = Math.max(0, levels.length - 1), P = nb + nc;
  const design = Array.from({ length: S }, (_, j) => { const r = new Array(P).fill(0); r[bi[j]] = 1; if (groups) { const l = levels.indexOf(groups[j]); if (l > 0) r[nb + l - 1] = 1; } return r; });
  const XtX = Array.from({ length: P }, (_, a) => Array.from({ length: P }, (_, b) => design.reduce((s, r) => s + r[a] * r[b], 0)));
  // B.hat = (XᵀX)⁻¹ Xᵀ Yᵀ  (P × G)
  const XtY = Array.from({ length: P }, (_, a) => Array.from({ length: G }, (_, g) => { let s = 0; for (let j = 0; j < S; j++) s += design[j][a] * x[g * S + j]; return s; }));
  const Bhat = solve(XtX, XtY);
  const stand = new Float64Array(G * S), varPooled = new Float64Array(G), sdata = new Float64Array(G * S);
  for (let g = 0; g < G; g++) {
    let grand = 0; for (let b = 0; b < nb; b++) grand += (nPer[b] / S) * Bhat[b][g];
    let v = 0;
    for (let j = 0; j < S; j++) {
      let fit = 0; for (let a = 0; a < P; a++) fit += design[j][a] * Bhat[a][g];
      v += (x[g * S + j] - fit) ** 2;
      let cov = 0; for (let a = nb; a < P; a++) cov += design[j][a] * Bhat[a][g];
      stand[g * S + j] = grand + cov;
    }
    varPooled[g] = Math.max(v / S, 1e-12);
    for (let j = 0; j < S; j++) sdata[g * S + j] = (x[g * S + j] - stand[g * S + j]) / Math.sqrt(varPooled[g]);
  }
  // per-batch location (gamma) and scale (delta) estimates
  const gHat = Array.from({ length: nb }, () => new Float64Array(G)), dHat = Array.from({ length: nb }, () => new Float64Array(G));
  for (let b = 0; b < nb; b++) for (let g = 0; g < G; g++) {
    let s = 0, n = 0; for (let j = 0; j < S; j++) if (bi[j] === b) { s += sdata[g * S + j]; n++; }
    const mean = s / n; let ss = 0; for (let j = 0; j < S; j++) if (bi[j] === b) ss += (sdata[g * S + j] - mean) ** 2;
    gHat[b][g] = mean; dHat[b][g] = ss / (n - 1);
  }
  const mv = (a: Float64Array) => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return [m, s / (a.length - 1)] as const; };
  const gammaStar: number[][] = [], deltaStar: number[][] = [];
  for (let b = 0; b < nb; b++) {
    const [gbar, t2] = mv(gHat[b]), [dm, ds2] = mv(dHat[b]), aPrior = (2 * ds2 + dm * dm) / ds2, bPrior = (dm * ds2 + dm ** 3) / ds2, n = nPer[b];
    const gNew = Float64Array.from(gHat[b]), dNew = Float64Array.from(dHat[b]);
    for (let g = 0; g < G; g++) {
      let gOld = gHat[b][g], dOld = dHat[b][g];
      for (let it = 0; it < 200; it++) {
        const gn = (t2 * n * gHat[b][g] + dOld * gbar) / (t2 * n + dOld);
        let sum2 = 0; for (let j = 0; j < S; j++) if (bi[j] === b) sum2 += (sdata[g * S + j] - gn) ** 2;
        const dn = (0.5 * sum2 + bPrior) / (n / 2 + aPrior - 1);
        const change = Math.max(Math.abs(gn - gOld) / (Math.abs(gOld) || 1), Math.abs(dn - dOld) / (Math.abs(dOld) || 1));
        gOld = gn; dOld = dn; if (change < 1e-4) break;
      }
      gNew[g] = gOld; dNew[g] = dOld;
    }
    gammaStar.push(Array.from(gNew)); deltaStar.push(Array.from(dNew));
  }
  const out = new Float64Array(G * S);
  for (let g = 0; g < G; g++) for (let j = 0; j < S; j++) {
    const b = bi[j]; out[g * S + j] = ((sdata[g * S + j] - gammaStar[b][g]) / Math.sqrt(deltaStar[b][g])) * Math.sqrt(varPooled[g]) + stand[g * S + j];
  }
  return { x: out, batches, nBatches: nb, gammaStar, deltaStar };
}

/** Optional third sample-sheet column: batch label per sample. Returns null when no sample has one. */
export function parseBatches(text: string, samples: string[]): string[] | null {
  const map = new Map<string, string>();
  for (const l of text.split(/\r?\n/)) { const f = l.split(/[\t,]/).map((x) => x.trim().replace(/^"|"$/g, '')); if (f.length >= 3 && f[0] && f[2]) map.set(f[0], f[2]); }
  if (!map.size) return null;
  const out = samples.map((s) => map.get(s)), miss = samples.filter((_, i) => !out[i]);
  if (miss.length) throw new Error(`Batch column is missing for: ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? '…' : ''}`);
  return out as string[];
}
