# Changelog

## 1.2.0 (2026-10-22)
New tools added to existing studios (no new studio). Everything runs in the browser.
- Lab Studio: survival analysis (Kaplan–Meier, log-rank, Cox with Efron ties), validated against R `aml`.
- Chemistry Studio: ADMET tab (solubility, logD, BBB models on open data; Lipinski/Veber/Egan/Ghose; BOILED-Egg).
- Chemistry Studio: molecule tools (Murcko scaffolds, MCS, R-groups, reaction enumeration, pharmacophore and USR shape similarity).
- Sequence Studio: proteomics basics (in-silico digestion, peptide masses, isotope patterns, mass matching, mzML viewer).
- Variant Studio: GWAS-lite association testing (linear, logistic, trend; PCs, exact HWE, LD pruning, genomic control).
- Single-Cell Studio: larger datasets (NN-descent kNN, Harmony-style batch integration, Scrublet-style doublet scoring).
- Expression Studio: pseudoalignment (FASTQ/FASTA → counts via a k-mer index and EM for small transcriptomes).
- Expression Studio: gene network view (Reactome pathway co-membership, force-directed layout, Louvain communities).
- Microbiome Studio: reference screening by FracMinHash containment and sourmash-style gather.
- Genome Studio: small-genome overlap assembler (minimizers, string graph, unitigs; unpolished).
- Structure Studio: analysis tools (contact map, B-factor profile, RMSD matrix, elastic-network normal modes).
- Sequence Studio: experimental protein language-model tab (ESM-2 8M scoring maths; live model not bundled in this build).
- Figures: box plots, multiple-sequence alignments and phylogenetic trees now export to SVG, PDF and PNG.

## 1.1.0 (2026-10-16)
- Docking Studio (`/docking`): AutoDock Vina 1.2.7 compiled to WebAssembly (Apache-2.0, built by `scripts/vendor_vina.sh`), clean-room receptor and ligand preparation (pH 7.4, Gasteiger charges, PDBQT, distance-geometry 3-D), box from a co-crystal ligand, residues or coordinates, pose viewer, interaction profile, small virtual screens, redocking benchmark (35.7 % of top poses < 2 Å on 42 complexes; identical scores to native Vina within 0.14 kcal/mol on average).
- The publisher is now **Solagene** (formerly Vivofold), https://solagene.com; new logo and icons.
- Publication-ready figures: every chart exports to SVG (editable text, light or dark), PDF (vector) and PNG at 300 or
  600 dpi, with width and height in mm, font size, a colour-blind-safe palette (Okabe–Ito) and editable title and axis
  labels. Volcano and MA plots can label the top N genes with collision avoidance.
- Lab Studio (`/lab`): qPCR ΔΔCt (Livak) and efficiency-corrected Pfaffl with multiple reference genes, geNorm,
  technical-replicate outlier flags, t-test / ANOVA on ΔCt and standard-curve efficiency; 4PL / 5PL dose–response with
  IC50 confidence intervals; power and sample size for t tests, ANOVA, proportions, log-rank and RNA-seq. Validated
  against the original papers and R (drc, pwr, RNASeqPower, gsDesign, NormqPCR), see benchmarks/RESULTS.md.
- Benchmarks: variant calling vs native minimap2/samtools/bcftools on real E. coli reads with 230 planted SNVs and
  indels; maximum-likelihood phylogenetics vs IQ-TREE on four public alignments. Three case studies on public data
  (docs/case-studies): airway dexamethasone RNA-seq, PBMC3k cell types, mutations of an E. coli LTEE line.
- Phylogenetics: κ (K80/HKY85) and the Γ shape are now estimated by maximum likelihood (κ was fixed at 2 and α
  chosen from a 9-value grid); identical alignment columns are computed once (site-pattern compression); base
  frequencies are the empirical ones, as IQ-TREE's +F.
- Genome: the mapping pipeline is shared between the browser and Node (src/studios/genome/pipeline.ts) and no longer
  runs a samtools text pileup when bcftools calls the variants.
- Downloaded files are named `solagene-nayancode_<name>_<date>.<ext>`.
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
