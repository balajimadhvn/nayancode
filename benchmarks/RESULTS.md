# Benchmark results

Measured 2026-10-15 with the code in this repository. Raw metrics: `results/expression.json`, `results/singlecell.json`.
FDR threshold 0.05 throughout.

## Differential expression (Expression Studio)
Workbench settings: TMM normalisation, CPM ≥ 1 in ≥ 2 samples, voom weights, design `~ cell + dex` (airway) and
`~ type + condition` (pasilla). DESeq2 uses its own normalisation, filtering and Wald test, run on all genes with
non-zero counts; comparisons use the genes both tools tested.

| | airway (paired, 15,041 genes tested) | pasilla (two factors, 8,047 genes tested) |
|---|---|---|
| **limma-voom, same model** | identical: log-fold changes and t-statistics within 1e-8, the same 5,003 significant genes | identical: the same 1,139 significant genes |
| **edgeR quasi-likelihood** | log-fold-change r = 0.999; finds 98.7 % of edgeR's 4,940 genes; 97.5 % of the Workbench's confirmed | r = 0.996; 96.9 % of 1,153; 98.1 % confirmed |
| **DESeq2 (Wald)** | r = 0.997; finds 99.3 % of DESeq2's 3,909 genes; 77.6 % of the Workbench's 5,003 confirmed | r = 0.991; 91.3 % of 1,065; 85.3 % confirmed |
| Runtime (Workbench, one CPU thread) | 1.0 s | 0.4 s |

Reading: the Workbench is limma-voom, reimplemented, and reproduces it exactly. Against DESeq2, a different statistical
model (negative binomial with shrunken dispersions), fold changes agree closely. Almost every DESeq2 call is also a
Workbench call, but on airway the Workbench calls about 1,100 more genes than DESeq2. This is the known difference
between limma-voom and DESeq2 on this dataset, not an error in either tool. The top-100 gene lists overlap with
Jaccard 0.74 (airway) and 0.69 (pasilla).

Two engine corrections came out of this benchmark: voom now chooses its lowess span from the number of genes, as limma
does by default since 3.64 (`adaptive.span = TRUE`); and the empirical-Bayes prior follows limma's `fitFDist` exactly
(zero variances offset by 1e-5 × median; mean scale when the prior degrees of freedom are infinite). Before these
fixes the Workbench differed from limma-voom by up to 0.048 in log-fold change and called about 10 genes differently
per dataset.

## Single-cell (Single-Cell Studio) on 10x PBMC3k
Both tools: cells with ≥ 200 genes and ≤ 20 % mitochondrial reads; genes in ≥ 3 cells; counts per 10k + log1p;
2,000 highly variable genes (Seurat flavour); scaling clipped at 10; 20 PCs; 15 neighbours; resolution 0.8.
The graphs differ by design: the Workbench builds a shared-nearest-neighbour graph and clusters it with Louvain
(as Seurat does); Scanpy uses UMAP connectivities and Leiden.

| Measure | Result |
|---|---|
| Cells kept | 2,699 in both, the same cells |
| Highly variable genes | 1,996 of 2,000 shared (Jaccard 0.996) |
| Principal components, |r| PC1–PC10 | 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.999, 0.23, 0.22, 0.94 |
| … best match among Scanpy's 10 PCs | 1.00 × 6, 0.999, 0.95, 0.89, 0.94 (PCs 8 and 9 have variances 0.4 % apart and swap order) |
| Clusters | Workbench 10, Scanpy 10; adjusted Rand index 0.75, NMI 0.84 between the two |
| Agreement with the published annotation (8 cell types, 2,638 cells) | ARI: Workbench 0.61, Scanpy 0.64; NMI 0.77 vs 0.79 |
| Top-10 marker genes shared per matched cluster | 8.6 on average (5–10) |
| Runtime (Workbench, one CPU thread, including UMAP on 200 cells) | 5.3 s |

Reading: up to and including the PCA the two pipelines give the same answer. Clusters agree to the degree expected
from two different graph-clustering methods, and both recover the annotated cell types about equally well (ARI of
about 0.6 at this resolution, which splits some annotated types).

Corrections from this benchmark: highly variable gene selection now follows Scanpy's Seurat flavour exactly
(dispersion of un-logged values, 20 equal-width bins, single-gene bins handled as Scanpy does), normalisation uses
library sizes over the genes kept, scaling clips only the upper side, and the randomized PCA uses more oversampling and
power iterations so that lower components match an exact SVD. Before these changes only 1,093 of the 2,000 variable
genes were shared and only PC1–PC2 agreed.

