// Sample-sheet parsing, design specification and the studio-facing differential-expression call built on linear.ts.
import type { CountMatrix, DeParams, DeResult, DeRow } from './kernels';
import { buildDesign, contrastTest, factorContrasts, fitDesign, fTest, levelContrast, type Design, type Term } from './linear';

/* ---------------- sample sheet ---------------- */

export interface Sheet { columns: string[]; samples: string[]; values: string[][] /* [column][row], rows in sheet order */ }

const splitLine = (l: string, delim: string) => l.split(delim).map((x) => x.trim().replace(/^"|"$/g, ''));

/**
 * Reads a sample sheet: first column = sample name, every other column a variable. The first row is a header unless its
 * first cell is one of the count-matrix samples (then generic names group, batch, var4… are used).
 */
export function parseSheet(text: string, samples?: string[]): Sheet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { columns: [], samples: [], values: [] };
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map((l) => splitLine(l, delim));
  const header = samples ? !samples.includes(rows[0][0]) : true;
  const width = Math.max(...rows.map((r) => r.length));
  const columns = Array.from({ length: width - 1 }, (_, i) => (header && rows[0][i + 1]) || (['group', 'batch'][i] ?? `var${i + 2}`));
  const body = header ? rows.slice(1) : rows;
  return { columns, samples: body.map((r) => r[0]), values: columns.map((_, c) => body.map((r) => r[c + 1] ?? '')) };
}

/** Column values in the order of `samples`; throws naming the samples the sheet does not describe. */
export function alignColumn(sheet: Sheet, column: string, samples: string[]): string[] {
  const c = sheet.columns.indexOf(column);
  if (c < 0) throw new Error(`The sample sheet has no column “${column}”.`);
  const map = new Map(sheet.samples.map((s, i) => [s, sheet.values[c][i]]));
  const out = samples.map((s) => map.get(s) ?? '');
  const miss = samples.filter((_, i) => !out[i]);
  if (miss.length) throw new Error(`Column “${column}” has no value for: ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? '…' : ''}`);
  return out;
}

/* ---------------- design specification ---------------- */

export interface VarSpec { name: string; use: boolean; kind: 'factor' | 'numeric'; reference?: string }
export type TestSpec =
  | { kind: 'pair'; factor: string; a: string; b: string }
  | { kind: 'anova'; factor: string }
  | { kind: 'slope'; variable: string };

const isNum = (v: string) => v !== '' && Number.isFinite(Number(v));
export const levelsOf = (sheet: Sheet, name: string) => [...new Set(sheet.values[sheet.columns.indexOf(name)] ?? [])].filter(Boolean);

/**
 * Sensible starting design: numeric columns with more than two distinct values become covariates; other columns
 * become factors. A column with one level, or a different value for every sample (an ID), is left out.
 */
export function guessSpecs(sheet: Sheet): VarSpec[] {
  return sheet.columns.map((name, c) => {
    const v = sheet.values[c].filter(Boolean), lv = new Set(v);
    const kind = v.length && v.every(isNum) && lv.size > 2 ? 'numeric' : 'factor';
    const use = v.length === sheet.samples.length && lv.size > 1 && (kind === 'numeric' || lv.size < v.length);
    return { name, use, kind, reference: kind === 'factor' ? [...lv][0] : undefined };
  });
}

/**
 * What to test by default: a used factor called group/condition/treatment/genotype, else the factor with the fewest
 * levels (a donor or batch column usually has more levels than the treatment it is paired with).
 */
export function defaultTest(sheet: Sheet, specs: VarSpec[]): TestSpec | null {
  const fs = specs.filter((s) => s.use && s.kind === 'factor');
  const f = fs.find((s) => /^(group|condition|treatment|genotype)$/i.test(s.name)) ?? [...fs].sort((a, b) => levelsOf(sheet, a.name).length - levelsOf(sheet, b.name).length)[0];
  if (f) { const lv = levelsOf(sheet, f.name), a = f.reference && lv.includes(f.reference) ? f.reference : lv[0]; return { kind: 'pair', factor: f.name, a, b: lv.find((x) => x !== a) ?? a }; }
  const n = specs.find((s) => s.use && s.kind === 'numeric');
  return n ? { kind: 'slope', variable: n.name } : null;
}

export const formula = (specs: VarSpec[]) => '~ ' + (specs.filter((s) => s.use).map((s) => s.name).join(' + ') || '1');

export function termsFor(sheet: Sheet, specs: VarSpec[], samples: string[]): Term[] {
  return specs.filter((s) => s.use).map((s) => ({ name: s.name, kind: s.kind, values: alignColumn(sheet, s.name, samples), reference: s.reference }));
}

/** Checks the design without data: returns the design or a readable problem. */
export function checkDesign(sheet: Sheet, specs: VarSpec[], test: TestSpec | null, samples = sheet.samples): { design?: Design; error?: string } {
  try {
    if (!test) throw new Error('Choose what to test.');
    const used = specs.filter((s) => s.use);
    const target = test.kind === 'slope' ? test.variable : test.factor;
    const ts = used.find((s) => s.name === target);
    if (!ts) throw new Error(`“${target}” must be in the design to be tested.`);
    if (test.kind === 'slope' && ts.kind !== 'numeric') throw new Error(`“${target}” is a factor; compare two of its levels instead.`);
    if (test.kind !== 'slope' && ts.kind !== 'factor') throw new Error(`“${target}” is numeric; test its slope instead.`);
    if (test.kind === 'pair' && test.a === test.b) throw new Error('Choose two different levels to compare.');
    if (test.kind === 'anova' && levelsOf(sheet, target).length < 3) throw new Error(`“${target}” has only two levels; compare them directly.`);
    return { design: buildDesign(termsFor(sheet, specs, samples), samples.length) };
  } catch (e) { return { error: (e as Error).message }; }
}

