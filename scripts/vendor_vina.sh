#!/usr/bin/env bash
# Builds AutoDock Vina 1.2.7 (Apache-2.0, Trott & Olson 2010; Eberhardt et al. 2021) to WebAssembly with Emscripten.
# Output: public/wasm/vina/vina.{js,wasm} (single-thread, runs anywhere) and vina-mt.{js,wasm} (pthreads, needs
# cross-origin isolation), plus LICENSE files and SHA256SUMS. Only Vina, Boost (BSL-1.0) filesystem/serialization and
# the wrapper in scripts/vina-wasm/ are linked: no Open Babel, no GPL code.
#   Requirements: emsdk 4.0.x on PATH (source emsdk_env.sh), git, Boost >= 1.80 headers (BOOST_INC, default /usr/include).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$HOME/.cache/nayancode-build}
BOOST_INC=${BOOST_INC:-/usr/include}   # directory that contains boost/ (only boost/ is exposed to the compiler)
BOOST_TAG=${BOOST_TAG:-boost-1.90.0}
VINA_TAG=${VINA_TAG:-v1.2.7}
mkdir -p "$WORK"; cd "$WORK"
mkdir -p boost-inc; ln -sfn "$BOOST_INC/boost" boost-inc/boost; BOOST_INC=$WORK/boost-inc
[ -d AutoDock-Vina ] || git clone -q --depth 1 --branch "$VINA_TAG" https://github.com/ccsb-scripps/AutoDock-Vina.git
for l in filesystem serialization; do [ -d boost-$l ] || git clone -q --depth 1 --branch "$BOOST_TAG" https://github.com/boostorg/$l.git boost-$l; done
V=$WORK/AutoDock-Vina/src/lib
OUT=$ROOT/public/wasm/vina; mkdir -p "$OUT"
LIBSRC="ad4cache cache non_cache conf_independent coords grid szv_grid model monte_carlo mutate parallel_mc parse_pdbqt quasi_newton quaternion random utils vina"
build() { # $1 = st|mt
  local mode=$1 B=$WORK/obj-$1; mkdir -p "$B/vina"
  local cf="-O3 -DNDEBUG -std=c++20 -fexceptions -DBOOST_ALL_NO_LIB -DBOOST_FILESYSTEM_STATIC_LINK=1 -Wno-deprecated-declarations -I$ROOT/scripts/vina-wasm -I$V -I$BOOST_INC -I$WORK/boost-filesystem/src"
  local lf="-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=2GB -sMODULARIZE=1 -sEXPORT_NAME=VinaModule -sENVIRONMENT=web,worker,node -fexceptions -sEXPORTED_FUNCTIONS=_vina_dock,_vina_score,_vina_free,_malloc,_free -sEXPORTED_RUNTIME_METHODS=FS,UTF8ToString,stringToUTF8,lengthBytesUTF8 -sFORCE_FILESYSTEM=1"
  [ $mode = mt ] && { cf="$cf -pthread"; lf="$lf -pthread -sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency -sPTHREAD_POOL_SIZE_STRICT=0"; }
  local objs=()
  for f in $LIBSRC; do em++ $cf -c "$V/$f.cpp" -o "$B/vina/$f.o" & objs+=("$B/vina/$f.o"); while [ "$(jobs -r | wc -l)" -ge 8 ]; do sleep 0.2; done; done
  for f in path operations directory exception codecvt_error_category path_traits portability unique_path utf8_codecvt_facet; do em++ $cf -c "$WORK/boost-filesystem/src/$f.cpp" -o "$B/fs_$f.o" & objs+=("$B/fs_$f.o"); while [ "$(jobs -r | wc -l)" -ge 8 ]; do sleep 0.2; done; done
  em++ $cf -c "$ROOT/scripts/vina-wasm/wrapper.cpp" -o "$B/wrapper.o" & objs+=("$B/wrapper.o")
  wait
  local name=vina; [ $mode = mt ] && name=vina-mt
  em++ $cf $lf "${objs[@]}" ${EXTRA_OBJS:-} -o "$OUT/$name.js"
}
cp "$V/../../LICENSE" "$OUT/LICENSE.vina.txt"
# Vina uses boost::thread only for hardware_concurrency(); parallel.h is replaced by a std::thread version.
cp "$V/vina.h" "$V/vina.h.orig" 2>/dev/null || true
sed -i 's|#include <boost/thread/thread.hpp>.*|#include <thread>|; s|boost::thread::hardware_concurrency()|std::thread::hardware_concurrency()|' "$V/vina.h"
cp "$V/parallel_progress.h" "$V/parallel_progress.h.orig" 2>/dev/null || true
sed -i 's|#include <boost/thread/mutex.hpp>|#include <mutex>|; s|boost::mutex::scoped_lock self_lk(self);|std::lock_guard<std::mutex> self_lk(self);|; s|boost::mutex self;|std::mutex self;|' "$V/parallel_progress.h"
cp "$V/parallel.h" "$V/parallel.h.orig" 2>/dev/null || true; cp "$ROOT/scripts/vina-wasm/parallel.h" "$V/parallel.h"
build st
[ "${NO_MT:-0}" = 1 ] || build mt
cp "$WORK/boost-filesystem/LICENSE_1_0.txt" "$OUT/LICENSE.boost.txt" 2>/dev/null || true
(cd "$OUT" && sha256sum vina*.js vina*.wasm > SHA256SUMS)
ls -l "$OUT"
