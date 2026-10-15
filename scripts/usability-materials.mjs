// Writes the participant files for the usability study (docs/usability/PROTOCOL.md, section 8) into
// docs/usability/materials/. PBMC3k needs `bash benchmarks/fetch.sh` first.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const out = 'docs/usability/materials';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/airway_counts.tsv`, gunzipSync(readFileSync('benchmarks/deseq2/airway_counts.tsv.gz')));
cpSync('benchmarks/deseq2/airway_samples.tsv', `${out}/airway_samples.tsv`);
const pb = 'benchmarks/.cache/pbmc3k/filtered_gene_bc_matrices/hg19';
if (existsSync(pb)) cpSync(pb, `${out}/pbmc3k`, { recursive: true });
else console.warn('PBMC3k not found: run `bash benchmarks/fetch.sh`, then this script again.');
writeFileSync(`${out}/README.txt`, 'Task files for the Nayancode Workbench usability study.\nairway: Himes et al. 2014 (GEO GSE52778), Bioconductor airway package (LGPL).\npbmc3k: 10x Genomics public dataset "3k PBMCs from a Healthy Donor".\n');
console.log(`materials written to ${out}`);
