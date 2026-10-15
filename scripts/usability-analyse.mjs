// Summarises usability-study sheets (columns as docs/usability/results-template.csv).
// Usage: node scripts/usability-analyse.mjs results.csv [--json]
import { readFileSync } from 'node:fs';

export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some((x) => x !== '')) rows.push(row);
  const [h, ...body] = rows; return body.map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] ?? '').trim()])));
}
/** SUS score 0–100 (Brooke 1996): odd items score − 1, even items 5 − score, sum × 2.5. */
export function sus(r) {
  let s = 0; for (let i = 1; i <= 10; i++) { const v = Number(r[`sus${i}`]); if (!(v >= 1 && v <= 5)) return null; s += i % 2 ? v - 1 : 5 - v; }
  return s * 2.5;
}
/** Bangor, Kortum & Miller (2009) adjective for a mean SUS score. */
export const adjective = (x) => (x >= 85 ? 'excellent' : x >= 72.75 ? 'good' : x >= 52 ? 'OK' : x >= 39 ? 'poor' : 'awful');
/** Wilson 95 % interval for k successes out of n (half-credit successes count as 0.5). */
export function wilson(k, n, z = 1.96) {
  if (!n) return [NaN, NaN]; const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), e = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - e) / d), Math.min(1, (c + e) / d)];
}
const quant = (v, q) => { const a = [...v].sort((x, y) => x - y), h = (a.length - 1) * q, lo = Math.floor(h); return a.length ? a[lo] + (h - lo) * ((a[Math.min(lo + 1, a.length - 1)]) - a[lo]) : NaN; };
const tCrit = (df) => [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09][df - 1] ?? 1.96 + 2.4 / df;

export function analyse(rows) {
  const groups = { all: rows, A: rows.filter((r) => r.group === 'A'), B: rows.filter((r) => r.group === 'B') };
  const out = {};
  for (const [g, rs] of Object.entries(groups)) {
    if (!rs.length) continue;
    const tasks = [1, 2, 3, 4, 5].map((t) => {
      const done = rs.filter((r) => r[`t${t}_success`] !== ''), k = done.reduce((s, r) => s + Number(r[`t${t}_success`]), 0), secs = done.map((r) => Number(r[`t${t}_seconds`])).filter(Number.isFinite);
      const [lo, hi] = wilson(k, done.length);
      return { task: t, n: done.length, success: done.length ? k / done.length : NaN, ci95: [lo, hi], medianSeconds: quant(secs, 0.5), iqrSeconds: [quant(secs, 0.25), quant(secs, 0.75)], meanHints: done.reduce((s, r) => s + Number(r[`t${t}_hints`] || 0), 0) / (done.length || 1) };
    });
    const s = rs.map(sus).filter((x) => x !== null), m = s.reduce((a, b) => a + b, 0) / s.length, sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, s.length - 1)), h = s.length > 1 ? (tCrit(s.length - 1) * sd) / Math.sqrt(s.length) : NaN;
    out[g] = { participants: rs.length, tasks, sus: { n: s.length, mean: m, sd, ci95: [m - h, m + h], adjective: s.length ? adjective(m) : '' } };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]; if (!file) { console.error('Usage: node scripts/usability-analyse.mjs results.csv [--json]'); process.exit(1); }
  const res = analyse(parseCsv(readFileSync(file, 'utf8')));
  if (process.argv.includes('--json')) { console.log(JSON.stringify(res, null, 2)); process.exit(0); }
  const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : '–'), r1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
  for (const [g, r] of Object.entries(res)) {
    console.log(`\n## ${g === 'all' ? 'All participants' : `Group ${g}`} (n = ${r.participants})\n\n| Task | Success | 95 % CI | Median time (s) | IQR (s) | Mean hints |\n|---|---|---|---|---|---|`);
    for (const t of r.tasks) console.log(`| ${t.task} | ${pct(t.success)} | ${pct(t.ci95[0])}–${pct(t.ci95[1])} | ${r1(t.medianSeconds)} | ${r1(t.iqrSeconds[0])}–${r1(t.iqrSeconds[1])} | ${r1(t.meanHints)} |`);
    console.log(`\nSUS: mean ${r1(r.sus.mean)} (SD ${r1(r.sus.sd)}, 95 % CI ${r1(r.sus.ci95[0])}–${r1(r.sus.ci95[1])}, n = ${r.sus.n}), "${r.sus.adjective}" (Bangor et al. 2009; average ≈ 68).`);
  }
}
