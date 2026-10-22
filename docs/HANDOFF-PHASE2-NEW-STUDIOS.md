# HANDOFF PHASE 2: build nine new Workbench studios, three Lab Studio additions and five free tool pages

Written 2026-10-22 by Claude (Sonnet 5.5) for a less capable model.
**Read this whole file first. Then do the items in order. Do not improvise. Do not skip the tests.**

Copies of this file: `/run/media/aji/1-TB/company-webpage/docs/HANDOFF-PHASE2-NEW-STUDIOS.md` and
`/run/media/aji/1-TB/nayancode/docs/HANDOFF-PHASE2-NEW-STUDIOS.md`.
Progress log you must keep: `docs/HANDOFF-PHASE2-PROGRESS-LOG.md` (same two places).

---

## 0. YOUR PROMPT

You are continuing the Solagene / Nayancode project. Phase 1 (13 tools) is finished and committed. Your job is Phase 2:
build the items in section 5, **in the order given**, in the Nayancode repo, then sync into the Solagene website (item 12).
Everything must run **inside the visitor's browser** and be hostable for **free on Cloudflare static hosting**. No servers, no databases,
no paid APIs, no logins.

### Hard rules (breaking any of these is a failure)
1. **Only do what this file says.** Do not refactor, rename, reformat or "improve" anything else. Do not edit existing studios except where an item says so.
   Never edit these: `src/studios/docking/**`, existing tests (except to *add* lines where told), `wrangler.jsonc`, `public/_headers`.
2. **No stubs.** A button that does not compute, a tab that says "coming soon", or a number that is hard-coded is a failure. (Last time one tool was shipped as a stub and had to be redone.)
   If you cannot finish something, mark it **PARTIAL** in the log, say exactly what is missing, and do not claim it works.
3. **Every algorithm needs a known-answer test**: a published value, a value computed independently with numpy/scipy/RDKit in Python, an analytic formula, or a simulation with planted truth.
   If a test fails, **do not weaken it and do not change the expected numbers to match your output** unless you have proven (with an independent calculation) that the expected number was wrong; write that proof in the log.
4. **Honest UI.** Each tool shows its limits in a visible note (each item says what to write).
5. **One item = one commit**, made only when that item's unit tests, `npx tsc --noEmit`, and its e2e test pass.
6. **Do not push, deploy, or open pull requests.** Local commits only.
7. **Run only the tests for the item you are working on.** Run the full suites once at the end (section 7, "FINAL CHECK").
8. **Do not install packages.** Everything you need is already in `node_modules`.
9. **File-size rule for hosting:** no file you add to `public/` or that ends up in `dist/` may be larger than **20 MiB**. After every build run
   `find dist -type f -size +20M` — it must print nothing. Cloudflare rejects files over 25 MiB.
10. **Licences:** write code yourself from the formulas given. Do not copy code from GPL projects or paste big pieces from the internet. Data you download must be public domain or permissively licensed (each item says which).
11. In every shell command start with `cd` to the repo (the shell forgets its directory). The "zoxide" banner in the output is harmless; ignore it.
12. Temporary files go in `/tmp/claude-1000/-run-media-aji-1-TB-company-webpage/e2520647-3200-4079-b272-84ee9b1f83a1/scratchpad/` (never inside the repos).
13. After every item, and whenever you stop, **update the progress log** (section 3).

### Commit identity (exactly this)
```bash
cd /run/media/aji/1-TB/nayancode && git add -A && git -c user.name=balajimadhvn -c user.email=maivannanrangan@gmail.com commit -q -m "MESSAGE

Co-Authored-By: Claude <noreply@anthropic.com>"
```
Work on a **new branch** in nayancode first: `cd /run/media/aji/1-TB/nayancode && git checkout -b feature/phase2-studios` (branch from the current `feature/more-tools`).

---

## 1. WHERE EVERYTHING IS

| What | Path |
|---|---|
| Source of truth (do all studio work here) | `/run/media/aji/1-TB/nayancode` |
| Website (gets a *copy* via the sync script; has a few of its own files) | `/run/media/aji/1-TB/company-webpage` |
| Sync script | `company-webpage/scripts/sync-workbench.mjs` |
| Old handoff files (for style) | `docs/HANDOFF-REMAINING-WORKBENCH-TOOLS.md`, `docs/HANDOFF-PROGRESS-LOG.md` |

Tools: Node 22, vitest, playwright, Python 3 with numpy, scipy, scikit-learn, **RDKit**. **R is not installed. statsmodels is not installed.** Internet works (curl).

### Standard commands
```bash
cd /run/media/aji/1-TB/nayancode && npx tsc --noEmit                                  # must print only the zoxide banner
cd /run/media/aji/1-TB/nayancode && npx vitest run src/studios/<folder>               # tests for one folder
cd /run/media/aji/1-TB/nayancode && npm run build 2>&1 | grep -E "error|built in"    # build (needed before e2e)
cd /run/media/aji/1-TB/nayancode && find dist -type f -size +20M                      # must print nothing
cd /run/media/aji/1-TB/nayancode && npx playwright test e2e/studios.spec.ts -g "<test name part>"
```

---

## 2. HOW TO ADD A NEW STUDIO (use this checklist for every "new studio" item)

A studio has an **id** (letters only, e.g. `plasmid`), a **path** (lower-case letters and hyphens only, e.g. `/plasmid`; the route script reads it with the regex `path: '(\/[a-z-]+)'`), a **name**, and a folder `src/studios/<id>/`.

Do these steps **in order** for each new studio, in `/run/media/aji/1-TB/nayancode`:

1. **`src/core/studios.ts`**: add a new object at the end of the `STUDIOS` array (before `];`), copying the shape of the `lab` entry. Fields:
   `id, path, name, short, blurb, status: 'live', milestone: 'M1', accent: <hue 0-360 not used by another studio>, inputs: [...], analyses: [...], engines: '...', limits: '...', cloudLater: ''`.
   Keep `name` short (the website builds page titles from it and a unit test limits title length to 66 characters).
2. **`src/ui/Icons.tsx`**: add the studio to the `StudioIcon` map (the line that reads `phylo: Icon.Phylo, genome: Icon.Genome, ... lab: Icon.Flask,`). Reuse an existing icon (`Icon.Flask`, `Icon.Cpu`, `Icon.Doc`, `Icon.Spark`, `Icon.Genome`, …). Do not draw a new one.
3. **`src/App.tsx`**: add one line to the `live` object: `<id>: lazyRetry(() => import('@/studios/<id>/<Name>Studio')),`. The studio component must be the **default export** of that file and take no props.
4. Create `src/studios/<id>/<Name>Studio.tsx`. Copy the layout of `src/studios/lab/LabStudio.tsx` (a `page-head` with `<h1>Name Studio</h1><p>…</p>`, then `Tabs`). Each tab is a lazy component in its own file.
5. **`e2e/studios.spec.ts`**: in the `ROUTES` array near the top add `['<path-without-slash>', /<Name> Studio/]`.
6. Add the tab components, kernels and tests (the item tells you what).
7. `npx tsc --noEmit`, unit tests, `npm run build`, e2e for the studio, `find dist -type f -size +20M`.
8. Commit.

(`scripts/routes.mjs` and the Overview page and the sidebar read `STUDIOS` automatically. You do not edit them.)
The **website** has its own `src/App.tsx`; that is edited later, in item 12, not now.

### Patterns to copy (open these files before writing code)
- Kernel + known-answer test: `src/studios/lab/survival.ts` + `survival.test.ts`.
- Kernel in a worker: `src/studios/chemistry/moltools.worker.ts` and `MolToolsView.tsx` (`createRemote` from `@/compute/rpc`, `exposeKernels`, `useRunner` from `@/ui/useRunner`).
- Lazy tab: `src/studios/lab/LabStudio.tsx` (how `Survival` is lazy-imported and shown inside `<Suspense>`).
- UI kit: `Card, Field, Stat, DataTable, Callout, Busy, Tabs, FileDrop, downloadText, toCsv, fmt, sci` from `@/ui/kit`. Charts: `CurvePlot, Scatter, Histogram, BarChart, cssVar` from `@/viz/charts` (they include an "Export figure" button).
- Every `run(...)` call: `{ label, tool, params, inputs: [{ name, data: <string> }], run, summary? }` (see `src/studios/lab/Survival.tsx`). `inputs[].data` must be a string.
- Citation keys: add a line to the `CITATIONS` object in `src/core/provenance.ts` for each new reference (one line each). A tool's `citations: ['key', …]` must use keys that exist.
- A tool info object: `{ id, name, version: '0.1.0', engine, citations, describe: (p) => 'sentence for the methods section' }`.

### Existing helpers you may IMPORT (do not copy-paste them)
| Need | Import |
|---|---|
| p-values and quantiles (`pnorm, qnorm, pt, qt, pf, pchisq, qchisq, gammaP, gammaQ, lgamma`) | `@/studios/lab/dist` (file `src/studios/lab/dist.ts`) |
| 4-parameter logistic and Levenberg–Marquardt fitting | `src/studios/lab/doseResponse.ts` (read its exports first: `grep -n "^export" src/studios/lab/doseResponse.ts`) |
| Exact Hardy–Weinberg test `hweExact`, `r2` (LD), `ldPrune`, `genotypePcs`, `lambdaGc` | `src/studios/variants/assoc.ts` |
| k-mer iteration `forEachKmer(seq, k, cb)` (canonical k-mers, k ≤ 25) | `src/studios/expression/pseudoalign.ts` |
| FASTA parsing `parseFasta`, protein properties `proteinProps`, peptide masses | `src/studios/sequence/kernels.ts`, `src/studios/sequence/proteomics.ts` (`peptideMass`, `MONO`, `WATER`, `PROTON`, `mz`) |
| Pairwise alignment `align(a, b, { mode: 'global'\|'local', kind: 'dna'\|'protein' })` | `src/studios/sequence/kernels.ts` |
| Structure parsing and superposition (Kabsch/RMSD) | `src/studios/structure/geometry.ts` (run `grep -n "^export" src/studios/structure/geometry.ts`), `src/studios/structure/netmodes.ts` |
| Moderated t-test, normalisation and DE | `src/studios/expression/kernels.ts`, `linear.ts` (run `grep -n "^export" …` to find names) |
| Louvain communities | `louvain` in `src/studios/singlecell/kernels.ts` |
| Streaming FASTQ/FASTA reader | `src/core/readstream.ts` (`readSequences`) |
| Figure engine (SVG/PDF/PNG) | `src/viz/figure.ts` (`Scene`, `FigureOptions`, `buildCurves`, `buildBars`, …) and `src/viz/FigureExport.tsx` (`ExportBar`) |

---

## 3. PROGRESS LOG (mandatory)

Create **`/run/media/aji/1-TB/company-webpage/docs/HANDOFF-PHASE2-PROGRESS-LOG.md`** (a starting version already exists) and keep it updated. After each item, append:
```
## Item <n> <name> — DONE | PARTIAL | NOT STARTED   (date, time)
- files created/changed:
- tests added and result (pass/fail counts):
- e2e test name and result:
- commit hash (or "uncommitted"):
- what is left / problems / decisions for the owner:
```
Never write DONE unless unit tests, type check, build and the e2e all passed. At the very end copy the log to `/run/media/aji/1-TB/nayancode/docs/`.

---

## 4. ORDER OF WORK

