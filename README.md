# Nayancode Workbench

**Free, open-source bioinformatics and cheminformatics that runs in your web browser.**
By [Vivofold](https://vivofold.in) · Licence: [Apache-2.0](LICENSE) · Use it: **https://balajimadhvn.github.io/nayancode/**

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
| Genome | FASTQ QC, read mapping (minimap2), sort / index / depth / pileup (samtools), SNV calling, coverage | minimap2 + samtools (WebAssembly) | ~100 Mb reference, ~300 MB reads; substitutions only |
| Variant | VCF parsing and filtering, Ti/Tv and spectra, mutational signatures (NMF + NNLS), ClinVar / gnomAD / CIViC / Ensembl VEP evidence | TypeScript | Research use only |
| Expression | Normalisation, PCA, moderated-t differential expression with FDR, ComBat batch correction, ORA and preranked GSEA (Reactome, WikiPathways, GO) | TypeScript | Two-group designs (design-matrix models in progress) |
| Single-Cell | QC, HVGs, PCA, kNN graph, Louvain clustering, UMAP and t-SNE, marker genes, 10x import | TypeScript | Embeddings on 3,000 cells by default |
| Microbiome | Alpha / beta diversity, UniFrac, PERMANOVA, CLR, differential abundance | TypeScript | Amplicon-scale tables |
| Chemistry | Descriptors, fingerprints, similarity, substructure, Lipinski, QSAR with cross-validation and Y-randomisation | RDKit (WebAssembly) | Interactive library sizes |
| Structure | 3D viewing (Mol*), interaction profiling, geometry, pocket heuristics | Mol* + TypeScript | Pocket score is heuristic |
| Alignment & Phylogenetics | MSA, distances, NJ/UPGMA, maximum-likelihood trees with model selection and bootstrap | TypeScript | ~60 taxa for ML |

Also: a Gene Atlas, a Report builder that writes the Methods section from each analysis's provenance, and an importer
for nf-core pipeline outputs.

## Validation
Every analysis kernel is tested against a known answer: published reference values (for example t-distribution
tables, Benjamini–Hochberg against R's `p.adjust`, UMAP curve parameters), hand-computed examples, or simulations with
a planted truth (planted variants, differentially expressed genes, batch effects, clusters, signatures and pathways).
`npm test` runs 187 unit tests; `npm run e2e` runs 13 end-to-end browser tests that execute each studio on demo data.
Head-to-head benchmarks against DESeq2, limma, Scanpy, bcftools and IQ-TREE on public data are being added under
`benchmarks/`.

## Cite
Use the "Cite this repository" button on GitHub (from `CITATION.cff`), or the Zenodo DOI of the release you used.

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
See [CONTRIBUTING.md](CONTRIBUTING.md). Questions: support@vivofold.in. Issues: https://github.com/balajimadhvn/nayancode/issues

Research and education use. Not a medical device; not for clinical decisions about individual patients.
