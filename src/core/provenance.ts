import { newId } from './id';
import { create } from 'zustand';
import { BRAND } from './brand';

export interface ToolInfo { id: string; name: string; version: string; engine: string; citations: string[]; describe: (p: Record<string, unknown>) => string }

export const CITATIONS: Record<string, string> = {
  santalucia1998: 'SantaLucia J Jr. (1998) A unified view of polymer, dumbbell, and oligonucleotide DNA nearest-neighbor thermodynamics. Proc Natl Acad Sci USA 95:1460–1465.',
  owczarzy2008: 'Owczarzy R, et al. (2008) Predicting stability of DNA duplexes in solutions containing magnesium and monovalent cations. Biochemistry 47:5336–5353.',
  needleman1970: 'Needleman SB, Wunsch CD (1970) A general method applicable to the search for similarities in the amino acid sequence of two proteins. J Mol Biol 48:443–453.',
  smith1981: 'Smith TF, Waterman MS (1981) Identification of common molecular subsequences. J Mol Biol 147:195–197.',
  gotoh1982: 'Gotoh O (1982) An improved algorithm for matching biological sequences. J Mol Biol 162:705–708.',
  henikoff1992: 'Henikoff S, Henikoff JG (1992) Amino acid substitution matrices from protein blocks. Proc Natl Acad Sci USA 89:10915–10919.',
  robinson2010: 'Robinson MD, Oshlack A (2010) A scaling normalization method for differential expression analysis of RNA-seq data. Genome Biol 11:R25.',
  anders2010: 'Anders S, Huber W (2010) Differential expression analysis for sequence count data. Genome Biol 11:R106.',
  livak2001: 'Livak KJ, Schmittgen TD (2001) Analysis of relative gene expression data using real-time quantitative PCR and the 2−ΔΔCT method. Methods 25:402–408.',
  pfaffl2001: 'Pfaffl MW (2001) A new mathematical model for relative quantification in real-time RT–PCR. Nucleic Acids Res 29:e45.',
  vandesompele2002: 'Vandesompele J, et al. (2002) Accurate normalization of real-time quantitative RT-PCR data by geometric averaging of multiple internal control genes. Genome Biol 3:research0034.',
  marquardt1963: 'Marquardt DW (1963) An algorithm for least-squares estimation of nonlinear parameters. J Soc Ind Appl Math 11:431–441.',
  ritz2015: 'Ritz C, Baty F, Streibig JC, Gerhard D (2015) Dose-response analysis using R. PLoS ONE 10:e0146021.',
  gottschalk2005: 'Gottschalk PG, Dunn JR (2005) The five-parameter logistic: a characterization and comparison with the four-parameter logistic. Anal Biochem 343:54–65.',
  cohen1988: 'Cohen J (1988) Statistical Power Analysis for the Behavioral Sciences, 2nd ed. Lawrence Erlbaum.',
  schoenfeld1981: 'Schoenfeld DA (1981) The asymptotic properties of nonparametric tests for comparing survival distributions. Biometrika 68:316–319.',
  hart2013: 'Hart SN, Therneau TM, Zhang Y, Poland GA, Kocher JP (2013) Calculating sample size estimates for RNA sequencing data. J Comput Biol 20:970–978.',
  lenth1989: 'Lenth RV (1989) Algorithm AS 243: cumulative distribution function of the non-central t distribution. Appl Stat 38:185–189.',
  nayancode: 'Madhavan B (2026) Nayancode Workbench: open-source bioinformatics and cheminformatics in the web browser. Zenodo. https://doi.org/10.5281/zenodo.23393495',
  law2014: 'Law CW, Chen Y, Shi W, Smyth GK (2014) voom: precision weights unlock linear model analysis tools for RNA-seq read counts. Genome Biol 15:R29.',
  smyth2004: 'Smyth GK (2004) Linear models and empirical Bayes methods for assessing differential expression in microarray experiments. Stat Appl Genet Mol Biol 3:Article3.',
  benjamini1995: 'Benjamini Y, Hochberg Y (1995) Controlling the false discovery rate. J R Stat Soc B 57:289–300.',
  rdkit: 'RDKit: Open-source cheminformatics. https://www.rdkit.org',
  rogers2010: 'Rogers D, Hahn M (2010) Extended-connectivity fingerprints. J Chem Inf Model 50:742–754.',
  lipinski2001: 'Lipinski CA, et al. (2001) Experimental and computational approaches to estimate solubility and permeability in drug discovery and development settings. Adv Drug Deliv Rev 46:3–26.',
  saitou1987: 'Saitou N, Nei M (1987) The neighbor-joining method: a new method for reconstructing phylogenetic trees. Mol Biol Evol 4:406–425.',
  felsenstein1985: 'Felsenstein J (1985) Confidence limits on phylogenies: an approach using the bootstrap. Evolution 39:783–791.',
  ondov2016: 'Ondov BD, et al. (2016) Mash: fast genome and metagenome distance estimation using MinHash. Genome Biol 17:132.',
  mclaren2016: 'McLaren W, et al. (2016) The Ensembl Variant Effect Predictor. Genome Biol 17:122.',
  butler2015: 'Butler A, et al. (2015) Spatial reconstruction of single-cell gene expression data. Nat Biotechnol 33:495–502 (HVG dispersion binning).',
  blondel2008: 'Blondel VD, et al. (2008) Fast unfolding of communities in large networks. J Stat Mech P10008.',
  johnson2007: 'Johnson WE, Li C, Rabinovic A (2007) Adjusting batch effects in microarray expression data using empirical Bayes methods. Biostatistics 8(1):118–127.',
  mcinnes2018: 'McInnes L, Healy J, Melville J (2018) UMAP: Uniform Manifold Approximation and Projection for dimension reduction. arXiv:1802.03426.',
  vandermaaten2008: 'van der Maaten L, Hinton G (2008) Visualizing data using t-SNE. J Mach Learn Res 9:2579–2605.',
  halko2011: 'Halko N, Martinsson PG, Tropp JA (2011) Finding structure with randomness: probabilistic algorithms for constructing approximate matrix decompositions. SIAM Rev 53:217–288.',
  moran1950: 'Moran PAP (1950) Notes on continuous stochastic phenomena. Biometrika 37:17–23.',
  anderson2001: 'Anderson MJ (2001) A new method for non-parametric multivariate analysis of variance. Austral Ecol 26:32–46.',
  aitchison1982: 'Aitchison J (1982) The statistical analysis of compositional data. J R Stat Soc B 44:139–177.',
  gloor2017: 'Gloor GB, et al. (2017) Microbiome datasets are compositional: and this is not optional. Front Microbiol 8:2224.',
  hurlbert1971: 'Hurlbert SH (1971) The nonconcept of species diversity: a critique and alternative parameters. Ecology 52:577–586.',
  mann1947: 'Mann HB, Whitney DR (1947) On a test of whether one of two random variables is stochastically larger than the other. Ann Math Stat 18:50–60.',
  fisher1922: 'Fisher RA (1922) On the interpretation of χ² from contingency tables, and the calculation of P. J R Stat Soc 85:87–94.',
  subramanian2005: 'Subramanian A, et al. (2005) Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. Proc Natl Acad Sci USA 102:15545–15550.',
  reactome2024: 'Milacic M, et al. (2024) The Reactome Pathway Knowledgebase 2024. Nucleic Acids Res 52:D672–D678. (CC BY 4.0)',
  wikipathways2024: 'Agrawal A, et al. (2024) WikiPathways 2024: next generation pathway database. Nucleic Acids Res 52:D679–D689. (CC0)',
  go2023: 'Gene Ontology Consortium (2023) The Gene Ontology knowledgebase in 2023. Genetics 224:iyad031. (CC BY 4.0)',
  lee2001: 'Lee DD, Seung HS (2001) Algorithms for non-negative matrix factorization. Adv Neural Inf Process Syst 13:556–562.',
  alexandrov2013: 'Alexandrov LB, et al. (2013) Signatures of mutational processes in human cancer. Nature 500:415–421.',
  lawson1974: 'Lawson CL, Hanson RJ (1974) Solving Least Squares Problems. Prentice-Hall.',
  clinvar2018: 'Landrum MJ, et al. (2018) ClinVar: improving access to variant interpretations and supporting evidence. Nucleic Acids Res 46:D1062–D1067. (public domain)',
  civic2017: 'Griffith M, et al. (2017) CIViC is a community knowledgebase for expert crowdsourcing the clinical interpretation of variants in cancer. Nat Genet 49:170–174. (CC0)',
  opentargets2023: 'Ochoa D, et al. (2023) The next-generation Open Targets Platform. Nucleic Acids Res 51:D1353–D1359. (CC0)',
  gnomad2020: 'Karczewski KJ, et al. (2020) The mutational constraint spectrum quantified from variation in 141,456 humans. Nature 581:434–443.',
  breiman2001: 'Breiman L (2001) Random forests. Mach Learn 45:5–32.',
  butina1999: 'Butina D (1999) Unsupervised data base clustering based on Daylight\'s fingerprint and Tanimoto similarity. J Chem Inf Comput Sci 39:747–750.',
  oecd2007: 'OECD (2007) Guidance document on the validation of (Q)SAR models. OECD Series on Testing and Assessment 69.',
  hsu2013: 'Hsu PD, et al. (2013) DNA targeting specificity of RNA-guided Cas9 nucleases. Nat Biotechnol 31:827–832.',
  kyte1982: 'Kyte J, Doolittle RF (1982) A simple method for displaying the hydropathic character of a protein. J Mol Biol 157:105–132.',
  campen2008: 'Campen A, et al. (2008) TOP-IDP-scale: a new amino acid scale measuring propensity for intrinsic disorder. Protein Pept Lett 15:956–963.',
  jaspar2024: 'Rauluseviciute I, et al. (2024) JASPAR 2024: 20th anniversary of the open-access database of transcription factor binding profiles. Nucleic Acids Res 52:D174–D182. (CC BY 4.0)',
  ewing1998: 'Ewing B, Green P (1998) Base-calling of automated sequencer traces using phred. II. Error probabilities. Genome Res 8:186–194.',
  gibson2009: 'Gibson DG, et al. (2009) Enzymatic assembly of DNA molecules up to several hundred kilobases. Nat Methods 6:343–345.',
  engler2008: 'Engler C, Kandzia R, Marillonnet S (2008) A one pot, one step, precision cloning method with high throughput capability. PLoS ONE 3:e3647.',
  lozupone2005: 'Lozupone C, Knight R (2005) UniFrac: a new phylogenetic method for comparing microbial communities. Appl Environ Microbiol 71:8228–8235.',
  felsenstein1981: 'Felsenstein J (1981) Evolutionary trees from DNA sequences: a maximum likelihood approach. J Mol Evol 17:368–376.',
  hasegawa1985: 'Hasegawa M, Kishino H, Yano T (1985) Dating of the human-ape splitting by a molecular clock of mitochondrial DNA. J Mol Evol 22:160–174.',
  yang1994: 'Yang Z (1994) Maximum likelihood phylogenetic estimation from DNA sequences with variable rates over sites: approximate methods. J Mol Evol 39:306–314.',
  hendlich1997: 'Hendlich M, Rippmann F, Barnickel G (1997) LIGSITE: automatic and efficient detection of potential small molecule-binding sites in proteins. J Mol Graph Model 15:359–363.',
  shrake1973: 'Shrake A, Rupley JA (1973) Environment and exposure to solvent of protein atoms. J Mol Biol 79:351–371.',
  kabsch1976: 'Kabsch W (1976) A solution for the best rotation to relate two sets of vectors. Acta Crystallogr A 32:922–923.',
  horn1987: 'Horn BKP (1987) Closed-form solution of absolute orientation using unit quaternions. J Opt Soc Am A 4:629–642.',
  zhang2004: 'Zhang Y, Skolnick J (2004) Scoring function for automated assessment of protein structure template quality. Proteins 57:702–710.',
  li2018: 'Li H (2018) Minimap2: pairwise alignment for nucleotide sequences. Bioinformatics 34:3094–3100. (MIT)',
  danecek2021: 'Danecek P, et al. (2021) Twelve years of SAMtools and BCFtools. GigaScience 10:giab008. (MIT)',
  robinson2011: 'Robinson JT, et al. (2011) Integrative genomics viewer. Nat Biotechnol 29:24–26. (igv.js: MIT)',
  doench2016: 'Doench JG, et al. (2016) Optimized sgRNA design to maximize activity and minimize off-target effects of CRISPR-Cas9. Nat Biotechnol 34:184–191. (CFD score tables)',
  bae2014: 'Bae S, Park J, Kim JS (2014) Cas-OFFinder: a fast and versatile algorithm that searches for potential off-target sites of Cas9 RNA-guided endonucleases. Bioinformatics 30:1473–1475.',
  ye2012: 'Ye J, et al. (2012) Primer-BLAST: a tool to design target-specific primers for polymerase chain reaction. BMC Bioinformatics 13:134. (design reference only; no code used)',
  oleary2016: "O'Leary NA, et al. (2016) Reference sequence (RefSeq) database at NCBI. Nucleic Acids Res 44:D733–D745.",
  uniprot2023: 'The UniProt Consortium (2023) UniProt: the Universal Protein Knowledgebase in 2023. Nucleic Acids Res 51:D523–D531. (CC BY 4.0)',
  trott2010: 'Trott O, Olson AJ (2010) AutoDock Vina: improving the speed and accuracy of docking with a new scoring function, efficient optimization, and multithreading. J Comput Chem 31:455–461.',
  eberhardt2021: 'Eberhardt J, Santos-Martins D, Tillack AF, Forli S (2021) AutoDock Vina 1.2.0: new docking methods, expanded force field, and Python bindings. J Chem Inf Model 61:3891–3898.',
  gasteiger1980: 'Gasteiger J, Marsili M (1980) Iterative partial equalization of orbital electronegativity: a rapid access to atomic charges. Tetrahedron 36:3219–3228.',
  blaney1994: 'Blaney JM, Dixon JS (1994) Distance geometry in molecular modeling. Rev Comput Chem 5:299–335.',
  molstar: 'Sehnal D, et al. (2021) Mol* Viewer: modern web app for 3D visualization and analysis of large biomolecular structures. Nucleic Acids Res 49:W431–W437.',
  rcsb: 'Berman HM, et al. (2000) The Protein Data Bank. Nucleic Acids Res 28:235–242.',
  alphafold: 'Jumper J, et al. (2021) Highly accurate protein structure prediction with AlphaFold. Nature 596:583–589.',
};

