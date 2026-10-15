# Roadmap: tools that can run on free static hosting

Rule: every tool runs in the visitor's browser (WebAssembly, WebAssembly threads, WebGPU, Web Workers), so the whole
Workbench stays hostable on GitHub Pages or Cloudflare Pages at no cost. Anything that needs a server is out of scope.
Shipped code must be permissively licensed (MIT, BSD, Apache-2.0, LGPL as a separate module); GPL tools may be used only
as reference implementations in CI benchmarks, never shipped. Browser limits to design around: about 2 to 4 GB of
WebAssembly memory per tab, a few CPU threads, optional WebGPU, and static files under 100 MB each.

## Tier 1: highest value for researchers and for the paper
| Tool | How it runs free | Notes |
|---|---|---|
| Molecular docking (AutoDock Vina) | Vina compiled to WebAssembly (Apache-2.0; Webina-style build); ligand prep with RDKit, receptor from PDB / AlphaFold DB | One ligand, or a library of hundreds; exhaustiveness limited by threads. Add redocking validation on PDBbind-type complexes (RMSD < 2 Å rate) |
| Publication-ready figures (shipped for scatter, bar, heatmap, line, histogram, curve charts; trees, MSA and box plots to follow) | Pure TypeScript SVG/PDF/PNG export | Why people cite tools; about one week |
| qPCR ΔΔCt, dose-response / IC50, power and sample size (shipped as Lab Studio) | Pure TypeScript | Wet-lab users; links to Vedicgen courses |
| ~~Genome viewer (igv.js) and BAM/VCF/BED viewer~~ done | igv.js (MIT) | Local BAM/CRAM/VCF/BED/GFF/bigWig, Genome Studio and Variant Studio hand-off, SVG export |
| ~~Primer specificity and CRISPR off-targets on small genomes~~ done | seed k-mer index and exhaustive PAM scan in a worker; 8 RefSeq genomes as static files | Validated against Cas-OFFinder and exhaustive search (benchmarks/RESULTS.md). Large genomes: pre-built indexes on Zenodo or Hugging Face, after checking CORS |
| ~~Reference-genome bundles~~ done | Static files under 25 MiB each (`public/genomes`, manifest with SHA-256) | Selectable as the mapping reference |
| Case-study notebooks | Static pages generated from the benchmarks | Needed for the paper and for teaching |

## Tier 2: strong additions
| Tool | How it runs free | Notes |
|---|---|---|
| ADMET / property prediction | RDKit descriptors + small gradient-boosted or random-forest models trained offline on open data (ESOL, lipophilicity, BBBP, hERG, TDC under open licences), shipped as JSON | Validate with scaffold splits; state applicability domain |
| Molecule tools: MCS, scaffold analysis, R-group tables, reaction enumeration, pharmacophore and shape similarity | RDKit WebAssembly (BSD) | Mostly UI work |
| Protein language-model features | ESM-2 small models (MIT) through ONNX Runtime Web or transformers.js with WebGPU; embeddings, masked-marginal variant scoring | Model files 30 to 150 MB: host on Hugging Face (free), not in the repository. Be explicit about accuracy |
| Protein structure utilities | Superposition and RMSD, normal-mode analysis (elastic network), pocket detection (fpocket-style, clean-room), B-factor and contact maps | Pure TypeScript or small WebAssembly |
| Pseudoalignment for small transcriptomes | kallisto-style k-mer index in WebAssembly or TypeScript for bacteria and yeast | Human-scale indexes are too large; keep nf-core import for those |
| Metagenome profiling | Mash/sourmash-style sketches against a small bundled database (tens of MB) | Genus-level only; label as screening |
| Small-genome assembly and polishing | miniasm-style overlap assembly (MIT) in WebAssembly | Bacterial and viral scale |
| Survival analysis and GWAS-lite | Kaplan-Meier, log-rank, Cox in TypeScript; PLINK-style association on small cohorts | Clinical-style data stays local |
| Network and pathway view | STRING and Reactome APIs (CORS enabled, CC BY) plus force-directed graphs | Sends only gene identifiers, as the privacy page states |
| Proteomics basics | In-silico digest, peptide mass and isotope patterns, mzML viewer | Pure TypeScript |
| Larger single-cell | Approximate kNN, WebGPU matrix kernels, doublet detection, clean-room integration (Harmony-style; the reference implementations are GPL, so write from the paper) | Raises the 3,000-cell embedding limit |

## Not realistic on free static hosting
Training or running AlphaFold/ESMFold-scale structure prediction, GPU docking screens of millions of compounds,
production molecular dynamics (GROMACS/OpenMM at scale), human-scale alignment and variant calling from raw FASTQ,
accounts, shared projects and cloud storage. For these the Workbench should keep exporting standard files for nf-core,
GROMACS and similar tools, and say so on the page.

## Platform items
- Multi-threaded WebAssembly needs cross-origin isolation (COOP/COEP headers). GitHub Pages cannot send headers: use
  `coi-serviceworker`, or move to Cloudflare Pages (`public/_headers` is already prepared). Required before docking and
  parallel mapping reach full speed.
- Large model and data files: Hugging Face datasets, Zenodo and GitHub Releases are free and serve CORS; check each before
  relying on it, and keep checksums in `benchmarks/fetch.sh`-style scripts.
- Optional batch lane for public data only: GitHub Actions can run heavy reference tools on public inputs and publish
  results as artifacts. It breaks the "files never leave your computer" promise, so offer it only as a clearly separate,
  opt-in feature.
- Keep every shipped dependency in `scripts/license-check.mjs`, and add a benchmark or known-answer test with each tool.
