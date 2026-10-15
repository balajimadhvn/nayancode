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