export interface ProvRecord {
  id: string; toolId: string; toolName: string; toolVersion: string; engine: string; citations: string[];
  params: Record<string, unknown>; inputs: { name: string; sha256: string; bytes: number }[];
  startedAt: string; durationMs: number; summary: string; app: string;
}

interface ProvState {
  records: ProvRecord[];
  add(r: Omit<ProvRecord, 'id' | 'app'>): void;
  clear(): void;
}

const KEY = 'wb.provenance.v1';
const load = (): ProvRecord[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };

export const useProvenance = create<ProvState>((set, get) => ({
  records: load(),
  add: (r) => {
    const rec: ProvRecord = { ...r, id: newId(), app: `${BRAND.name} ${BRAND.version}` };
    const records = [...get().records, rec].slice(-200);
    try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* storage unavailable */ }
    set({ records });
  },
  clear: () => { try { localStorage.removeItem(KEY); } catch { /* noop */ } set({ records: [] }); },
}));

/** Auto-written Methods paragraph + reference list from the provenance log. */
export function buildMethods(records: ProvRecord[]): { text: string; refs: string[] } {
  if (!records.length) return { text: '', refs: [] };
  const seen = new Set<string>();
  const sentences: string[] = [];
  const refKeys: string[] = [];
  for (const r of records) {
    const k = `${r.toolId}|${JSON.stringify(r.params)}`;
    if (seen.has(k)) continue; seen.add(k);
    sentences.push(`${r.summary} (${r.toolName} v${r.toolVersion}, ${r.engine}).`);
    for (const c of r.citations) if (!refKeys.includes(c)) refKeys.push(c);
  }
  const nums = (cs: string[]) => cs.map((c) => `[${refKeys.indexOf(c) + 1}]`).join('');
  const text = sentences.map((s) => {
    const r = records.find((x) => s.startsWith(x.summary));
    return r ? `${s} ${nums(r.citations)}`.trim() : s;
  }).join(' ');
  const last = records[records.length - 1];
  refKeys.push('nayancode');
  const tail = ` Analyses were run in the web browser with the ${last.app} [${refKeys.length}]; input files were analysed locally and not uploaded.`;
  return { text: text + tail, refs: refKeys.map((k, i) => `[${i + 1}] ${CITATIONS[k] ?? k}`) };
}
