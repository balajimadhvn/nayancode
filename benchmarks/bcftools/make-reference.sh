#!/usr/bin/env bash
# Native reference calls for the Genome Studio benchmark (genome.bench.test.ts).
# Data: E. coli B REL606 reference (NCBI NC_012967.1) with planted edits (plant.mjs), and the first 800,000 reads of
# SRR2584863 read 1 (Illumina, an evolved line from the E. coli long-term evolution experiment; Tenaillon et al. 2016).
# The same commands as the Workbench, with current native builds of minimap2, samtools and bcftools.
#   bash benchmarks/fetch.sh && bash benchmarks/bcftools/make-reference.sh [bin-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=${1:-}; [ -n "$BIN" ] && export PATH="$BIN:$PATH"
C=benchmarks/.cache/ecoli; O=benchmarks/bcftools
node $O/plant.mjs $C/REL606.fa $C/REL606_planted.fa $O/truth.json
T0=$(date +%s.%N)
minimap2 -a -x sr --secondary=no -t 1 $C/REL606_planted.fa $C/SRR2584863_1.800k.fastq 2>/dev/null | samtools sort -@1 -o $C/native.bam -
samtools index $C/native.bam; samtools faidx $C/REL606_planted.fa
bcftools mpileup -f $C/REL606_planted.fa -q 20 -Q 20 -d 10000 -a AD,DP -Ou $C/native.bam 2>/dev/null | bcftools call -mv --ploidy 1 -Ov -o $O/native.vcf
T1=$(date +%s.%N)
{ echo "{"; echo "  \"minimap2\": \"$(minimap2 --version)\","; echo "  \"samtools\": \"$(samtools --version | head -1 | cut -d' ' -f2)\",";
  echo "  \"bcftools\": \"$(bcftools --version | head -1 | cut -d' ' -f2)\","; echo "  \"runtimeSeconds\": $(echo "$T1 - $T0" | bc), \"threads\": 1"; echo "}"; } > $O/native.versions.json
grep -vc '^#' $O/native.vcf | xargs echo "native calls:"
# Case study C (docs/case-studies/ecoli.case.test.ts): the same native pipeline against the unmodified REL606 reference.
minimap2 -a -x sr --secondary=no -t 1 $C/REL606.fa $C/SRR2584863_1.800k.fastq 2>/dev/null | samtools sort -@1 -o $C/native_rel606.bam -
samtools index $C/native_rel606.bam; samtools faidx $C/REL606.fa
bcftools mpileup -f $C/REL606.fa -q 20 -Q 20 -d 10000 -a AD,DP -Ou $C/native_rel606.bam 2>/dev/null | bcftools call -mv --ploidy 1 -Ov -o $O/native_rel606.vcf
# Optional second step, after `npm run bench -- benchmarks/bcftools` has saved the Workbench's own alignments:
# native bcftools on the Workbench BAM separates aligner differences from caller-version differences.
if [ -f $C/workbench.bam ]; then
  samtools index $C/workbench.bam
  bcftools mpileup -f $C/REL606_planted.fa -q 20 -Q 20 -d 10000 -a AD,DP -Ou $C/workbench.bam 2>/dev/null | bcftools call -mv --ploidy 1 -Ov -o $O/native_on_workbench_bam.vcf
fi