| # | Item | Kind |
|---|---|---|
| 1 | Lab Studio additions: enzyme kinetics, plate reader / ELISA, growth curves | extend existing studio |
| 2 | **Statistics & Meta-analysis Studio** (`stats`) | new studio |
| 3 | **Plasmid & Construct Studio** (`plasmid`) | new studio |
| 4 | **Antibody & Biologics Developability Studio** (`biologics`) | new studio |
| 5 | **PK / PD Studio** (`pk`) | new studio |
| 6 | **MD & Trajectory Analysis Studio** (`trajectory`) | new studio |
| 7 | **Peptide Studio** (`peptide`) | new studio |
| 8 | **Population Genetics Studio** (`popgen`) | new studio |
| 9 | **Proteomics & Metabolomics Quant Studio** (`omicsquant`) | new studio |
| 10 | **AMR / Bacterial Genomics Studio** (`amr`) | new studio |
| 11 | Five free tool pages for the website | website |
| 12 | Website integration, product pages, copy updates, final checks | website |

Do items 1 → 12 in this order. Item 1 is first because it extends a studio that already exists (easier). If an item blocks you for more than a reasonable effort, log it as PARTIAL/NOT STARTED and **continue with the next item**.

---

## 5. THE ITEMS

### ITEM 1: Lab Studio additions (existing studio `src/studios/lab/`)

Add **three tabs** to `LabStudio.tsx` exactly like the `Survival` tab was added (lazy component file, new id in `type Tab`, entry in `Tabs items`, a line that renders it inside `<Suspense>`): `Enzyme kinetics` (id `kinetics`), `Plate reader` (id `plate`), `Growth curves` (id `growth`). Update the studio description sentence in the `<p>` to mention them. Update the `analyses` list of `lab` in `src/core/studios.ts` with three short entries.

**Shared fitter.** First read `src/studios/lab/doseResponse.ts`. If it exports a general Levenberg–Marquardt routine that takes a model function, use it. If not, create `src/studios/lab/nls.ts` with:
`export function fitNls(model: (x: number[], p: number[]) => number, x: number[][], y: number[], p0: number[], opt?: { lower?: number[]; upper?: number[]; maxIter?: number }): { p: number[]; se: number[]; ci95: [number, number][]; rss: number; r2: number; df: number; converged: boolean }`
using a numerical Jacobian (central differences), damping that is increased when a step does not reduce the residual and decreased when it does, covariance `s² (JᵀJ)⁻¹` with `s² = rss/(n−p)`, and 95 % intervals `p ± qt(0.975, n−p)·se` (`qt` from `lab/dist.ts`).
Add `nls.test.ts`: fit `y = a·exp(−b·x)` to noise-free data (a=3, b=0.5, x=0..10) and require `|a−3| < 1e-6`, `|b−0.5| < 1e-6`; and a noisy dataset compared with scipy (see below).

**1a. Enzyme kinetics (`kinetics.ts`, `Kinetics.tsx`)**
Models (v = rate, S = substrate, I = inhibitor):
- Michaelis–Menten: `v = Vmax·S/(Km+S)`
- Substrate inhibition: `v = Vmax·S/(Km + S·(1+S/Ksi))`
- Hill: `v = Vmax·S^n/(K^n + S^n)`
- Competitive: `v = Vmax·S/(Km·(1+I/Ki) + S)`
- Non-competitive: `v = Vmax·S/((Km+S)·(1+I/Ki))`
- Uncompetitive: `v = Vmax·S/(Km + S·(1+I/Ki))`
- Mixed: `v = Vmax·S/(Km·(1+I/Ki) + S·(1+I/(α·Ki)))`
Fits: single data set (S, v) for MM/substrate-inhibition/Hill; **global fit** across several inhibitor concentrations for the four inhibition models (columns S, I, v), with an AIC comparison table to suggest the best inhibition type. Also compute (display only) the Lineweaver–Burk, Eadie–Hofstee and Hanes–Woolf linearisations with a note "linear transforms distort errors; the non-linear fit above is preferred". Output kcat when the user supplies enzyme concentration (`kcat = Vmax/[E]`) and `kcat/Km`.
**Tests (`kinetics.test.ts`):**
1. Noise-free MM data (Vmax=100, Km=5, S = 0.5,1,2,5,10,20,50) → parameters recovered to `1e-6`.
2. Write `benchmarks/lab/make-kinetics-reference.py` (numpy seed 7, MM with Vmax=50, Km=3, 5 % multiplicative noise at S = 0.3,0.6,1,2,4,8,16,32) that uses `scipy.optimize.curve_fit` and writes `kinetics-reference.json` with `S`, `v`, `Vmax`, `Km`, and their standard errors. Test: your Vmax, Km agree to relative `1e-4` and SE to `1e-3`.
3. Global competitive data generated without noise (Vmax=80, Km=4, Ki=2, I ∈ {0,1,3}) → recovers Ki to `1e-5`, and the AIC choice picks *competitive* over *uncompetitive*.
4. Hill data (n=2.5) recovers n to `1e-5`.
UI note: "Initial-rate data only. Check that substrate depletion is below 10 % and that rates are linear in time."

**1b. Plate reader / ELISA (`plate.ts`, `Plate.tsx`)**
Input: a plate as 8×12 (or 16×24) CSV of absorbances + a layout CSV (same shape) containing labels: `blank`, `std:<concentration>`, `unk:<name>[:<dilution>]`. Steps: subtract mean blank; group replicates (mean, SD, CV %); fit the standard curve (default 4PL using the existing fitter in `doseResponse.ts`; also offer linear and 5PL if the existing code has it); back-calculate unknown concentrations (`x = C·((A−D)/(y−D) − 1)^(1/B)` style inversion for 4PL, with the parameter names of the existing fitter) multiplied by the dilution; flag unknowns outside the standard range (extrapolation); LOD = mean(blank) + 3·SD(blank) and LOQ = + 10·SD in concentration units; CSV download of results.
**Tests:** standards generated from a 4PL with known parameters (no noise) → back-calculation of a value at y = the curve value at x=12.5 returns 12.5 within `1e-6`; replicate CV computed for `[1.0, 1.1, 0.9]` = `10 %` (sample SD 0.1 / mean 1.0); an out-of-range absorbance is flagged; layout and plate dimension mismatch gives a clear error message.

**1c. Growth curves (`growth.ts`, `Growth.tsx`)**
Input CSV: time, then one column per well/strain (OD). Subtract blank option. Fit **modified Gompertz** and **logistic** (Zwietering et al. 1990) on `y = ln(OD/OD0)`:
- Gompertz: `y = A·exp(−exp(μ·e/A·(λ − t) + 1))`
- Logistic: `y = A/(1 + exp(4·μ/A·(λ − t) + 2))`
with μ = maximum specific growth rate, λ = lag, A = asymptote. Also model-free μmax by regressing `ln(OD)` over a sliding window of 4 points and taking the maximum slope (report the window). Doubling time = ln 2/μ. Choose the better model per curve by AIC.
**Tests:** noise-free Gompertz with (A=2.5, μ=0.6, λ=1.5) over t=0..24 step 0.5 → recovered to `1e-3`; same for logistic; the sliding-window μmax of a pure exponential `OD = 0.05·exp(0.4 t)` equals `0.4` within `1e-9`; a flat line gives μ ≈ 0 and a warning "no growth detected".
**e2e (one test for the item):** open `/lab`, click each of the three tabs, click each tab's demo button, expect a result text (`Vmax`, `Standard curve`, `Doubling time`). Add a "Load demo" button in each tab that fills the inputs with generated data.
**Citations:** add `michaelis1913`, `cleland1963`, `zwietering1990`. **Commit:** `Lab Studio: enzyme kinetics, plate reader / ELISA and growth-curve fitting`.

---

### ITEM 2: Statistics & Meta-analysis Studio (`stats`, path `/statistics`, name "Statistics Studio")

Follow section 2. Tabs: `Compare groups`, `Relationships`, `Categorical`, `Multiple testing`, `Meta-analysis`. All kernels are plain TypeScript in `src/studios/stats/`.

**Files:** `tests.ts`, `tests.test.ts`, `meta.ts`, `meta.test.ts`, one tab component per tab, `StatsStudio.tsx`; builders `buildForest` and `buildFunnel` appended to `src/viz/figure.ts` with tests added to `src/viz/figure.test.ts`.

**2a. Classical tests (`tests.ts`)**, using `lab/dist.ts` for distributions. Implement and export:
- `welchT(a, b)`, `studentT(a, b)`, `pairedT(a, b)`, `oneSampleT(a, mu)` → `{ t, df, p, meanDiff, ci95: [lo, hi] }` (two-sided).
- `oneWayAnova(groups)` → `{ F, df1, df2, p, etaSquared }`; `leveneMedian(groups)` (Brown–Forsythe: ANOVA on absolute deviations from the group **median**).
- `mannWhitney(a, b)` → U, z, p with tie correction and continuity correction (normal approximation, two-sided), and `wilcoxonSignedRank(a, b)` (differences, drop zeros, average ranks for ties, normal approximation with tie and continuity correction), `kruskalWallis(groups)` (tie-corrected H, χ² p).
- `chiSquare(table)` (r×c, Pearson, plus Yates 2×2), `fisherExact(a, b, c, d)` (two-sided p = sum of probabilities ≤ the observed probability, hypergeometric, computed in log space with `lgamma`), `oddsRatio2x2` with a log-scale Wald 95 % CI.
- `pearson(x, y)` (r, t, df, p, Fisher-z 95 % CI), `spearman(x, y)` (average ranks, then Pearson on ranks, t-based p), `linearRegression(x, y)` → slope, intercept, SEs, t, p, R², adjusted R², F, 95 % CI of slope.
- `holm(p)`, `bonferroni(p)`, `benjaminiHochberg(p)` (monotone adjusted p-values, returned in the original order).
- `shapiroWilk` is **not** required. Do not implement Tukey HSD. For post-hoc use pairwise Welch t-tests with Holm adjustment and say so in the UI.
**Reference script `benchmarks/stats/make-reference.py`** (numpy seed 11; write `reference.json`): create fixed datasets (two samples n=12 and n=15 with different variances, a paired set of 10, three groups of sizes 8/9/10, a 2×3 table `[[12,5,7],[8,9,15]]`, a 2×2 table `[[7,3],[2,9]]`, an x/y set of 20) and compute with scipy: `ttest_ind(equal_var=False)`, `ttest_ind(equal_var=True)`, `ttest_rel`, `f_oneway`, `levene(center='median')`, `mannwhitneyu(method='asymptotic', use_continuity=True)`, `wilcoxon(method='approx', correction=True, zero_method='wilcox')`, `kruskal`, `chi2_contingency(correction=False)` and the 2×2 with `correction=True`, `fisher_exact`, `pearsonr`, `spearmanr`, `linregress`; plus Holm, Bonferroni and BH written by hand in Python (for `p = [0.001,0.008,0.039,0.041,0.042,0.06,0.074,0.205,0.212,0.216]`: BH-adjusted must be non-decreasing in sorted order and ≤ 1).
**Tests:** each statistic and p-value equals the scipy value (relative error `< 1e-6` for statistics, `< 1e-5` for p-values). Add: Fisher exact for `[[3,1],[1,3]]` two-sided p = `0.4857142857…` (exact: 34/70); Mann–Whitney of two identical samples gives p = 1.

