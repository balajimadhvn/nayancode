# Data notice

`airway_counts.tsv.gz` / `airway_samples.tsv` are taken from the Bioconductor data package **airway** 1.32.0 (LGPL),
gene-level counts from Himes BE et al. (2014) *RNA-Seq transcriptome profiling identifies CRISPLD2 as a glucocorticoid
responsive gene that modulates cytokine function in airway smooth muscle cells.* PLoS ONE 9:e99625 (GEO GSE52778).

`pasilla_counts.tsv.gz` / `pasilla_samples.tsv` are taken from the Bioconductor data package **pasilla** 1.40.0 (LGPL),
counts from Brooks AN et al. (2011) *Conservation of an RNA regulatory map between Drosophila and mammals.*
Genome Res 21:193–202 (GEO GSE18508).

Only genes with a non-zero total count are kept; values are otherwise unchanged. `reference.json.gz` holds results
computed from these counts with DESeq2, limma and edgeR by `make-reference.R`.
