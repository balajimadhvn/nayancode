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
| 5 | PK / PD Studio | NOT STARTED |
| 6 | MD & Trajectory Analysis Studio | NOT STARTED |
| 7 | Peptide Studio | NOT STARTED |
| 8 | Population Genetics Studio | NOT STARTED |
| 9 | Proteomics & Metabolomics Quant Studio | NOT STARTED |
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
