/**
 * Survival analysis: Kaplan–Meier with Greenwood (log–log) confidence intervals, log-rank test (with strata for
 * more than two groups) and Cox proportional hazards with Efron tie handling. Pure TypeScript.
 */
import { pchisq, pnorm, qnorm } from './dist';

export interface Subject { time: number; event: 0 | 1; group?: string; x?: number[] }

export interface KmPoint { time: number; atRisk: number; events: number; censored: number; surv: number; lo: number; hi: number; se: number }
export interface KmCurve { group: string; n: number; events: number; median: number; medianLo: number; medianHi: number; points: KmPoint[] }

const finite = (v: number) => Number.isFinite(v);

/** Parses CSV/TSV with a header: time, event (0/1 or TRUE/FALSE or 1=event 2=censored is NOT guessed), optional group, other numeric covariates. */
export function parseSurvival(text: string): { subjects: Subject[]; covariates: string[]; skipped: number } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('Need a header row and at least one subject.');
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const head = lines[0].split(sep).map((h) => h.trim());
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h.toLowerCase()));
  const it = idx(['time', 'os_time', 'futime', 'days', 'months', 'duration']), ie = idx(['event', 'status', 'os_event', 'death', 'dead', 'fustat']), ig = idx(['group', 'arm', 'treatment', 'strata']);
  if (it < 0 || ie < 0) throw new Error('The header needs a "time" column and an "event" column (1 = event, 0 = censored).');
  const covIdx = head.map((_, i) => i).filter((i) => i !== it && i !== ie && i !== ig);
  const subjects: Subject[] = []; let skipped = 0;
  const covariates: string[] = [];
  const numericCols = covIdx.filter((i) => lines.slice(1).every((l) => { const c = l.split(sep)[i]?.trim(); return c !== undefined && c !== '' && finite(Number(c)); }));
  for (const i of numericCols) covariates.push(head[i]);
  for (const l of lines.slice(1)) {
    const c = l.split(sep).map((s) => s.trim());
    const t = Number(c[it]); const ev = /^(true|yes)$/i.test(c[ie]) ? 1 : /^(false|no)$/i.test(c[ie]) ? 0 : Number(c[ie]);
    if (!finite(t) || t < 0 || (ev !== 0 && ev !== 1)) { skipped++; continue; }
    subjects.push({ time: t, event: ev as 0 | 1, group: ig >= 0 ? c[ig] : undefined, x: numericCols.map((i) => Number(c[i])) });
  }
  return { subjects, covariates, skipped };
}

/** Kaplan–Meier estimate; confidence interval on the log(-log S) scale (the R survival default). */
export function kaplanMeier(subjects: Subject[], group = 'all', conf = 0.95): KmCurve {
  const s = [...subjects].sort((a, b) => a.time - b.time);
  const z = qnorm(1 - (1 - conf) / 2);
  const times = [...new Set(s.filter((x) => x.event === 1).map((x) => x.time))];
  let surv = 1, gw = 0, i = 0; const points: KmPoint[] = [{ time: 0, atRisk: s.length, events: 0, censored: 0, surv: 1, lo: 1, hi: 1, se: 0 }];
  for (const t of times) {
    while (i < s.length && s[i].time < t) i++;
    const atRisk = s.length - i;
    let d = 0, c = 0; let j = i;
    while (j < s.length && s[j].time === t) { if (s[j].event === 1) d++; else c++; j++; }
    surv *= 1 - d / atRisk;
    if (atRisk > d) gw += d / (atRisk * (atRisk - d)); else gw = Infinity;
    const se = surv * Math.sqrt(gw);
    let lo = 0, hi = 1;
    if (surv > 0 && surv < 1 && finite(gw)) { const v = Math.sqrt(gw) / Math.log(surv); lo = surv ** Math.exp(z * v); hi = surv ** Math.exp(-z * v); }
    else if (surv === 1) { lo = 1; hi = 1; }
    points.push({ time: t, atRisk, events: d, censored: c, surv, lo: Math.min(lo, hi), hi: Math.max(lo, hi), se });
  }
  const med = (f: (p: KmPoint) => number) => { const p = points.find((q) => f(q) <= 0.5); return p ? p.time : NaN; };
  return { group, n: s.length, events: s.filter((x) => x.event === 1).length, median: med((p) => p.surv), medianLo: med((p) => p.lo), medianHi: med((p) => p.hi), points };
}

