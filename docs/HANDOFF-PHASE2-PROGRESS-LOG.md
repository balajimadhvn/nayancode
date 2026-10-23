# Phase 2 progress log

Rules and the format for entries: `HANDOFF-PHASE2-NEW-STUDIOS.md`, section 3. Append entries at the bottom. Never write DONE unless unit tests,
type check, build and the e2e test all passed.

Starting state (2026-10-22): Phase 1 complete (13 tools + live ESM-2), nayancode branch `feature/more-tools` at the latest commit, website `main`
with the Phase 1 sync. Phase 2 branch to create in nayancode: `feature/phase2-studios`.

| # | Item | Status |
|---|---|---|
| 1 | Lab Studio: enzyme kinetics, plate reader / ELISA, growth curves | DONE |
| 2 | Statistics & Meta-analysis Studio | DONE |
| 3 | Plasmid & Construct Studio | DONE |
| 4 | Antibody & Biologics Developability Studio | DONE |
| 5 | PK / PD Studio | DONE |
| 6 | MD & Trajectory Analysis Studio | DONE |
| 7 | Peptide Studio | DONE |
| 8 | Population Genetics Studio | DONE |
| 9 | Proteomics & Metabolomics Quant Studio | DONE |
| 10 | AMR / Bacterial Genomics Studio | NOT STARTED |
| 11 | Five free tool pages (website) | NOT STARTED |
| 12 | Website integration, product pages, copy, final checks | NOT STARTED |

## Item 1 Lab Studio: enzyme kinetics, plate reader / ELISA, growth curves — DONE   (2026-10-23, 02:40)
- files created/changed: `src/studios/lab/{kinetics,plate,growth,nls,survival,doseResponse}.ts` (+ tests), `LabStudio.tsx` and tab components, `benchmarks/lab/*` (R and scipy references, `lab.bench.test.ts`), `src/viz/charts.tsx` (CurvePlot)
- tests added and result: 570 unit tests pass (58 files); kinetics, plate-reader, growth, dose–response and survival numbers agree with R/scipy references
- e2e test name and result: `lab: Livak 2001 example, dose–response fit and a power calculation`, `lab: survival demo gives Kaplan–Meier medians, log-rank and a Cox hazard ratio`, `lab: enzyme kinetics, plate reader and growth-curve demos all compute a result` — pass
- commit hash: ea38010 (survival was part of the same studio line of work)
- what is left / problems / decisions for the owner: none

## Item 2 Statistics & Meta-analysis Studio — DONE   (2026-10-23, 03:00)
- files created/changed: `src/studios/stats/*` (classical tests, meta-analysis with fixed/DL/REML/PM pooling, forest and funnel plots), `benchmarks/stats/make-reference.py` + `reference.json`
- tests added and result: all statistics tests pass; values agree with scipy to the specified tolerances
- e2e test name and result: `statistics: meta-analysis demo pools the BCG trials and draws a forest plot` — pass
- commit hash: 953e1e4
- what is left / problems / decisions for the owner: none

## Item 3 Plasmid & Construct Studio — DONE   (2026-10-23, 03:23)
- files created/changed: `src/studios/plasmid/{genbank,annotate}.ts` (+ tests), `features-library.ts`, `fixtures/puc19.gb`, `PlasmidStudio.tsx`, the four tab components, `buildPlasmidMap` in `src/viz/figure.ts` (+ tests)
- tests added and result: 19 tests in `genbank.test.ts`/`annotate.test.ts`/`figure.test.ts` additions; pUC19 parses to 2,686 bp circular starting `TCGCGCGTTTCGGTGATGACGG`, round trip keeps sequence and features, AmpR and the other features annotate at the published coordinates
- e2e test name and result: `plasmid: pUC19 demo annotates AmpR and draws the circular map` — pass
- commit hash: fbc6bf1
- what is left / problems / decisions for the owner: the primer checks use the documented nearest-neighbour parameters, not Primer3's salt correction; noted in the tab copy

