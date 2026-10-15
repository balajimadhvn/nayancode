"""Reference results from Scanpy for the Single-Cell Studio benchmark (singlecell.bench.test.ts).

Dataset: 10x Genomics PBMC3k (2,700 peripheral blood mononuclear cells; CC BY 4.0), downloaded by benchmarks/fetch.sh.
Settings match the Workbench defaults (src/studios/singlecell/kernels.ts, SC_DEFAULTS): cells with >= 200 genes and
<= 20 % mitochondrial counts, genes in >= 3 cells, counts per 10k + log1p, 2,000 Seurat-flavour highly variable genes,
scaling clipped at 10, 20 principal components, 15 neighbours, Leiden at resolution 0.8, Welch t-test markers.
Cell-type labels for an independent check come from Scanpy's annotated PBMC3k (sc.datasets.pbmc3k_processed()).

Run: bash benchmarks/fetch.sh
     python -m venv .venv && .venv/bin/pip install -r benchmarks/scanpy/requirements.txt
     .venv/bin/python benchmarks/scanpy/make-reference.py
"""
import gzip, json, sys
from importlib.metadata import version
import numpy as np
import scanpy as sc

src = sys.argv[1] if len(sys.argv) > 1 else "benchmarks/.cache/pbmc3k/filtered_gene_bc_matrices/hg19"
out = "benchmarks/scanpy/reference.json.gz"
sc.settings.verbosity = 0
sc.settings.datasetdir = "benchmarks/.cache"  # pbmc3k_processed.h5ad is downloaded here, outside git

adata = sc.read_10x_mtx(src, var_names="gene_ids")  # Ensembl IDs are unique; symbols are not
adata.var["mt"] = adata.var["gene_symbols"].str.upper().str.startswith("MT-")
sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], percent_top=None, log1p=False, inplace=True)
adata = adata[(adata.obs.n_genes_by_counts >= 200) & (adata.obs.pct_counts_mt <= 20)].copy()
sc.pp.filter_genes(adata, min_cells=3)
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
adata.raw = adata
sc.pp.highly_variable_genes(adata, flavor="seurat", n_top_genes=2000)
hvg = adata.var_names[adata.var.highly_variable].tolist()
ad = adata[:, adata.var.highly_variable].copy()
sc.pp.scale(ad, max_value=10)
sc.tl.pca(ad, n_comps=20, svd_solver="arpack", random_state=0)
sc.pp.neighbors(ad, n_neighbors=15, n_pcs=20, random_state=0)
sc.tl.leiden(ad, resolution=0.8, flavor="igraph", n_iterations=2, random_state=0)
sc.tl.rank_genes_groups(ad, "leiden", method="t-test", use_raw=True)
markers = {}
for g in ad.obs["leiden"].cat.categories:
    names = ad.uns["rank_genes_groups"]["names"][g][:10]
    markers[g] = [adata.raw.var.loc[n, "gene_symbols"] for n in names]

ann = sc.datasets.pbmc3k_processed()
labels = ann.obs["louvain"].astype(str).to_dict()

ref = {
    "versions": {p: version(p) for p in ["scanpy", "anndata", "numpy", "scipy", "scikit-learn", "leidenalg", "igraph"]},
    "settings": {"minGenes": 200, "maxPctMito": 20, "minCells": 3, "nHvg": 2000, "nPcs": 20, "k": 15, "resolution": 0.8},
    "cells": ad.obs_names.tolist(),
    "hvg": hvg,
    "pcVarianceRatio": ad.uns["pca"]["variance_ratio"].tolist(),
    "pcs": np.round(ad.obsm["X_pca"][:, :10], 5).tolist(),
    "leiden": ad.obs["leiden"].astype(str).tolist(),
    "markers": markers,
    "annotation": {c: labels[c] for c in ad.obs_names if c in labels},
}
with gzip.open(out, "wt") as f:
    json.dump(ref, f)
print(f"{ad.n_obs} cells, {len(hvg)} HVGs, {ad.obs['leiden'].nunique()} Leiden clusters -> {out}")
