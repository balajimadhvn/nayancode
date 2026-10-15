# Changelog

## Unreleased
- Publication-ready figures: every chart exports to SVG (editable text, light or dark), PDF (vector) and PNG at 300 or
  600 dpi, with width and height in mm, font size, a colour-blind-safe palette (Okabe–Ito) and editable title and axis
  labels. Volcano and MA plots can label the top N genes with collision avoidance.
- Lab Studio (`/lab`): qPCR ΔΔCt (Livak) and efficiency-corrected Pfaffl with multiple reference genes, geNorm,
  technical-replicate outlier flags, t-test / ANOVA on ΔCt and standard-curve efficiency; 4PL / 5PL dose–response with
  IC50 confidence intervals; power and sample size for t tests, ANOVA, proportions, log-rank and RNA-seq. Validated
  against the original papers and R (drc, pwr, RNASeqPower, gsDesign, NormqPCR), see benchmarks/RESULTS.md.
- Downloaded files are named `vivofold-nayancode_<name>_<date>.<ext>`.
- Expression Studio defaults to testing the treatment rather than a paired donor or batch column.
- Usability-study kit in `docs/usability/` (protocol, consent form, tasks, SUS questionnaire, analysis script).
- Benchmarks on public data (`benchmarks/`, `npm run bench`): Expression Studio vs DESeq2, limma-voom and edgeR on
  airway and pasilla; Single-Cell Studio vs Scanpy on 10x PBMC3k. Results in benchmarks/RESULTS.md.
- Expression: voom chooses its lowess span from the number of genes, and the empirical-Bayes prior follows limma's
  fitFDist; results are now identical to limma 3.66 (previously up to 0.048 log-fold-change difference).
- Single-Cell: highly variable genes follow Scanpy's Seurat flavour exactly; normalisation, scaling and PCA match
  Scanpy through PC7.
- Genome: SNV and indel calling with bcftools 1.10 (WebAssembly, MIT), haploid or diploid; the built-in caller stays
  available for low allele fractions.
- Phylogenetics: maximum-likelihood bootstrap support, run in parallel on the CPU's cores; ML limit raised from 60 to
  150 taxa; faster branch-length optimisation (2–4×) with an exact final pass.
- The overview lists only what genuinely needs more than a browser (human-scale genomes, metagenome databases,
  structure prediction, atlas-scale single-cell).
- The auto-written Methods paragraph cites the Workbench by its Zenodo DOI, and states precisely that input files
  were analysed locally.

## 1.0.0 (2026-10-15)
First public, open-source release (Apache-2.0).
- Studios: Sequence, Genome (minimap2 + samtools, WebAssembly), Variant, Expression, Single-Cell, Microbiome,
  Chemistry (RDKit, QSAR), Structure (Mol*), Alignment & Phylogenetics.
- Expression Studio fits any experimental design: multiple groups, covariates, batches, paired or repeated samples;
  pairwise contrasts, F-tests across levels and numeric trends (TMM, voom, moderated t/F; agrees with edgeR + limma).
- Gene Atlas, Report builder with automatic methods text, nf-core results import.
- 208 unit tests against known answers; 14 end-to-end browser tests.
