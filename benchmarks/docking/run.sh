#!/usr/bin/env bash
# Regenerates benchmarks/results/docking.json: fetch inputs, build native Vina, run N parallel shards, aggregate.
#   usage: bash benchmarks/docking/run.sh [shards=8] [exhaustiveness=8]
set -euo pipefail
cd "$(dirname "$0")/../.."
N=${1:-8}; export EXH=${2:-8}
bash benchmarks/docking/fetch.sh
[ -x benchmarks/.cache/vina-native/vina ] || bash benchmarks/docking/build_native_vina.sh
rm -rf benchmarks/.cache/docking/results; mkdir -p benchmarks/.cache/docking/results
for i in $(seq 0 $((N-1))); do
  SHARD=$i/$N npx vitest run --config benchmarks/docking/vitest.shard.config.ts > benchmarks/.cache/docking/shard$i.log 2>&1 &
done
wait
node benchmarks/docking/aggregate.mjs
