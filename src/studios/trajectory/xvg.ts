/** GROMACS .xvg (Grace) reader and time-series statistics.
 *  Comments start with #, directives with @, data rows are whitespace-separated numbers,
 *  and a line starting with & starts a new data set.
 */

export interface XvgData {
  title: string;
  xLabel: string;
  yLabel: string;
  legends: string[];
  /** x column of the first data set (shared overlay axis) */
  x: number[];
  /** one array per y column, data sets concatenated in file order */
  series: number[][];
  datasets: number;
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');

export function parseXvg(text: string): XvgData {
  interface Set { x: number[]; ys: number[][] }
  const sets: Set[] = [];
  let cur: Set = { x: [], ys: [] };
  const legends: string[] = [];
  let title = '';
  let xLabel = '';
  let yLabel = '';

  const flush = () => {
    if (cur.x.length || cur.ys.length) sets.push(cur);
    cur = { x: [], ys: [] };
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('@')) {
      const m = /^@\s+(\S+)\s*(.*)$/.exec(line);
      if (!m) continue;
      const name = m[1];
      const rest = m[2].trim();
      if (name === 'title') title = unquote(rest);
      else if (name === 'xaxis') { const lm = /label\s+(.*)$/.exec(rest); if (lm) xLabel = unquote(lm[1]); }
      else if (name === 'yaxis') { const lm = /label\s+(.*)$/.exec(rest); if (lm) yLabel = unquote(lm[1]); }
      else {
        const lm = /^legend\s+(.*)$/.exec(rest);
        if (lm) {
          const idx = Number(name.replace(/^s/, ''));
          if (Number.isInteger(idx) && idx >= 0) legends[idx] = unquote(lm[1]);
        }
      }
      continue;
    }

    if (line.startsWith('&')) { flush(); continue; }

    const vals = line.split(/\s+/).map(Number);
    if (vals.length < 2 || vals.some((v) => !Number.isFinite(v))) continue;
    const nY = vals.length - 1;
    while (cur.ys.length < nY) cur.ys.push([]);
    cur.x.push(vals[0]);
    for (let k = 0; k < cur.ys.length; k++) cur.ys[k].push(vals[k + 1] ?? NaN);
  }
  flush();

  const x = sets[0]?.x ?? [];
  const series = sets.flatMap((s) => s.ys);
  const labels = series.map((_, i) => legends[i] ?? `Series ${i + 1}`);

  return { title, xLabel: xLabel || 'Time', yLabel: yLabel || 'Value', legends: labels, x, series, datasets: sets.length };
}

export interface SeriesStats {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  /** mean of the last quarter of the sampled time range (inclusive end point) */
  finalQuarterMean: number;
  /** standard error of block means, block size n/5 */
  blockSE: number;
  /** ordinary least-squares slope of y against x */
  drift: number;
  /** integrated autocorrelation time tau = 1/2 + sum rho_k, summed until the first negative rho */
  autocorrelationTime: number;
  /** first x after which the running mean stays within ±1 SD of the final-half mean */
  equilibrationTime: number | null;
  equilibrationHint: string;
}

const meanOf = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sdOf = (v: number[]) => { const m = meanOf(v); return v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : 0; };

export function describeSeries(x: number[], y: number[]): SeriesStats {
  const n = Math.min(x.length, y.length);
  if (n === 0) {
    return { n: 0, mean: 0, sd: 0, min: 0, max: 0, finalQuarterMean: 0, blockSE: 0, drift: 0, autocorrelationTime: 0, equilibrationTime: null, equilibrationHint: 'no data' };
  }
  const xs = x.slice(0, n);
  const ys = y.slice(0, n);
  const mean = meanOf(ys);
  const sd = sdOf(ys);
  let min = Infinity, max = -Infinity;
  for (const v of ys) { if (v < min) min = v; if (v > max) max = v; }

  // last quarter of the spacing between first and last sample, end point included
  const qStart = Math.floor(0.75 * (n - 1));
  const finalQuarterMean = meanOf(ys.slice(qStart));

  // block-averaged standard error (five blocks)
  const nBlocks = Math.max(1, Math.min(5, n));
  const blockSize = Math.ceil(n / nBlocks);
  const blockMeans: number[] = [];
  for (let b = 0; b < n; b += blockSize) blockMeans.push(meanOf(ys.slice(b, Math.min(n, b + blockSize))));
  const blockSE = blockMeans.length > 1 ? sdOf(blockMeans) / Math.sqrt(blockMeans.length) : 0;

  // OLS slope, with a guard for a constant x axis
  let drift = 0;
  const xm = meanOf(xs);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - xm) ** 2; sxy += (xs[i] - xm) * (ys[i] - mean); }
  if (sxx > 0) drift = sxy / sxx;

  // integrated autocorrelation time, truncated at the first negative sample correlation
  let autocorrelationTime = 0;
  if (n >= 3) {
    let denom = 0;
    for (const v of ys) denom += (v - mean) ** 2;
    if (denom > 0) {
      const maxLag = Math.min(n - 1, 2000);
      let sum = 0.5;
      for (let k = 1; k <= maxLag; k++) {
        let num = 0;
        for (let i = 0; i + k < n; i++) num += (ys[i] - mean) * (ys[i + k] - mean);
        const rho = num / denom;
        if (rho <= 0) break;
        sum += rho;
      }
      autocorrelationTime = sum;
    }
  }

  // equilibration: running mean must stay inside ±1 SD of the final-half mean
  let equilibrationTime: number | null = null;
  let equilHint = 'not enough samples';
  if (n >= 4) {
    const halfMean = meanOf(ys.slice(Math.floor(n / 2)));
    const halfSd = sdOf(ys.slice(Math.floor(n / 2)));
    let run = 0;
    const inside = new Array<boolean>(n);
    for (let i = 0; i < n; i++) { run += ys[i]; inside[i] = Math.abs(run / (i + 1) - halfMean) <= halfSd; }
    if (inside[n - 1]) {
      let from = n - 1;
      while (from > 0 && inside[from - 1]) from--;
      equilibrationTime = xs[from];
    }
    equilHint = equilibrationTime === null
      ? 'running mean never settles within ±1 SD of the final-half mean'
      : `running mean within ±1 SD of the final-half mean from x = ${equilibrationTime}`;
  }

  return { n, mean, sd, min, max, finalQuarterMean, blockSE, drift, autocorrelationTime, equilibrationTime, equilibrationHint: equilHint };
}

const TO_PS: Record<string, number> = { fs: 1e-3, ps: 1, ns: 1e3, us: 1e6, µs: 1e6, ms: 1e9 };

/** Convert a time value between fs, ps, ns, us. */
export function convertTimeUnit(value: number, from: string = 'ps', to: string = 'ns'): number {
  return (value * (TO_PS[from] ?? 1)) / (TO_PS[to] ?? 1);
}
