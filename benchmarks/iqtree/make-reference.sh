#!/usr/bin/env bash
# IQ-TREE reference results for the phylogenetics benchmark (phylo.bench.test.ts). IQ-TREE (GPL) is only run here and
# in CI; it is never shipped. Alignments: benchmarks/iqtree/data (exported by export-alignments.R).
#   bash benchmarks/iqtree/make-reference.sh [bin-dir]          # fixed-model trees, model selection, bootstrap
#   bash benchmarks/iqtree/make-reference.sh [bin-dir] eval     # after the bench: score the Workbench trees in IQ-TREE
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=${1:-}; [ -n "$BIN" ] && export PATH="$BIN:$PATH"; MODE=${2:-ref}
D=benchmarks/iqtree/data; W=benchmarks/.cache/iqtree; O=benchmarks/iqtree/ref; mkdir -p $W $O
IQ=$(command -v iqtree3 || command -v iqtree2)
model() { case $1 in chloroplast) echo "Poisson+G4";; *) echo "HKY+G4";; esac; }
for ds in woodmouse Laurasiatherian chloroplast yeast; do
  gunzip -kfc $D/$ds.fa.gz > $W/$ds.fa; m=$(model $ds)
  if [ "$MODE" = eval ]; then
    [ -f $W/$ds.workbench.nwk ] && $IQ -s $W/$ds.fa -m $m -te $W/$ds.workbench.nwk -T 1 -seed 1 --prefix $W/$ds.eval -quiet -redo
    continue
  fi
  # Finished runs are kept; an interrupted run resumes from IQ-TREE's checkpoint (REDO=1 starts afresh).
  R=${REDO:+-redo}; done_() { [ -z "${REDO:-}" ] && [ -f $W/$1.iqtree ]; }
  done_ $ds.ml || $IQ -s $W/$ds.fa -m $m -T 1 -seed 1 --prefix $W/$ds.ml -quiet $R
  case $ds in chloroplast) mset="Poisson";; *) mset="JC,K2P,HKY";; esac
  done_ $ds.mf || $IQ -s $W/$ds.fa -m MF -mset $mset -mrate E,G4 -merit BIC -T 1 -seed 1 --prefix $W/$ds.mf -quiet $R
  # Standard (non-parametric) bootstrap, 100 replicates, on the two DNA sets the Workbench bootstrap is compared on.
  case $ds in woodmouse|Laurasiatherian) done_ $ds.boot || $IQ -s $W/$ds.fa -m $m -b 100 -T 1 -seed 1 --prefix $W/$ds.boot -quiet $R;; esac
done
python3 benchmarks/iqtree/summarise.py $W $O $MODE "$($IQ --version | head -1)"