## Lab Studio against R and the original papers
Reference values are produced natively in R 4.5.3 in a separate conda environment (`benchmarks/lab/make-reference.R`,
`qpcr-reference.R`; packages drc 3.0.1, pwr 1.3.0, RNASeqPower 1.50.0, gsDesign 3.11.0, NormqPCR 1.56.0) and stored in
`benchmarks/lab/reference.json`. Unit tests check every row (`src/studios/lab/*.test.ts`); `npm run bench -- benchmarks/lab`
writes the deviations below to `results/lab.json`.

| Method | Reference | Cases | Largest deviation |
|---|---|---|---|
| Power / n, t tests (two-sample, paired, one-sample; two-sided and one-sided) | R `pwr.t.test` | 48 | n: 1.6e-12 relative; power: 3.7e-15 |
| Power / n, one-way ANOVA | `pwr.anova.test` | 18 | n: 9e-10; power: 9e-10 (R's non-central F stops at 1e-9) |
| Power / n, two proportions (Cohen's h) | `pwr.2p.test` | 8 | n: 9e-13; power: 7e-16 |
| RNA-seq n, power, detectable fold change, tolerable CV | `RNASeqPower::rnapower` | 18 | 4e-15 |
| Log-rank events (Schoenfeld) | `gsDesign::nEvents`, equal and 1:2 allocation | 6 | 2e-15 |
| Non-central t and F distribution functions | R `pt(ncp=)`, `pf(ncp=)` | 4 | 1e-12 (t); 2e-10 (F) |
| geNorm M, pairwise variation V, ranking, 10 genes | `NormqPCR::selectHKs` on its geNorm example | 1 | 4e-15 |
| Welch / Student t, one-way ANOVA, Holm on ΔCt | `t.test`, `aov`, `p.adjust` | 1 | 1e-14 |
| Standard curve slope, intercept, R², efficiency, CI | `lm`, `confint` | 1 | 2e-15 |

Dose–response (Levenberg–Marquardt) against `drc::drm` on its own datasets, with the same model (LL.4 / LL.5) and the same data:

| Dataset and model | RSS vs drc | Largest parameter difference | EC50 SE vs Gauss–Newton in R | EC50 SE vs drc's Hessian |
|---|---|---|---|---|
| ryegrass, 4PL | 1.2e-10 | 6.7e-6 | 3.2e-6 | 0.1 % |
| S. alba glyphosate, 4PL | 5e-12 | 3.0e-6 | 1.9e-6 | 0.4 % |
| S. alba bentazone, 4PL | 2e-11 | 3.5e-6 | 4.6e-7 | 0.4 % |
| secalonic acid, 4PL | 4e-10 | 8.3e-5 | 8.2e-6 | 8.2 % |
| ryegrass, bottom fixed at 0 | 1e-11 | 1.0e-6 | 2.9e-7 | 2.9 % |
| S. alba glyphosate, bottom fixed at 0 | 1e-11 | 2.8e-6 | 1.8e-6 | 2.9 % |
| simulated 5PL (seed 42) | 1.4e-7 | 7.0e-4 | 1.5e-4 | 2.1 % |
| S. alba bentazone, 5PL (real data) | 1.7e-4 | not identifiable | not identifiable | 18 % |

Reading the dose–response table: the Workbench reaches the same least-squares optimum as drc (our residual sum of
squares is never larger, and differs from drc's by at most 1.7e-4 relative; drc stops at an optimiser tolerance of
about 1e-7). Standard errors come from the Gauss–Newton matrix JᵀJ, the same quantity as in R `nls`; they agree with an
independent R computation to 1e-5, but drc reports Hessian-based errors, which differ by up to 8 % for 4PL fits on small
datasets. Five-parameter fits to real data (here 36 points) are nearly unidentifiable: shape parameters differ by more
than 10 % between optimisers while the fitted curves agree within 0.3 % of the response range, so only the curve, the
midpoint dose and the top and bottom are compared. The EC50 in the tables is drc's parameter `e`; for 5PL the app
reports the midpoint dose separately.

Worked examples from the papers (tests in `src/studios/lab/qpcr.test.ts`; data typed from the printed tables):
- **Livak and Schmittgen 2001, Table 1** (c-myc, GAPDH, brain vs kidney, six wells each, separate wells): ΔCt 6.86 and
  4.37, ΔΔCt −2.50, 5.6-fold, replicate SDs 0.15, 0.09, 0.06, 0.08 and propagated SDs 0.17 and 0.10, range 5.3–6.0:
  all reproduced.
- **Livak and Schmittgen 2001, Table 2** (same well): kidney ΔCt 4.47 ± 0.14 reproduced. The printed brain row (6.93 ±
  0.16) is not consistent with its own six wells, whose ΔCt values average 7.00 ± 0.21; the Workbench gives 7.00, so the
  published ΔΔCt of −2.47 (5.5-fold) becomes −2.53 (5.8-fold) from the printed data. We report this instead of
  tuning the test.
- **Pfaffl 2001, Table 3** (TyrA and PyrB against Gst, E = 2.09, 2.16, 1.99; three cDNA inputs at two levels): all 12
  published ratios R are reproduced from the Table 2 crossing points to within 0.5 % (efficiencies are printed to two
  decimals; the largest gap is 0.48 %, PyrB at 4.0 ng).

## Figure export
SVG, PDF (own minimal writer, no dependency) and PNG are drawn from one scene description, so all three show the same
marks. Tests parse the output (SVG: well-formed XML, millimetre size, one circle per point, editable text, no CSS
variables; PDF: cross-reference offsets, stream length, page size, one path per point, fonts; PNG: pixel size at 600 dpi
in the e2e test). Exported PDFs were also rasterised with poppler (`pdftoppm`) and inspected.
## Variant calling (Genome Studio) vs native bcftools on real E. coli reads
Data: the first 800,000 read-1 sequences (150 bp, 25×) of SRR2584863, an evolved line of the E. coli long-term
evolution experiment, mapped to its ancestor REL606 (NC_012967.1) **with 230 edits planted into the reference**
(150 SNVs, 40 deletions and 40 insertions of 1–10 bp; `bcftools/plant.mjs`). The real reads carry the original
sequence, so they show exactly those 230 differences, with a real Illumina error profile, on top of the line's own
mutations. Both sides run the same commands: minimap2 `-x sr`, samtools sort/index, bcftools mpileup
(MAPQ ≥ 20, BQ ≥ 20) and `call -mv --ploidy 1`. Workbench: the shipped WebAssembly builds (minimap2 2.22, samtools
1.17, bcftools 1.10), run under Node through the same pipeline code as the browser. Native: minimap2 2.28,
samtools 1.21, bcftools 1.21 (bioconda).

| | Workbench (WebAssembly) | Native |
|---|---|---|
| Planted SNVs recovered | 147 / 150 (98.0 %) | 147 / 150 (98.0 %) |
| Planted indels recovered | 77 / 80 (96.3 %) | 77 / 80 (96.3 %) |
| All calls | 250 | 252 |
| Calls beyond the planted edits (the line's own mutations) | 24 | 27 |
| Runtime, one thread | 388 s (minimap2 304 s, bcftools 60 s) | 25 s |

Concordance: every Workbench call is also a native call; the 3 native calls with no Workbench counterpart are
low-confidence (QUAL 6, 22 and 26). Genotypes agree for 100 % of shared calls and depth correlates at r = 0.98.

QUAL and DP4-derived allele fractions differ between the two versions of bcftools (Spearman 0.29 for QUAL, Pearson
0.84 for allele fraction). Running native bcftools 1.21 on the Workbench's own BAM reproduces the full native QUAL
exactly (Spearman 1.000, the same 252 calls), so the alignments are equivalent and the difference comes from the
caller version; the browser build of bcftools (biowasm) is 1.10.

The minimap2 WebAssembly build is about 20× slower than the native binary, so in-browser mapping of a bacterial
genome at 25× takes several minutes. One fix came out of this benchmark: the pipeline no longer runs a full samtools
text pileup when bcftools calls the variants (it is only needed for the built-in caller), saving ~30 s here.

## Maximum-likelihood phylogenetics (Phylogenetics Studio) vs IQ-TREE 3.1.4
Four public alignments; IQ-TREE was run with the reference models (HKY+F+G4, Poisson+G4) and its ModelFinder result.
The Workbench infers each tree by ML from a neighbour-joining start, with gamma rate heterogeneity (4 categories) and
the same model. Both sides are single-threaded for the tree search. The bootstrap is compared on the splits both
programs report.

| Dataset (taxa × sites) | Topology RF distance | Log-likelihood, Workbench vs IQ-TREE | Model chosen (BIC) | Runtime, Workbench vs IQ-TREE |
|---|---|---|---|---|
| woodmouse (15 × 965) | 0 (identical) | −1746.17 vs −1745.97 | HKY+F+G4, same as IQ-TREE | 0.4 s vs 0.4 s |
| Laurasiatherian (47 × 3179) | 0.205 | −45064.82 vs −45052.39 | HKY+F+G4, same | 58.5 s vs 29.8 s |
| chloroplast protein (19 × 5144) | 0 (identical) | −81528.73 vs −81528.72 | Poisson+G4, same | 171 s vs 154 s |
| yeast (8 × 127026) | 0.2 | −685053.88 vs −684686.80 | HKY+F+G4, same | 10.6 s vs 10.0 s |

What this shows:
- **Model selection agrees everywhere**: the BIC winner matches IQ-TREE's ModelFinder on all four datasets.
- **Two datasets give the same tree**; the other two have a normalised Robinson–Foulds distance of 0.205 and 0.2.
- **The gap in log-likelihood is in the search, not the likelihood.** Scoring IQ-TREE's own tree with the Workbench's
  likelihood gives −45053.18 for Laurasiatherian (0.8 units from IQ-TREE's optimum) and −684758.5 for yeast (72 units
  below it). Scoring the Workbench's tree in IQ-TREE gives −45064.46 and −684905.47. The Workbench's search settles on
  a less likely tree on the two larger datasets, and its parameter optimisation also stops short on yeast
  (α 0.457 vs 0.409, κ 5.45 vs 6.17). On the same tree the Workbench's likelihood is within 0.8 units of IQ-TREE's on
  Laurasiatherian and within 0.2 on woodmouse, but 72 units lower on yeast, so the parameter optimisation is also a
  gap there.
- **Bootstrap support is correlated with IQ-TREE's**: Pearson 0.92 (woodmouse, 12 splits) and 0.87 (Laurasiatherian,
  44 splits); mean absolute difference 5.2 and 12.6 percentage points. The Workbench bootstrap runs 100 replicates in
  4 s and 135 s; IQ-TREE's standard bootstrap ran 34 s and 2047 s. **This is not a like-for-like speed comparison**: the
  Workbench used 15 threads and IQ-TREE was started with `-T 1`. Single-thread runtimes are in the table above.
- Yeast is the largest alignment (127k sites), where a 0.2 RF distance and a 367-unit log-likelihood gap are the
  clearest remaining differences. The search, not the model, needs work.

Source: `benchmarks/results/phylogenetics.json`; reference runs in `benchmarks/iqtree/ref/`.

## Case-study figures: status
Captured: `docs/case-studies/figures/pbmc3k_umap.png`.
To capture (`npx playwright test -c docs/case-studies/playwright.config.ts`, ~10 minutes, mostly the E. coli run):
`airway_volcano.png`, `airway_ma.png`, `airway_gsea_reactome.png`, `pbmc3k_annotation.png`,
`ecoli_coverage.png`, `ecoli_variants.png`. The case-study README links to these files; the links are broken until they are captured.
## Genome tools (Genome Studio): CRISPR off-targets and primer specificity
Measured 2026-10-16 on an AMD Ryzen 7 7735HS laptop, one JavaScript thread (Node 22). Raw metrics:
`results/genome-tools-crispr.json`, `results/genome-tools-primers.json`. Genomes are the bundled RefSeq files
(`public/genomes`, NCBI public domain); guides and primers are sampled from them with a fixed seed.

### CRISPR off-target search against Cas-OFFinder 2.4.1
Reference: Cas-OFFinder 2.4.1 (BSD-3-Clause), run natively on the CPU through OpenCL (PoCL) by
`genome-tools/make-reference.mjs`; it is a benchmark tool only and is not shipped. Same genome, same guides (20 real
protospacers followed by NGG and 4 random 20-mers per genome; 16 real 23-nt Cas12a guides), same PAM (NRG = NGG plus NAG for
SpCas9; TTTV for Cas12a) and mismatch limit. A site counts as found only if guide, sequence, strand, coordinate, mismatch
count and site sequence are all identical.

| Genome | Nuclease, mismatch limit | Guides | Cas-OFFinder sites | Workbench sites | Identical | Workbench time |
|---|---|---|---|---|---|---|
| lambda (<0.1 Mb) | SpCas9 NRG, ≤ 4 | 24 | 20 | 20 | yes | 0.07 s |
| t7 (<0.1 Mb) | SpCas9 NRG, ≤ 4 | 24 | 20 | 20 | yes | 0.03 s |
| ecoli-k12 (4.6 Mb) | SpCas9 NRG, ≤ 4 | 24 | 37 | 37 | yes | 1.42 s |
| bsubtilis-168 (4.2 Mb) | SpCas9 NRG, ≤ 4 | 24 | 38 | 38 | yes | 1.48 s |
| mtb-h37rv (4.4 Mb) | SpCas9 NRG, ≤ 4 | 24 | 74 | 74 | yes | 2.02 s |
| saureus-8325 (2.8 Mb) | SpCas9 NRG, ≤ 4 | 24 | 41 | 41 | yes | 0.68 s |
| scer-s288c (12.2 Mb) | SpCas9 NRG, ≤ 4 | 24 | 95 | 95 | yes | 3.89 s |
| ecoli-k12 (4.6 Mb) | SpCas9 NRG, ≤ 6 | 8 | 401 | 401 | yes | 0.91 s |
| ecoli-k12 (4.6 Mb) | Cas12a TTTV, ≤ 4 | 16 | 16 | 16 | yes | 0.3 s |
| scer-s288c (12.2 Mb) | Cas12a TTTV, ≤ 4 | 16 | 58 | 58 | yes | 0.75 s |
**All 10 comparisons are identical: 800 of 800 sites in both directions, no missing and no extra site.** The search is
exhaustive (every PAM site on both strands), so identical output is the expected result when the semantics agree; the test
confirms that PAM handling, strand and coordinate conventions, reverse-complement handling and mismatch counting do.
Cas-OFFinder's OpenCL run took 0.4 to 0.7 s per genome on this machine, faster than the Workbench's single-threaded
JavaScript (up to 3.9 s for 24 guides on 12 Mb, about 13 ms per guide per Mb); both are fast enough for the browser.
Differences that the benchmark does not cover: Cas-OFFinder treats IUPAC ambiguity codes in the genome as matching, the
Workbench counts them as mismatches (S. aureus NCTC 8325 has one such base, which no tested site touched); bulged sites
(DNA/RNA bulges) are a Workbench extra and are covered by unit tests only, because Cas-OFFinder 2.4.1 does not search bulges.

Scoring is not part of the Cas-OFFinder comparison. CFD uses the published tables of Doench et al. (2016), taken from
the MIT-licensed crisprScore package (`scripts/make-cfd-data.mjs`); MIT uses the position weights of Hsu et al. (2013).
Unit tests check the PAM weights (NGG 1, NAG 0.259) and table lookups, and that the on-target site is excluded from the
aggregate specificity; the aggregate scores were not compared against another implementation.

### Primer specificity against exhaustive search
Two independent references: `bruteForceSites` (tests every window of every sequence) and a separate string-based scan
written in the test file. Rule: at most N mismatches, at most 1 in the last 5 bases of the 3′ end; mismatches are
weighted 5, 4, 3, 2, 2, then 1 from the 3′ end. Primers are 18 to 26 nt, 40 to 60 % GC, cut from the genome (half
reverse-complemented). The seeded search (pigeonhole: N+1 disjoint exact k-mers, then base-by-base verification) must
return exactly the same sites, mismatch counts and penalties.

| Genome | Primers | Max mismatches | Sites | Seed index | Seeded search | Exhaustive scan |
|---|---|---|---|---|---|---|
| ecoli-k12 | 12 | 3 | 35 (22 exact) | pigeonhole k-mers | 0.50 s | 4.53 s |
| bsubtilis-168 | 12 | 4 | 62 (30 exact) | pigeonhole k-mers | 1.42 s | 4.70 s |
| scer-s288c | 10 | 3 | 26 (10 exact) | pigeonhole k-mers | 1.26 s | 8.97 s |
| lambda | 8 | 5 | 11 (8 exact) | none (seeds < 4 bp, scans) | 0.03 s | 0.04 s |
**The seeded search and both references agree on every site, in all four genomes.** The seed index is used only when
each of the N+1 segments has at least 4 bases (otherwise a plain scan runs, as for lambda at 5 mismatches); with it the search
is 3 to 9 times faster than the exhaustive scan on 4 to 12 Mb. The amplicon predictor was checked against an all-pairs
enumeration, and for 8 primer pairs designed by Sequence Studio on random 900-bp E. coli regions the intended product
was found at its exact coordinates 8 of 8 times, each as the single perfect product in the genome. There is no comparison
with Primer-BLAST (a remote NCBI service, not run here), so the product list is validated against the stated rule, not
against NCBI's thermodynamic filtering.
