# Bundled reference genomes

Eight small RefSeq genomes (FASTA + GFF3, gzip, 11.7 MiB in total) used by Genome Studio for mapping, the genome viewer,
primer specificity and CRISPR off-target search. Each file is below 25 MiB.

`manifest.json` records, per genome, the RefSeq assembly accession and name, the NCBI download URL, byte size, SHA-256 and
MD5 (checked against NCBI's `md5checksums.txt`) and the sequences with their lengths.

Licence: NCBI RefSeq records are public domain in the United States (works of the US Government, 17 U.S.C. § 105) and NCBI
places no restrictions on their use or distribution; please cite the original submitters and RefSeq
(O'Leary et al. 2016, Nucleic Acids Res 44:D733). Files are NCBI's own, unmodified.

Rebuild or verify: `node scripts/fetch-genomes.mjs` (downloads and rewrites the manifest) and
`node scripts/fetch-genomes.mjs --check` (verifies files against the manifest).