## Item 4 Antibody & Biologics Developability Studio — DONE   (2026-10-23, 03:45)
- files created/changed: `src/studios/biologics/{cdr,liabilities}.ts` (+ tests), `BiologicsStudio.tsx`, `ChainsTab.tsx`, `DevelopabilityTab.tsx`, `CompareTab.tsx`, `benchmarks/biologics/check.py`, `kabat1991`/`raybould2019` in `src/core/provenance.ts`
- tests added and result: 18 tests in `cdr.test.ts`/`liabilities.test.ts`; trastuzumab and adalimumab VH/VL reproduce the expected Kabat CDRs exactly, scFv splitting works, `ANGSDGNTK` gives deamidation at 2, isomerisation at 4 and a sequon at 2, `NPS` is not a sequon, `KKKKK` charge > 4.9 and `EEEEE` < −4.9, trastuzumab's CDR-H2 `NG` is flagged "in CDR"
- e2e test name and result: `biologics: trastuzumab demo finds the CDRs and screens liabilities` — pass
- commit hash: uncommitted at the time of writing (see `git log`)
- what is left / problems / decisions for the owner: CDR boundaries are the fixed heuristic rules from the spec, not a numbering scheme; the developability thresholds are published rules of thumb and the UI says so

## Item 5 PK / PD Studio — DONE   (2026-10-23, 21:55)
- files created/changed: `src/studios/pk/{nca,models}.ts` (+ tests), `PKStudio.tsx`, `NcaTab.tsx`, `DosingTab.tsx`, `SimulateTab.tsx`; `src/App.tsx` (lazy route), `src/core/studios.ts` (entry), `src/ui/Icons.tsx` (icon), `src/core/provenance.ts` (`gibaldi1982`, `yeh1978`), `src/viz/figure.ts` + `src/viz/figure.test.ts` (semi-log axis fix and regression test), `e2e/studios.spec.ts` (`/pharmacokinetics` route and test)
- tests added and result: 31 unit tests pass (`nca.test.ts`: 19, `models.test.ts`: 12); NCA AUC/AUMC (linear-up/log-down), λz selection, compartment fits and multiple-dose superposition reproduce the reference values; the new `buildCurves log axes` regression test covers `logY` with `yMin: 0`
- e2e test name and result: `pk: IV demo gives an AUCinf and the simulator and dosing tabs run` — pass (4 passed together with the route sweep, trajectory and peptide)
- tsc/build/size: `npx tsc --noEmit` clean; `npm run build` succeeds; `find dist -type f -size +20M` prints nothing
- commit hash: see `git log` (`PK Studio: non-compartmental analysis, compartment models and multiple-dose simulation`)
- what is left / problems / decisions for the owner: the PK semi-log plots pass `yMin: 0` with `logY: true`, which previously made `buildCurves`' tick generator loop forever (log10(0) = −Infinity); `src/viz/figure.ts` now ignores non-positive log bounds and guards non-finite ones. This is a shared-chart fix, not a change to PK numbers.

## Item 6 MD & Trajectory Analysis Studio — DONE   (2026-10-23, 21:55)
- files created/changed: `src/studios/trajectory/{xvg,traj}.ts` (+ tests), `TrajectoryStudio.tsx`; `src/App.tsx` (lazy route), `src/core/studios.ts` (entry), `src/ui/Icons.tsx` (icon), `src/core/provenance.ts` (`amadei1993`, `flyvbjerg1989`), `e2e/studios.spec.ts` (`/trajectory` route and test)
- tests added and result: 18 unit tests pass (`xvg.test.ts`: 9, `traj.test.ts`: 9); XVG parsing (title, `&` dataset separator), block-averaged standard errors, autocorrelation time, Kabsch superposition, RMSD/RMSF/Rg with the 3N/(3N−6) DoF correction, PCA power iteration with deflation and the free-energy surface
- e2e test name and result: `trajectory: demo gives RMSD and PC1 and the landscape tab draws` — pass
- tsc/build/size: `npx tsc --noEmit` clean; `npm run build` succeeds; `find dist -type f -size +20M` prints nothing
- commit hash: see `git log` (`Trajectory Studio: XVG time-series statistics, PDB-model trajectory RMSD/RMSF/Rg, essential dynamics and free-energy surface`)
- what is left / problems / decisions for the owner: the earlier 87.5 vs 88 note was a miscount — the last quarter starts at index `floor(0.75 × (n−1)) = 74` (end point included), so the mean of 75..100 is exactly 87.5. No test expectation was changed.

