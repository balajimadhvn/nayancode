<p align="center"><img src="public/brand/solagene-logo.svg" alt="Solagene: Research, Education, Innovation" width="420"></p>

# Nayancode Workbench

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23393495.svg)](https://doi.org/10.5281/zenodo.23393495)

**Free, open-source bioinformatics and cheminformatics that runs in your web browser.**
By [Solagene](https://solagene.com) · Licence: [Apache-2.0](LICENSE) · Use it: **https://solagene.com/workbench/** (mirror: https://balajimadhvn.github.io/nayancode/)

Nayancode is a set of analysis studios that run entirely client-side, using Web Workers and WebAssembly. There is
nothing to install and no account to create.

**Privacy, stated precisely.** Your files are read and analysed on your own computer; they are never uploaded.
Some studios offer optional look-ups in public databases (PDB, AlphaFold DB, UniProt, ClinVar, gnomAD via MyVariant,
Ensembl, Open Targets, CIViC, PubChem, ChEMBL). These send only the identifier you search for (for example a gene
symbol, variant or compound name), and only when you ask. A badge in the header shows whether anything has been sent.

## Studios

| Studio | What it does | Engine | Current limits |
|---|---|---|---|
| Sequence | ORFs, translation, restriction digest and virtual gel, primer design and in-silico PCR, Golden Gate / Gibson cloning, CRISPR guides, Sanger traces, motifs (JASPAR) | TypeScript | Browser-scale sequences |
| Genome | FASTQ QC, read mapping (minimap2), sort / index / depth / pileup (samtools), SNV and indel calling (bcftools), coverage | minimap2 + samtools + bcftools (WebAssembly) | ~100 Mb reference, ~300 MB reads; no structural variants |
| Docking | Receptor and ligand preparation (pH 7.4, Gasteiger charges, PDBQT), box from a co-crystal ligand or residues, AutoDock Vina docking, pose viewer and interaction profile, small virtual screens | AutoDock Vina 1.2.7 (WebAssembly) | Redocking: 35.7 % of top poses < 2 Å on 42 complexes, scores identical to native Vina |
| Variant | VCF parsing and filtering, Ti/Tv and spectra, mutational signatures (NMF + NNLS), ClinVar / gnomAD / CIViC / Ensembl VEP evidence | TypeScript | Research use only |
| Expression | TMM + voom linear models for any design (groups, covariates, batches, paired samples; contrasts and F-tests), PCA, ComBat for plots, ORA and preranked GSEA (Reactome, WikiPathways, GO) | TypeScript | Results agree with edgeR + limma; DESeq2's negative-binomial model is not implemented |
| Single-Cell | QC, HVGs, PCA, kNN graph, Louvain clustering, UMAP and t-SNE, marker genes, 10x import | TypeScript | Embeddings on 3,000 cells by default |
| Microbiome | Alpha / beta diversity, UniFrac, PERMANOVA, CLR, differential abundance | TypeScript | Amplicon-scale tables |
| Chemistry | Descriptors, fingerprints, similarity, substructure, Lipinski, QSAR with cross-validation and Y-randomisation | RDKit (WebAssembly) | Interactive library sizes |
| Structure | 3D viewing (Mol*), interaction profiling, geometry, pocket heuristics | Mol* + TypeScript | Pocket score is heuristic |
| Lab | qPCR ΔΔCt and Pfaffl with multiple reference genes, 4PL / 5PL dose–response with IC50 confidence intervals, power and sample size | TypeScript | Validated against R (drc, pwr, NormqPCR) |
| Alignment & Phylogenetics | MSA, distances, NJ/UPGMA with bootstrap, maximum-likelihood trees (JC69/K80/HKY85 +Γ, NNI) with parallel bootstrap | TypeScript | ML up to 150 taxa, local search only |

Also: a Gene Atlas, a Report builder that writes the Methods section from each analysis's provenance, and an importer
for nf-core pipeline outputs.

## Validation
Every analysis kernel is tested against a known answer: published reference values (for example t-distribution
tables, Benjamini–Hochberg against R's `p.adjust`, UMAP curve parameters), hand-computed examples, or simulations with
a planted truth (planted variants, differentially expressed genes, batch effects, clusters, signatures and pathways).
`npm test` runs 311 unit tests; `npm run e2e` runs 23 end-to-end browser tests that execute each studio on demo data.

Benchmarks against reference tools on public data ([benchmarks/RESULTS.md](benchmarks/RESULTS.md), `npm run bench`):
- **Differential expression** (airway, pasilla): identical to limma-voom; fold-change correlation 0.996–0.999 with
  edgeR and 0.991–0.997 with DESeq2, recovering 91–99 % of DESeq2's significant genes.
- **Single-cell** (10x PBMC3k): the same cells, 1,996 of 2,000 variable genes and the same leading principal
  components as Scanpy; clusters agree with ARI 0.75, and both tools match the published cell-type annotation
  about equally (ARI 0.61 vs 0.64).

Comparisons for variant calling (bcftools on the command line) and phylogenetics (IQ-TREE) are planned.

## Cite
Madhavan B. *Nayancode Workbench: open-source bioinformatics and cheminformatics in the web browser.* Solagene, 2026.
DOI: [10.5281/zenodo.23393495](https://doi.org/10.5281/zenodo.23393495) (all versions; version 1.1.0 is
[10.5281/zenodo.23418144](https://doi.org/10.5281/zenodo.23418144), version 1.0.0 is
[10.5281/zenodo.23393496](https://doi.org/10.5281/zenodo.23393496)). GitHub's "Cite this repository" button gives the same
reference from `CITATION.cff`. Please cite the version you used.

## Run locally
```bash
npm install
npm run dev        # http://localhost:5180
npm test           # unit tests
npm run build      # licence audit + type-check + production build into dist/
npm run e2e        # browser tests against dist/
```
`BASE_PATH=/nayancode/ npm run build` builds for a sub-path (as on GitHub Pages).

## Contributing and support
See [CONTRIBUTING.md](CONTRIBUTING.md). Questions: support@solagene.com. Issues: https://github.com/balajimadhvn/nayancode/issues

Research and education use. Not a medical device; not for clinical decisions about individual patients.
