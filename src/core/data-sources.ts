/** Every external service, dataset or vendored binary the app can touch, with the terms we rely on. Shown on /licenses. */
export interface DataSource { name: string; use: string; terms: string; commercialOk: boolean; attribution: string; url: string; kind: 'bundled' | 'live API' | 'vendored binary' | 'public domain facts' }

export const DATA_SOURCES: DataSource[] = [
  { name: 'Reactome pathways', kind: 'bundled', use: 'Expression enrichment, Atlas pathway membership (replaces KEGG)', terms: 'CC BY 4.0', commercialOk: true, attribution: 'Reactome (Milacic et al. 2024)', url: 'https://reactome.org/license' },
  { name: 'WikiPathways', kind: 'bundled', use: 'Expression enrichment, Atlas (replaces KEGG)', terms: 'CC0 1.0', commercialOk: true, attribution: 'WikiPathways (Agrawal et al. 2024)', url: 'https://www.wikipathways.org/' },
  { name: 'Gene Ontology + GOA annotations', kind: 'bundled', use: 'Expression enrichment (GO Biological Process, true-path propagated)', terms: 'CC BY 4.0', commercialOk: true, attribution: 'Gene Ontology Consortium (2023)', url: 'https://geneontology.org/docs/go-citation-policy/' },
  { name: 'JASPAR 2024 CORE vertebrates', kind: 'bundled', use: 'Motif scanning in Sequence Studio (replaces MEME / HOMER)', terms: 'CC BY 4.0', commercialOk: true, attribution: 'JASPAR 2024 (Rauluseviciute et al.)', url: 'https://jaspar.elixir.no/' },
  { name: 'NCBI Gene identifier table', kind: 'bundled', use: 'Ensembl / Entrez → HGNC symbol mapping', terms: 'Public domain (NCBI)', commercialOk: true, attribution: 'NCBI Gene', url: 'https://www.ncbi.nlm.nih.gov/home/about/policies/' },
  { name: 'NCBI RefSeq reference genomes (8 small genomes)', kind: 'bundled', use: 'Genome Studio: mapping reference, genome viewer, primer and CRISPR off-target search (E. coli K-12, S. aureus NCTC 8325, B. subtilis 168, M. tuberculosis H37Rv, S. cerevisiae S288C, phage lambda and T7, SARS-CoV-2)', terms: 'Public domain in the United States (NCBI RefSeq); sequences unmodified, SHA-256 in public/genomes/manifest.json', commercialOk: true, attribution: "O'Leary et al. (2016) Nucleic Acids Res 44:D733", url: 'https://www.ncbi.nlm.nih.gov/home/about/policies/' },
  { name: 'CFD mismatch and PAM score tables (SpCas9)', kind: 'public domain facts', use: 'CRISPR off-target scoring (Doench et al. 2016, Supplementary Table 19)', terms: 'Published numerical tables; copied from the MIT-licensed crisprScore package (Genentech, Inc.), no GPL code used', commercialOk: true, attribution: 'Doench et al. (2016) Nat Biotechnol 34:184; crisprScore (MIT)', url: 'https://github.com/crisprVerse/crisprScore' },
  { name: 'minimap2 2.22 (WebAssembly)', kind: 'vendored binary', use: 'Genome Studio read mapping', terms: 'MIT (Heng Li)', commercialOk: true, attribution: 'Li H (2018) Bioinformatics', url: 'https://github.com/lh3/minimap2' },
  { name: 'samtools 1.17 (WebAssembly)', kind: 'vendored binary', use: 'Genome Studio sort / index / depth / pileup', terms: 'MIT/Expat (Genome Research Ltd)', commercialOk: true, attribution: 'Danecek et al. (2021) GigaScience', url: 'https://github.com/samtools/samtools' },
  { name: 'bcftools 1.10 (WebAssembly)', kind: 'vendored binary', use: 'Genome Studio SNV and indel calling (mpileup + multiallelic caller)', terms: 'MIT/Expat (Genome Research Ltd); built without the optional GPL GSL code', commercialOk: true, attribution: 'Danecek P et al. (2021) Twelve years of SAMtools and BCFtools. GigaScience 10:giab008. Build: biowasm (MIT)', url: 'https://github.com/samtools/bcftools' },
  { name: 'biowasm build packaging', kind: 'vendored binary', use: 'WebAssembly builds of the two tools above', terms: 'MIT (R. Aboukhalil)', commercialOk: true, attribution: 'biowasm', url: 'https://github.com/biowasm/biowasm' },
  { name: 'RCSB Protein Data Bank', kind: 'live API', use: 'Structure Studio: coordinates and entry metadata by ID', terms: 'CC0 1.0 (public domain)', commercialOk: true, attribution: 'wwPDB / RCSB PDB', url: 'https://www.rcsb.org/pages/policies' },
  { name: 'AlphaFold Protein Structure Database', kind: 'live API', use: 'Structure Studio: predicted models by UniProt accession (replaces AlphaFold 3 weights, which are non-commercial)', terms: 'CC BY 4.0', commercialOk: true, attribution: 'AlphaFold DB, Google DeepMind & EMBL-EBI', url: 'https://alphafold.ebi.ac.uk/' },
  { name: 'UniProt', kind: 'live API', use: 'Atlas: protein function, accession, PDB cross-references', terms: 'CC BY 4.0', commercialOk: true, attribution: 'The UniProt Consortium', url: 'https://www.uniprot.org/help/license' },
  { name: 'Open Targets Platform', kind: 'live API', use: 'Atlas / Variant Studio: gene–disease associations (replaces OMIM, DisGeNET)', terms: 'CC0 1.0', commercialOk: true, attribution: 'Open Targets (Ochoa et al. 2023)', url: 'https://platform-docs.opentargets.org/licence' },
  { name: 'CIViC', kind: 'live API', use: 'Variant Studio: clinical evidence for cancer variants (replaces OncoKB, COSMIC)', terms: 'CC0 1.0', commercialOk: true, attribution: 'CIViC (Griffith et al. 2017)', url: 'https://civicdb.org/about' },
  { name: 'ClinVar (NCBI E-utilities)', kind: 'live API', use: 'Variant Studio: clinical significance (replaces HGMD)', terms: 'Public domain (NCBI)', commercialOk: true, attribution: 'ClinVar (Landrum et al. 2018)', url: 'https://www.ncbi.nlm.nih.gov/home/about/policies/' },
  { name: 'gnomAD via MyVariant.info', kind: 'live API', use: 'Variant Studio: population allele frequency (only gnomAD fields are requested; dbNSFP/CADD/SpliceAI are never requested)', terms: 'gnomAD: CC0 · MyVariant.info: free service', commercialOk: true, attribution: 'gnomAD (Karczewski et al. 2020)', url: 'https://gnomad.broadinstitute.org/policies' },
  { name: 'Ensembl REST (VEP)', kind: 'live API', use: 'Variant Studio: optional consequence annotation', terms: 'Free, fair-use rate limits; data open', commercialOk: true, attribution: 'Ensembl, EMBL-EBI', url: 'https://rest.ensembl.org/' },
  { name: 'PubChem PUG-REST', kind: 'live API', use: 'Chemistry Studio: compound lookup by name (replaces DrugBank)', terms: 'Public domain (NCBI)', commercialOk: true, attribution: 'PubChem', url: 'https://pubchem.ncbi.nlm.nih.gov/docs/programmatic-access' },
  { name: 'ChEMBL', kind: 'live API', use: 'QSAR Lab: bioactivity datasets by target (replaces DrugBank)', terms: 'CC BY-SA 3.0 (share-alike applies if you redistribute derived datasets)', commercialOk: true, attribution: 'ChEMBL, EMBL-EBI (Zdrazil et al. 2024)', url: 'https://chembl.gitbook.io/chembl-interface-documentation/about#data-licensing' },
  { name: 'BLOSUM62 matrix', kind: 'public domain facts', use: 'Protein alignment scoring', terms: 'Published numerical matrix (Henikoff & Henikoff 1992)', commercialOk: true, attribution: 'Henikoff & Henikoff 1992', url: 'https://doi.org/10.1073/pnas.89.22.10915' },
  { name: 'Restriction enzyme sites', kind: 'public domain facts', use: 'Sequence Studio digest / cloning', terms: 'Recognition sequences and cut positions are scientific facts; compiled by hand, no database copied', commercialOk: true, attribution: 'none required', url: '' },
  { name: 'Amino-acid scales (Kyte–Doolittle, TOP-IDP, Miller max ASA, Bondi radii)', kind: 'public domain facts', use: 'Protein and structure analysis', terms: 'Published numerical scales', commercialOk: true, attribution: 'Kyte & Doolittle 1982; Campen et al. 2008; Miller et al. 1987; Bondi 1964', url: '' },
  { name: 'MIT CRISPR mismatch weights', kind: 'public domain facts', use: 'CRISPR specificity score', terms: 'Published numerical weights (Hsu et al. 2013)', commercialOk: true, attribution: 'Hsu et al. 2013', url: 'https://doi.org/10.1038/nbt.2647' },
  { name: 'Canonical cell-type marker genes', kind: 'public domain facts', use: 'Single-cell heuristic annotation', terms: 'HGNC gene symbols from common knowledge; no curated database copied', commercialOk: true, attribution: 'HGNC', url: 'https://www.genenames.org/' },
];

