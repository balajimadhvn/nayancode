# Benchmarks against reference tools

Each benchmark runs the Workbench's own analysis code (the same TypeScript the browser runs, here under Node) on public
data and compares it with results computed by the reference tool. Reference results are committed, so the comparisons
run without R or Python. Numbers are in [RESULTS.md](RESULTS.md); the raw metrics are written to `results/`.

```bash
bash benchmarks/fetch.sh   # public datasets into benchmarks/.cache (checksummed; not committed)
npm run bench              # all benchmarks; the expression ones need no download
```

| Benchmark | Data | Reference tools | Code |
|---|---|---|---|
| Differential expression | airway (GSE52778, paired, 8 samples) and pasilla (GSE18508, two factors, 7 samples) | DESeq2 1.50.2, limma 3.66.0 (voom), edgeR 4.8.2 (QL), R 4.5.3 | `deseq2/` |
| Single-cell clustering | 10x PBMC3k (2,700 cells) | Scanpy 1.12.4 (Leiden, igraph 1.0) | `scanpy/` |
| limma internals | simulated 3-group + batch and paired designs | limma 3.66.0, edgeR 4.8.2 | `limma/` → `src/studios/expression/linear.test.ts` |

## Regenerating the reference results
- Expression: `Rscript benchmarks/deseq2/make-reference.R benchmarks/.cache` (needs DESeq2, limma, edgeR, jsonlite).
- Single-cell: `python -m venv .venv && .venv/bin/pip install -r benchmarks/scanpy/requirements.txt`, then
  `.venv/bin/python benchmarks/scanpy/make-reference.py`.
- limma internals: `Rscript benchmarks/limma/make-fixture.R`.

## What the tests enforce
Thresholds sit just below the measured values, so a change that lowers agreement fails `npm run bench`:
identical results to limma-voom (log-fold changes within 1e-6, t within 1e-4, identical significant genes);
log-fold-change correlation > 0.98 with DESeq2 and > 0.99 with edgeR; for PBMC3k the same cells, > 99 % shared highly
variable genes, PCs 1–7 with |r| > 0.99, cluster ARI with Scanpy > 0.7 and > 8 of each cluster's top-10 markers shared.

Data licences: airway and pasilla counts come from LGPL Bioconductor data packages (see `deseq2/NOTICE.md`); PBMC3k is
published by 10x Genomics under CC BY 4.0 and is downloaded, not redistributed.