## Item 7 Peptide Studio — DONE   (2026-10-23, 21:55)
- files created/changed: `src/studios/peptide/{props,ms,amp,wheel}.ts` (+ tests), `PeptideStudio.tsx`; `src/viz/figure.ts` + `src/viz/figure.test.ts` (`buildHelicalWheel` and tests), `src/App.tsx` (lazy route), `src/core/studios.ts` (entry), `src/ui/Icons.tsx` (icon), `src/core/provenance.ts` (`eisenberg1984`, `ikai1980`, `roepstorff1984`), `benchmarks/peptide/make-reference.py` + `reference.json`, `e2e/studios.spec.ts` (`/peptides` route and test)
- tests added and result: 45 unit tests pass (`props.test.ts`: 22, `ms.test.ts`: 17, `amp.test.ts`: 6); properties (Henderson–Hasselbalch charge, pI, GRAVY, aliphatic index, Eisenberg hydrophobic moment), b/y/a fragment ions with neutral losses, cyclic/disulfide masses and pairings, and the AMP heuristic all have known-answer tests. Masses and the hydrophobic moment were cross-checked against the independent plain-Python `benchmarks/peptide/make-reference.py` output (`reference.json`). `figure.test.ts` gained two helical-wheel tests on top of the log-axis regression test.
- e2e test name and result: `peptide: demo gives properties, a helical wheel and an AMP score` — pass; the page shows the exact note "Heuristic screen from simple physicochemical rules; it is not trained or validated against activity data. Antimicrobial activity must be measured."
- tsc/build/size: `npx tsc --noEmit` clean; `npm run build` succeeds; `find dist -type f -size +20M` prints nothing
- commit hash: see `git log` (`Peptide Studio: properties, helical wheel, fragment ions, cyclic/disulfide masses and AMP heuristic`)
- what is left / problems / decisions for the owner: two documented interpretations. (1) The blocked-termini pI test asserts charge at pH 14 rather than an exact crossing, because a blocked peptide with no ionisable side chains has no finite pI; free termini are checked separately. (2) The AMP screen awards the cysteine criterion only for 1–2 Cys (zero Cys scores 0), which is the reading that satisfies every sanity threshold in the handoff without changing any expected number.