**2b. Meta-analysis (`meta.ts`)** — export:
- Effect-size builders returning `{ yi, vi }` per study: `logOddsRatio(a, b, c, d)` (a/b = events/non-events in treated, c/d in control; `yi = ln((a·d)/(b·c))`, `vi = 1/a+1/b+1/c+1/d`; add 0.5 to all cells of any study with a zero cell and say so), `logRiskRatio` (`yi = ln((a/(a+b))/(c/(c+d)))`, `vi = 1/a − 1/(a+b) + 1/c − 1/(c+d)`), `riskDifference`, `hedgesG(m1, sd1, n1, m2, sd2, n2)` (pooled SD, small-sample correction `J = 1 − 3/(4(n1+n2−2)−1)`, `vi = (n1+n2)/(n1·n2) + g²/(2(n1+n2))`), and a generic `{yi, vi}` input.
- `metaAnalysis(yi, vi, method: 'FE' | 'DL' | 'REML' | 'PM')` returning `{ estimate, se, z, p, ci95, tau2, I2, H2, Q, Qdf, Qp, k, weights, predictionInterval }`.
  Fixed effect: `w=1/vi`. Heterogeneity `Q = Σ w (yi − θFE)²`. DerSimonian–Laird `τ² = max(0, (Q − (k−1)) / (Σw − Σw²/Σw))`. REML: solve for τ² maximising the restricted likelihood `−½[Σ ln(vi+τ²) + ln Σ w* + Σ w*(yi−μ)²]` with `w*=1/(vi+τ²)`; use Fisher scoring or a bracketed 1-D search on τ² ∈ [0, max(10·var(yi), 1)] to tolerance `1e-10`. Paule–Mandel: τ² such that `Σ w*(yi − μ)² = k−1`. `I² = max(0, (Q−(k−1))/Q)·100`, `H² = Q/(k−1)`. Random-effects weights `1/(vi+τ²)`. 95 % CI and p from the **normal** distribution. Prediction interval `estimate ± t(0.975, k−2)·sqrt(τ² + se²)` (needs k ≥ 3).
- `eggerTest(yi, vi)` (regress `yi/se` on `1/se`; report the intercept, its t-test with k−2 df), `leaveOneOut(yi, vi, method)`, `subgroups(yi, vi, labels, method)` (per-group estimates and a between-group Q test with χ² on groups−1 df).
- Optional (skip if time is short and say so in the log): trim-and-fill (Duval & Tweedie 2000, L0 estimator).
**Known-answer test (BCG vaccine trials, Colditz et al. 1994; R `metafor::dat.bcg`).** Data (tpos, tneg, cpos, cneg), 13 trials:
`(4,119,11,128) (6,300,29,274) (3,228,11,209) (62,13536,248,12619) (33,5036,47,5761) (180,1361,372,1079) (8,2537,10,619) (505,87886,499,87892) (29,7470,45,7232) (17,1699,65,1600) (186,50448,141,27197) (5,2493,3,2338) (27,16886,29,17825)`
Using `logRiskRatio`, the results (computed independently in Python and equal to the `metafor` documentation) are:
`yi` = −0.8893, −1.5854, −1.3481, −1.4416, −0.2175, −0.7861, −1.6209, 0.0120, −0.4694, −1.3713, −0.3394, 0.4459, −0.0173 (4 decimals).
- Fixed effect: estimate **−0.43028516**, se **0.04049875**.
- Q = **152.233008**, df = 12, I² = **92.1173 %** (DL formula).
- DerSimonian–Laird: τ² = **0.30876026**, estimate **−0.71411722**, se **0.17874209**.
- REML: τ² = **0.31324326**, estimate **−0.71453234**, se **0.17978152**.
- Egger intercept = **−2.1120421**, p = **0.1887070** (two-sided, 11 df).
- REML prediction interval = **[−2.00838, 0.57931]**.
Tests must match these to `1e-6` (estimates, τ², Q) and `1e-4` (Egger p, prediction interval). Also: all-equal `yi` gives τ² = 0 and `I² = 0`; a single study throws "need at least 2 studies".
**Forest and funnel figures:** add to `src/viz/figure.ts`: `buildForest(spec: { labels: string[]; est: number[]; lo: number[]; hi: number[]; weight: number[]; pooled: { est: number; lo: number; hi: number; label: string }; xLabel: string; logScale?: boolean }, o: FigureOptions): Scene` (square markers sized by weight, horizontal CI lines, a diamond for the pooled effect, a vertical line at the null value 0 (or 1 on the log scale)) and `buildFunnel(spec: { yi: number[]; se: number[]; centre: number; xLabel: string }, o): Scene` (points, a vertical centre line and pseudo-95 % limits `centre ± 1.96·se`, y axis inverted so precise studies are on top). Read `buildBars`/`buildCurves` and copy how they create a `Scene`. Tests in `figure.test.ts`: forest scene contains one text label per study and one polygon (diamond); funnel y positions decrease as `se` increases; `sceneToSvg` and `sceneToPdf` work (PDF starts with `%PDF-1.4`). Display them with a small component that uses `ExportBar` (copy `Histogram` in `src/viz/charts.tsx`).