/** What a commercial-licence-restricted tool was replaced with. */
export const REPLACEMENTS: [string, string, string][] = [
  ['KEGG pathways', 'Reactome + WikiPathways + Gene Ontology (bundled, offline)', 'Expression Studio → Enrichment (ORA and preranked GSEA); Atlas'],
  ['COSMIC signatures', 'De novo NMF on your own cohort + NNLS refit to any matrix you upload', 'Variant Studio → Signatures'],
  ['OncoKB', 'CIViC (CC0)', 'Variant Studio → Evidence'],
  ['OMIM / DisGeNET / HGMD', 'Open Targets (CC0) + ClinVar (public domain)', 'Atlas; Variant Studio → Evidence'],
  ['DrugBank', 'PubChem (public domain) + ChEMBL (CC BY-SA)', 'Chemistry Studio → add by name; QSAR Lab'],
  ['MEME Suite / HOMER', 'JASPAR matrices (CC BY 4.0) + clean-room PWM scanner', 'Sequence Studio → Motifs'],
  ['SignalP / TMHMM / NetMHC', 'Published open scales: Kyte–Doolittle hydropathy, TOP-IDP disorder', 'Sequence Studio → Protein'],
  ['CADD / SpliceAI scores', 'Not replaced: ClinVar + gnomAD + Ensembl VEP consequences', 'Variant Studio'],
  ['AlphaFold 3 / ESM3 weights (non-commercial)', 'AlphaFold DB models (CC BY 4.0); ESM-2 (MIT) planned', 'Structure Studio'],
  ['PLIP / fpocket / Primer3 / trimAl / FastTree / IQ-TREE (GPL)', 'Clean-room re-implementations from the papers', 'Structure, Sequence and Phylogenetics studios'],
];
export const NOT_USED = [
  ['KEGG, COSMIC, OncoKB, DrugBank, OMIM, HGMD, DisGeNET', 'commercial licence required'],
  ['MEME Suite, CADD, SpliceAI scores, dbNSFP, NetMHC / SignalP / TMHMM', 'academic / non-commercial licences'],
  ['FastTree, IQ-TREE, Primer3, Prodigal, trimAl, PLIP, fpocket, Clustal Omega (GPL)', 'copyleft: algorithms are re-implemented clean-room, no GPL code is shipped'],
  ['AlphaFold 3 weights, ESM3-open weights', 'non-commercial model licences'],
];
