#!/usr/bin/env bash
# Builds the unmodified native AutoDock Vina 1.2.7 CLI (reference for the docking benchmark; never shipped).
# Needs g++ and system Boost (system, thread, filesystem, program_options, serialization). Output: .cache/vina-native/vina
set -euo pipefail
cd "$(dirname "$0")/.."; mkdir -p .cache; cd .cache
[ -d vina-src ] || git clone -q --depth 1 --branch v1.2.7 https://github.com/ccsb-scripps/AutoDock-Vina.git vina-src
mkdir -p vina-native
S=vina-src/src
g++ -O3 -DNDEBUG -std=c++17 -pthread -DVERSION='"v1.2.7"' -Wno-deprecated-declarations -I$S/lib \
  $S/main/main.cpp $(for f in ad4cache cache non_cache conf_independent coords grid szv_grid model monte_carlo mutate parallel_mc parse_pdbqt quasi_newton quaternion random utils vina; do echo $S/lib/$f.cpp; done) \
  -o vina-native/vina -lboost_system -lboost_thread -lboost_serialization -lboost_filesystem -lboost_program_options
vina-native/vina --version