**2c. UI.** `Compare groups`: paste a two-column table (`group,value`) or wide columns; the studio checks normality visually (histogram) and offers the right test (2 groups → Welch/Mann–Whitney; ≥3 → ANOVA/Kruskal + Holm-adjusted pairwise Welch), shows effect sizes (Cohen's d, η²) and a box/dot summary using the existing `BarChart`/`Histogram`; `Relationships`: x,y columns → Pearson/Spearman/regression + scatter with the fit line (`Scatter`); `Categorical`: a contingency table editor → chi-square/Fisher + odds ratio; `Multiple testing`: paste p-values → Holm/Bonferroni/BH table; `Meta-analysis`: CSV with columns `study,a,b,c,d` or `study,m1,sd1,n1,m2,sd2,n2` or `study,yi,vi`, choose measure and method, shows the forest plot, funnel plot, heterogeneity statistics, leave-one-out, Egger. Each tab has a demo button (the meta-analysis demo is the BCG data). **Visible note on every tab:** "Check assumptions before trusting a p-value. Statistics Studio does not replace a statistician for a clinical or regulatory analysis."
**Citations:** `dersimonian1986`, `viechtbauer2005`, `egger1997`, `hedges1981`, `colditz1994`, `holm1979` (benjamini1995 exists). **e2e:** `/statistics`, Meta-analysis tab, demo, expect `−0.71` (use the text `0.71`) and `Forest plot`. **Commit:** `Statistics Studio: classical tests and meta-analysis (fixed, DL, REML, PM), forest and funnel plots`.

---

### ITEM 3: Plasmid & Construct Studio (`plasmid`, path `/plasmid`, name "Plasmid Studio")

Follow section 2. Tabs: `Map`, `Features`, `Restriction map`, `Primers & checks`.
**Fixture (public domain, NCBI):** `cd /run/media/aji/1-TB/nayancode && mkdir -p src/studios/plasmid/fixtures && curl -s "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=L09137.2&rettype=gb&retmode=text" -o src/studios/plasmid/fixtures/puc19.gb` (pUC19, 2,686 bp, circular). Open it and read how its `FEATURES` and `ORIGIN` sections look.
**Files:** `genbank.ts` (+ test), `annotate.ts` (+ test), `features-library.ts`, `PlasmidStudio.tsx`, tab components, and `buildPlasmidMap` in `src/viz/figure.ts`.

- `parseGenBank(text)` → `{ name, topology: 'circular'|'linear', seq (upper case, no spaces/numbers), features: { type, start, end (1-based inclusive), strand: 1|-1, label, qualifiers }[] }`. Handle `complement(a..b)`, `join(...)` (use the outer span and strand), `<`/`>` partial markers, qualifiers continued over several lines, and `ORIGIN` blocks. Also `toGenBank(plasmid)` writing a valid minimal file, and `parseFastaPlasmid`. Test: pUC19 length 2686, topology circular, sequence starts `TCGCGCGTTTCGGTGATGACGG`; round trip `parseGenBank(toGenBank(x))` keeps sequence and features.
- **Feature library** (`features-library.ts`): a list of `{ name, type, seq (DNA, 5'→3'), note }`.
  (i) Short standard elements, type them exactly: T7 promoter `TAATACGACTCACTATAGGG`; T3 promoter `AATTAACCCTCACTAAAGGG`; SP6 promoter `ATTTAGGTGACACTATAG`; M13 fwd (−20) primer `GTAAAACGACGGCCAGT`; M13 rev primer `CAGGAAACAGCTATGAC`; 6xHis tag `CACCACCACCACCACCAC`; FLAG tag `GACTACAAAGACGATGACGACAAG`; HA tag `TACCCATACGATGTTCCAGATTACGCT`; c-Myc tag `GAACAAAAACTCATCTCAGAAGAGGATCTG`; lac operator `AATTGTGAGCGGATAACAATT`.
  (ii) Three longer elements **sliced from the pUC19 fixture** (1-based inclusive coordinates; these were verified):
  - `AmpR` (β-lactamase CDS) = reverse complement of positions **1626..2486** (861 bp; translates to a protein that starts `MSIQHFRVALIPFFAAFCLPVFA` and ends `…LIKHW*`).
  - `lacZα` = reverse complement of positions **146..469** (324 bp; translates to a protein that starts `MTMITPSLHACRSTLEDPRVPSSNSLAVVLQRRDWENPGV`).
  - `pMB1 ori` = reverse complement of positions **867..1455** (589 bp).
  In the library test, check these three translations/lengths. In pUC19 the elements lie on the **minus** strand (that is why the reverse complement is stored; the library stores the 5'→3' sequence of the element and the annotator reports `strand = -1` when it matches the reverse complement of the plasmid).
- `annotate(seq, library, { minIdentity = 0.95, circular })` → features found on either strand: exact/near-exact matching of each library element. Algorithm: for library elements shorter than 40 nt require a **perfect match** (both strands); for longer elements use k-mer seeding with `forEachKmer` (k = 12) to find candidate positions on both strands, then verify with the existing `align(..., { mode: 'local', kind: 'dna' })` and keep hits with identity ≥ `minIdentity` and coverage ≥ 90 % of the element. For circular plasmids also search across the origin (search `seq + seq.slice(0, maxLen−1)`, drop duplicates). Remove hits fully contained in a larger hit of the same name.
- **Tests (`annotate.test.ts`):** annotate pUC19 with the library → finds `AmpR` on the **minus** strand overlapping positions 1626–2486 by ≥ 95 %, `lacZα` on the minus strand overlapping 146–469, `pMB1 ori` overlapping 867–1455; the T7 promoter is **not** reported (pUC19 has none; verified). Insert a T7 promoter + 6xHis tag into a copy of the sequence at a known position → both found at the right coordinates on the plus strand. A feature spanning the origin of a circular copy (rotate the sequence so AmpR crosses position 1) is still found.
- **Restriction map tab:** reuse `digest` and `ENZYMES` from `src/studios/sequence/kernels.ts`; show unique cutters (`singles`), cut positions on the map, fragment sizes. Test: pUC19 with `EcoRI` has exactly one site (GAATTC starting at position **396**); `HindIII` exactly one (AAGCTT starting at **447**); digest with both gives 2 fragments summing to 2686.
- **Primers & checks tab:** for a typed primer, show every binding site on both strands (exact, 3′ end must match ≥ 12 nt, up to 2 mismatches elsewhere) and Tm via `oligoTm` from `sequence/kernels.ts`.
- **Map figure:** add `buildPlasmidMap(spec: { name: string; length: number; features: { start: number; end: number; strand: 1 | -1; label: string; color: string }[]; sites: { pos: number; label: string }[] }, o: FigureOptions): Scene` to `figure.ts`: a circle with 12 o'clock = position 1 going clockwise, arrows for features (arrowhead in the strand direction, label outside with a short leader line), tick labels every 500 bp (or a sensible step), unique restriction sites as outer ticks with names, the plasmid name and length (`name (2,686 bp)`) in the centre. Wrap-around features must be drawn as one arc. Tests: scene has one arc/polygon per feature; the centre text contains `2,686 bp`; the SVG output contains each feature label; works for a feature that wraps the origin. Show it with `ExportBar`.
- **UI:** paste/drop GenBank or FASTA; "Load pUC19 demo"; edit feature list (rename/delete/add by coordinates); download GenBank and the map (SVG/PDF/PNG via the export bar). Visible note: "Automatic annotation covers only the standard elements in the built-in library; confirm important features by sequencing."
**Citations:** `yanisch1985` (Yanisch-Perron C, Vieira J, Messing J (1985) Improved M13 phage cloning vectors and host strains: nucleotide sequences of the M13mp18 and pUC19 vectors. Gene 33:103–119). **e2e:** `/plasmid` → demo → expect `2,686 bp` and `AmpR`. **Commit:** `Plasmid Studio: GenBank import, feature annotation, restriction map and circular map figure`.

---

### ITEM 4: Antibody & Biologics Developability Studio (`biologics`, path `/biologics`, name "Biologics Studio")

Follow section 2. Tabs: `Chains & CDRs`, `Developability`, `Compare`. Files in `src/studios/biologics/`: `cdr.ts`, `cdr.test.ts`, `liabilities.ts`, `liabilities.test.ts`, UI files.

**4a. CDR identification (`cdr.ts`).** Heuristic, rule-based, Kabat-style CDRs for VH and VL domains. Export `findCdrs(seq: string): { chain: 'H' | 'L' | null; cdr1: string; cdr2: string; cdr3: string; cdr1Pos: [number, number]; cdr2Pos: [number, number]; cdr3Pos: [number, number] }` (positions 1-based inclusive in the input) and an `error` string when `chain` is `null`. Clean the input first (upper case, letters only). **These exact rules were tested in Python on the four sequences below and reproduce the expected CDRs; implement them exactly:**
- **Heavy chain (VH).** Let `cys` = index of the first `C` in the sequence. Let `m1` = first match of `W[VIA]R` (its index is `w`). Let `j` = first match of `W[GA][QRKH]G`. If any of these is missing → not a heavy chain.
  - `CDR-H1` = `seq[cys+9 .. w)` (from 9 residues after the first Cys up to, not including, the `W` of `W[VIA]R`).
  - `CDR-H2` starts at `w+14`. Let `m2` = first match of `[RK][LIVFTA][TSIAN]` in the text that begins **15 residues after the H2 start** (i.e. in `seq[w+14+15 ..]`). `CDR-H2` = `seq[w+14 .. (w+14+15+m2.index))`.
  - `CDR-H3`: take the **last** match of `Y[YFH]C[A-Z]{1,2}` that ends before `j`; `CDR-H3` = text from the end of that match up to (not including) `j`.
- **Light chain (VL).** Let `m = ` first match of `[VIAL][TS]C` (L1 starts right after it), `w = ` the index of the first `W[YF]Q`, `j = ` first match of `F[GA][QGSAT]G`. If any is missing → not a light chain.
  - `CDR-L1` = `seq[(end of m) .. w)`.
  - `CDR-L2` = the 7 residues `seq[w+15 .. w+22)`.
  - `CDR-L3`: the **last** match of `[YF][YF]C` that ends before `j`; `CDR-L3` = text from its end up to `j`.
- Decide the chain: try heavy first; if its patterns are all found → `'H'`; else try light → `'L'`; else `chain: null` with the message `Not recognised as a VH or VL domain`. Run the heavy test only if the sequence contains `W[VIA]R` **and** `W[GA][QRKH]G` (otherwise a light chain could be mistaken for a heavy chain); run the light test only if it contains `W[YF]Q` **and** `F[GA][QGSAT]G`.
- A sequence that holds both a VH and a VL joined by a linker (scFv) is split first at a run of `G4S` repeats (`(GGGGS){2,}`) into two domains, each analysed separately.
**Known-answer tests** (Kabat CDRs of well-known therapeutics; sequences are public):
- Trastuzumab VH `EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS` → H1 `DTYIH`, H2 `RIYPTNGYTRYADSVKG`, H3 `WGGDGFYAMDY`.
- Trastuzumab VL `DIQMTQSPSSLSASVGDRVTITCRASQDVNTAVAWYQQKPGKAPKLLIYSASFLYSGVPSRFSGSRSGTDFTLTISSLQPEDFATYYCQQHYTTPPTFGQGTKVEIK` → L1 `RASQDVNTAVA`, L2 `SASFLYS`, L3 `QQHYTTPPT`.
- Adalimumab VH `EVQLVESGGGLVQPGRSLRLSCAASGFTFDDYAMHWVRQAPGKGLEWVSAITWNSGHIDYADSVEGRFTISRDNAKNSLYLQMNSLRAEDTAVYYCAKVSYLSTASSLDYWGQGTLVTVSS` → H1 `DYAMH`, H2 `AITWNSGHIDYADSVEG`, H3 `VSYLSTASSLDY`.
- Adalimumab VL `DIQMTQSPSSLSASVGDRVTITCRASQGIRNYLAWYQQKPGKAPKLLIYAASTLQSGVPSRFSGSGSGTDFTLTISSLQPEDVATYYCQRYNRAPYTFGQGTKVEIK` → L1 `RASQGIRNYLA`, L2 `AASTLQS`, L3 `QRYNRAPYT`.
All four sequences must give exactly these CDRs; a random protein gives `chain: null`. If your rule set cannot reproduce all four, **adjust the rules** (not the expected strings) until it does; if you cannot, log PARTIAL.

**4b. Developability (`liabilities.ts`).** For a full antibody sequence (or CDR/Fv):
- Sequence liabilities with positions, flagged `in CDR` or `framework`: N-glycosylation `N[^P][ST]` (sequon); deamidation `N[GSTN]` (high risk `NG`); isomerisation `D[GSTDH]` (high risk `DG`, `DS`); oxidation `M`, `W` (exposed unknown: mark CDR ones as higher risk); free cysteine (odd number of `C` in the Fv, or `C` in CDR); acid-labile `DP`; fragmentation `D[P]`; integrin-binding `RGD`; a "NXS/T with X=P" excluded as above.
- Global properties: length, MW (`proteinProps` from `sequence/kernels.ts`), theoretical pI, net charge at pH 7.4 (Henderson–Hasselbalch with the pKa set used in `proteinProps` (N-term 9.69, C-term 2.34, K 10.5, R 12.4, H 6.0, D 3.86, E 4.25, C 8.3, Y 10.07): copy those constants into your file with a comment saying where they come from), GRAVY, CDR total length, CDR-H3 length, **hydrophobic CDR residue fraction** and a **charge-patch** metric (net charge of CDRs at pH 7.4). Flag thresholds (documented in the UI as rules of thumb, not validated cut-offs): pI of the Fv > 9.5 or < 6 (viscosity/clearance risk); CDR-H3 length > 20; > 2 hydrophobic CDR residues clusters `[AVILMFWY]{4,}`; net CDR charge > +2 or < −2.
**Tests:** a sequence `ANGSDGNTK` has liabilities: deamidation at `NG` (position 2–3), isomerisation at `DG` (4–5), and an N-glycosylation sequon? (`NGS` at 2–4 is `N[^P][ST]` → yes) — assert exactly these three motifs with 1-based positions `[2], [4], [2]`. A sequence with `NPS` has **no** sequon. Net charge of poly-lysine `KKKKK` at pH 7.4 is **> +4.9** and of poly-glutamate `EEEEE` is **< −4.9**. Trastuzumab VH contains `NG` at CDR-H2 (`TNGY`): flagged "in CDR". Compute expected values by hand or with a short independent Python snippet and put the snippet in `benchmarks/biologics/check.py`.
**UI:** paste VH and VL (or a single chain / scFv; split `GGGGS` linkers automatically); highlighted sequence with CDRs colour-coded and liabilities underlined; a developability table with traffic-light flags; "Compare" tab: paste up to 6 named antibodies and compare pI, charge, CDR-H3 length and flags side by side, CSV download. Demo buttons: trastuzumab, adalimumab. **Visible note:** "Rule-based screen of sequence liabilities and simple properties. It does not predict immunogenicity, aggregation or expression; confirm experimentally. CDRs use a heuristic Kabat definition (no numbering database)."
**Citations:** `kabat1991`, `raybould2019` (Raybould MIJ et al. (2019) Five computational developability guidelines for therapeutic antibody profiling. PNAS 116:4025–4030). **e2e:** `/biologics` → trastuzumab demo → expect `DTYIH`. **Commit:** `Biologics Studio: heuristic CDR identification and sequence-liability developability screen`.

---

### ITEM 5: PK / PD Studio (`pk`, path `/pharmacokinetics`, name "PK Studio")

Follow section 2. Tabs: `Non-compartmental`, `Simulate`, `Dosing regimens`. Files in `src/studios/pk/`: `nca.ts`, `nca.test.ts`, `models.ts`, `models.test.ts`, UI files.

**5a. NCA (`nca.ts`).** `nca(time[], conc[], opt: { dose, route: 'iv'|'extravascular', doseUnit?, concUnit?, lambdaPoints?: number|'auto', trapezoid: 'linear-up-log-down'|'linear' })` →
`{ cmax, tmax, clast, tlast, aucLast, lambdaZ, halfLife, r2adj, nPointsLambda, aucInf, aucExtrapPct, aumcLast, aumcInf, mrt, cl (CL or CL/F), vz (Vz or Vz/F), warnings[] }`.
- Remove missing values; concentrations below LOQ as 0 (user option); require ≥ 3 points; `tmax` is the first time of the maximum.
- `AUClast`: linear trapezoid when concentration is rising or equal; **log trapezoid when falling** (`(C1−C2)·Δt / ln(C1/C2)`; fall back to linear if either concentration is 0).
- `λz`: log-linear regression on the terminal phase. If `lambdaPoints = 'auto'`: try the last 3..n points (excluding `Cmax` point), pick the fit with the **highest adjusted R²** (tolerance: prefer more points if adjusted R² is within `1e-4`), need slope < 0. `t½ = ln 2/λz`. `AUCinf = AUClast + Clast/λz`; warn if `AUC%extrap > 20`.
- `AUMC` by the same trapezoid rule on `t·C` (log version `AUMC` segment: `(t1C1 − t2C2)Δt/ln(C1/C2) − Δt²(C1−C2)/ln(C1/C2)²`); `MRT = AUMCinf/AUCinf` (for IV; label "MRTinf"); `AUMCinf = AUMClast + Clast·tlast/λz + Clast/λz²`.
- `CL = Dose/AUCinf`; `Vz = Dose/(λz·AUCinf)`.
**Known-answer tests (analytic, noise-free):** IV bolus, one compartment, `D=100`, `V=10`, `k=0.1` → `C(t) = 10·e^{−0.1 t}`, sampled at `t = 0.25, 0.5, 1, 2, 4, 6, 8, 12, 16, 24, 36, 48` plus `t=0`: `λz` must equal `0.1` to `1e-9`; `t½ = 6.931471806`; `AUCinf` within **0.3 %** of `D/(V·k) = 100`; `CL` within 0.3 % of `1.0`; `Vz` within 0.3 % of `10`; `MRT` within 0.5 % of `1/k = 10`. Oral Bateman data (`F=1, D=100, V=10, k=0.1, ka=1`): `C = D·ka/(V(ka−k))·(e^{−kt} − e^{−ka t})`; `tmax` observed at the sampled time closest to `ln(ka/k)/(ka−k) = 2.5578`; `λz` = 0.1 (terminal), `AUCinf` within 0.5 % of 100. A profile with fewer than 3 positive points returns an error message instead of numbers. A profile where the terminal slope is not negative returns `lambdaZ: null` and no `AUCinf`.

**5b. Compartment models (`models.ts`).** Closed-form concentration-time functions and a numerical integrator:
- `oneCmtIV(D, V, k, t)`, `oneCmtOral(D, F, V, k, ka, t)` (Bateman; handle `ka ≈ k` by the limit `D·F/V·k·t·e^{−kt}`), `oneCmtInfusion(rate, T, V, k, t)` (`C = R/(V k)(1−e^{−kt})` during; `C(T)e^{−k(t−T)}` after).
- `twoCmtIV(D, V1, k10, k12, k21, t)`: `α, β` are the roots of `x² − (k10+k12+k21)x + k10·k21 = 0` (α > β); `A = (D/V1)(α−k21)/(α−β)`, `B = (D/V1)(k21−β)/(α−β)`, `C(t) = A e^{−αt} + B e^{−βt}`.
- `simulateOde(rhs, y0, tEnd, dt)` classical RK4, used for multi-dose regimens: `multipleDose(model, dose, tau, nDoses, t)` by superposition of single-dose curves (valid for linear PK) and accumulation ratio `R = 1/(1−e^{−kτ})`, `Css,avg = F·D/(CL·τ)`, and a loading-dose suggestion `LD = Css·V`.
**Tests:** `twoCmtIV` at `t=0` equals `D/V1` to `1e-12`; RK4 integration of the two-compartment ODE (`dA1/dt = −(k10+k12)A1 + k21 A2`, `dA2/dt = k12 A1 − k21 A2`) with `dt=0.001` matches the closed form within `1e-6` relative at `t = 1, 5, 20`; `oneCmtOral` with `ka = k` equals the limit expression (no NaN); superposition of 5 doses at `τ=12` for `k=0.1` has trough/peak after the last dose consistent with `R = 1/(1−e^{−1.2})` within `1e-9` on the pre-dose concentration ratio (`C_trough,ss/C_trough,dose1-first-pre-dose` for IV bolus: compare the limit with 60 doses); `oneCmtInfusion` is continuous at `t=T`.
**UI:** paste `time,conc` (several subjects as extra columns or a `subject` column → per-subject NCA table + mean/SD/geometric mean summary); a chart (`CurvePlot`) with semi-log option and the λz points highlighted; `Simulate` tab with sliders for the parameters and live curves; `Dosing regimens` tab for steady state. Demo data: the analytic IV and oral profiles above. **Visible note:** "Educational and research tool. NCA results depend on sampling; this is not a validated clinical pharmacology package (use Phoenix WinNonlin, PKNCA or NONMEM for regulated work)."
**Citations:** `gibaldi1982` (Gibaldi M, Perrier D (1982) Pharmacokinetics, 2nd ed.), `yeh1978` (Yeh KC, Kwan KC (1978) A comparison of numerical integrating algorithms by trapezoidal, Lagrange, and spline approximation. J Pharmacokinet Biopharm 6:79–98). **e2e:** `/pharmacokinetics` → demo → expect `AUCinf`. **Commit:** `PK Studio: non-compartmental analysis, compartment models and multiple-dose simulation`.

---

### ITEM 6: MD & Trajectory Analysis Studio (`trajectory`, path `/trajectory`, name "Trajectory Studio")

Follow section 2. For results of simulations the user ran elsewhere (GROMACS, AMBER, NAMD, OpenMM). Tabs: `Time series (XVG)`, `Trajectory (PDB models)`, `Energy landscape`. Files in `src/studios/trajectory/`: `xvg.ts`, `traj.ts` (+ tests), UI.

**6a. XVG reader (`xvg.ts`).** GROMACS `.xvg` files: lines starting `#` are comments; `@` lines are Grace directives: `@    title "RMSD"`, `@    xaxis  label "Time (ps)"`, `@    yaxis  label "RMSD (nm)"`, `@ s0 legend "Backbone"`; data rows are whitespace-separated numbers; lines starting `&` separate data sets. Export `parseXvg(text)` → `{ title, xLabel, yLabel, legends: string[], x: number[], series: number[][] , datasets: number } `. Tolerate missing directives and Windows line endings. Provide `describeSeries(x, y)` → mean, SD, min, max, final-quarter mean ("converged value"), **block-averaged standard error** (block size n/5), drift (slope of a linear fit), and `autocorrelationTime` (integrated, truncated at the first negative autocorrelation) and a `equilibrationHint` (first time after which the running mean stays within ±1 SD of the final-half mean). Convert time units option (ps→ns).
**Tests:** a hand-written XVG string with comments, directives, 3 columns and 5 rows parses to the expected arrays and labels; legends parsed; `&` splits sets; `describeSeries` of `y = 2` constant → SD 0, drift 0; of `y = t` (t=0..99) → drift `1`, min 0, max 99; final-quarter mean of `1..100` is `87.5`; autocorrelation time of white noise (seeded, n = 5000) is **0.5 ± 0.1**, and of an AR(1) series with φ = 0.9 (n = 20000, seeded) is within 20 % of the theoretical value **9.5** (integrated autocorrelation time `τ_int = ½ + Σ_{k≥1} ρ_k = (1+φ)/(2(1−φ))`; sum the sample autocorrelation `ρ_k` until the first negative value).

**6b. Trajectory from multi-model PDB (`traj.ts`).** Parse `MODEL … ENDMDL` blocks (and a plain single-model file as one frame); keep atom name/residue/chain/coordinates; frames must have the same atoms (else error "frame k has a different atom count"). Reuse the structure parser/Kabsch from `src/studios/structure/geometry.ts` if it exposes them (check with `grep -n "^export" …`); otherwise implement Kabsch (SVD of the 3×3 covariance by Jacobi eigen-decomposition of `HᵀH`, with the determinant sign fix). Export:
- `superposeToReference(frames, selection, refFrame = 0)` (fit on selected atoms, default CA), `rmsd(frames, sel)`, `rmsf(frames, sel)` per atom/residue after superposition, `radiusOfGyration(frame, sel)` (mass-unweighted; label it so), `pairDistance(frames, i, j)`, `hbondCount(frame, donors/acceptors by simple distance 3.5 Å and element N/O)` optional.
- `pca(frames, sel, nPc)`: covariance of superposed coordinates (3N×3N for CA atoms, N ≤ 300 else error); eigenvectors by Jacobi (N ≤ 100 CA) or power iteration with deflation for the top `nPc` components; return eigenvalues (nm²/Å²), eigenvectors, projections per frame, and `explained` fractions.
- `freeEnergy2D(x, y, bins = 40, T = 300)`: `F = −kT ln(P/Pmax)` in kJ/mol (`k = 0.0083144626 kJ/mol/K`), empty bins `NaN`.
**Tests (synthetic trajectories, planted truth):**
1. A rigid 20-point body copied 30 times with random rotations and translations → `rmsd` to frame 0 after superposition `< 1e-6` for every frame; before superposition it is large.
2. Same body with Gaussian noise σ = 0.5 Å per coordinate (seeded, 400 frames) → RMSF per atom ≈ `σ·√3 = 0.866` within 6 %; RMSD to the mean structure ≈ `0.866` within 6 %.
3. `radiusOfGyration` of 8 points at the corners of a cube with side 2 (centred) = `√3 = 1.7320508` (to `1e-9`).
4. A trajectory with a planted collective motion along a unit vector `v` (amplitude drawn N(0, 3 Å) per frame, plus σ=0.3 isotropic noise): PC1 explains > 85 % of the variance, `|cos(angle(PC1, v))| > 0.99`, projection variance ≈ `9 ·(…)` (just check PC1 eigenvalue within 10 % of `9 + 0.09`).
5. `freeEnergy2D` of a single 2-D Gaussian: minimum 0 at the centre; the value at one standard deviation from the centre is `0.5·kT` within 25 % (kT = 2.494 kJ/mol at 300 K).
**UI:** XVG tab: drop several `.xvg` files, overlay series (`CurvePlot`), statistics table from `describeSeries`, CSV/figure export; Trajectory tab: drop a multi-model PDB (limit 200 MB, ≤ 5,000 frames), choose selection (CA / backbone / all heavy), plots of RMSD, RMSF per residue, Rg, PCA scatter coloured by frame (`Scatter`), and the energy landscape as a heat map (use `buildHeatmap` from `src/viz/figure.ts` through the existing heat-map component if one exists in `src/viz/charts.tsx`/`more.tsx`; check names with `grep -n "Heatmap" src/viz/*.tsx`). A "Load demo" button generates the synthetic planted-motion trajectory. **Visible note:** "Analyses of simulations you ran elsewhere. Binary XTC/TRR/DCD files are not read: convert with `gmx trjconv -o traj.pdb` (or use `.xvg` outputs). No simulations run in the browser."
**Citations:** `kabsch1976`, `amadei1993` (Amadei A, Linssen ABM, Berendsen HJC (1993) Essential dynamics of proteins. Proteins 17:412–425), `flyvbjerg1989` (Flyvbjerg H, Petersen HG (1989) Error estimates on averages of correlated data. J Chem Phys 91:461–466). **e2e:** `/trajectory` → demo → expect `RMSD` and `PC1`. **Commit:** `Trajectory Studio: XVG time-series statistics, PDB-model trajectory RMSD/RMSF/Rg, essential dynamics and free-energy surface`.

---

### ITEM 7: Peptide Studio (`peptide`, path `/peptides`, name "Peptide Studio")

Follow section 2. Tabs: `Properties`, `Helical wheel`, `Fragments & masses`, `Cyclic & disulfide`, `AMP screen`. Files in `src/studios/peptide/`: `props.ts`, `props.test.ts`, `ms.ts`, `ms.test.ts`, UI.

**7a. Properties (`props.ts`).** For sequences up to 100 residues (error beyond):
- Length, monoisotopic and average mass (reuse `peptideMass`), net charge at a given pH and the whole charge-vs-pH curve (pKa constants as in Item 4; free termini optional; amidated C-terminus and acetylated N-terminus options remove the terminal charges), pI (bisection on net charge), `GRAVY` (Kyte–Doolittle; reuse the table if exported by `sequence/kernels.ts`, else type the standard table: A 1.8, R −4.5, N −3.5, D −3.5, C 2.5, Q −3.5, E −3.5, G −0.4, H −3.2, I 4.5, L 3.8, K −3.9, M 1.9, F 2.8, P −1.6, S −0.8, T −0.7, W −0.9, Y −1.3, V 4.2).
- **Aliphatic index** (Ikai 1980) `= X(A) + 2.9·X(V) + 3.9·(X(I)+X(L))` with `X` the mole percent.
- **Hydrophobic moment** (Eisenberg et al. 1984): `μH = sqrt( (Σ H_n sin(nδ))² + (Σ H_n cos(nδ))² )`, `⟨μH⟩ = μH/N`, with `δ = 100°` (α-helix) or `160°` (β-strand) and the **Eisenberg consensus scale**: A 0.62, R −2.53, N −0.78, D −0.90, C 0.29, Q −0.85, E −0.74, G 0.48, H −0.40, I 1.38, L 1.06, K −1.50, M 0.64, F 1.19, P 0.12, S −0.18, T −0.05, W 0.81, Y 0.26, V 1.08.
- Residue composition counts and fractions by class (hydrophobic `AVILMFWC`, polar `STNQGHY P`? use: hydrophobic `AVILMFWC`, polar uncharged `STNQYGHP`, positive `KR` (and `H` counted separately), negative `DE`).
**Tests:** `KKKKK` net charge at pH 7.4 is between **4.8 and 5.0**, at pH 14 close to `0`; pI of `KKKKK` is **> 10.5**; pI of `DDDDD` is **< 3.5**; aliphatic index of `AVILAVIL` equals `(2/8·100) + 2.9·(2/8·100) + 3.9·(4/8·100) = 25 + 72.5 + 195 = 292.5`; hydrophobic moment: write an independent Python function in `benchmarks/peptide/make-reference.py` that computes `μH` (δ = 100°, scale above) and run it for the sequence **`LKKLLKLLKKLLKLLKKL`**; save the value in `reference.json` and require agreement to `1e-9`; a sequence of one repeated residue `LLLLLLLL` has `μH = 1.06·|Σ_{n=1..8} e^{i·n·100°}|` (compute that number in the test with complex arithmetic, compare to `1e-9`); `GRAVY(AAAA) = 1.8`.

**7b. Helical wheel (`wheel.ts` + figure).** Positions at angle `100°·n` (n from 0), radius fixed, colour by class, label residue, arrow showing the hydrophobic moment direction and magnitude. Add `buildHelicalWheel(spec: { seq: string; delta: number }, o): Scene` to `figure.ts` with a test (one text element per residue; the moment arrow exists). Show with `ExportBar`.

**7c. Fragments and masses (`ms.ts`).** `fragmentIons(seq, { ionTypes: ['b','y','a'], charges: [1,2], mods? })`: `b_i = Σ residues(1..i) + PROTON`, `y_i = Σ residues(n−i+1..n) + WATER + PROTON`, `a_i = b_i − 27.99491463` (CO), for charge z: `(M + z·PROTON)/z` where M is the neutral fragment mass (`b_i − PROTON` etc.). Reuse `MONO`, `WATER`, `PROTON` from `src/studios/sequence/proteomics.ts`. Include optional neutral losses (−H2O, −NH3) as separate columns. `matchSpectrum(peaks, ions, tolPpm)` → matched ions and sequence coverage.
**Known-answer test (computed independently in Python, `PEPTIDE`, singly charged):**
b ions (b1–b6): **98.0600, 227.1026, 324.1554, 425.2031, 538.2871, 653.3141**; y ions (y1–y6): **148.0604, 263.0874, 376.1714, 477.2191, 574.2719, 703.3145** (4 decimals; test to `5e-4`). `b_i + y_{n−i} = M + 2·PROTON` for all i (to `1e-6`). A spectrum made of those 12 peaks plus 3 random peaks matches 12 ions at 10 ppm and gives 100 % coverage.

**7d. Cyclic and disulfide (`ms.ts`).** Head-to-tail cyclisation changes the mass by `−WATER` (−18.0105647); each disulfide bond by `−2.01565` (−2·1.00782503); `disulfidePairings(seq)` lists all ways to pair the cysteines (for n cysteines: (n−1)!! pairings, n ≤ 8) with the resulting neutral mass (same for all pairings with the same number of bonds; the list shows connectivity). **Tests:** `CYCLIC` (7 residues containing 2 C) mass with 1 disulfide = linear − 2.01565 (to `1e-5`); head-to-tail = linear − 18.0105647; 4 cysteines give exactly 3 pairings; 6 give 15; 5 cysteines give pairings with one unpaired.

**7e. AMP screen (`amp.ts`).** A **rule-based heuristic score** (label it "heuristic, not a trained model"): points for length 10–50 (1), net charge at pH 7.4 ≥ +2 (2; +1 more if ≥ +4), hydrophobic fraction 30–60 % (1), mean hydrophobic moment (δ=100°) ≥ 0.35 (2), no more than 2 Cys (0.5). Score = sum / 6.5 clipped to [0, 1]. Output reasons per criterion. **Tests:** magainin 2 `GIGKFLHSAKKFGKAFVGEIMNS` and melittin `GIGAVLKVLTTGLPALISWIKRKRQQ` score ≥ 0.6; `EEEEDDDDEEEE` and `GGGGSGGGGSGGGG` score ≤ 0.2; a 5-residue peptide scores ≤ 0.3. (These are sanity checks of the heuristic, not validation; say so in the UI.)
**UI:** textarea (one peptide per line, optional `name,sequence` CSV) → table with all properties, charge-vs-pH curve (`CurvePlot`), CSV download; wheel for the selected row; fragment table with a mass-list box; the cyclic/disulfide tab with a pairing list; AMP score with reasons. Demo: magainin 2 and melittin. **Visible note on the AMP tab:** "Heuristic screen from simple physicochemical rules; it is not trained or validated against activity data. Antimicrobial activity must be measured."
**Citations:** `kyte1982`, `eisenberg1984`, `ikai1980`, `roepstorff1984` (Roepstorff P, Fohlman J (1984) Proposal for a common nomenclature for sequence ions in mass spectra of peptides. Biomed Mass Spectrom 11:601). **e2e:** `/peptides` → demo → expect `Hydrophobic moment`. **Commit:** `Peptide Studio: properties, helical wheel, fragment ions, cyclic/disulfide masses and AMP heuristic`.

---

### ITEM 8: Population Genetics Studio (`popgen`, path `/population-genetics`, name "Population Genetics Studio")

Follow section 2. Tabs: `Frequencies & HWE`, `Differentiation (Fst)`, `Structure (PCA & admixture)`, `Sequence diversity`. Files in `src/studios/popgen/`: `stats.ts` (+ test), `admix.ts` (+ test), `diversity.ts` (+ test), UI.
Input formats: a genotype table (`sample, population, snp1, snp2, …` with 0/1/2 dosages; reuse `parseGenotypeTable` from `variants/assoc.ts` for the genotype part and read the population column yourself), or a VCF plus a `sample,population` table (reuse `parseGenotypeVcf`).
**8a. `stats.ts`**
- `alleleFreqs(G, pop)`: per SNP per population: n (non-missing individuals), alt frequency, observed heterozygosity `Ho`, expected `He = 2p(1−p)·(2n/(2n−1))` (unbiased), HWE exact p per population (reuse `hweExact`).
- **Weir & Cockerham (1984) θ (Fst)** over loci and populations, exactly: for each locus with `r` populations: `n̄ = Σn_i/r`; `n_c = (r·n̄ − Σn_i²/(r·n̄))/(r−1)`; `p̄ = Σ n_i p_i/(r·n̄)`; `s² = Σ n_i (p_i − p̄)²/((r−1)·n̄)`; `h̄ = Σ n_i h_i/(r·n̄)` (`h_i` = observed heterozygote **proportion**);
  `a = (n̄/n_c)·[ s² − (1/(n̄−1))·( p̄(1−p̄) − ((r−1)/r)·s² − h̄/4 ) ]`;
  `b = (n̄/(n̄−1))·[ p̄(1−p̄) − ((r−1)/r)·s² − ((2n̄−1)/(4n̄))·h̄ ]`;
  `c = h̄/2`.
  Multi-locus `θ = Σ_l a_l / Σ_l (a_l + b_l + c_l)`. Pairwise population Fst matrix (apply the same formula to each pair). Bootstrap over loci (200 resamples) for a 95 % CI.
- `ldMatrix(G, idx, window)` using `r2` from `assoc.ts`; `D′` (Lewontin) from haplotype-free estimate using genotype correlation is **not** valid; show r² only.
- Expected-vs-observed heterozygosity table and inbreeding coefficient `F = 1 − Ho/He`.
**Tests (`stats.test.ts`):** generate (seeded) a Balding–Nichols dataset: ancestral frequencies `p ~ U(0.1, 0.9)` for 3000 loci; two populations with `F_ST = 0.05`: `p_pop ~ Beta(p(1−F)/F, (1−p)(1−F)/F)`, genotypes `Binomial(2, p_pop)`, n = 100 per population → WC θ is within **±0.006** of `0.05`; with `F_ST = 0` (same p) the estimate is within ±0.003 of 0; `F = 1 − Ho/He` of a Hardy–Weinberg sample is within ±0.02 of 0; fully fixed differences (pop1 all 0, pop2 all 2 at every locus) give θ close to **1**. HWE p of `(50,40,10)` equals `0.6367558662349944` (value from `benchmarks/assoc/reference.json`, test that your studio calls the shared function).
**8b. `admix.ts`** (ADMIXTURE-style maximum likelihood by EM, Tang et al. 2005 / Alexander et al. 2009). Model: `P(g_ij alt alleles | q_i, P) = Binomial(2, Σ_k q_ik·p_kj)`. EM updates per iteration, skipping missing genotypes:
`r1_ijk = q_ik p_kj / Σ_k' q_ik' p_k'j`, `r0_ijk = q_ik (1 − p_kj)/Σ_k' q_ik'(1 − p_k'j)`;
`p_kj = Σ_i g_ij r1_ijk / Σ_i ( g_ij r1_ijk + (2 − g_ij) r0_ijk )`;
`q_ik = Σ_j ( g_ij r1_ijk + (2 − g_ij) r0_ijk ) / (2·J_i)` where `J_i` is the number of non-missing loci of individual i. Clamp `p` to [1e-6, 1−1e-6]. Run `K` from 1 to 6 with 5 random starts each (seeded), up to 300 iterations or log-likelihood change `< 1e-6` relative; report log-likelihood and **BIC = −2·logL + (parameters)·ln(n_obs)** per K to help choose K. Output `Q` (N×K) and a stacked-bar plot (`StackedBars` exists in `src/viz/more.tsx`). Handle label switching when comparing runs by sorting columns by their mean `q`.
**Tests:** simulate two populations (Fst 0.1, 1500 loci, 60 individuals each) plus 20 admixed individuals with true ancestry proportions `α ~ U(0.2, 0.8)` built by drawing each allele from pop 1 with probability α → for K=2 the Pearson correlation between estimated and true ancestry proportion (after matching columns) is **> 0.95** over the admixed individuals; K=1 has lower log-likelihood than K=2 by a wide margin; log-likelihood is non-decreasing across EM iterations (assert on a trace); results are deterministic for a seed.
PCA: reuse `genotypePcs` from `assoc.ts` after LD pruning (`ldPrune`); scatter coloured by population; test that PC1 separates the two simulated populations (all of one population on one side).
**8c. `diversity.ts`** for aligned DNA (FASTA): `S` (segregating sites), `π` (mean pairwise differences, over sites with no gaps/N), Watterson `θW = S/a1`, **Tajima's D** (Tajima 1989): `a1 = Σ_{i=1}^{n−1} 1/i`, `a2 = Σ 1/i²`, `b1 = (n+1)/(3(n−1))`, `b2 = 2(n²+n+3)/(9n(n−1))`, `c1 = b1 − 1/a1`, `c2 = b2 − (n+2)/(a1·n) + a2/a1²`, `e1 = c1/a1`, `e2 = c2/(a1² + a2)`, `D = (π − S/a1)/sqrt(e1·S + e2·S·(S−1))`; sliding-window π and D; `dN/dS` is **not** required. **Tests:** four sequences `AAAA, AAAT, AATT, ATTT` → `S = 3`, `π = (number of pairwise differences = 1+2+3+1+2+1 = 10)/6 = 1.6666667`, `θW = 3/(1+1/2+1/3) = 1.6363636`, and `D` equals the formula evaluated by hand in `benchmarks/popgen/check.py` (write that independent Python and store the number in `reference.json`); an alignment of identical sequences gives `S = 0` and `D = null` (not NaN); fewer than 4 sequences gives an error for D.
**Visible note:** "Exploratory population-genetic summaries. Fst and admixture depend on sampling and sample size; use PLINK/ADMIXTURE/STRUCTURE for publication analyses of large panels."
**Citations:** `weir1984`, `alexander2009`, `tajima1989`, `balding1995`. **e2e:** `/population-genetics` → demo (generated two-population data) → expect `Fst`. **Commit:** `Population Genetics Studio: Weir–Cockerham Fst, HWE, LD, PCA, admixture EM and Tajima's D`.

---

### ITEM 9: Proteomics & Metabolomics Quant Studio (`omicsquant`, path `/omics-quant`, name "Omics Quant Studio")

Follow section 2. Tabs: `Data & QC`, `Normalise & impute`, `Differential abundance`, `Clustering & PCA`. Files in `src/studios/omicsquant/`: `prep.ts` (+ test), `OmicsQuantStudio.tsx`, tab components. **Reuse the existing differential-expression engine** for the moderated t-test: find it with `grep -n "^export" src/studios/expression/linear.ts src/studios/expression/design.ts src/studios/expression/kernels.ts` (look for a limma-like fit such as `fitLinear`, `moderatedT`, `ebayes`). Do **not** reimplement it; import it. Input: an intensity matrix (rows = proteins/metabolites, columns = samples; blank/NA/0/`NaN` = missing) plus a sample sheet (`sample,group[,batch]`); MaxQuant `proteinGroups.txt` style columns starting with `LFQ intensity ` or `Intensity ` are auto-detected (strip the prefix for sample names; drop rows flagged `+` in `Reverse`, `Potential contaminant`, `Only identified by site`).
**`prep.ts` exports and behaviour:**
- `parseMatrix(text)` (CSV/TSV, header = samples, first column = id; MaxQuant detection as above) and `missingnessSummary(m)` (per-sample and per-feature NA counts, percent missing).
- `log2Transform(m)` (zeros and negatives become missing; add option "add pseudocount").
- `filterFeatures(m, groups, minValidPerGroup = 2)` (keep a feature if it has ≥ `minValidPerGroup` values in at least one group).
- `normalise(m, method: 'none'|'median'|'quantile'|'vsn-like-none')` — implement **only** `none`, `median` (subtract each sample's median of log2 values and add back the grand median) and `quantile` (rank-average quantile normalisation with ties averaged, missing values ignored). Do not implement VSN; the UI must not offer it.
- `impute(m, method: 'none'|'minprob'|'knn'|'halfmin', opts)`: `halfmin` = per-feature half of the minimum observed value; `minprob` (Perseus-like, left-censored) = draw from `N(μ, σ)` with `μ = q-th quantile (q = 0.01) of all observed values − 0` and `σ = 0.3 ·median feature SD`, seeded; `knn` (k=10, Euclidean on features with ≥ 70 % observed values, mean of the neighbours' values). All methods must return a **mask** of imputed cells so the UI can mark them, and must never change an observed value.
- `differential(m, groups, contrast, { imputed mask })` calling the existing moderated-t engine and Benjamini–Hochberg (reuse `bh` from where it lives; `grep -n "bh\b" src/studios/expression/*.ts`), returning `logFC, p, fdr` per feature; features with < 2 observed values per group before imputation are excluded and counted.
- `pca(m)` (reuse an existing PCA if `expression/kernels.ts` exports one) and hierarchical clustering heat map (reuse the heat map from Expression Studio if it is a separate component; if it is internal to `ExpressionStudio.tsx`, build the heat map with `buildHeatmap` in `src/viz/figure.ts` through the heat map component in `src/viz/charts.tsx`; check names first).
**Tests (`prep.test.ts`):** after `median` normalisation all sample medians are equal (to `1e-9`); after `quantile` normalisation all samples have identical sorted value vectors (when no values are missing); `impute` never changes an observed cell and fills exactly the missing cells (count equal to the number of NA); `halfmin` value equals `min/2` for a known feature; MaxQuant-style input with 2 `Reverse = +` rows drops exactly those rows; **planted differential abundance:** simulate 600 features × 6 samples (3 vs 3, seeded, log-normal intensities, 10 % missing completely at random, plus left-censoring of values below the 10th percentile), 40 features up by 2 log2 units in group B → after log2, median normalisation, `minprob` imputation and the moderated test, the AUC of `−log10 p` separating the 40 planted from the rest is **> 0.9** and at FDR 0.05 at least 25 of the 40 are detected with at most 5 false positives.
**UI:** a demo button builds the simulated data above. **Visible note:** "Imputation and normalisation choices change results; report them. For label-free DIA/DDA pipelines use the vendor/DIA-NN output as input."
**Citations:** `cox2014` (Cox J et al. (2014) Accurate proteome-wide label-free quantification by delayed normalization and maximal peptide ratio extraction, termed MaxLFQ. Mol Cell Proteomics 13:2513–2526), `lazar2016` (Lazar C et al. (2016) Accounting for the multiple natures of missing values in label-free quantitative proteomics data sets. J Proteome Res 15:1116–1125), `bolstad2003` (Bolstad BM et al. (2003) A comparison of normalization methods for high density oligonucleotide array data based on variance and bias. Bioinformatics 19:185–193). **e2e:** `/omics-quant` → demo → run the differential tab → expect `Volcano`. **Commit:** `Omics Quant Studio: normalisation, imputation and differential abundance for proteomics and metabolomics matrices`.

---

### ITEM 10: AMR / Bacterial Genomics Studio (`amr`, path `/amr`, name "AMR Studio")

Follow section 2. Tabs: `Screen assembly`, `Results`, `Gene library`. Files in `src/studios/amr/`: `search.ts` (+ test), `amr.worker.ts`, UI.
**Data (public domain, NCBI AMRFinderPlus reference gene nucleotide set).** Download and prepare:
```bash
cd /run/media/aji/1-TB/nayancode && mkdir -p public/data/amr
curl -s https://ftp.ncbi.nlm.nih.gov/pathogen/Antimicrobial_resistance/AMRFinderPlus/database/latest/AMR_CDS.fa | gzip -9 > public/data/amr/AMR_CDS.fa.gz
curl -s https://ftp.ncbi.nlm.nih.gov/pathogen/Antimicrobial_resistance/AMRFinderPlus/database/latest/version.txt > public/data/amr/version.txt
ls -la public/data/amr    # AMR_CDS.fa.gz must be well under 20 MiB (expected about 3 MB)
```
FASTA headers look like `>AAA16360.1|L11078.1|1|1|stxA2b|stxA2b|Shiga_toxin_Stx2b_subunit_A L11078.1:177-1136` (fields separated by `|`: protein accession, nucleotide accession, ..., **gene symbol** (5th), allele (6th), **product name** (7th, before the first space)). Write `parseAmrHeader`. Also check `curl -s https://ftp.ncbi.nlm.nih.gov/pathogen/Antimicrobial_resistance/AMRFinderPlus/database/latest/ | grep -i -E "catalog|ReferenceGeneCatalog"`: if a reference gene catalogue file exists, also download it and use its antibiotic class/subclass columns (match by gene symbol or accession) for a "drug class" column; if it does not exist, skip classes (do not invent them). Add `public/data/amr/NOTICE.txt`: "NCBI AMRFinderPlus reference gene database (public domain, NCBI). Version: <contents of version.txt>. Source URL: …".
**`search.ts` algorithm (nucleotide screening of assembled contigs; this is a screening tool, not AMRFinderPlus):**
1. `buildAmrIndex(refs)`: k = 15; index **forward** k-mers of every reference into three parallel typed arrays sorted by k-mer value (`Float64Array` keys, `Int32Array` ref ids, `Int32Array` positions; build by pushing, then sort an index array by key; ≈ 11 M entries → fine). Use `forEachKmer`-style rolling code **but non-canonical** (write a small local forward-only k-mer loop; do not use canonical k-mers here). Drop k-mers occurring in more than 50 references. Binary-search lookups.
2. `screenContigs(index, contigs, { minIdentity = 0.9, minCoverage = 0.6, minSeeds = 6 })`: for each contig and for **both strands** (contig and its reverse complement) look up every k-mer, vote for `(refId, diagonal = refPos − queryPos)` with diagonals bucketed in windows of 32; take buckets with ≥ `minSeeds` votes (merge neighbouring buckets); for each candidate extract the contig window `[queryStart − 50, queryStart + refLength + 50]` and run the existing `align(refSeq, window, { mode: 'local', kind: 'dna' })` (from `sequence/kernels.ts`); compute identity = identical columns / alignment length, coverage = aligned reference span / reference length; keep hits that pass the thresholds, convert the coordinates back to the contig (and to the forward strand), and record strand.
3. Resolve overlaps: if two hits overlap on the same contig/strand by > 50 % of the shorter, keep the one with the higher `score = identity·coverage` (ties: longer). Sort by contig and position.
4. Cap: candidate buckets per contig ≤ 2,000; contig length ≤ 20 Mb (error otherwise); total input ≤ 100 Mb.
**Tests (`search.test.ts`)**, using the real gzipped file (read with node `fs` + `zlib`):
- Take 5 specific reference sequences (choose by symbol from the file: `blaTEM-1`, `tetA`, `aac(6')-Ib`, `sul1`, `mecA` — if a symbol is not present choose any 5 distinct genes and write which in the log) and build a synthetic contig: 20 kb of random ACGT (seeded, GC ≈ 50 %) with the 5 genes inserted at known positions, three on the plus strand and two reverse-complemented, one of them carrying 3 % substitutions and another 1 deletion of 3 nt. The search must find **all 5** with the correct gene symbol, strand and start/end within ± 5 bp, `identity ≥ 0.96` for the mutated one and `1.0` for the exact ones; **no hit** from a 50 kb random contig; a gene truncated to 50 % of its length is **not** reported at `minCoverage 0.6` but **is** reported at `minCoverage 0.4`.
- The bundled E. coli K-12 genome (`public/genomes/ecoli-k12.fna.gz`) runs without error in under 60 s and returns fewer than 25 hits (K-12 has few acquired AMR genes); print the hit list into the log.
- A hit table sorted by contig and position; `parseAmrHeader` returns the symbol `stxA2b` and name `Shiga_toxin_Stx2b_subunit_A` for the example header above.
**UI:** drop a FASTA of contigs/genome (≤ 100 MB, gz accepted), thresholds, "Screen" button with progress, result table (gene, product, contig, start–end, strand, %identity, %coverage, drug class if available), a summary by gene family, CSV download, and a demo button "Demo: synthetic contig with 5 resistance genes" and "Demo: E. coli K-12 (bundled)". The AMR database is fetched on first use with `assetUrl('data/amr/AMR_CDS.fa.gz')` and decompressed with `DecompressionStream('gzip')` inside the worker. **Visible warning:** "Nucleotide screening against the NCBI reference gene set. It finds acquired resistance genes in assembled DNA; it does not detect point mutations or predict phenotypes. Use AMRFinderPlus or ResFinder for clinical or surveillance reporting."
**Citations:** `feldgarden2021` (Feldgarden M et al. (2021) AMRFinderPlus and the Reference Gene Catalog facilitate examination of the genomic links among antimicrobial resistance, stress response, and virulence. Sci Rep 11:12728). **e2e:** `/amr` → synthetic demo → expect `blaTEM` (or the first symbol you used). **Commit:** `AMR Studio: screening of assembled genomes against the NCBI AMRFinderPlus reference genes`.

---

### ITEM 11: Five free tool pages for the website (`company-webpage`)

These are **pages on the Solagene website** (not Workbench studios). Work in `/run/media/aji/1-TB/company-webpage`. First re-read how the calculator tools were added: `src/site/data/tools.ts` (entries such as `molarity-calculator`), `src/site/tools/Widgets.tsx` (functions such as `MolarityTool`, the `WIDGETS` map at the bottom, helpers `Quantity`, `MetricRow`, `useFields`, `Empty`, `sig`, `parseNum`), `src/site/tools/kernels.ts` (+ `kernels.test.ts`), and the e2e list in `e2e/site.spec.ts` (search for `'primer-tm-calculator'` in the `every free tool computes a result from its example` test).
Website tool kernels may import from the synced studios (`@/studios/...`) but **must not edit** synced folders (edit in nayancode and re-sync if you need a change there).
For **each** page do all of: (a) add an object to `TOOLS` in `src/site/data/tools.ts` with `slug, group, glyph, name, input: 'numbers'|'dna'|…, course, seoTitle (≤ 66 characters), seoDescription, short, about (3 sections), faq (2 entries + the privacy entry `PRIVACY_NUM`), related (existing slugs only), keywords`; (b) a widget in `Widgets.tsx` and its entry in `WIDGETS`; (c) the kernel + tests in `src/site/tools/kernels.ts` / `kernels.test.ts`; (d) the slug appended to the e2e list in `site.spec.ts`; (e) if the widget shows an empty-state message, make sure it begins with one of the words already matched by the e2e regex `Enter (three|an amount|at least|a |the |two|an A)` or `Paste a sequence`, or extend that regex by adding your new prefix to it.
Course slugs to link: `essential-laboratory-skills`, `molecular-biology-techniques`, `qpcr-gene-expression`, `microbiology-techniques`, `bioinformatics-foundations`, `population-genomics-gwas`, `python-for-bioinformatics` (verify each exists with `grep -ho "slug: '<slug>'" src/site/data/courses*.ts` before using it).

**11a. `michaelis-menten-calculator`** (group `Lab calculators`, course `essential-laboratory-skills`): paste `S, v` pairs → fits Vmax and Km (+ 95 % CI) with the NLS fitter from Item 1 (`@/studios/lab/kinetics` or `nls`), shows a plot (use the same small SVG sparkline approach as `QpcrTool` in `Widgets.tsx`) and the Lineweaver–Burk values. Test: reuse the noise-free dataset (recovers Vmax=100, Km=5 to `1e-6`).
**11b. `hardy-weinberg-calculator`** (course `population-genomics-gwas`): inputs AA, Aa, aa counts → allele frequencies, expected counts, χ² (1 df) and the **exact** p (use `hweExact` from `@/studios/variants/assoc`). Tests: `(50,40,10)` exact p `0.6367558662349944` and χ² computed by hand = `Σ (O−E)²/E` with `p=0.7`: expected `(49, 42, 9)` → χ² = `(1/49)+(4/42)+(1/9) = 0.0204082+0.0952381+0.1111111 = 0.2267574` (to `1e-6`).
**11c. `codon-optimizer`** (course `molecular-biology-techniques`): input a protein (or a CDS, translated first) and a host (E. coli K-12, S. cerevisiae S288C, and Homo sapiens **only if** you can obtain a codon-usage table that is public: Kazusa; otherwise omit human and say so in the log); output a DNA sequence using the most frequent codon for each amino acid ("max CAI") or a weighted-random choice ("harmonised", seeded), GC % and CAI, and a list of unwanted motifs the user types (restriction sites, `AAAAAA`, `GGGG`) that the algorithm avoids when an alternative codon exists. Host tables: **compute them from the bundled genomes**: write `scripts/codon-tables.mjs` that reads `public/genomes/ecoli-k12.fna.gz` + `.gff3.gz` and `scer-s288c.fna.gz` + `.gff3.gz`, extracts every `CDS` feature (handle the minus strand and, for yeast, multi-exon `Parent` joins by concatenating segments in order), counts codons of CDSs whose length is a multiple of 3 and that start with ATG and end with a stop, and writes `src/site/data/codon-tables.json` (frequency per codon per host). Run it and commit the JSON. **Tests:** the output always translates back to the input protein (test on 20 random proteins of length 50–300 for each host, both modes); the max-CAI sequence of `MKT` for E. coli uses the single most frequent codon for each residue (compare with the JSON); GC % and CAI are in [0, 1]; avoided motif absent when possible (use a protein of all `L` and motif `CTG`: the optimiser must use another Leu codon at least once or report that it could not avoid the motif).
**11d. `cell-count-calculator`** (course `essential-laboratory-skills`): hemocytometer counts of live and dead cells in N squares, dilution factor, chamber depth 0.1 mm and square area 1 mm² → cells/mL = `mean per square × dilution × 10⁴`, viability %, total cells in a given volume, seeding calculator (`volume to seed = target cells / concentration`), and the diluent to add to reach a target density. **Tests:** counts `[45, 52, 48, 55]` (4 squares) with dilution 2 → `mean = 50`, `50 × 2 × 10⁴ = 1,000,000` cells/mL; viability `live 200, dead 50` → `80 %`; seeding `2×10⁵` cells from `1×10⁶/mL` → `200 µL`; the seeding volume never exceeds the well volume (message when it does).
**11e. `gel-band-quantifier`** (course `molecular-biology-techniques`; this is the hardest page — if it takes too long, log PARTIAL and finish the rest): user picks an image file (kept in the browser; use a `canvas`; never upload), sets the number of lanes and the rectangle of the gel region (x, y, width, height as numeric inputs with the image shown and the rectangle drawn over it), the tool converts to grey, **inverts if bands are dark on light** (auto: compare mean to median), splits the region into equal-width lanes, computes the **lane profile** (mean intensity per row), subtracts a baseline (straight line between the 5th-percentile of the first and last 10 % of the profile), finds peaks (local maxima above 5 % of the max after baseline) and integrates the area under each peak between the neighbouring minima, and reports each lane's main-band area **relative to a chosen control lane** (and to a loading-control row if the user defines a second rectangle). **Kernel tests (pure functions on arrays, no DOM):** `laneProfile` of a synthetic 100×60 image with a Gaussian band (centre row 40, σ = 3, amplitude 200, background 20) in lane 1 and amplitude 100 in lane 2 gives integrated areas in ratio **2.0 ± 0.02**; baseline subtraction of a linear ramp with no band gives areas below 1 % of the ramp total; peak finder returns exactly one peak for a single Gaussian and two peaks for two Gaussians 20 rows apart; inversion detection flips a dark-on-light image. **e2e:** the page loads a tiny generated test image through `setInputFiles` (generate a PNG buffer in the test with a canvas in the page, or write a small PNG to the test-results directory with `node:fs` using a hard-coded base64 1×1… **simpler:** make the e2e only check that the page renders, the file input exists, and the "Load demo gel" button (which draws a synthetic gel on the canvas) produces results containing `Relative`).
**Commit messages:** one commit per page, e.g. `Free tools: Michaelis–Menten calculator`. Run `cd /run/media/aji/1-TB/company-webpage && npx vitest run src/site` after each page (the SEO unit test checks title length and distinctness; fix lengths by shortening `seoTitle`).

---

### ITEM 12: Website integration, copy updates, product pages, final checks

Do this after items 1–11 are committed (or logged as skipped). Work as follows.

**12a. Sync.**
```bash
cd /run/media/aji/1-TB/company-webpage && node scripts/sync-workbench.mjs ../nayancode
```
**12b. Register the new studios in the website's own `src/App.tsx`** (this file is not synced): add one line per shipped studio to the `live` object, in the same style as the existing lines, e.g. `plasmid: lazyRetry(() => import('@/studios/plasmid/PlasmidStudio')),` for each of `stats` (`StatsStudio`), `plasmid`, `biologics`, `pk`, `trajectory`, `peptide`, `popgen`, `omicsquant`, `amr` — **use exactly the file and component names you created**. The `STUDIOS` array itself comes from the synced `src/core/studios.ts`.
**12c. Studio count wording.** The number of studios changes from eleven to **eleven plus the number of studios you shipped** (20 if all nine shipped). Update the words "Eleven"/"eleven" in exactly these places (find them with `grep -rn -i "eleven" src/site docs ../nayancode/docs/biotools.json | cut -c1-200`): `src/site/content.ts` (workbench body), `src/site/SiteLayout.tsx` (header button title), `src/site/pages/Home.tsx`, `src/site/pages/Science.tsx`, `src/site/pages/nayancode/Home.tsx`, `src/site/pages/nayancode/Tools.tsx`, `src/site/data/products.ts` (tagline and description), and `../nayancode/docs/biotools.json` (description; this file is JSON: keep it valid; and add the new studios' EDAM operations only if you can verify the term IDs on https://edamontology.org — otherwise leave the operations list alone). Write the number as a word ("Twenty") in prose. Do not change anything else in those sentences. Also update the `analyses`/blurb mentions already added by the items.
**12d. Product pages (optional but wanted).** `src/site/data/products.ts` has one entry per studio (see the `genome-studio` entry: `slug, name, line, studio, app, shot, courses, tagline, short, description[], features[], useCases[], inputs, outputs, engine, limits, seoTitle (≤ 66 chars), seoDescription, keywords`). Add one entry per shipped studio, copying the field shapes exactly; `studio:` must equal the studio id; `app: st('<id>').path`; for `shot:` use `shot('<studio>-studio')` **only if** a screenshot exists in `public/img/products/`; otherwise reuse the `shot` value of the `lab-studio` entry and write in the log: "owner: run `node scripts/screens.mjs` to create real screenshots for the new product pages". Use course slugs that exist (verify with grep). Then regenerate the index: `cd /run/media/aji/1-TB/company-webpage && node scripts/site-index.mjs`. Update the e2e product list if a test enumerates product slugs (`grep -n "genome-studio" e2e/site.spec.ts`) by **adding** new slugs.
**12e. Checks.**
```bash
cd /run/media/aji/1-TB/company-webpage && npx tsc --noEmit
cd /run/media/aji/1-TB/company-webpage && npx vitest run src/site
cd /run/media/aji/1-TB/company-webpage && npm run build 2>&1 | grep -E "error|built|Error"
cd /run/media/aji/1-TB/company-webpage && find dist -type f -size +20M            # must print nothing
cd /run/media/aji/1-TB/company-webpage && find dist -type f | wc -l              # must stay far below 20000
cd /run/media/aji/1-TB/company-webpage && npx playwright test e2e/site.spec.ts -g "free tool|studio|product|sitemap"
```
Fix only what your changes broke. **Commit** in the website repo: `Workbench Phase 2: new studios, free tools and product pages synced from Nayancode`.
**12f. Notes.** Add a dated section to `SOLAGENE-PROGRESS.md` ("Workbench Phase 2") listing what shipped, what was skipped and why, and the owner to-dos below.

---

## 7. FINAL CHECK (run once at the very end, in nayancode)
```bash
cd /run/media/aji/1-TB/nayancode && npx tsc --noEmit && npx vitest run 2>&1 | tail -8
cd /run/media/aji/1-TB/nayancode && npm run build 2>&1 | grep -E "error|built in" && find dist -type f -size +20M
cd /run/media/aji/1-TB/nayancode && npx playwright test e2e/studios.spec.ts --grep-invert "docking: 1HSG|live model" 2>&1 | tail -15
cd /run/media/aji/1-TB/nayancode && git status --short && git log --oneline | head -20
```
If something fails that you did not touch, do not fix it: record it. Finish the progress log with a final table: item, status, commit.

## 8. WHAT THE OWNER STILL HAS TO DO (write this at the end of the log; do not do it yourself)
- Review and merge the branches (`feature/more-tools` then `feature/phase2-studios`) in nayancode, push, and (optionally) mint a new Zenodo version; update `CITATION.cff`/`.zenodo.json` and `package.json` version for 1.3.0 if desired.
- Push the website repo; Cloudflare builds and deploys from GitHub.
- Run `node scripts/screens.mjs` to create real screenshots for the new product pages.
- Submit the new URLs with `scripts/indexnow.mjs` after the deploy.
- Review the claims on the new pages (especially the AMP, developability, PK and AMR notes) before announcing.

## 9. THINGS THAT ARE OUT OF SCOPE (do not start)
Anything needing a backend: AlphaFold-scale structure prediction, GPU docking of millions of compounds, production molecular dynamics, human-scale alignment from raw reads, user accounts, shared projects, cloud storage, paid APIs. Binary trajectory formats (XTC/TRR/DCD) are not required. Trim-and-fill meta-analysis is optional.
