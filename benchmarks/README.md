# Benchmarks against reference tools

## limma / edgeR (differential expression)
`limma/make-fixture.R` simulates a 3-group design with a batch covariate and a paired before/after design, then runs
edgeR (TMM) + limma (voom, lmFit, contrasts.fit, eBayes, topTable). `src/studios/expression/linear.test.ts` checks the
Nayancode implementation against those results on every test run. Agreement (R 4.4.3, edgeR 4.4.0, limma 3.62.1):
TMM factors to ~1e-11, log-fold changes to ~1e-11, moderated t correlation 1.000000, identical significant-gene sets
for coefficient tests, contrasts, the moderated F-test and the paired design.

Planned: DESeq2, Scanpy, bcftools and IQ-TREE comparisons on public datasets.
