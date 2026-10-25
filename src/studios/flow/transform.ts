/** Transforms and spillover compensation. */

export type TransformKind = 'none' | 'arcsinh' | 'log';
export interface TransformSpec { kind: TransformKind; cofactor?: number; floor?: number }

export const arcsinh = (x: number, cofactor = 150) => Math.asinh(x / cofactor);
export const inverseArcsinh = (y: number, cofactor = 150) => Math.sinh(y) * cofactor;
export const log10Clip = (x: number, floor = 1) => Math.log10(Math.max(x, floor));
export const inverseLog10 = (y: number) => 10 ** y;

export function applyTransform(values: ArrayLike<number>, spec: TransformSpec): Float64Array {
  if (spec.kind === 'none') return Float64Array.from(values);
  if (spec.kind === 'arcsinh') {
    const c = spec.cofactor ?? 150;
    return Float64Array.from(values, (v) => arcsinh(v, c));
  }
  const floor = spec.floor ?? 1;
  return Float64Array.from(values, (v) => log10Clip(v, floor));
}

/** Gauss-Jordan inverse with partial pivoting; throws for a singular or oversized matrix. */
export function invert(matrix: number[][]): number[][] {
  const n = matrix.length;
  if (!n || matrix.some((row) => row.length !== n)) throw new Error('The spillover matrix must be square.');
  if (n > 32) throw new Error('The spillover matrix is larger than 32 × 32.');
  const a = matrix.map((row) => row.slice());
  const inv = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('The spillover matrix is singular and cannot be inverted.');
    if (pivot !== col) { [a[pivot], a[col]] = [a[col], a[pivot]]; [inv[pivot], inv[col]] = [inv[col], inv[pivot]]; }
    const p = a[col][col];
    for (let c = 0; c < n; c++) { a[col][c] /= p; inv[col][c] /= p; }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (!f) continue;
      for (let c = 0; c < n; c++) { a[r][c] -= f * a[col][c]; inv[r][c] -= f * inv[col][c]; }
    }
  }
  return inv;
}

/** observed = true × S (rows = true sources, columns = detectors), so true = observed × S⁻¹. */
export function compensate(columns: Float64Array[], spillMatrix: number[][]): Float64Array[] {
  const n = spillMatrix.length;
  if (columns.length !== n) throw new Error(`The spillover matrix has ${n} channels but ${columns.length} columns were selected.`);
  const length = columns[0]?.length ?? 0;
  if (columns.some((c) => c.length !== length)) throw new Error('The selected columns must have equal length.');
  const inv = invert(spillMatrix);
  const out = Array.from({ length: n }, () => new Float64Array(length));
  for (let e = 0; e < length; e++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += columns[j][e] * inv[j][i];
      out[i][e] = sum;
    }
  }
  return out;
}
