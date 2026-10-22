# Handoff progress log (Workbench 1.2.0 tools)

Format and rules: see `HANDOFF-REMAINING-WORKBENCH-TOOLS.md`, section 3. Append new entries at the bottom.

## Items 3, 2, 4, 6, 12, 13 — DONE (2026-10-22, by Claude Sonnet 5.5)
- Survival (lab) 4f842f2 · ADMET (chemistry) 6f9d977 · Molecule tools (chemistry) aec819e · Proteomics (sequence) 2121c21 · GWAS-lite (variants) db57274 · Single-cell scale-up 3fbfd2a.
- All have unit tests with known answers (R `aml` values, numpy/scipy references, RDKit Python references, published peptide masses, simulations with planted truth) and e2e tests; all passing when committed.
- Honest limits recorded in the UI: ADMET logD R2 0.38 and BBB AUC 0.70 on scaffold split (solubility R2 0.84); no hERG model (no open dataset reachable); pharmacophore/USR are screening aids; GWAS-lite is for small cohorts.

## Item 9 Pseudoalignment (Expression Studio) — DONE (2026-10-22, commit b240777)
- FASTQ/FASTA streaming reader (src/core/readstream.ts), k-mer index + EM isoform quantification (pseudoalign.ts/.worker.ts), QuantifyCard wired into ExpressionStudio, bray2016 citation.
- Tests: pseudoalign.test.ts 11/11 pass (k-mer canonicalisation, unique/shared classification, paired, EM isoform split, Spearman > 0.98, TPM sums to 1e6, FASTQ/FASTA streaming).

## Items 10, 11, 5, 1, 7 — DONE (2026-10-22, by Claude Sonnet 5.5)
- Reference screening (microbiome) 8594aac · Small-genome assembler (genome) 555fa8d · Structure analysis tools (structure) 4650d3b · Publication figures box/MSA/tree (viz) d19f1e7 · Gene network view (expression) d776b61.
- Each has a known-answer unit test and an e2e test, all passing when committed.

## Item 8 Protein language-model tab (Sequence Studio) — DONE (2026-10-22, this session)
- Real, unit-tested scoring maths kept in src/studios/sequence/plm.ts (logSoftmax, maskedMarginal, pseudoPerplexity, meanPool, parseMutation); plm.test.ts 14/14 pass against known values.
- PlmPanel.tsx rewritten to be honest: it shows the experimental warning + a "Load model (~30 MB)" button (e2e-visible) but produces NO scores, because the live ESM-2 runtime (@huggingface/transformers) and ~30 MB weights are not bundled in this build. This removes a fabricated-embedding/mock-logits placeholder that displayed invented "masked marginal" numbers, per the handoff's "no fake results" rule.
- Verification: `npx tsc --noEmit` clean · `npx vitest run src/studios/sequence/plm.test.ts` 14/14 · `npm run build` OK · e2e "protein language model" passes.
- e2e fix: the pre-existing test looked for a button named /Load demo proteins/ that does not exist; changed to the real label 'Demo proteins' (label mismatch only, algorithm untouched, per handoff rule).
- Owner decision to enable live inference later: install @huggingface/transformers (verify Apache-2.0 first), add plm.worker.ts loading Xenova/esm2_t6_8M_UR50D, and possibly a CSP connect-src entry for huggingface.co in public/_headers (not edited here — rule forbids it).

## Remaining: section 5 (sync to Solagene website) and section 6 (final full-suite check)
- Section 5 prep in nayancode: CHANGELOG 1.2.0, ROADMAP strikethrough, src/core/studios.ts capability lists; then sync into company-webpage via scripts/sync-workbench.mjs; then section 6 final vitest + build + targeted e2e.
