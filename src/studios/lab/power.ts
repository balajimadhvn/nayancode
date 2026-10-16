import { pfNc, pnorm, ptNc, qf, qnorm, qt, uniroot } from './dist';

export type Alt = 'two.sided' | 'greater' | 'less';
export type TType = 'two.sample' | 'paired' | 'one.sample';

// ---------------------------------------------------------------- t tests (pwr.t.test)
/** Power of a one-, paired- or two-sample t test with equal group sizes n and standardised effect d (Cohen). */
export function powerT(n: number, d: number, alpha = 0.05, type: TType = 'two.sample', alt: Alt = 'two.sided'): number {
  const nu = type === 'two.sample' ? (n - 1) * 2 : n - 1, ncp = type === 'two.sample' ? d * Math.sqrt(n / 2) : d * Math.sqrt(n);
  if (alt === 'two.sided') { const q = qt(1 - alpha / 2, nu); return 1 - ptNc(q, nu, ncp) + ptNc(-q, nu, ncp); }
  const q = qt(1 - alpha, nu);
  return alt === 'greater' ? 1 - ptNc(q, nu, ncp) : ptNc(-q, nu, ncp);
}
export const sampleSizeT = (d: number, power = 0.8, alpha = 0.05, type: TType = 'two.sample', alt: Alt = 'two.sided') =>
  uniroot((n) => powerT(n, d, alpha, type, alt) - power, 2 + 1e-10, 1e7);
export const effectT = (n: number, power = 0.8, alpha = 0.05, type: TType = 'two.sample', alt: Alt = 'two.sided') =>
  uniroot((d) => powerT(n, d, alpha, type, alt) - power, 1e-7, 10);

// ---------------------------------------------------------------- one-way ANOVA (pwr.anova.test)
export function powerAnova(k: number, n: number, f: number, alpha = 0.05): number {
  const d1 = k - 1, d2 = (n - 1) * k;
  return 1 - pfNc(qf(1 - alpha, d1, d2), d1, d2, k * n * f * f);
}
export const sampleSizeAnova = (k: number, f: number, power = 0.8, alpha = 0.05) => uniroot((n) => powerAnova(k, n, f, alpha) - power, 2 + 1e-10, 1e6);
export const effectAnova = (k: number, n: number, power = 0.8, alpha = 0.05) => uniroot((f) => powerAnova(k, n, f, alpha) - power, 1e-7, 5);

// ---------------------------------------------------------------- two proportions (pwr.2p.test, Cohen's h)
export const cohenH = (p1: number, p2: number) => 2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p2));
export function powerProp(n: number, h: number, alpha = 0.05, alt: Alt = 'two.sided'): number {
  const s = h * Math.sqrt(n / 2);
  if (alt === 'two.sided') { const qu = qnorm(1 - alpha / 2); return pnorm(s - qu) + pnorm(-s - qu); }
  const qu = qnorm(1 - alpha); return alt === 'greater' ? pnorm(s - qu) : pnorm(-s - qu);
}
/** n per group. */
export const sampleSizeProp = (h: number, power = 0.8, alpha = 0.05, alt: Alt = 'two.sided') => uniroot((n) => powerProp(n, Math.abs(h) * (alt === 'less' ? -1 : 1), alpha, alt) - power, 2, 1e8);

// ---------------------------------------------------------------- log-rank (Schoenfeld 1981)
/** Events needed; `allocation` is the fraction of subjects in arm 1 (0.5 = equal). */
export function logrankEvents(hr: number, power = 0.8, alpha = 0.05, allocation = 0.5): number {
  const za = qnorm(1 - alpha / 2), zb = qnorm(power);
  return ((za + zb) ** 2) / (allocation * (1 - allocation) * Math.log(hr) ** 2);
}
export const logrankPower = (events: number, hr: number, alpha = 0.05, allocation = 0.5) =>
  pnorm(Math.sqrt(events * allocation * (1 - allocation)) * Math.abs(Math.log(hr)) - qnorm(1 - alpha / 2));
/** Probability of an event by the end of the study for exponential survival with uniform accrual over `accrual`, then `followup` more. */
export function eventProbability(rate: number, accrual: number, followup: number): number {
  if (accrual <= 0) return 1 - Math.exp(-rate * followup);
  return 1 - (Math.exp(-rate * followup) - Math.exp(-rate * (accrual + followup))) / (rate * accrual);
}
export interface LogrankPlan { events: number; n: number; nControl: number; nTreat: number; pEventControl: number; pEventTreat: number }
/** Total subjects from the events requirement, with exponential survival (control median, HR) and uniform accrual. */
export function logrankSampleSize(hr: number, medianControl: number, accrual: number, followup: number, power = 0.8, alpha = 0.05, allocation = 0.5): LogrankPlan {
  const lam0 = Math.LN2 / medianControl, lam1 = lam0 * hr, p0 = eventProbability(lam0, accrual, followup), p1 = eventProbability(lam1, accrual, followup);
  const events = logrankEvents(hr, power, alpha, allocation), pAvg = allocation * p1 + (1 - allocation) * p0, n = events / pAvg;
  return { events, n, nControl: n * (1 - allocation), nTreat: n * allocation, pEventControl: p0, pEventTreat: p1 };
}

// ---------------------------------------------------------------- RNA-seq (Hart et al. 2013; RNASeqPower::rnapower, equal groups)
/** depth = mean read count per gene, cv = biological coefficient of variation, effect = fold change. */
export function rnaseqPower(depth: number, n: number, cv: number, effect: number, alpha = 0.05): number {
  const v = 2 * (1 / depth + cv * cv) / n;
  return pnorm(Math.abs(Math.log(effect)) / Math.sqrt(v) + qnorm(alpha / 2));
}
export const rnaseqSampleSize = (depth: number, cv: number, effect: number, power = 0.8, alpha = 0.05) =>
  2 * (1 / depth + cv * cv) * ((-qnorm(alpha / 2) + qnorm(power)) / Math.log(effect)) ** 2;
export const rnaseqEffect = (depth: number, n: number, cv: number, power = 0.8, alpha = 0.05) =>
  Math.exp((-qnorm(alpha / 2) + qnorm(power)) * Math.sqrt((2 * (1 / depth + cv * cv)) / n));
export const rnaseqCv = (depth: number, n: number, effect: number, power = 0.8, alpha = 0.05) =>
  Math.sqrt(Math.max(0, (Math.log(effect) / (-qnorm(alpha / 2) + qnorm(power))) ** 2 * (n / 2) - 1 / depth));
