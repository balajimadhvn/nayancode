#!/usr/bin/env bash
# Vendors WebAssembly builds of MIT-licensed bioinformatics tools (self-hosted: no third-party CDN at runtime).
#   minimap2 2.22  (Heng Li, MIT)            https://github.com/lh3/minimap2
#   samtools 1.17  (Genome Research Ltd, MIT/Expat) https://github.com/samtools/samtools
# Builds: biowasm (R. Aboukhalil, MIT) https://github.com/biowasm/biowasm
set -euo pipefail
cd "$(dirname "$0")/../public/wasm"
fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
for spec in minimap2/2.22 samtools/1.17; do
  tool=${spec%/*}; mkdir -p "$tool"
  for ext in js wasm data; do fetch "https://biowasm.com/cdn/v3/$spec/$tool.$ext" "$tool/$tool.$ext"; done
done
fetch https://raw.githubusercontent.com/lh3/minimap2/master/LICENSE.txt minimap2/LICENSE.txt
fetch https://raw.githubusercontent.com/samtools/samtools/develop/LICENSE samtools/LICENSE.txt
fetch https://raw.githubusercontent.com/biowasm/biowasm/main/LICENSE LICENSE.biowasm.txt
sha256sum minimap2/minimap2.* samtools/samtools.* > SHA256SUMS
echo "vendored: $(ls minimap2 samtools | wc -l) files"