/* ---------------- one call for the worker ---------------- */

export interface DesignRun { specs: VarSpec[]; test: TestSpec; minCpm: number; minSamples: number; useVoom: boolean; fdr: number; lfc: number }
export interface StudioDe extends DeResult {
  label: string; mode: TestSpec['kind']; formula: string; columns: string[]; residualDf: number; voom: boolean;
  normFactors: number[]; trend?: { x: number[]; y: number[] }; levelNames?: string[];
}

export function testLabel(t: TestSpec): string {
  return t.kind === 'pair' ? `${t.b} vs ${t.a}` : t.kind === 'anova' ? `any difference between ${t.factor} levels` : `change per unit of ${t.variable}`;
}

/**
 * Fits the design (TMM, optional voom, weighted least squares, empirical Bayes) and runs the chosen test.
 * Rows are sorted by p-value. For an F-test, log2FC is the largest-magnitude difference from the reference level and
 * `t` holds the F statistic; per-level differences are in `lfcs`.
 */
export function designDe(m: CountMatrix, sheet: Sheet, r: DesignRun): StudioDe {
  const chk = checkDesign(sheet, r.specs, r.test, m.samples);
  if (chk.error) throw new Error(chk.error);
  const res = fitDesign(m, { terms: termsFor(sheet, r.specs, m.samples), minCpm: r.minCpm, minSamples: r.minSamples, useVoom: r.useVoom, fdr: r.fdr, lfc: r.lfc });
  const { design, fit, eb } = res, t = r.test;
  let rows: DeRow[], levelNames: string[] | undefined;
  if (t.kind === 'anova') {
    const term = design.terms.find((x) => x.name === t.factor)!;
    levelNames = term.levels!.slice(1).map((l) => `${l} vs ${term.reference}`);
    rows = fTest(fit, eb, factorContrasts(design, t.factor), { fdr: r.fdr }).map((f) => {
      const big = f.logFC.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
      const sig = f.sig && f.logFC.some((x) => Math.abs(x) >= r.lfc);
      return { gene: f.gene, log2FC: big, avgExpr: f.avgExpr, t: f.F, p: f.p, fdr: f.fdr, sig: sig ? (big > 0 ? 'up' : 'down') : 'ns', lfcs: f.logFC };
    });
  } else {
    const c = t.kind === 'pair' ? levelContrast(design, t.factor, t.a, t.b) : (() => { const v = new Array(design.columns.length).fill(0); v[design.terms.find((x) => x.name === t.variable)!.columns[0]] = 1; return v; })();
    rows = contrastTest(fit, eb, c, { fdr: r.fdr, lfc: r.lfc }).map((x) => ({ gene: x.gene, log2FC: x.logFC, avgExpr: x.avgExpr, t: x.t, p: x.p, fdr: x.fdr, sig: x.sig }));
  }
  rows.sort((a, b) => a.p - b.p);
  const params: DeParams = { groupA: t.kind === 'pair' ? t.a : '', groupB: t.kind === 'pair' ? t.b : '', minCpm: r.minCpm, minSamples: r.minSamples, lfcThreshold: r.lfc, fdr: r.fdr };
  return {
    rows, tested: res.kept, filteredOut: res.filtered, priorDf: eb.d0, priorVar: eb.s02, params,
    nUp: rows.filter((x) => x.sig === 'up').length, nDown: rows.filter((x) => x.sig === 'down').length,
    label: testLabel(t), mode: t.kind, formula: formula(r.specs), columns: design.columns, residualDf: fit.df, voom: r.useVoom,
    normFactors: res.normFactors, trend: res.trend, levelNames,
  };
}

/* ---------------- synthetic demo: three groups, paired donors ---------------- */

/**
 * Twelve samples: four donors each given control, drugA and drugB. Donors differ strongly per gene (so pairing matters);
 * genes 1–200 respond to drugA, genes 151–350 to drugB. `truth` is the drugA-vs-control set.
 */
export function syntheticPairedExperiment(seed = 21, nGenes = 3000) {
  let s = seed >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const poisson = (l: number): number => { if (l > 50) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss())); const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
  const donors = ['d1', 'd2', 'd3', 'd4'], arms = ['control', 'drugA', 'drugB'];
  const cols = donors.flatMap((d) => arms.map((a) => ({ d, a, name: `${d}_${a}` })));
  const depth = cols.map(() => 0.8 + rnd() * 0.5), genes: string[] = [], lines: string[] = ['gene,' + cols.map((c) => c.name).join(',')];
  for (let g = 0; g < nGenes; g++) {
    const name = `GENE${String(g + 1).padStart(4, '0')}`; genes.push(name);
    const base = Math.exp(2.5 + 3 * rnd()), don = donors.map(() => 0.8 * gauss());
    const eA = g < 200 ? (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd()) : 0, eB = g >= 150 && g < 350 ? (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd()) : 0;
    lines.push(name + ',' + cols.map((c, j) => poisson(base * depth[j] * 2 ** (don[donors.indexOf(c.d)] + (c.a === 'drugA' ? eA : c.a === 'drugB' ? eB : 0) + 0.25 * gauss()))).join(','));
  }
  const sheet = 'sample,treatment,donor\n' + cols.map((c) => `${c.name},${c.a},${c.d}`).join('\n');
  return { csv: lines.join('\n'), sheet, truth: new Set(genes.slice(0, 200)) };
}
