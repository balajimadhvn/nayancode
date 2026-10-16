/** Probability distributions (central and non-central t, F, chi-square, normal) in plain TypeScript, no dependencies. */

export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised incomplete beta I_x(a, b) (Lentz continued fraction). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  const cf = (x: number, a: number, b: number) => {
    const tiny = 1e-300; let c = 1, d = 1 - ((a + b) * x) / (a + 1); if (Math.abs(d) < tiny) d = tiny; d = 1 / d; let h = d;
    for (let m = 1; m <= 500; m++) {
      const m2 = 2 * m; let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; h *= d * c;
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (front * cf(x, a, b)) / a : 1 - (front * cf(1 - x, b, a)) / b;
}

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) { let sum = 1 / a, term = sum; for (let n = 1; n < 1000; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-16) break; } return sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  const tiny = 1e-300; let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < tiny) d = tiny; c = b + an / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

// ---- normal
/** Regularised upper incomplete gamma Q(a, x) with full relative accuracy in the tail. */
export function gammaQ(a: number, x: number): number {
  if (x < a + 1) return 1 - gammaP(a, x);
  const tiny = 1e-300; let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < tiny) d = tiny; c = b + an / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break; }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
export function pnorm(z: number): number {
  if (z === 0) return 0.5;
  const tail = 0.5 * gammaQ(0.5, (z * z) / 2); // P(Z > |z|)
  return z > 0 ? 1 - tail : tail;
}
/** Standard normal quantile (Wichura AS 241, ~1e-16). */
export function qnorm(p: number): number {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (q * (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r + 3.387132872796366608)) / (((((((r * 5226.495278852545925 + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
  }
  let r = q < 0 ? p : 1 - p; r = Math.sqrt(-Math.log(r)); let v: number;
  if (r <= 5) { r -= 1.6; v = (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r + 1.42343711074968357734) / (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1); }
  else { r -= 5; v = (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r + 6.6579046435011037772) / (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1); }
  return q < 0 ? -v : v;
}

// ---- central t, F, chi-square
export const pt = (t: number, df: number) => { const x = df / (df + t * t), p = 0.5 * betaI(x, df / 2, 0.5); return t > 0 ? 1 - p : p; };
export const ptUpper = (t: number, df: number) => pt(-t, df);
export const pf = (f: number, d1: number, d2: number) => (f <= 0 ? 0 : betaI((d1 * f) / (d1 * f + d2), d1 / 2, d2 / 2));
export const pfUpper = (f: number, d1: number, d2: number) => (f <= 0 ? 1 : betaI(d2 / (d2 + d1 * f), d2 / 2, d1 / 2));
export const pchisq = (x: number, k: number) => gammaP(k / 2, x / 2);

function invert(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  while (cdf(hi) < p && hi < 1e300) hi *= 2; while (cdf(lo) > p && lo > -1e300) lo = lo < 0 ? lo * 2 : lo - 1;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < p) lo = mid; else hi = mid; if (hi - lo < 1e-14 * Math.max(1, Math.abs(mid))) break; }
  return (lo + hi) / 2;
}
export const qt = (p: number, df: number) => (p === 0.5 ? 0 : invert((x) => pt(x, df), p, -10, 10));
export const qf = (p: number, d1: number, d2: number) => invert((x) => pf(x, d1, d2), p, 0, 10);
export const qchisq = (p: number, k: number) => invert((x) => pchisq(x, k), p, 0, Math.max(10, k * 3));

/** Non-central t CDF P(T <= t), AS 243 (Lenth 1989) as used by R's pt(ncp=). */
export function ptNc(t: number, df: number, ncp: number): number {
  if (ncp === 0) return pt(t, df);
  const negdel = t < 0, tt = negdel ? -t : t, del = negdel ? -ncp : ncp;
  let tnc: number;
  if (tt === 0) tnc = pnorm(-del);
  else {
    const x = (tt * tt) / (tt * tt + df), lambda = del * del; let p = 0.5 * Math.exp(-0.5 * lambda);
    if (p === 0) return negdel ? 1 : 0;
    let q = Math.sqrt(2 / Math.PI) * p * del, s = 0.5 - p, a = 0.5; const b = 0.5 * df, rxb = (1 - x) ** b, albeta = 0.5 * Math.log(Math.PI) + lgamma(b) - lgamma(0.5 + b);
    let xodd = betaI(x, a, b), godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta), xeven: number; tnc = b * x;
    xeven = tnc < 2.2e-16 ? tnc : 1 - rxb; const geven0 = tnc * rxb; let geven = geven0;
    tnc = p * xodd + q * xeven;
    for (let it = 1; it <= 10000; it++) {
      a += 1; xodd -= godd; xeven -= geven; godd *= (x * (a + b - 1)) / a; geven *= (x * (a + b - 0.5)) / (a + 0.5);
      p *= lambda / (2 * it); q *= lambda / (2 * it + 1); tnc += p * xodd + q * xeven; s -= p;
      if (s < -1e-10) break; if (s <= 0 && it > 1) break;
      if (Math.abs(2 * s * (xodd - godd)) < 1e-12) break;
    }
    tnc += pnorm(-del);
  }
  tnc = Math.min(tnc, 1);
  return negdel ? 1 - tnc : tnc;
}

/** Non-central F CDF via the Poisson mixture of central beta terms, summed outward from the Poisson mode. */
export function pfNc(f: number, d1: number, d2: number, ncp: number): number {
  if (f <= 0) return 0; const x = (d1 * f) / (d1 * f + d2), h = ncp / 2;
  if (h === 0) return betaI(x, d1 / 2, d2 / 2);
  const j0 = Math.floor(h), at = (j: number) => Math.exp(-h + j * Math.log(h) - lgamma(j + 1)) * betaI(x, d1 / 2 + j, d2 / 2);
  let sum = 0;
  for (let j = j0; j < j0 + 100000; j++) { const v = at(j); sum += v; if (j > j0 + 2 && v < 1e-17 * sum) break; }
  for (let j = j0 - 1; j >= 0; j--) { const v = at(j); sum += v; if (v < 1e-17 * sum) break; }
  return Math.min(1, sum);
}

/** Brent-style bracketing root finder for monotone functions. */
export function uniroot(f: (x: number) => number, lo: number, hi: number, tol = 1e-12): number {
  let flo = f(lo), fhi = f(hi);
  for (let i = 0; i < 60 && flo * fhi > 0; i++) { hi *= 2; fhi = f(hi); }
  if (flo * fhi > 0) return NaN;
  for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2, fm = f(mid); if (fm === 0 || (hi - lo) / 2 < tol * Math.max(1, Math.abs(mid))) return mid; if (fm * flo < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } }
  return (lo + hi) / 2;
}