## Item 8 Population Genetics Studio — DONE   (2026-10-23, 22:11)
- files created/changed: `src/studios/popgen/{stats,admix,diversity,demo}.ts` (+ `stats.test.ts`, `admix.test.ts`, `diversity.test.ts`), `PopulationGeneticsStudio.tsx`, `FrequenciesTab.tsx`, `FstTab.tsx`, `StructureTab.tsx`, `DiversityTab.tsx`; `benchmarks/popgen/check.py` + `reference.json`; `src/App.tsx` (lazy route), `src/core/studios.ts` (entry), `src/ui/Icons.tsx` (icon), `src/core/provenance.ts` (`alexander2009`, `tajima1989`, `balding1995`; `weir1984` already existed), `e2e/studios.spec.ts` (route and test)
- tests added and result: 24 unit tests pass (`stats.test.ts`: 11, `admix.test.ts`: 7, `diversity.test.ts`: 6); Weir–Cockerham θ recovers F_ST = 0.05 from a 3000-locus Balding–Nichols simulation and is near zero at F_ST = 0; fixed differences give θ > 0.95; the HWE p for (50,40,10) equals the shared reference 0.6367558662349944; the admixture EM recovers the true ancestry proportions with r > 0.95 at K = 2, never decreases the log-likelihood and is deterministic per seed; PCA separates the two source populations on PC1; Tajima's D for AAAA/AAAT/AATT/ATTT matches `benchmarks/popgen/check.py` (D = 0.1676557950339481)
- e2e test name and result: `popgen: demo genotype table gives Fst and a Hardy–Weinberg table` — pass (2 passed together with the all-routes sweep)
- tsc/build/size: `npx tsc --noEmit` clean; `npm run build` succeeds; `find dist -type f -size +20M` prints nothing
- commit hash: see `git log` (`Population Genetics Studio: Weir–Cockerham Fst, HWE, LD, PCA, admixture EM and Tajima's D`)
- what is left / problems / decisions for the owner: (1) PCA coordinates come from the shared `genotypePcs`, whose result is components × samples; the UI and tests use that orientation. (2) BIC uses parameters = K(n + m) and n = observed genotypes. (3) The demo genotype table contains a third labelled group ("Admixed") so the structure tab has something to resolve; the Fst tab therefore reports θ over all three labels, not just the two sources. (4) The visible note is exactly the sentence required by the handoff.

## Item 9 Proteomics & Metabolomics Quant Studio — DONE   (2026-10-23, 22:20)
- files created/changed: `src/studios/omicsquant/prep.ts` (+ `prep.test.ts`), `OmicsQuantStudio.tsx`, `DataTab.tsx`, `NormaliseTab.tsx`, `DiffTab.tsx`, `ClusterTab.tsx`; `src/App.tsx` (lazy route), `src/core/studios.ts` (entry), `src/ui/Icons.tsx` (icon), `src/core/provenance.ts` (`cox2014`, `lazar2016`, `bolstad2003`), `e2e/studios.spec.ts` (route and test)
- tests added and result: 12 unit tests pass (`prep.test.ts`): generic CSV and MaxQuant parsing (LFQ/Intensity prefix stripping; rows flagged Reverse, Potential contaminant or Only identified by site dropped), log2 with zeros/negatives becoming missing and the pseudocount option, group-wise feature filtering, median normalisation (all sample medians equal to 1e-9), quantile normalisation (identical sorted vectors when complete; ties averaged), all three imputation methods (observed cells unchanged, mask count equals the number of NAs, seeded determinism), half-minimum = min/2, and the planted experiment (600 features × 6 samples, 3 vs 3, 10 % MCAR plus left-censoring below the 10th percentile, 40 features +2 log2): AUC of −log10 p > 0.9, ≥ 25/40 recovered at FDR 0.05 and ≤ 5 false positives
- e2e test name and result: `omics quant: demo recovers spiked features and draws a volcano` — pass (3.7 s); the demo reports 488 tested features, 33/33 tested spiked features recovered and 4 false positives at FDR 0.05, and the Volcano card renders
- tsc/build/size: `npx tsc --noEmit` clean; `npm run build` succeeds; `find dist -type f -size +20M` prints nothing
- commit hash: see `git log` (`Omics Quant Studio: normalisation, imputation and differential abundance for proteomics and metabolomics matrices`)
- what is left / problems / decisions for the owner: the imputation mask is used for two things, not just reporting. Besides counting observed values per group, cells flagged as imputed enter the weighted moderated fit with weight 0.05 (`DiffOptions.imputedWeight`, documented in `prep.ts`). Without this, a single left-censored MinProb filler can dominate a feature's residual variance and hide a real effect: with the mask ignored the planted test recovered only 20/40 at FDR 0.05. With the weight it recovers the required ≥ 25/40 while keeping ≤ 5 false positives. `normalise` implements only none/median/quantile; VSN is neither implemented nor offered. Quantile normalisation with ties keeps equal values equal by averaging the reference quantiles over the tied ranks, so sorted vectors are identical across samples only when there are no ties, which is how the handoff phrases the invariant.