export function kmByGroup(subjects: Subject[]): KmCurve[] {
  const groups = [...new Set(subjects.map((s) => s.group ?? 'all'))];
  return groups.map((g) => kaplanMeier(subjects.filter((s) => (s.group ?? 'all') === g), g));
}

/** Step function value of a curve at time t. */
export const survAt = (c: KmCurve, t: number) => { let v = 1; for (const p of c.points) { if (p.time <= t) v = p.surv; else break; } return v; };

/** Log-rank test across k groups (Mantel–Haenszel / Peto form with hypergeometric variance), chi-square on k−1 df. */
export function logRank(subjects: Subject[]) {
  const groups = [...new Set(subjects.map((s) => s.group ?? 'all'))];
  const k = groups.length;
  if (k < 2) throw new Error('The log-rank test needs at least two groups.');
  const times = [...new Set(subjects.filter((s) => s.event === 1).map((s) => s.time))].sort((a, b) => a - b);
  const O = new Array(k).fill(0), E = new Array(k).fill(0);
  const V = Array.from({ length: k }, () => new Array(k).fill(0));
  const gi = subjects.map((s) => groups.indexOf(s.group ?? 'all'));
  for (const t of times) {
    const n = new Array(k).fill(0), d = new Array(k).fill(0);
    subjects.forEach((s, i) => { if (s.time >= t) n[gi[i]]++; if (s.time === t && s.event === 1) d[gi[i]]++; });
    const N = n.reduce((a, b) => a + b, 0), D = d.reduce((a, b) => a + b, 0);
    if (N < 2) continue;
    for (let a = 0; a < k; a++) {
      O[a] += d[a]; E[a] += (D * n[a]) / N;
      for (let b = 0; b < k; b++) V[a][b] += ((D * (N - D)) / (N * N * (N - 1))) * n[a] * ((a === b ? N : 0) - n[b]);
    }
  }
  // Drop the last group, then chi² = (O−E)' V⁻¹ (O−E).
  const m = k - 1, diff = O.slice(0, m).map((o, i) => o - E[i]), M = V.slice(0, m).map((r) => r.slice(0, m));
  const sol = solve(M, diff);
  const chisq = diff.reduce((a, d, i) => a + d * sol[i], 0);
  return { groups, observed: O, expected: E, chisq, df: m, p: 1 - pchisq(chisq, m) };
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return new Array(n).fill(NaN);
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function invert(A: number[][]): number[][] {
  const n = A.length; const cols = Array.from({ length: n }, (_, j) => solve(A, A.map((_, i) => (i === j ? 1 : 0))));
  return A.map((_, i) => cols.map((c) => c[i]));
}

export interface CoxCoef { name: string; coef: number; hr: number; se: number; z: number; p: number; hrLo: number; hrHi: number }
export interface CoxFit { coefs: CoxCoef[]; n: number; events: number; loglik0: number; loglik: number; lrt: number; lrtP: number; waldP: number; concordance: number; iterations: number; converged: boolean }

/** Cox proportional hazards with Efron's approximation for ties (the R coxph default), Newton–Raphson. */
export function coxPh(subjects: Subject[], names: string[], conf = 0.95): CoxFit {
  const p = names.length, n = subjects.length;
  if (!p) throw new Error('Choose at least one covariate.');
  const ord = [...subjects].sort((a, b) => a.time - b.time);
  const X = ord.map((s) => s.x!), T = ord.map((s) => s.time), E = ord.map((s) => s.event);
  const events = E.reduce<number>((a, b) => a + b, 0);
  if (events < 2) throw new Error('At least two events are needed to fit a Cox model.');
  const times = [...new Set(T.filter((_, i) => E[i] === 1))].sort((a, b) => b - a); // descending: risk set accumulates
  // Precompute for each event time the tied-death indices and the risk-set start.
  const tiesAt = new Map<number, number[]>(); T.forEach((t, i) => { if (E[i] === 1) (tiesAt.get(t) ?? tiesAt.set(t, []).get(t)!).push(i); });
  const first = new Map<number, number>(); T.forEach((t, i) => { if (!first.has(t)) first.set(t, i); });

  const evalAt = (beta: number[], needHess: boolean) => {
    const eta = X.map((x) => x.reduce((a, v, j) => a + v * beta[j], 0)), w = eta.map(Math.exp);
    let ll = 0; const g = new Array(p).fill(0); const H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (const t of times) {
      const dIdx = tiesAt.get(t)!, d = dIdx.length, start = first.get(t)!;
      let s0 = 0; const s1 = new Array(p).fill(0); const s2 = Array.from({ length: p }, () => new Array(p).fill(0));
      for (let i = start; i < n; i++) { s0 += w[i]; for (let a = 0; a < p; a++) { s1[a] += w[i] * X[i][a]; if (needHess) for (let b = 0; b <= a; b++) s2[a][b] += w[i] * X[i][a] * X[i][b]; } }
      let d0 = 0; const d1 = new Array(p).fill(0); const d2 = Array.from({ length: p }, () => new Array(p).fill(0));
      for (const i of dIdx) { d0 += w[i]; for (let a = 0; a < p; a++) { d1[a] += w[i] * X[i][a]; if (needHess) for (let b = 0; b <= a; b++) d2[a][b] += w[i] * X[i][a] * X[i][b]; } ll += eta[i]; for (let a = 0; a < p; a++) g[a] += X[i][a]; }
      for (let k = 0; k < d; k++) {
        const f = k / d, den = s0 - f * d0; ll -= Math.log(den);
        for (let a = 0; a < p; a++) {
          const m1 = s1[a] - f * d1[a]; g[a] -= m1 / den;
          if (needHess) for (let b = 0; b <= a; b++) { const m2 = s2[a][b] - f * d2[a][b]; H[a][b] += m2 / den - (m1 * (s1[b] - f * d1[b])) / (den * den); }
        }
      }
    }
    if (needHess) for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) H[b][a] = H[a][b];
    return { ll, g, H };
  };

  let beta = new Array(p).fill(0); const ll0 = evalAt(beta, false).ll; let cur = evalAt(beta, true), it = 0, converged = false;
  for (; it < 50; it++) {
    const step = solve(cur.H, cur.g);
    if (step.some((v) => !finite(v))) break;
    let scale = 1, next = beta, ev = cur;
    for (let h = 0; h < 20; h++) { next = beta.map((b, j) => b + scale * step[j]); ev = evalAt(next, true); if (finite(ev.ll) && ev.ll >= cur.ll - 1e-9) break; scale /= 2; }
    const delta = Math.max(...step.map((v) => Math.abs(v * scale)));
    beta = next; const improved = Math.abs(ev.ll - cur.ll); cur = ev;
    if (delta < 1e-9 || improved < 1e-10) { converged = true; it++; break; }
  }
  const cov = invert(cur.H), z = qnorm(1 - (1 - conf) / 2);
  const coefs: CoxCoef[] = beta.map((b, j) => { const se = Math.sqrt(cov[j][j]); const zz = b / se; return { name: names[j], coef: b, hr: Math.exp(b), se, z: zz, p: 2 * (1 - pnorm(Math.abs(zz))), hrLo: Math.exp(b - z * se), hrHi: Math.exp(b + z * se) }; });
  const lrt = 2 * (cur.ll - ll0);
  const wald = beta.reduce((a, b, i) => a + b * beta.reduce((c, b2, j) => c + cur.H[i][j] * b2, 0), 0);
  return { coefs, n, events, loglik0: ll0, loglik: cur.ll, lrt, lrtP: 1 - pchisq(lrt, p), waldP: 1 - pchisq(wald, p), concordance: concordance(ord, beta), iterations: it, converged };
}

/** Harrell's C: among comparable pairs, the fraction where the higher risk score fails earlier (ties in score count 0.5). */
export function concordance(ordered: Subject[], beta: number[]): number {
  const r = ordered.map((s) => s.x!.reduce((a, v, j) => a + v * beta[j], 0));
  let conc = 0, tot = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].event !== 1) continue;
    for (let j = i + 1; j < ordered.length; j++) {
      if (ordered[j].time === ordered[i].time && ordered[j].event === 1) continue;
      tot++; if (r[i] > r[j]) conc++; else if (r[i] === r[j]) conc += 0.5;
    }
  }
  return tot ? conc / tot : NaN;
}

/** Recodes a two-level group column as a 0/1 covariate (second level in sorted order = 1). */
export function withGroupCovariate(subjects: Subject[]): { subjects: Subject[]; name: string } {
  const lv = [...new Set(subjects.map((s) => s.group ?? ''))].sort();
  if (lv.length !== 2) throw new Error('A group covariate needs exactly two groups.');
  return { name: `group=${lv[1]} vs ${lv[0]}`, subjects: subjects.map((s) => ({ ...s, x: [...(s.x ?? []), s.group === lv[1] ? 1 : 0] })) };
}
