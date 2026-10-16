#!/usr/bin/env bash
# Downloads the public datasets used by the benchmarks into benchmarks/.cache and checks their SHA-256 sums.
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p .cache; cd .cache
get() { # url sha256 file
  [ -f "$3" ] && echo "$2  $3" | sha256sum -c --quiet 2>/dev/null && return 0
  curl -fsSL -o "$3" "$1"; echo "$2  $3" | sha256sum -c --quiet
}
get https://bioconductor.org/packages/3.23/data/experiment/src/contrib/airway_1.32.0.tar.gz 829f654fc8075ac9d810574e8a8d4672e69e847c45fa2ce598d1ffbc30c7fe19 airway_1.32.0.tar.gz
get https://bioconductor.org/packages/3.23/data/experiment/src/contrib/pasilla_1.40.0.tar.gz 75122d45eb2c415d3e94d1b9bc9e4f6978c4504ef7e70f6bfeccb20547cb3db5 pasilla_1.40.0.tar.gz
get https://cf.10xgenomics.com/samples/cell-exp/1.1.0/pbmc3k/pbmc3k_filtered_gene_bc_matrices.tar.gz 847d6ebd9a1ec9a768f2be7e40ca42cbfe75ebeb6d76a4c24167041699dc28b5 pbmc3k.tar.gz
tar xzf airway_1.32.0.tar.gz; tar xzf pasilla_1.40.0.tar.gz; mkdir -p pbmc3k; tar xzf pbmc3k.tar.gz -C pbmc3k
# E. coli B REL606 reference (NCBI NC_012967.1) and the first 800,000 reads of SRR2584863 read 1 (ENA).
mkdir -p ecoli
[ -f ecoli/REL606.fa ] || curl -fsSL -o ecoli/REL606.fa "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=NC_012967.1&rettype=fasta&retmode=text"
echo "8c5a838b7b0d50614868d9ddc4f0789201018717df610eddf9d59461a87b91b9  ecoli/REL606.fa" | sha256sum -c --quiet
if ! echo "67af866fbf4cd426adc57769edb0fdde302323a6ecf463d3ab6bf054b4d8c8c7  ecoli/SRR2584863_1.800k.fastq" | sha256sum -c --quiet 2>/dev/null; then
  (curl -fsSL https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR258/003/SRR2584863/SRR2584863_1.fastq.gz | gzip -dc 2>/dev/null | head -n 3200000 > ecoli/SRR2584863_1.800k.fastq) || true
  echo "67af866fbf4cd426adc57769edb0fdde302323a6ecf463d3ab6bf054b4d8c8c7  ecoli/SRR2584863_1.800k.fastq" | sha256sum -c --quiet
fi
[ -f ecoli/REL606.gff3 ] || curl -fsSL -o ecoli/REL606.gff3 "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=NC_012967.1&rettype=gff3&retmode=text"
echo "de673a8630ba1e003138f8bc99f5dddb90ab7c94ea5719179df759e51b52d2ba  ecoli/REL606.gff3" | sha256sum -c --quiet
echo "datasets ready in $(pwd)"
