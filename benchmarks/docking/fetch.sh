#!/usr/bin/env bash
# Downloads the PDB files listed in complexes.tsv into benchmarks/.cache/docking/pdb and checks their SHA-256 sums.
# (Public data: RCSB PDB, CC0.) The native Vina reference binary is built separately by build_native_vina.sh.
set -euo pipefail
cd "$(dirname "$0")/.."; mkdir -p .cache/docking/pdb; cd .cache/docking/pdb
grep -v '^#' ../../../docking/complexes.tsv | while IFS=$'\t' read -r id comp smi sha res heavy; do
  f="$id.pdb"
  if [ -f "$f" ] && echo "$sha  $f" | sha256sum -c --quiet 2>/dev/null; then continue; fi
  curl -fsSL --retry 3 -o "$f" "https://files.rcsb.org/download/$id.pdb"
  echo "$sha  $f" | sha256sum -c --quiet || { echo "checksum mismatch for $f" >&2; exit 1; }
done
echo "docking inputs ready in $(pwd) ($(ls | wc -l) files)"
