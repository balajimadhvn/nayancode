export type StudioStatus = 'live' | 'building' | 'planned';

export interface StudioDef {
  id: string;
  path: string;
  name: string;
  short: string;
  blurb: string;
  status: StudioStatus;
  milestone: 'M1' | 'M2' | 'M3';
  accent: number; // hue 0-360
  inputs: string[];
  analyses: string[];
  engines: string;
  limits: string;
  cloudLater: string;
}

export const STUDIOS: StudioDef[] = [
  {
    id: 'sequence', path: '/sequence', name: 'Sequence Studio', short: 'Sequence',
    blurb: 'Analyse, digest, design and align DNA, RNA and protein sequences.',
    status: 'live', milestone: 'M1', accent: 190,
    inputs: ['FASTA', 'Pasted text', 'Sanger .ab1 traces'],
    analyses: ['ORF finder & translation', 'Restriction digest + virtual gel', 'Primer design + in-silico PCR', 'Cloning simulator (Golden Gate, Gibson)', 'CRISPR guides + off-target scan', 'Sanger viewer, trimming & comparison', 'Protein analysis & JASPAR motif scan', 'Pairwise alignment & dotplot', 'Proteomics basics', 'Protein language-model features (experimental)'],
    engines: 'TypeScript kernels in a Web Worker',
    limits: 'Browser-scale sequences; genome-wide searches belong on the future cloud tier',
    cloudLater: 'Genome-wide CRISPR off-targets, large-database homology search',
  },
  {
    id: 'expression', path: '/expression', name: 'Expression Studio', short: 'Expression',
    blurb: 'Bulk RNA-seq: counts to QC, differential expression and figures.',
    status: 'live', milestone: 'M1', accent: 265,
    inputs: ['Count matrix CSV/TSV', 'Sample sheet'],
    analyses: ['Moderated-t differential expression', 'ComBat batch correction', 'PCA & sample QC', 'Volcano, MA & clustered heatmap', 'Enrichment: ORA + preranked GSEA', 'Pseudoalignment (FASTQ to counts)', 'Gene network'],
    engines: 'TypeScript kernels in a Web Worker',
    limits: 'Two-group designs; confirm key findings with DESeq2 or limma',
    cloudLater: 'FASTQ → counts via nf-core/rnaseq',
  },
  {
    id: 'chemistry', path: '/chemistry', name: 'Chemistry Studio', short: 'Chemistry',
    blurb: 'Curate, filter, search and profile compound libraries with RDKit.',
    status: 'live', milestone: 'M1', accent: 150,
    inputs: ['SMILES', 'CSV with SMILES column', 'PubChem / ChEMBL import'],
    analyses: ['Descriptors, curation & alerts', 'Similarity search (Morgan/Tanimoto)', 'Substructure (SMARTS)', 'Chemical space + Butina clusters', 'QSAR Lab (RF, kNN, ridge, applicability domain)', 'ADMET, scaffolds, MCS, R-groups, reaction enumeration, pharmacophore and shape similarity'],
    engines: 'RDKit (WebAssembly) in a worker',
    limits: 'Interactive library sizes; models are validated by cluster CV and Y-randomisation',
    cloudLater: 'GNN QSAR, large-scale docking, generative design',
  },
  {
    id: 'structure', path: '/structure', name: 'Structure Studio', short: 'Structure',
    blurb: 'Explore protein structures from the PDB and AlphaFold with Mol*.',
    status: 'live', milestone: 'M1', accent: 20,
    inputs: ['PDB ID', 'UniProt ID (AlphaFold)', 'PDB / mmCIF files'],
    analyses: ['3D viewing & selection (Mol*)', 'Interaction profiler', 'Pocket detection', 'SASA & Kabsch superposition (TM-score)', 'Contact maps, normal modes, RMSD matrix'],
    engines: 'Mol* (WebGL) + TypeScript kernels',
    limits: 'Heavy-atom geometry only; pocket score is heuristic, not a druggability model',
    cloudLater: 'Structure prediction, MD, virtual screening',
  },
  {
    id: 'docking', path: '/docking', name: 'Docking Studio', short: 'Docking',
    blurb: 'Dock small molecules into protein structures with AutoDock Vina, in your browser.',
    status: 'live', milestone: 'M1', accent: 35,
    inputs: ['PDB ID / AlphaFold DB / PDB or mmCIF file', 'SMILES, SDF, MOL2 or PubChem name'],
    analyses: ['Receptor and ligand preparation (pH 7.4, Gasteiger charges, PDBQT)', 'Vina 1.2.7 docking with box from a co-crystal ligand, residues or coordinates', 'Pose viewer and interaction profile', 'Small virtual screen (up to 300 compounds)', 'Redocking validation against crystal poses'],
    engines: 'AutoDock Vina 1.2.7 (WebAssembly, threads when cross-origin isolated) + RDKit + TypeScript preparation',
    limits: 'Rigid receptor, one box up to 40 Å, ligands up to 70 heavy atoms and 20 rotatable bonds, up to 300 compounds per screen; scores are estimates, not binding free energies',
    cloudLater: 'Flexible side chains, GPU and large-library screening',
  },
  {
    id: 'phylo', path: '/phylogenetics', name: 'Alignment & Phylogenetics', short: 'Phylogenetics',
    blurb: 'MSA, curation, tree inference and publication-grade tree figures.',
    status: 'live', milestone: 'M1', accent: 120,
    inputs: ['FASTA', 'Newick'],
    analyses: ['Progressive multiple alignment', 'Conservation scoring', 'NJ / UPGMA with bootstrap', 'Maximum-likelihood trees (±Γ, AIC/BIC)', 'Newick import & export'],
    engines: 'TypeScript kernels in a Web Worker',
    limits: 'Maximum-likelihood trees up to 150 taxa (local NNI search); bootstrap runs in parallel on your CPU cores',
    cloudLater: 'Large ML trees, dating, dN/dS',
  },
  {
    id: 'genome', path: '/genome', name: 'Genome Studio', short: 'Genome',
    blurb: 'Read QC, small-genome alignment, assembly QC, comparison and tracks.',
    status: 'live', milestone: 'M1', accent: 55,
    inputs: ['FASTQ', 'FASTA', 'BAM / CRAM + index', 'VCF', 'BED / GFF / GTF', 'bigWig'],
    analyses: ['Streaming FASTQ read QC', 'Mapping, SNV & indel calling (minimap2, samtools, bcftools)', 'igv.js genome viewer (local BAM, CRAM, VCF, BED, GFF, bigWig)', '8 bundled RefSeq reference genomes', 'Primer specificity and off-target amplicons', 'CRISPR off-targets with CFD and MIT scores', 'Assembly metrics', 'BED algebra', 'MinHash ANI', 'Small-genome assembly'],
    engines: 'WebAssembly (minimap2, samtools) + igv.js',
    limits: 'Mapping up to about a 100 Mb reference and 300 MB of reads; SNVs and short indels, no structural variants. Primer and CRISPR searches suit genomes up to a few tens of Mb (bundled: phage, bacteria, yeast)',
    cloudLater: 'Assembly, human alignment & variant calling',
  },
  {
    id: 'variant', path: '/variants', name: 'Variant Studio', short: 'Variants',
    blurb: 'VCF exploration with germline, cancer and GWAS modes.',
    status: 'live', milestone: 'M1', accent: 330,
    inputs: ['VCF', 'GWAS summary statistics'],
    analyses: ['VCF QC & filtering', 'Somatic TMB / VAF', 'Mutational signatures (NMF, no COSMIC)', 'Evidence: ClinVar, CIViC, Open Targets, gnomAD', 'Ensembl VEP annotation', 'GWAS Manhattan & QQ plots', 'GWAS-lite association testing'],
    engines: 'TypeScript kernels; public APIs only when you ask for a lookup',
    limits: 'Evidence lookups call public databases only when you ask; research use only',
    cloudLater: 'Joint calling, LD, PRS, somatic calling',
  },
  {
    id: 'singlecell', path: '/single-cell', name: 'Single-Cell & Spatial', short: 'Single-cell',
    blurb: 'scRNA-seq from matrix to annotated clusters, then spatial context.',
    status: 'live', milestone: 'M1', accent: 300,
    inputs: ['Count matrix', 'Spatial coordinates (optional)', '10x triplet (via Import)'],
    analyses: ['QC, HVG & PCA', 'SNN-Louvain clustering', 'UMAP or t-SNE', 'Markers & annotation', "Spatial statistics (Moran's I)", 'Batch integration, doublet scoring, approximate neighbours'],
    engines: 'TypeScript kernels in a Web Worker',
    limits: 'UMAP and t-SNE embed up to 3,000 cells by default; clustering uses all cells',
    cloudLater: 'Atlas-scale integration on GPU',
  },
  {
    id: 'microbiome', path: '/microbiome', name: 'Microbiome Studio', short: 'Microbiome',
    blurb: 'Diversity, ordination and differential abundance for amplicon data.',
    status: 'live', milestone: 'M1', accent: 90,
    inputs: ['Feature table', 'Sample metadata', 'Newick tree (optional)'],
    analyses: ['Alpha / beta diversity', 'Weighted & unweighted UniFrac', 'PCoA & PERMANOVA', 'CLR differential abundance', 'Rarefaction', 'Reference screening'],
    engines: 'TypeScript kernels in a Web Worker',
    limits: 'Amplicon-scale feature tables',
    cloudLater: 'DADA2, shotgun profiling, MAGs',
  },
  {
    id: 'lab', path: '/lab', name: 'Lab Studio', short: 'Lab',
    blurb: 'Bench calculators: qPCR relative quantification, dose–response curves, power and sample size.',
    status: 'live', milestone: 'M1', accent: 40,
    inputs: ['Plate CSV (long or wide)', 'Dose–response CSV', 'Standard-curve CSV', 'Initial-rate kinetics CSV', 'Plate-reader plate + layout CSV', 'Growth-curve CSV'],
    analyses: ['qPCR ΔΔCt (Livak) and efficiency-corrected Pfaffl, multiple reference genes, geNorm', 'Technical-replicate outlier flags, t-test / ANOVA on ΔCt', 'Standard-curve efficiency', '4PL / 5PL dose–response (IC50, Hill slope, 95 % CI)', 'Power and sample size: t, ANOVA, proportions, log-rank, RNA-seq', 'Survival', 'Enzyme kinetics: Michaelis–Menten, substrate inhibition, Hill and global inhibition fits with AIC', 'Plate reader / ELISA: blank subtraction, 4PL/5PL standard curve, LOD/LOQ', 'Growth curves: modified Gompertz and logistic fits, model-free μmax'],
    engines: 'TypeScript (Levenberg–Marquardt, non-central t/F)',
    limits: 'Equal-sized groups in the power tools; dose–response assumes independent replicates and constant variance',
    cloudLater: '',
  },
  {
    id: 'plasmid', path: '/plasmid', name: 'Plasmid Studio', short: 'Plasmid',
    blurb: 'GenBank import, automatic annotation of standard elements, restriction mapping and a circular map figure.',
    status: 'live', milestone: 'M1', accent: 20,
    inputs: ['GenBank flat file', 'FASTA sequence'],
    analyses: ['GenBank parse and write (join, complement, partial locations)', 'Library annotation of promoters, tags, origins and resistance genes', 'Restriction map and fragment sizes', 'Primer binding sites and Tm', 'Circular map figure (SVG/PDF/PNG)'],
    engines: 'TypeScript kernels in a Web Worker',
    limits: 'The built-in element library is small (13 elements); annotation is nucleotide identity, not a gene model',
    cloudLater: '',
  },
  {
    id: 'biologics', path: '/biologics', name: 'Biologics Studio', short: 'Biologics',
    blurb: 'Heuristic Kabat CDR identification and a sequence-liability developability screen for antibodies.',
    status: 'live', milestone: 'M1', accent: 330,
    inputs: ['VH / VL amino-acid sequence', 'scFv sequence'],
    analyses: ['Heuristic Kabat CDR identification', 'Sequence liabilities (deamidation, isomerisation, glycosylation, oxidation, free cysteine)', 'pI, charge at pH 7.4, GRAVY, CDR composition', 'Rule-of-thumb developability flags', 'Comparison of up to twelve chains'],
    engines: 'TypeScript',
    limits: 'No numbering database, no structure; the flags are published rules of thumb, not validated cut-offs',
    cloudLater: '',
  },
  {
    id: 'stats', path: '/statistics', name: 'Statistics Studio', short: 'Statistics',
    blurb: 'Classical tests, effect sizes, multiple-testing correction and meta-analysis with forest and funnel plots.',
    status: 'live', milestone: 'M1', accent: 190,
    inputs: ['Grouped values (long or wide)', 'Two numeric columns', 'Contingency table', 'List of p-values', 'Study-level effects'],
    analyses: ['Welch / Student / paired / one-sample t-tests', 'One-way ANOVA and Brown–Forsythe', 'Mann–Whitney, Wilcoxon signed rank, Kruskal–Wallis', 'Chi-square, Fisher exact and odds ratios', 'Pearson, Spearman and linear regression', 'Holm, Bonferroni and Benjamini–Hochberg', 'Meta-analysis (FE, DerSimonian–Laird, REML, Paule–Mandel), Egger test, leave-one-out', 'Forest and funnel plots'],
    engines: 'TypeScript kernels in a Web Worker',
    limits: 'No mixed models, no survival or multivariate models; the meta-analysis assumes independent studies and known variances',
    cloudLater: '',
  },
];

export const studioById = (id: string) => STUDIOS.find((s) => s.id === id);
