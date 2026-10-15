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
echo "datasets ready in $(pwd)"
